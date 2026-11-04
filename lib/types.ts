export type Currency = "UAH" | "EUR" | "USD";

export type ProjectStatus =
  | "Новий"
  | "Обговорення"
  | "У роботі"
  | "Очікує клієнта"
  | "Завершений"
  | "Скасований";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "Новий",
  "Обговорення",
  "У роботі",
  "Очікує клієнта",
  "Завершений",
  "Скасований",
];

export const CURRENCIES: Currency[] = ["UAH", "EUR", "USD"];

export type PaymentType = "Передоплата" | "Доплата" | "Інша оплата";

export const PAYMENT_TYPES: PaymentType[] = [
  "Передоплата",
  "Доплата",
  "Інша оплата",
];

// Тип клієнта — лише позначка для списку й фільтра. Він не бере участі в
// розрахунку залишків, очікуваних доплат чи статусів проєктів.
export const CLIENT_KINDS = ["Постійний", "Непостійний"] as const;

export type ClientKind = (typeof CLIENT_KINDS)[number];

// `null` — ознаку ще не задано (старі записи та нові без вибору).
export type Client = {
  id: string;
  name: string;
  company: string;
  phone: string;
  telegram: string;
  email: string;
  note: string;
  kind: ClientKind | null;
  archived: boolean;
  createdAt: string;
};

export type Project = {
  id: string;
  clientId: string | null;
  title: string;
  description: string;
  amountMinor: number;
  currency: Currency;
  status: ProjectStatus;
  deadline: string;
  nextAction: string;
  note: string;
  createdAt: string;
};

export type Payment = {
  id: string;
  projectId: string;
  amountMinor: number;
  currency: Currency;
  date: string;
  type: PaymentType;
  note: string;
  createdAt: string;
};

export type Reminder = {
  id: string;
  title: string;
  datetime: string;
  clientId: string | null;
  projectId: string | null;
  done: boolean;
  createdAt: string;
};

export type CrmState = {
  clients: Client[];
  projects: Project[];
  payments: Payment[];
  reminders: Reminder[];
};
