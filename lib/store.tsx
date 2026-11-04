"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { makeDemoState } from "./demoData";
import { currentMonthKey, monthKey, shiftMonth } from "./money";
import { migrateState } from "./migrate";
import { canAddPayment, canChangeProjectCurrency, canUpdatePayment } from "./payments";
import type { Client, CrmState, Currency, Payment, Project, Reminder } from "./types";

const STORAGE_KEY = "quickstride.crm.v1";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

type Store = {
  state: CrmState;
  isDemo: boolean;
  addClient: (input: Omit<Client, "id" | "createdAt" | "archived">) => Client;
  updateClient: (id: string, patch: Partial<Client>) => void;
  addProject: (input: Omit<Project, "id" | "createdAt">) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  addPayment: (input: Omit<Payment, "id" | "createdAt">) => Payment;
  updatePayment: (id: string, patch: Partial<Payment>) => void;
  deletePayment: (id: string) => void;
  addReminder: (input: Omit<Reminder, "id" | "createdAt" | "done">) => void;
  updateReminder: (id: string, patch: Partial<Reminder>) => void;
  toggleReminder: (id: string) => void;
  deleteReminder: (id: string) => void;
  resetDemo: () => void;
};

const StoreContext = createContext<Store | null>(null);

// Застосунок — клієнтський Mini App: дані живуть у localStorage браузера,
// тому перший рендер на сервері показує заглушку, а стан підвантажується на клієнті.
export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CrmState | null>(null);
  const [isDemo, setIsDemo] = useState(true);

  useEffect(() => {
    setState(loadState());
    setIsDemo(!localStorage.getItem(STORAGE_KEY));
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Переповнене сховище не ламає інтерфейс — дані живуть у пам'яті.
    }
  }, [state]);

  const addClient = useCallback<Store["addClient"]>((input) => {
    const client: Client = { ...input, id: newId("client"), archived: false, createdAt: new Date().toISOString() };
    setState((current) => (current ? { ...current, clients: [client, ...current.clients] } : current));
    return client;
  }, []);

  const updateClient = useCallback<Store["updateClient"]>((id, patch) => {
    setState((current) =>
      current ? { ...current, clients: current.clients.map((client) => (client.id === id ? { ...client, ...patch } : client)) } : current,
    );
  }, []);

  const addProject = useCallback<Store["addProject"]>((input) => {
    const project: Project = { ...input, id: newId("project"), createdAt: new Date().toISOString() };
    setState((current) => (current ? { ...current, projects: [project, ...current.projects] } : current));
    return project;
  }, []);

  const updateProject = useCallback<Store["updateProject"]>((id, patch) => {
    if (state && patch.currency !== undefined) {
      const project = state.projects.find((item) => item.id === id);
      if (project) {
        const rule = canChangeProjectCurrency(state, project, patch.currency);
        if (!rule.allowed) throw new Error(rule.message);
      }
    }
    setState((next) =>
      next ? { ...next, projects: next.projects.map((project) => (project.id === id ? { ...project, ...patch } : project)) } : next,
    );
  }, [state]);

  const addPayment = useCallback<Store["addPayment"]>((input) => {
    // Один виклик — один запис: кнопка надсилання блокується, а id унікальний,
    // тож повторний запит чи подвійний клік не створюють дубля.
    if (state) {
      const rule = canAddPayment(state, input);
      if (!rule.allowed) throw new Error(rule.message);
    }
    const payment: Payment = { ...input, id: newId("payment"), createdAt: new Date().toISOString() };
    setState((current) => (current ? { ...current, payments: [payment, ...current.payments] } : current));
    return payment;
  }, [state]);

  const updatePayment = useCallback<Store["updatePayment"]>((id, patch) => {
    if (state) {
      const existing = state.payments.find((payment) => payment.id === id);
      if (existing) {
        const rule = canUpdatePayment(state, existing, patch);
        if (!rule.allowed) throw new Error(rule.message);
      }
    }
    setState((next) =>
      next ? { ...next, payments: next.payments.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)) } : next,
    );
  }, [state]);

  const deletePayment = useCallback<Store["deletePayment"]>((id) => {
    setState((current) => (current ? { ...current, payments: current.payments.filter((payment) => payment.id !== id) } : current));
  }, []);

  const addReminder = useCallback<Store["addReminder"]>((input) => {
    const reminder: Reminder = { ...input, id: newId("reminder"), done: false, createdAt: new Date().toISOString() };
    setState((current) => (current ? { ...current, reminders: [reminder, ...current.reminders] } : current));
  }, []);

  const updateReminder = useCallback<Store["updateReminder"]>((id, patch) => {
    setState((current) =>
      current
        ? { ...current, reminders: current.reminders.map((reminder) => (reminder.id === id ? { ...reminder, ...patch } : reminder)) }
        : current,
    );
  }, []);

  const toggleReminder = useCallback<Store["toggleReminder"]>((id) => {
    setState((current) =>
      current
        ? { ...current, reminders: current.reminders.map((reminder) => (reminder.id === id ? { ...reminder, done: !reminder.done } : reminder)) }
        : current,
    );
  }, []);

  const deleteReminder = useCallback<Store["deleteReminder"]>((id) => {
    setState((current) => (current ? { ...current, reminders: current.reminders.filter((reminder) => reminder.id !== id) } : current));
  }, []);

  const resetDemo = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(makeDemoState());
    setIsDemo(true);
  }, []);

  const value = useMemo<Store | null>(
    () =>
      state
        ? { state, isDemo, addClient, updateClient, addProject, updateProject, addPayment, updatePayment, deletePayment, addReminder, updateReminder, toggleReminder, deleteReminder, resetDemo }
        : null,
    [state, isDemo, addClient, updateClient, addProject, updateProject, addPayment, updatePayment, deletePayment, addReminder, updateReminder, toggleReminder, deleteReminder, resetDemo],
  );

  if (!value) {
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
