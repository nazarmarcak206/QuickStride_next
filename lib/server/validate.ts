import { CURRENCIES, CLIENT_KINDS, PAYMENT_TYPES, PROJECT_STATUSES } from "../types";
import type { ClientKind, Currency, PaymentType, ProjectStatus } from "../types";
import { isUuid } from "../ids";
import { isTimeZone } from "../settings";

// Валідація на межі мережі: клієнт надсилає JSON, але довіряти його формі
// не можна. Кожен парсер повертає або значення, або одну зрозумілу помилку.
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(label: string, why: string): Parsed<never> {
  return { ok: false, error: `${label}: ${why}` };
}

export function parseText(
  raw: unknown,
  label: string,
  options: { required?: boolean; max: number }
): Parsed<string> {
  if (raw === undefined || raw === null) {
    return options.required ? fail(label, "обовʼязкове поле") : { ok: true, value: "" };
  }
  if (typeof raw !== "string") return fail(label, "має бути рядком");
  const value = raw.trim();
  if (options.required && !value) return fail(label, "обовʼязкове поле");
  if (value.length > options.max) return fail(label, `не довше за ${options.max} символів`);
  return { ok: true, value };
}

export function parseId(
  raw: unknown,
  label: string,
  options: { required?: boolean; nullable?: boolean }
): Parsed<string | null> {
  if (raw === undefined || raw === null || raw === "") {
    return options.required ? fail(label, "обовʼязкове поле") : { ok: true, value: options.nullable ? null : "" };
  }
  // Ідентифікатори у crm_* — uuid: все інше відхиляється до запиту до бази.
  if (!isUuid(raw)) return fail(label, "очікується UUID");
  return { ok: true, value: (raw as string).toLowerCase() };
}

// Ідентифікатор запису з URL-параметра: той самий uuid, але обовʼязковий.
export function parseRecordId(raw: unknown, label = "Ідентифікатор запису"): Parsed<string> {
  if (!isUuid(raw)) return fail(label, "очікується UUID");
  return { ok: true, value: raw.toLowerCase() };
}

export function parseCurrency(raw: unknown, label = "Валюта"): Parsed<Currency> {
  return CURRENCIES.includes(raw as Currency)
    ? { ok: true, value: raw as Currency }
    : fail(label, `має бути одне з ${CURRENCIES.join(", ")}`);
}

export function parseProjectStatus(raw: unknown, label = "Статус"): Parsed<ProjectStatus> {
  return PROJECT_STATUSES.includes(raw as ProjectStatus)
    ? { ok: true, value: raw as ProjectStatus }
    : fail(label, "невідомий статус");
}

export function parsePaymentType(raw: unknown, label = "Тип оплати"): Parsed<PaymentType> {
  return PAYMENT_TYPES.includes(raw as PaymentType)
    ? { ok: true, value: raw as PaymentType }
    : fail(label, "невідомий тип");
}

export function parseClientKind(raw: unknown, label = "Тип клієнта"): Parsed<ClientKind | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  return CLIENT_KINDS.includes(raw as ClientKind)
    ? { ok: true, value: raw as ClientKind }
    : fail(label, `має бути одне з ${CLIENT_KINDS.join(", ")}`);
}

export function parseAmountMinor(raw: unknown, label: string, options: { positive?: boolean } = {}): Parsed<number> {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return fail(label, "має бути цілим числом копійок");
  if (raw < 0) return fail(label, "не може бути відʼємним");
  if (raw > 9_000_000_000_000) return fail(label, "завелика сума");
  if (options.positive && raw <= 0) return fail(label, "має бути більше за нуль");
  return { ok: true, value: raw };
}

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATETIME_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?(Z|[+-](0\d|1[0-3]):[0-5]\d)?$/;

// paid_on у базі — date NOT NULL, тому дата оплати обовʼязкова: без неї
// запис просто не можна створити.
export function parseDateText(raw: unknown, label: string, options: { required?: boolean } = {}): Parsed<string> {
  if (raw === undefined || raw === null || raw === "") {
    return options.required ? fail(label, "обовʼязкове поле") : { ok: true, value: "" };
  }
  if (typeof raw !== "string" || !DATE_PATTERN.test(raw)) return fail(label, "очікується дата YYYY-MM-DD");
  return { ok: true, value: raw };
}

// due_at у базі — timestamptz NOT NULL, тому дата й час справи обовʼязкові:
// саме за ними інтерфейс показує «найближчі дедлайни» й групує справи на
// сьогодні. Формат перевіряється тут, а пояс береться з налаштувань власника.
export function parseDateTimeText(raw: unknown, label: string, options: { required?: boolean } = {}): Parsed<string> {
  if (raw === undefined || raw === null || raw === "") {
    return options.required ? fail(label, "обовʼязкове поле — справа без дати не має коли наступати") : { ok: true, value: "" };
  }
  if (typeof raw !== "string" || !DATETIME_PATTERN.test(raw)) return fail(label, "очікується дата й час YYYY-MM-DDTHH:mm");
  return { ok: true, value: raw };
}

export function parseBool(raw: unknown, label: string): Parsed<boolean> {
  return typeof raw === "boolean" ? { ok: true, value: raw } : fail(label, "має бути true або false");
}

export function parseTimeZone(raw: unknown, label = "Часовий пояс"): Parsed<string> {
  if (typeof raw !== "string" || !isTimeZone(raw)) return fail(label, "невідомий часовий пояс");
  return { ok: true, value: raw };
}

// Ключі, які приймаються в PATCH: відсутній ключ не змінює поле, undefined
// усередині обʼєкта трактується як «не надіслано».
function present<T extends object>(patch: T, key: keyof T): boolean {
  return key in patch && patch[key] !== undefined;
}

export type ClientPatch = {
  name?: string;
  company?: string;
  phone?: string;
  telegram?: string;
  email?: string;
  note?: string;
  kind?: ClientKind | null;
  archived?: boolean;
};

export function parseClientPatch(body: Record<string, unknown>): Parsed<ClientPatch> {
  const patch: ClientPatch = {};
  if (present(body, "name")) {
    const parsed = parseText(body.name, "Імʼя", { required: true, max: 120 });
    if (!parsed.ok) return parsed;
    patch.name = parsed.value;
  }
  for (const key of ["company", "phone", "telegram", "email"] as const) {
    if (present(body, key)) {
      const parsed = parseText(body[key], key, { max: 120 });
      if (!parsed.ok) return parsed;
      patch[key] = parsed.value;
    }
  }
  if (present(body, "note")) {
    const parsed = parseText(body.note, "Нотатка", { max: 2000 });
    if (!parsed.ok) return parsed;
    patch.note = parsed.value;
  }
  if (present(body, "kind")) {
    const parsed = parseClientKind(body.kind);
    if (!parsed.ok) return parsed;
    patch.kind = parsed.value;
  }
  if (present(body, "archived")) {
    const parsed = parseBool(body.archived, "Архівування");
    if (!parsed.ok) return parsed;
    patch.archived = parsed.value;
  }
  return { ok: true, value: patch };
}

export type ProjectPatch = {
  clientId?: string | null;
  title?: string;
  description?: string;
  amountMinor?: number;
  currency?: Currency;
  status?: ProjectStatus;
  deadline?: string;
  nextAction?: string;
  note?: string;
};

export function parseProjectPatch(body: Record<string, unknown>): Parsed<ProjectPatch> {
  const patch: ProjectPatch = {};
  if (present(body, "clientId")) {
    const parsed = parseId(body.clientId, "Клієнт", { nullable: true });
    if (!parsed.ok) return parsed;
    patch.clientId = parsed.value;
  }
  if (present(body, "title")) {
    const parsed = parseText(body.title, "Назва проєкту", { required: true, max: 200 });
    if (!parsed.ok) return parsed;
    patch.title = parsed.value;
  }
  if (present(body, "description")) {
    const parsed = parseText(body.description, "Опис", { max: 2000 });
    if (!parsed.ok) return parsed;
    patch.description = parsed.value;
  }
  if (present(body, "amountMinor")) {
    const parsed = parseAmountMinor(body.amountMinor, "Сума");
    if (!parsed.ok) return parsed;
    patch.amountMinor = parsed.value;
  }
  if (present(body, "currency")) {
    const parsed = parseCurrency(body.currency);
    if (!parsed.ok) return parsed;
    patch.currency = parsed.value;
  }
  if (present(body, "status")) {
    const parsed = parseProjectStatus(body.status);
    if (!parsed.ok) return parsed;
    patch.status = parsed.value;
  }
  if (present(body, "deadline")) {
    const parsed = parseDateText(body.deadline, "Дедлайн");
    if (!parsed.ok) return parsed;
    patch.deadline = parsed.value;
  }
  if (present(body, "nextAction")) {
    const parsed = parseText(body.nextAction, "Наступна дія", { max: 500 });
    if (!parsed.ok) return parsed;
    patch.nextAction = parsed.value;
  }
  if (present(body, "note")) {
    const parsed = parseText(body.note, "Нотатка", { max: 2000 });
    if (!parsed.ok) return parsed;
    patch.note = parsed.value;
  }
  return { ok: true, value: patch };
}

export type PaymentPatch = {
  projectId?: string;
  amountMinor?: number;
  currency?: Currency;
  date?: string;
  type?: PaymentType;
  note?: string;
};

export function parsePaymentPatch(body: Record<string, unknown>): Parsed<PaymentPatch> {
  const patch: PaymentPatch = {};
  if (present(body, "projectId")) {
    const parsed = parseId(body.projectId, "Проєкт", { required: true });
    if (!parsed.ok) return parsed;
    patch.projectId = parsed.value as string;
  }
  if (present(body, "amountMinor")) {
    const parsed = parseAmountMinor(body.amountMinor, "Сума", { positive: true });
    if (!parsed.ok) return parsed;
    patch.amountMinor = parsed.value;
  }
  if (present(body, "currency")) {
    const parsed = parseCurrency(body.currency);
    if (!parsed.ok) return parsed;
    patch.currency = parsed.value;
  }
  if (present(body, "date")) {
    const parsed = parseDateText(body.date, "Дата оплати", { required: true });
    if (!parsed.ok) return parsed;
    patch.date = parsed.value;
  }
  if (present(body, "type")) {
    const parsed = parsePaymentType(body.type);
    if (!parsed.ok) return parsed;
    patch.type = parsed.value;
  }
  if (present(body, "note")) {
    const parsed = parseText(body.note, "Нотатка", { max: 500 });
    if (!parsed.ok) return parsed;
    patch.note = parsed.value;
  }
  return { ok: true, value: patch };
}

export type ReminderPatch = {
  title?: string;
  datetime?: string;
  clientId?: string | null;
  projectId?: string | null;
  done?: boolean;
};

export function parseReminderPatch(body: Record<string, unknown>): Parsed<ReminderPatch> {
  const patch: ReminderPatch = {};
  if (present(body, "title")) {
    const parsed = parseText(body.title, "Назва справи", { required: true, max: 200 });
    if (!parsed.ok) return parsed;
    patch.title = parsed.value;
  }
  if (present(body, "datetime")) {
    const parsed = parseDateTimeText(body.datetime, "Дата й час", { required: true });
    if (!parsed.ok) return parsed;
    patch.datetime = parsed.value;
  }
  if (present(body, "clientId")) {
    const parsed = parseId(body.clientId, "Клієнт", { nullable: true });
    if (!parsed.ok) return parsed;
    patch.clientId = parsed.value;
  }
  if (present(body, "projectId")) {
    const parsed = parseId(body.projectId, "Проєкт", { nullable: true });
    if (!parsed.ok) return parsed;
    patch.projectId = parsed.value;
  }
  if (present(body, "done")) {
    const parsed = parseBool(body.done, "Виконано");
    if (!parsed.ok) return parsed;
    patch.done = parsed.value;
  }
  return { ok: true, value: patch };
}

export type SettingsPatch = {
  displayName?: string;
  baseCurrency?: Currency;
  timeZone?: string;
};

export function parseSettingsPatch(body: Record<string, unknown>): Parsed<SettingsPatch> {
  const patch: SettingsPatch = {};
  if (present(body, "displayName")) {
    const parsed = parseText(body.displayName, "Імʼя", { max: 60 });
    if (!parsed.ok) return parsed;
    patch.displayName = parsed.value;
  }
  if (present(body, "baseCurrency")) {
    const parsed = parseCurrency(body.baseCurrency, "Основна валюта");
    if (!parsed.ok) return parsed;
    patch.baseCurrency = parsed.value;
  }
  if (present(body, "timeZone")) {
    const parsed = parseTimeZone(body.timeZone);
    if (!parsed.ok) return parsed;
    patch.timeZone = parsed.value;
  }
  return { ok: true, value: patch };
}
