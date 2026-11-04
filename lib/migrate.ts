import { isClientKind } from "./clients";
import { CURRENCIES, PAYMENT_TYPES, PROJECT_STATUSES, type Client, type CrmState, type Currency, type Payment, type Project, type Reminder } from "./types";

// Дані живуть у localStorage, тож будь-який запис може бути старішим за поточну
// модель. Міграція тут — адитивна: нічого не видаляється й не об'єднується,
// новим полям просто дається значення «не задано».

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function money(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

// Невідома valuta/тип/статус — не привід викидати запис: лишаємо значення,
// яке вміє показати інтерфейс, а не губимо дані.
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function migrateClient(raw: Partial<Client> & { id: string }): Client {
  return {
    id: raw.id,
    name: text(raw.name),
    company: text(raw.company),
    phone: text(raw.phone),
    telegram: text(raw.telegram),
    email: text(raw.email),
    note: text(raw.note),
    kind: isClientKind(raw.kind) ? raw.kind : null,
    archived: raw.archived === true,
    createdAt: text(raw.createdAt),
  };
}

function migrateProject(raw: Partial<Project> & { id: string }): Project {
  return {
    id: raw.id,
    clientId: typeof raw.clientId === "string" ? raw.clientId : null,
    title: text(raw.title),
    description: text(raw.description),
    amountMinor: money(raw.amountMinor),
    currency: oneOf<Currency>(raw.currency, CURRENCIES, "UAH"),
    status: oneOf(raw.status, PROJECT_STATUSES, "Новий"),
    deadline: text(raw.deadline),
    nextAction: text(raw.nextAction),
    note: text(raw.note),
    createdAt: text(raw.createdAt),
  };
}

function migratePayment(raw: Partial<Payment> & { id: string }): Payment {
  return {
    id: raw.id,
    projectId: text(raw.projectId),
    amountMinor: money(raw.amountMinor),
    currency: oneOf<Currency>(raw.currency, CURRENCIES, "UAH"),
    date: text(raw.date),
    type: oneOf(raw.type, PAYMENT_TYPES, "Інша оплата"),
    note: text(raw.note),
    createdAt: text(raw.createdAt),
  };
}

function migrateReminder(raw: Partial<Reminder> & { id: string }): Reminder {
  return {
    id: raw.id,
    title: text(raw.title),
    datetime: text(raw.datetime),
    clientId: typeof raw.clientId === "string" ? raw.clientId : null,
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    done: raw.done === true,
    createdAt: text(raw.createdAt),
  };
}

/**
 * Повертає стан у поточній формі або `null`, якщо записи немає зовсім
 * (тоді підхоплюються демодані). Записи без `id` — єдине, що справді
 * не чим прив'язати, тому вони відкидаються.
 */
export function migrateState(parsed: unknown): CrmState | null {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  const keys = ["clients", "projects", "payments", "reminders"] as const;
  if (!keys.every((key) => Array.isArray(raw[key]))) return null;
  return {
    clients: (raw.clients as (Client & { id: string })[]).filter((item) => typeof item?.id === "string").map(migrateClient),
    projects: (raw.projects as (Project & { id: string })[]).filter((item) => typeof item?.id === "string").map(migrateProject),
    payments: (raw.payments as (Payment & { id: string })[]).filter((item) => typeof item?.id === "string").map(migratePayment),
    reminders: (raw.reminders as (Reminder & { id: string })[]).filter((item) => typeof item?.id === "string").map(migrateReminder),
  };
}
