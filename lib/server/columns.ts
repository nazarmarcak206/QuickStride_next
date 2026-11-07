// Відповідність між внутрішніми назвами моделі застосунку й фактичними
// колонками Supabase-бази QuickStride (crm_*). Переклад живе лише тут:
// інтерфейс і бізнес-логіка далі працюють із звичними іменами
// (Payment.date, Payment.type, Reminder.datetime), а на межі бази
// застосовуються реальні назви й реальні типи.
//
// Фактично (перевірено в Supabase):
//   crm_payments:  paid_on date NOT NULL, payment_type text NOT NULL
//   crm_reminders: due_at timestamp with time zone NOT NULL, timezone text NULL
//   crm_projects:  deadline date NULL — «дедлайн не задано» зберігається як NULL
// Решта колонок збігається з внутрішніми назвами.
//
// Оскільки due_at — абсолютний момент, його неможливо прочитати чи записати
// «обрізанням рядка»: потрібен пояс. Тому Reminder.datetime перетворюється
// через lib/timezone.ts (wall-clock ↔ мить), а використаний пояс зберігається
// у crm_reminders.timezone.
//
// Міждомейну цілісність у базі тримають СКЛАДЕНІ зовнішні ключі, які вже існують:
//   crm_projects(owner_id, client_id) → crm_clients(owner_id, id)
//   crm_payments(owner_id, project_id, currency) → crm_projects(owner_id, id, currency)
//   crm_reminders(owner_id, client_id) і (owner_id, project_id) → відповідно
// Тобто посилання на чужого клієнта/проєкт чи оплату в чужій валюті база
// відхиляє сама. Код перевіряє те саме раніше, щоб показати зрозуміле
// повідомлення замість помилки бази; однакових одинарних FK міграція не створює.
import { utcToWallClock, wallClockToUtc } from "../timezone";
import type { RestRow } from "./supabaseRest";
import { TABLE_PAYMENTS, TABLE_PROJECTS } from "./users";

// Перейменування «одна колонка — одне поле моделі». Для crm_reminders цього
// замало: там datetime моделі живе як пара колонок (due_at + timezone), тому
// він має власні перетворювачі нижче.
const COLUMN_BY_TABLE: Record<string, Readonly<Record<string, string>>> = {
  [TABLE_PAYMENTS]: { date: "paid_on", type: "payment_type" },
};

// Внутрішня (snake_case) назва → назва колонки в базі.
export function dbColumn(table: string, field: string): string {
  return COLUMN_BY_TABLE[table]?.[field] ?? field;
}

// Колонка в базі → внутрішня назва (для читання рядків і патчів).
export function modelField(table: string, column: string): string {
  const map = COLUMN_BY_TABLE[table];
  if (!map) return column;
  for (const [field, db] of Object.entries(map)) {
    if (db === column) return field;
  }
  return column;
}

// Рядок із бази → рядок у внутрішніх назвах моделі.
export function rowFromDb(table: string, row: RestRow): RestRow {
  const out: RestRow = {};
  for (const [column, value] of Object.entries(row)) {
    out[modelField(table, column)] = value;
  }
  return out;
}

// Колонки з типом date, які допускають NULL. Для них порожнє значення моделі
// означає «дедлайн не задано» і в базу має йти як NULL: "" — некоректний
// date, і Postgres відхилив би такий запит помилкою типу, а не валідацією.
const NULLABLE_DATE_COLUMNS: Record<string, readonly string[]> = {
  [TABLE_PROJECTS]: ["deadline"],
};

export function dbValueForWrite(table: string, column: string, value: unknown): unknown {
  const nullable = NULLABLE_DATE_COLUMNS[table] ?? [];
  return nullable.includes(column) && value === "" ? null : value;
}

// Внутрішні назви → колонки бази (для вставки).
export function rowToDb(table: string, row: RestRow): RestRow {
  const out: RestRow = {};
  for (const [field, value] of Object.entries(row)) {
    const column = dbColumn(table, field);
    out[column] = dbValueForWrite(table, column, value);
  }
  return out;
}

// date|timestamp|text → "YYYY-MM-DD".
export function toDateOnly(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

// ── crm_reminders: datetime моделі ↔ (due_at timestamptz + timezone) ────────
//
// Запис: місцевий час справи + пояс власника → абсолютний момент у due_at, а
// той самий пояс іде в timezone. Через це справа, створена в Києві о 09:00,
// прочитається «09:00» і на іншому пристрої, і після зміни поясу в налаштувань.
// Читання: момент + пояс рядка → місцевий час; для рядків без поясу
// (легасі-дані) беремо пояс налаштувань власника.

export type ReminderDbFields = { due_at: string; timezone: string };

export function reminderToDb(wallClock: string, timeZone: string): { ok: true; fields: ReminderDbFields } | { ok: false; error: string } {
  const instant = wallClockToUtc(wallClock, timeZone);
  if (!instant.ok) {
    return {
      ok: false,
      error:
        instant.reason === "zone"
          ? `Часовий пояс «${timeZone}» не підтримується сервером`
          : "Дата й час: очікується формат YYYY-MM-DDTHH:mm",
    };
  }
  return { ok: true, fields: { due_at: instant.iso, timezone: timeZone } };
}

// Рядок бази (snake_case) → значення поля datetime у моделі.
export function reminderWallClockFromDb(row: RestRow, fallbackTimeZone: string): string {
  const dueAt = typeof row.due_at === "string" ? row.due_at : "";
  const rowZone = typeof row.timezone === "string" ? row.timezone : "";
  const instant = Date.parse(dueAt);
  if (Number.isNaN(instant)) return "";
  for (const zone of [rowZone, fallbackTimeZone]) {
    if (!zone) continue;
    const wall = utcToWallClock(dueAt, zone);
    if (wall) return wall;
  }
  return "";
}
