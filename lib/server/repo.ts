import { randomUUID } from "node:crypto";
import { isUuid } from "../ids";
import { PREPAYMENT_NOTE } from "../projectCreate";
import type { Client, CrmState, Currency, Payment, Project, Reminder } from "../types";
import { dbColumn, dbValueForWrite, reminderToDb, reminderWallClockFromDb, rowFromDb, rowToDb, toDateOnly } from "./columns";
import type { RestFilter, RestRow, RestClient } from "./supabaseRest";
import { TABLE_CLIENTS, TABLE_PAYMENTS, TABLE_PROJECTS, TABLE_REMINDERS } from "./users";

// У реальній схемі власник запису — колонка owner_id (uuid → crm_users.id),
// а ідентифікатори записів — uuid. Код дотримується цього скрізь: жодного
// рядка без власника й жодного запиту без фільтра owner_id.

// Репозиторій: кожна функція вимагає ownerId сесії і додає його до фільтрів.
// Записи без owner_id або з чужим owner_id для цих запитів не існують.
export function requireOwnerId(ownerId: string): string {
  if (!isUuid(ownerId)) {
    throw new Error("Некоректний owner_id сесії");
  }
  return ownerId;
}

function text(row: RestRow, key: string): string {
  return typeof row[key] === "string" ? (row[key] as string) : "";
}

function nullableText(row: RestRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value ? value : null;
}

// bigint PostgREST повертає як рядок — звужуємо до числа.
function integer(row: RestRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stamp(row: RestRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function rowToClient(row: RestRow): Client {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    company: text(row, "company"),
    phone: text(row, "phone"),
    telegram: text(row, "telegram"),
    email: text(row, "email"),
    note: text(row, "note"),
    kind: nullableText(row, "kind") as Client["kind"],
    archived: row.archived === true,
    createdAt: stamp(row, "created_at"),
  };
}

function rowToProject(row: RestRow): Project {
  return {
    id: text(row, "id"),
    clientId: nullableText(row, "client_id"),
    title: text(row, "title"),
    description: text(row, "description"),
    amountMinor: integer(row, "amount_minor"),
    currency: text(row, "currency") as Currency,
    status: text(row, "status") as Project["status"],
    deadline: toDateOnly(text(row, "deadline")),
    nextAction: text(row, "next_action"),
    note: text(row, "note"),
    createdAt: stamp(row, "created_at"),
  };
}

function rowToPayment(row: RestRow): Payment {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    amountMinor: integer(row, "amount_minor"),
    currency: text(row, "currency") as Currency,
    // База може віддати date, timestamp або text — зводимо до YYYY-MM-DD.
    date: toDateOnly(text(row, "date")),
    type: text(row, "type") as Payment["type"],
    note: text(row, "note"),
    createdAt: stamp(row, "created_at"),
  };
}

// Рядок бази → справа моделі. datetime обчислюється з абсолютного моменту
// due_at у поясі рядка (легасі-рядки без поясу — пояс налаштувань власника).
function rowToReminder(row: RestRow, fallbackTimeZone: string): Reminder {
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    datetime: reminderWallClockFromDb(row, fallbackTimeZone),
    clientId: nullableText(row, "client_id"),
    projectId: nullableText(row, "project_id"),
    done: row.done === true,
    createdAt: stamp(row, "created_at"),
  };
}

// Справа моделі → рядок бази: місцевий час перетворюється на момент у
// вказаному поясі, а сам пояс записуємо в timezone.
function reminderRow(reminder: Reminder, ownerId: string, timeZone: string): RestRow {
  const converted = reminderToDb(reminder.datetime, timeZone);
  if (!converted.ok) throw new Error(converted.error);
  return {
    id: reminder.id,
    owner_id: ownerId,
    title: reminder.title,
    client_id: reminder.clientId,
    project_id: reminder.projectId,
    done: reminder.done,
    ...converted.fields,
  };
}

function clientRow(client: Client, ownerId: string): RestRow {
  return {
    id: client.id,
    owner_id: ownerId,
    name: client.name,
    company: client.company,
    phone: client.phone,
    telegram: client.telegram,
    email: client.email,
    note: client.note,
    kind: client.kind,
    archived: client.archived,
  };
}

function projectRow(project: Project, ownerId: string): RestRow {
  return {
    id: project.id,
    owner_id: ownerId,
    client_id: project.clientId,
    title: project.title,
    description: project.description,
    amount_minor: project.amountMinor,
    currency: project.currency,
    status: project.status,
    deadline: project.deadline,
    next_action: project.nextAction,
    note: project.note,
  };
}

function paymentRow(payment: Payment, ownerId: string): RestRow {
  return {
    id: payment.id,
    owner_id: ownerId,
    project_id: payment.projectId,
    amount_minor: payment.amountMinor,
    currency: payment.currency,
    date: payment.date,
    type: payment.type,
    note: payment.note,
  };
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// Патч-перетворювач: переносить лише надіслані поля, null лишається null
// (зняття звʼязку), undefined — поле не змінюється. Ключі, які в базі мають
// інші назви (date → paid_on, datetime → due_at), переписуються тут.
function patchRow(patch: Record<string, unknown>, table: string): RestRow {
  const row: RestRow = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = dbColumn(table, camelToSnake(key));
    row[column] = dbValueForWrite(table, column, value);
  }
  return row;
}

// Патч справи: datetime завжди йде парою (due_at + timezone), бо due_at —
// абсолютний момент. Інші поля перетворюються як зазвичай.
function reminderPatchRow(patch: Record<string, unknown>, timeZone: string): RestRow {
  const row = patchRow(patch, TABLE_REMINDERS);
  if (patch.datetime !== undefined) {
    delete row.datetime;
    const converted = reminderToDb(String(patch.datetime ?? ""), timeZone);
    if (!converted.ok) throw new Error(converted.error);
    Object.assign(row, converted.fields);
  }
  return row;
}

async function listEntity<T extends RestRow>(rest: RestClient, table: string, ownerId: string): Promise<T[]> {
  requireOwnerId(ownerId);
  const rows = await rest.select<RestRow>(table, {
    filters: [["owner_id", "eq", ownerId]],
    order: { column: "created_at", ascending: false },
  });
  // Колонки бази (paid_on, due_at …) → внутрішні назви моделі.
  return rows.map((row) => rowFromDb(table, row)) as T[];
}

// Часовий пояс власника потрібен, щоб перетворити абсолютні моменти справ
// назад на місцевий час. Для рядків із власним timezone він лише запасний.
export async function listState(rest: RestClient, ownerId: string, timeZone: string): Promise<CrmState> {
  const [clients, projects, payments, reminders] = await Promise.all([
    listEntity<RestRow>(rest, TABLE_CLIENTS, ownerId),
    listEntity<RestRow>(rest, TABLE_PROJECTS, ownerId),
    listEntity<RestRow>(rest, TABLE_PAYMENTS, ownerId),
    listEntity<RestRow>(rest, TABLE_REMINDERS, ownerId),
  ]);
  return {
    clients: clients.map(rowToClient),
    projects: projects.map(rowToProject),
    payments: payments.map(rowToPayment),
    reminders: reminders.map((row) => rowToReminder(row, timeZone)),
  };
}

// Ідентифікатор нового запису: uuid. Клієнт надсилає свій uuid (відома
// поведінка локального store), за його відсутності генерує сервер. Невалідні
// значення відхиляються до запису: у crm_* id має тип uuid.
export function newRecordId(raw: unknown): ParsedIdResult {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: randomUUID() };
  if (typeof raw !== "string" || !isUuid(raw)) {
    return { ok: false, error: "Некоректний ідентифікатор запису: очікується UUID" };
  }
  return { ok: true, value: raw };
}

type ParsedIdResult = { ok: true; value: string } | { ok: false; error: string };

export async function insertClient(rest: RestClient, ownerId: string, client: Client): Promise<Client> {
  const [row] = await rest.insert<RestRow>(TABLE_CLIENTS, clientRow(client, ownerId));
  return rowToClient(row);
}

export async function updateClientRow(
  rest: RestClient,
  ownerId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<Client | null> {
  const rows = await rest.update<RestRow>(TABLE_CLIENTS, patchRow(patch, TABLE_CLIENTS), ownedFilters(ownerId, id));
  return rows[0] ? rowToClient(rows[0]) : null;
}

export async function insertProject(rest: RestClient, ownerId: string, project: Project): Promise<Project> {
  const [row] = await rest.insert<RestRow>(TABLE_PROJECTS, rowToDb(TABLE_PROJECTS, projectRow(project, ownerId)));
  return rowToProject(row);
}

export type PrepaymentInput = { id: string; amountMinor: number; date: string };

// Проєкт разом із передоплатою зберігаються однією транзакцією в базі
// (Postgres-функція з міграції): або обидва записи, або жоден. Повторний
// виклик із тими самими id після збою не створює дублікатів — функція
// повертає вже записані рядки.
export async function insertProjectWithPrepayment(
  rest: RestClient,
  ownerId: string,
  project: Project,
  prepayment: PrepaymentInput
): Promise<{ project: Project; payment: Payment | null }> {
  const raw = await rest.rpc("qs_create_project_with_prepayment", {
    p_owner_id: requireOwnerId(ownerId),
    p_project: rowToDb(TABLE_PROJECTS, {
      id: project.id,
      client_id: project.clientId ?? "",
      title: project.title,
      description: project.description,
      amount_minor: project.amountMinor,
      currency: project.currency,
      status: project.status,
      deadline: project.deadline,
      next_action: project.nextAction,
      note: project.note,
    }),
    // Валюта платежу — валюта проєкту; функція відхиляє розбіжність.
    // Ключі jsonb — фактичні колонки бази (paid_on, payment_type), бо функція
    // пише їх просто в crm_payments.
    p_payment: rowToDb(TABLE_PAYMENTS, {
      id: prepayment.id,
      amount_minor: prepayment.amountMinor,
      currency: project.currency,
      date: prepayment.date,
      type: "Передоплата",
      note: PREPAYMENT_NOTE,
    }),
  });
  const result = (Array.isArray(raw) ? raw[0] : raw) as { project?: RestRow; payment?: RestRow | null } | null;
  if (!result?.project) throw new Error("База не повернула створений проєкт");
  return {
    project: rowToProject(rowFromDb(TABLE_PROJECTS, result.project)),
    payment: result.payment ? rowToPayment(rowFromDb(TABLE_PAYMENTS, result.payment)) : null,
  };
}

export async function updateProjectRow(
  rest: RestClient,
  ownerId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<Project | null> {
  const rows = await rest.update<RestRow>(TABLE_PROJECTS, patchRow(patch, TABLE_PROJECTS), ownedFilters(ownerId, id));
  return rows[0] ? rowToProject(rows[0]) : null;
}

export async function findProject(rest: RestClient, ownerId: string, id: string): Promise<Project | null> {
  const rows = await rest.select<RestRow>(TABLE_PROJECTS, {
    filters: ownedFilters(ownerId, id),
    limit: 1,
  });
  return rows[0] ? rowToProject(rows[0]) : null;
}

export async function findClient(rest: RestClient, ownerId: string, id: string): Promise<Client | null> {
  const rows = await rest.select<RestRow>(TABLE_CLIENTS, {
    filters: ownedFilters(ownerId, id),
    limit: 1,
  });
  return rows[0] ? rowToClient(rows[0]) : null;
}

export function ownedFilters(ownerId: string, id: string): RestFilter[] {
  if (!isUuid(id)) {
    throw new Error("Некоректний ідентифікатор запису: очікується UUID");
  }
  return [
    ["id", "eq", id],
    ["owner_id", "eq", requireOwnerId(ownerId)],
  ];
}

export async function insertPayment(rest: RestClient, ownerId: string, payment: Payment): Promise<{ payment: Payment; duplicate: boolean }> {
  // Ідемпотентність: клієнтський id — первинний ключ, тому повторний запит
  // (подвійний клік, повторна спроба після таймауту) не створює другу оплату.
  const rows = await rest.insert<RestRow>(TABLE_PAYMENTS, rowToDb(TABLE_PAYMENTS, paymentRow(payment, ownerId)), {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (rows[0]) return { payment: rowToPayment(rowFromDb(TABLE_PAYMENTS, rows[0])), duplicate: false };
  const existing = await rest.select<RestRow>(TABLE_PAYMENTS, {
    filters: ownedFilters(ownerId, payment.id),
    limit: 1,
  });
  if (!existing[0]) {
    throw new Error("Оплату не знайдено після спроби запису");
  }
  return { payment: rowToPayment(rowFromDb(TABLE_PAYMENTS, existing[0])), duplicate: true };
}

export async function updatePaymentRow(
  rest: RestClient,
  ownerId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<Payment | null> {
  const rows = await rest.update<RestRow>(TABLE_PAYMENTS, patchRow(patch, TABLE_PAYMENTS), ownedFilters(ownerId, id));
  return rows[0] ? rowToPayment(rowFromDb(TABLE_PAYMENTS, rows[0])) : null;
}

export async function findPayment(rest: RestClient, ownerId: string, id: string): Promise<Payment | null> {
  const rows = await rest.select<RestRow>(TABLE_PAYMENTS, {
    filters: ownedFilters(ownerId, id),
    limit: 1,
  });
  return rows[0] ? rowToPayment(rowFromDb(TABLE_PAYMENTS, rows[0])) : null;
}

export async function deletePaymentRow(rest: RestClient, ownerId: string, id: string): Promise<boolean> {
  const rows = await rest.delete<RestRow>(TABLE_PAYMENTS, ownedFilters(ownerId, id));
  return rows.length > 0;
}

export async function insertReminder(
  rest: RestClient,
  ownerId: string,
  reminder: Reminder,
  timeZone: string
): Promise<Reminder> {
  const [row] = await rest.insert<RestRow>(TABLE_REMINDERS, reminderRow(reminder, ownerId, timeZone));
  return rowToReminder(row, timeZone);
}

export async function updateReminderRow(
  rest: RestClient,
  ownerId: string,
  id: string,
  patch: Record<string, unknown>,
  timeZone: string
): Promise<Reminder | null> {
  const rows = await rest.update<RestRow>(TABLE_REMINDERS, reminderPatchRow(patch, timeZone), ownedFilters(ownerId, id));
  return rows[0] ? rowToReminder(rows[0], timeZone) : null;
}

export async function deleteReminderRow(rest: RestClient, ownerId: string, id: string): Promise<boolean> {
  const rows = await rest.delete<RestRow>(TABLE_REMINDERS, ownedFilters(ownerId, id));
  return rows.length > 0;
}

export async function listProjectPayments(rest: RestClient, ownerId: string, projectId: string): Promise<Payment[]> {
  const rows = await rest.select<RestRow>(TABLE_PAYMENTS, {
    filters: [
      ["owner_id", "eq", requireOwnerId(ownerId)],
      ["project_id", "eq", projectId],
    ],
  });
  return rows.map((row) => rowToPayment(rowFromDb(TABLE_PAYMENTS, row)));
}
