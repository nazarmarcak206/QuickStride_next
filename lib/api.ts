import type { CrmState, Client, Payment, Project, Reminder } from "./types";
import type { Settings } from "./settings";
import { telegramInitData } from "./telegram";

// Клієнтський шар сервера: усі запити автентифікуються HttpOnly-cookie,
// яку видає /api/auth/telegram. Ключів Supabase тут немає й бути не може.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export type AuthUser = { id: string; telegramName: string; telegramPhotoUrl: string; demoImported: boolean };

export type ServerSnapshot = {
  user: AuthUser;
  settings: Settings;
  state: CrmState;
};

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Немає зʼєднання з сервером. Перевірте інтернет і спробуйте ще раз.");
  }
  if (!response.ok) {
    let message = `Помилка сервера (${response.status}).`;
    try {
      const data = (await response.json()) as { error?: unknown };
      if (typeof data.error === "string" && data.error) message = data.error;
    } catch {
      // Тіло помилки не JSON — лишається стандартне повідомлення.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function authenticate(initData: string): Promise<{ isNew: boolean }> {
  return request("/api/auth/telegram", { method: "POST", body: { initData } });
}

// Локальний режим розробки: вхід без Telegram через /api/auth/dev.
// Доступний лише у dev-білді з увімкненим NEXT_PUBLIC_DEV_LOGIN; сам маршрут
// на сервері додатково перевіряє NODE_ENV і DEV_LOGIN, тому в прод
// не перетворюється на обхід авторизації.
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_LOGIN === "true";
}

export async function authenticateDev(): Promise<{ isNew: boolean }> {
  return request("/api/auth/dev", { method: "POST" });
}

export function fetchSnapshot(): Promise<ServerSnapshot> {
  return request("/api/state");
}

export const api = {
  addClient: (client: Client) => request<{ client: Client }>("/api/clients", { method: "POST", body: client }),
  updateClient: (id: string, patch: Partial<Client>) =>
    request<{ client: Client }>(`/api/clients/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  addProject: (project: Project) => request<{ project: Project }>("/api/projects", { method: "POST", body: project }),
  // Один запит: проєкт і передоплата зберігаються атомарно на сервері.
  addProjectWithPrepayment: (project: Project, prepayment: { id: string; amountMinor: number; date: string } | null) =>
    request<{ project: Project; payment: Payment | null }>("/api/projects", {
      method: "POST",
      body: prepayment ? { ...project, prepayment } : project,
    }),
  updateProject: (id: string, patch: Partial<Project>) =>
    request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  addPayment: (payment: Payment) =>
    request<{ payment: Payment; duplicate: boolean }>("/api/payments", { method: "POST", body: payment }),
  updatePayment: (id: string, patch: Partial<Payment>) =>
    request<{ payment: Payment }>(`/api/payments/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  deletePayment: (id: string) =>
    request<null>(`/api/payments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addReminder: (reminder: Reminder) =>
    request<{ reminder: Reminder }>("/api/reminders", { method: "POST", body: reminder }),
  updateReminder: (id: string, patch: Partial<Reminder>) =>
    request<{ reminder: Reminder }>(`/api/reminders/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  deleteReminder: (id: string) =>
    request<null>(`/api/reminders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>("/api/settings", { method: "PATCH", body: patch }),
  importDemo: (state: CrmState) =>
    request<{ imported: { clients: number; projects: number; payments: number; reminders: number } }>(
      "/api/import/demo",
      { method: "POST", body: { state } }
    ),
};

// Сесія може завершитися посеред роботи (30 днів). Один раз пробуємо
// переавторизуватися за свіжими initData і повторити запит.
export async function withReauth<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const initData = telegramInitData();
    if (error instanceof ApiError && error.status === 401 && initData) {
      await authenticate(initData);
      return operation();
    }
    throw error;
  }
}
