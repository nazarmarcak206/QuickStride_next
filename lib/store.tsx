"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, authenticate, authenticateDev, fetchSnapshot, isDevLoginEnabled, withReauth } from "./api";
import { makeDemoState } from "./demoData";
import { PREPAYMENT_NOTE } from "./projectCreate";
import { currentMonthKey, monthKey, shiftMonth } from "./money";
import { migrateState } from "./migrate";
import { canAddPayment, canChangeProjectCurrency, canUpdatePayment } from "./payments";
import { detectTimeZone, type Settings } from "./settings";
import { telegramInitData } from "./telegram";
import type { Client, CrmState, Currency, Payment, Project, Reminder } from "./types";

const STORAGE_KEY = "quickstride.crm.v1";

export type StoreMode = "boot" | "demo" | "server" | "error";

export type ServerUser = {
  id: string;
  telegramName: string;
  telegramPhotoUrl: string;
  demoImported: boolean;
};

export type ImportCounts = { clients: number; projects: number; payments: number; reminders: number };

// Ідентифікатор запису — uuid: у Supabase crm_* стовпець id має тип uuid.
// Старі локальні id («project-…») лишаються недоторканими в localStorage:
// перенесення в базу — лише окремий узгоджений імпорт.
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

// Викликається лише на клієнті: під час SSR стан ще невідомий.
function loadState(): CrmState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // Міграція додає нові поля (зокрема тип клієнта) старим записам,
      // не викидаючи й не об'єднуючи жодного з них.
      const migrated = migrateState(JSON.parse(raw) as unknown);
      if (migrated) return migrated;
    }
  } catch {
    // Пошкоджений localStorage — починаємо з демоданих.
  }
  return makeDemoState();
}

export function readLocalState(): CrmState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function hasLocalData(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) !== null;
}

type Store = {
  state: CrmState;
  mode: StoreMode;
  // demo — усе живе в цьому браузері; server — акаунт у базі.
  isDemo: boolean;
  serverUser: ServerUser | null;
  serverSettings: Settings | null;
  serverError: string | null;
  addClient: (input: Omit<Client, "id" | "createdAt" | "archived">) => Promise<Client>;
  updateClient: (id: string, patch: Partial<Client>) => Promise<void>;
  addProject: (input: Omit<Project, "id" | "createdAt">) => Promise<Project>;
  addProjectWithPayment: (
    input: Omit<Project, "id" | "createdAt">,
    prepaymentMinor: number,
    date: string
  ) => Promise<{ project: Project; payment: Payment | null }>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  addPayment: (input: Omit<Payment, "id" | "createdAt">) => Promise<Payment>;
  updatePayment: (id: string, patch: Partial<Payment>) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
  addReminder: (input: Omit<Reminder, "id" | "createdAt" | "done">) => Promise<void>;
  updateReminder: (id: string, patch: Partial<Reminder>) => Promise<void>;
  toggleReminder: (id: string) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  resetDemo: () => void;
  retryConnection: () => void;
  refreshFromServer: () => Promise<void>;
  importLocalData: (state: CrmState) => Promise<ImportCounts>;
  clearLocalData: () => void;
};

const StoreContext = createContext<Store | null>(null);

// Застосунок — клієнтський Mini App: у Telegram дані живуть на сервері,
// поза Telegram — у localStorage браузера; перший рендер на сервері
// показує заглушку, стан підвантажується на клієнті.
export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CrmState | null>(null);
  const [mode, setMode] = useState<StoreMode>("boot");
  const [serverUser, setServerUser] = useState<ServerUser | null>(null);
  const [serverSettings, setServerSettings] = useState<Settings | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const connectRef = useRef<{ cancelled: boolean } | null>(null);

  const connect = useCallback(async (signal: { cancelled: boolean }) => {
    const initData = telegramInitData();
    const devLogin = !initData && isDevLoginEnabled();
    if (!initData && !devLogin) {
      // Позасервісний режим: браузер без Telegram працює з локальними даними.
      setState(loadState());
      setMode("demo");
      return;
    }
    try {
      const auth = devLogin ? await authenticateDev() : await authenticate(initData);
      const snapshot = await fetchSnapshot();
      if (signal.cancelled) return;
      setState(snapshot.state);
      setServerUser(snapshot.user);
      setServerSettings(snapshot.settings);
      setMode("server");
      // Перший вхід: пояс пристрою корисніший за серверний стандарт.
      if (auth.isNew) {
        const zone = detectTimeZone();
        if (zone && zone !== snapshot.settings.timeZone) {
          try {
            const { settings } = await withReauth(() => api.saveSettings({ timeZone: zone }));
            if (!signal.cancelled) setServerSettings(settings);
          } catch {
            // Пояс не критичний — його можна змінити в налаштуваннях.
          }
        }
      }
    } catch (error) {
      if (signal.cancelled) return;
      // У Telegram тихо підмінювати сервер локальними демоданими не можна:
      // людина має бачити помилку й вирішити, що робити.
      setServerError(error instanceof ApiError ? error.message : "Не вдалося підключитися до сервера.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    connectRef.current = signal;
    void connect(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [connect]);

  useEffect(() => {
    // Локальні дані не перезаписуються серверним станом: у режимі акаунта
    // localStorage лишається недоторканим до явних дій користувача.
    if (mode !== "demo") return;
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Переповнене сховище не ламає інтерфейс — дані живуть у пам'яті.
    }
  }, [mode, state]);

  const retryConnection = useCallback(() => {
    setMode("boot");
    setServerError(null);
    const signal = { cancelled: false };
    connectRef.current = signal;
    void connect(signal);
  }, [connect]);

  const refreshFromServer = useCallback(async () => {
    const snapshot = await withReauth(() => fetchSnapshot());
    setState(snapshot.state);
    setServerUser(snapshot.user);
    setServerSettings(snapshot.settings);
  }, []);

  const addClient = useCallback<Store["addClient"]>(
    async (input) => {
      const client: Client = { ...input, id: newId(), archived: false, createdAt: new Date().toISOString() };
      if (mode === "server") {
        const { client: saved } = await withReauth(() => api.addClient(client));
        setState((current) => (current ? { ...current, clients: [saved, ...current.clients] } : current));
        return saved;
      }
      setState((current) => (current ? { ...current, clients: [client, ...current.clients] } : current));
      return client;
    },
    [mode]
  );

  const updateClient = useCallback<Store["updateClient"]>(
    async (id, patch) => {
      if (mode === "server") {
        const { client } = await withReauth(() => api.updateClient(id, patch));
        setState((current) =>
          current ? { ...current, clients: current.clients.map((item) => (item.id === client.id ? client : item)) } : current
        );
        return;
      }
      setState((current) =>
        current ? { ...current, clients: current.clients.map((client) => (client.id === id ? { ...client, ...patch } : client)) } : current
      );
    },
    [mode]
  );

  const addProject = useCallback<Store["addProject"]>(
    async (input) => {
      const project: Project = { ...input, id: newId(), createdAt: new Date().toISOString() };
      if (mode === "server") {
        const { project: saved } = await withReauth(() => api.addProject(project));
        setState((current) => (current ? { ...current, projects: [saved, ...current.projects] } : current));
        return saved;
      }
      setState((current) => (current ? { ...current, projects: [project, ...current.projects] } : current));
      return project;
    },
    [mode]
  );

  const updateProject = useCallback<Store["updateProject"]>(
    async (id, patch) => {
      if (state && patch.currency !== undefined) {
        const project = state.projects.find((item) => item.id === id);
        if (project) {
          const rule = canChangeProjectCurrency(state, project, patch.currency);
          if (!rule.allowed) throw new Error(rule.message);
        }
      }
      if (mode === "server") {
        const { project } = await withReauth(() => api.updateProject(id, patch));
        setState((current) =>
          current ? { ...current, projects: current.projects.map((item) => (item.id === project.id ? project : item)) } : current
        );
        return;
      }
      setState((next) =>
        next ? { ...next, projects: next.projects.map((project) => (project.id === id ? { ...project, ...patch } : project)) } : next
      );
    },
    [mode, state]
  );

  const updatePayment = useCallback<Store["updatePayment"]>(
    async (id, patch) => {
      if (state) {
        const existing = state.payments.find((payment) => payment.id === id);
        if (existing) {
          const rule = canUpdatePayment(state, existing, patch);
          if (!rule.allowed) throw new Error(rule.message);
        }
      }
      if (mode === "server") {
        const { payment } = await withReauth(() => api.updatePayment(id, patch));
        setState((current) =>
          current ? { ...current, payments: current.payments.map((item) => (item.id === payment.id ? payment : item)) } : current
        );
        return;
      }
      setState((next) =>
        next ? { ...next, payments: next.payments.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)) } : next
      );
    },
    [mode, state]
  );

  const addPayment = useCallback<Store["addPayment"]>(
    async (input) => {
      // Один виклик — один запис: форма блокує повторне надсилання, а id
      // клієнта стає первинним ключем, тож повторний запит не створює дубля.
      if (state) {
        const rule = canAddPayment(state, input);
        if (!rule.allowed) throw new Error(rule.message);
      }
      const payment: Payment = { ...input, id: newId(), createdAt: new Date().toISOString() };
      if (mode === "server") {
        const { payment: saved } = await withReauth(() => api.addPayment(payment));
        setState((current) => (current ? { ...current, payments: [saved, ...current.payments] } : current));
        return saved;
      }
      setState((current) => (current ? { ...current, payments: [payment, ...current.payments] } : current));
      return payment;
    },
    [mode, state]
  );

  const addProjectWithPayment = useCallback<Store["addProjectWithPayment"]>(
    async (input, prepaymentMinor, date) => {
      if (mode === "server") {
        // Один запит: проєкт і передоплата зберігаються атомарно (обидва
        // записи або жоден), повторна спроба не створює дублікатів.
        const project: Project = { ...input, id: newId(), createdAt: new Date().toISOString() };
        const prepayment = prepaymentMinor > 0 ? { id: newId(), amountMinor: prepaymentMinor, date } : null;
        const saved = await withReauth(() => api.addProjectWithPrepayment(project, prepayment));
        setState((current) =>
          current
            ? {
                ...current,
                projects: [saved.project, ...current.projects],
                payments: saved.payment ? [saved.payment, ...current.payments] : current.payments,
              }
            : current
        );
        return saved;
      }
      // Демо-режим: сервера немає, два локальні записи.
      const project = await addProject(input);
      if (!(prepaymentMinor > 0)) return { project, payment: null };
      const payment = await addPayment({
        projectId: project.id,
        amountMinor: prepaymentMinor,
        currency: project.currency,
        date,
        type: "Передоплата",
        note: PREPAYMENT_NOTE,
      });
      return { project, payment };
    },
    [mode, state, addProject, addPayment]
  );

  const deletePayment = useCallback<Store["deletePayment"]>(
    async (id) => {
      if (mode === "server") await withReauth(() => api.deletePayment(id));
      setState((current) => (current ? { ...current, payments: current.payments.filter((payment) => payment.id !== id) } : current));
    },
    [mode]
  );

  const addReminder = useCallback<Store["addReminder"]>(
    async (input) => {
      const reminder: Reminder = { ...input, id: newId(), done: false, createdAt: new Date().toISOString() };
      if (mode === "server") {
        const { reminder: saved } = await withReauth(() => api.addReminder(reminder));
        setState((current) => (current ? { ...current, reminders: [saved, ...current.reminders] } : current));
        return;
      }
      setState((current) => (current ? { ...current, reminders: [reminder, ...current.reminders] } : current));
    },
    [mode]
  );

  const updateReminder = useCallback<Store["updateReminder"]>(
    async (id, patch) => {
      if (mode === "server") {
        const { reminder } = await withReauth(() => api.updateReminder(id, patch));
        setState((current) =>
          current ? { ...current, reminders: current.reminders.map((item) => (item.id === reminder.id ? reminder : item)) } : current
        );
        return;
      }
      setState((current) =>
        current
          ? { ...current, reminders: current.reminders.map((reminder) => (reminder.id === id ? { ...reminder, ...patch } : reminder)) }
          : current
      );
    },
    [mode]
  );

  const toggleReminder = useCallback<Store["toggleReminder"]>(
    async (id) => {
      const existing = state?.reminders.find((reminder) => reminder.id === id);
      await updateReminder(id, { done: !existing?.done });
    },
    [state, updateReminder]
  );

  const deleteReminder = useCallback<Store["deleteReminder"]>(
    async (id) => {
      if (mode === "server") await withReauth(() => api.deleteReminder(id));
      setState((current) => (current ? { ...current, reminders: current.reminders.filter((reminder) => reminder.id !== id) } : current));
    },
    [mode]
  );

  const resetDemo = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(makeDemoState());
  }, []);

  const importLocalData = useCallback<Store["importLocalData"]>(async (localState) => {
    const { imported } = await withReauth(() => api.importDemo(localState));
    await refreshFromServer();
    return imported;
  }, [refreshFromServer]);

  const clearLocalData = useCallback(() => {
    // Лише локальна копія на цьому пристрої; серверні дані не зачіпаються.
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo<Store | null>(
    () =>
      state
        ? {
            state,
            mode,
            isDemo: mode === "demo",
            serverUser,
            serverSettings,
            serverError,
            addClient,
            updateClient,
            addProject,
            addProjectWithPayment,
            updateProject,
            addPayment,
            updatePayment,
            deletePayment,
            addReminder,
            updateReminder,
            toggleReminder,
            deleteReminder,
            resetDemo,
            retryConnection,
            refreshFromServer,
            importLocalData,
            clearLocalData,
          }
        : null,
    [
      state,
      mode,
      serverUser,
      serverSettings,
      serverError,
      addClient,
      updateClient,
      addProject,
      addProjectWithPayment,
      updateProject,
      addPayment,
      updatePayment,
      deletePayment,
      addReminder,
      updateReminder,
      toggleReminder,
      deleteReminder,
      resetDemo,
      retryConnection,
      refreshFromServer,
      importLocalData,
      clearLocalData,
    ]
  );

  if (!value) {
    if (mode === "error") {
      return (
        <div className="boot">
          <section className="card connection-error" role="alert">
            <h2>Не вдалося підключитися</h2>
            <p className="form-hint">{serverError}</p>
            <button type="button" className="button-primary" onClick={retryConnection}>
              Спробувати ще раз
            </button>
          </section>
        </div>
      );
    }
    return <div className="boot">Завантаження…</div>;
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useCrm(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useCrm must be used within CrmProvider");
  return store;
}

// --- Похідні показники ------------------------------------------------------

export function projectPayments(state: CrmState, projectId: string): Payment[] {
  return state.payments.filter((payment) => payment.projectId === projectId);
}

export type CurrencySum = { currency: Currency; minor: number };

// Суми оплат проєкту, зібрані окремо за кожною валютою. Різні валюти
// ніколи не складаються в одну: для історичних записів це єдиний чесний показ.
export function projectReceivedByCurrency(state: CrmState, project: Project): CurrencySum[] {
  const totals = new Map<Currency, number>();
  for (const payment of projectPayments(state, project.id)) {
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + payment.amountMinor);
  }
  return [...totals.entries()]
    .map(([currency, minor]) => ({ currency, minor }))
    .sort(
      (a, b) =>
        Number(b.currency === project.currency) - Number(a.currency === project.currency) ||
        b.minor - a.minor
    );
}

// Отримано саме в валюті проєкту. Оплати в інших валютах сюди не входять.
export function projectReceivedMinor(state: CrmState, project: Project): number {
  return projectReceivedByCurrency(state, project).find((row) => row.currency === project.currency)?.minor ?? 0;
}

// Записи в іншій валюті, що вже є в проєкті: показуємо їх окремо, а не в загальній сумі.
export function projectOtherCurrencyReceived(state: CrmState, project: Project): CurrencySum[] {
  return projectReceivedByCurrency(state, project).filter((row) => row.currency !== project.currency);
}

export function projectRemainingMinor(state: CrmState, project: Project): number {
  return Math.max(0, project.amountMinor - projectReceivedMinor(state, project));
}

export function receivedInMonthMinor(state: CrmState, currency: Currency, month: string): number {
  return state.payments
    .filter((payment) => payment.currency === currency && monthKey(payment.date) === month)
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
}

// Очікувані доплати: залишок по проєктах, які не скасовані.
// Завершений проєкт із недоотриманою сумою теж лишається в очікуваних,
// бо завершення роботи саме по собі не означає отримання грошей.
export function expectedByCurrency(state: CrmState, currency: Currency): number {
  return state.projects
    .filter((project) => project.currency === currency && project.status !== "Скасований")
    .reduce((sum, project) => sum + projectRemainingMinor(state, project), 0);
}

export function currenciesInUse(state: CrmState): Currency[] {
  const set = new Set<Currency>();
  for (const project of state.projects) set.add(project.currency);
  for (const payment of state.payments) set.add(payment.currency);
  return [...set];
}

export function monthlySeriesMinor(state: CrmState, currency: Currency, months = 6): { key: string; minor: number }[] {
  const current = currentMonthKey();
  const series: { key: string; minor: number }[] = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    const key = shiftMonth(current, -index);
    series.push({ key, minor: receivedInMonthMinor(state, currency, key) });
  }
  return series;
}
