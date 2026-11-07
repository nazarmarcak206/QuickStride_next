import { createHash } from "node:crypto";
import { migrateClient, migratePayment, migrateProject, migrateReminder } from "../migrate";
import type { Client, CrmState, Payment, Project, Reminder } from "../types";
import { dbColumn, dbValueForWrite, reminderToDb } from "./columns";
import { TABLE_REMINDERS } from "./users";
import type { Parsed } from "./validate";

// Явне перенесення локальних даних у базу. Нічого не імпортується і не
// видаляється автоматично: маршрут /api/import/demo запускається лише
// підтвердженою дією користувача.
//
// Ідентифікатори імпорту — детерміновані UUID (UUIDv5 з фіксованого простору
// імен: ownerId + локальний id). У crm_* id мають тип uuid, тому префіксні
// рядки на кшталт «imp-…» не підходять. Детермінованість зберігається:
// повторна спроба після обриву дописує брак, а не створює дублікати.
export const IMPORT_ID_NAMESPACE = "6f1a3c52-9e7d-5b8a-a1c2-7d4e8f0b6a25";

function namespaceBytes(value: string): Uint8Array {
  const hex = value.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function importId(ownerId: string, localId: string): string {
  const name = Buffer.concat([Buffer.from(namespaceBytes(IMPORT_ID_NAMESPACE)), Buffer.from(`${ownerId}:${localId}`, "utf8")]);
  const digest = createHash("sha1").update(name).digest();
  const bytes = new Uint8Array(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ImportPlan = {
  clients: Client[];
  projects: Project[];
  payments: Payment[];
  reminders: Reminder[];
};

const MAX_RECORDS_PER_TABLE = 2000;

function problems(label: string, index: number, why: string): string {
  return `${label} #${index + 1}: ${why}`;
}

function arrayField(raw: Record<string, unknown>, key: string): { rows: unknown[]; error?: string } {
  const value = raw[key];
  if (value === undefined) return { rows: [] };
  if (!Array.isArray(value)) return { rows: [], error: `${key} має бути списком` };
  return { rows: value };
}

// Перенесення приймає стан у формі локальної моделі (після migrateState
// на клієнті) і перевіряє звʼязки: оплата без проєкту чи проєкт без
// клієнта — проблема, яку користувач має побачити, а не тиха втрата запису.
export function planDemoImport(raw: unknown, ownerId: string): Parsed<ImportPlan> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Дані для перенесення мають бути обʼєктом стану" };
  }
  const state = raw as Record<string, unknown>;
  const issues: string[] = [];

  const clientsRaw = arrayField(state, "clients");
  if (clientsRaw.error) issues.push(clientsRaw.error);
  const projectsRaw = arrayField(state, "projects");
  if (projectsRaw.error) issues.push(projectsRaw.error);
  const paymentsRaw = arrayField(state, "payments");
  if (paymentsRaw.error) issues.push(paymentsRaw.error);
  const remindersRaw = arrayField(state, "reminders");
  if (remindersRaw.error) issues.push(remindersRaw.error);

  for (const [label, rows] of [
    ["Клієнти", clientsRaw.rows],
    ["Проєкти", projectsRaw.rows],
    ["Оплати", paymentsRaw.rows],
    ["Справи", remindersRaw.rows],
  ] as const) {
    if (rows.length > MAX_RECORDS_PER_TABLE) {
      issues.push(`${label}: забагато записів (${rows.length}), ліміт ${MAX_RECORDS_PER_TABLE}`);
    }
  }
  if (issues.length > 0) return { ok: false, error: issues.join("; ") };

  const clientIds = new Set<string>();
  const clients: Client[] = [];
  clientsRaw.rows.forEach((row, index) => {
    const migrated = coerceRecord(row, migrateClient);
    if (!migrated) {
      issues.push(problems("Клієнти", index, "запис без id пропущено"));
      return;
    }
    if (clientIds.has(migrated.id)) issues.push(problems("Клієнти", index, `дублікат id ${migrated.id}`));
    clientIds.add(migrated.id);
    clients.push(migrated);
  });

  const projectIds = new Set<string>();
  const projects: Project[] = [];
  projectsRaw.rows.forEach((row, index) => {
    const migrated = coerceRecord(row, migrateProject);
    if (!migrated) {
      issues.push(problems("Проєкти", index, "запис без id пропущено"));
      return;
    }
    if (projectIds.has(migrated.id)) issues.push(problems("Проєкти", index, `дублікат id ${migrated.id}`));
    if (migrated.clientId && !clientIds.has(migrated.clientId)) {
      issues.push(problems("Проєкти", index, `клієнта ${migrated.clientId} немає серед записів, що переносяться`));
    }
    projectIds.add(migrated.id);
    projects.push(migrated);
  });

  const paymentIds = new Set<string>();
  const payments: Payment[] = [];
  paymentsRaw.rows.forEach((row, index) => {
    const migrated = coerceRecord(row, migratePayment);
    if (!migrated) {
      issues.push(problems("Оплати", index, "запис без id пропущено"));
      return;
    }
    if (paymentIds.has(migrated.id)) issues.push(problems("Оплати", index, `дублікат id ${migrated.id}`));
    if (!migrated.projectId || !projectIds.has(migrated.projectId)) {
      issues.push(problems("Оплати", index, `проєкт ${migrated.projectId || "без id"} не переноситься разом з оплатою`));
    }
    paymentIds.add(migrated.id);
    payments.push(migrated);
  });

  const reminderIds = new Set<string>();
  const reminders: Reminder[] = [];
  remindersRaw.rows.forEach((row, index) => {
    const migrated = coerceRecord(row, migrateReminder);
    if (!migrated) {
      issues.push(problems("Справи", index, "запис без id пропущено"));
      return;
    }
    if (reminderIds.has(migrated.id)) issues.push(problems("Справи", index, `дублікат id ${migrated.id}`));
    if (migrated.clientId && !clientIds.has(migrated.clientId)) {
      issues.push(problems("Справи", index, `клієнта ${migrated.clientId} немає серед записів, що переносяться`));
    }
    if (migrated.projectId && !projectIds.has(migrated.projectId)) {
      issues.push(problems("Справи", index, `проєкт ${migrated.projectId} не переноситься разом зі справою`));
    }
    reminderIds.add(migrated.id);
    reminders.push(migrated);
  });

  if (issues.length > 0) return { ok: false, error: issues.join("; ") };
  if (clients.length + projects.length + payments.length + reminders.length === 0) {
    return { ok: false, error: "Локальні дані порожні — переносити нічого" };
  }

  return {
    ok: true,
    value: {
      clients: clients.map((client) => remapClient(client, ownerId)),
      projects: projects.map((project) => remapProject(project, ownerId)),
      payments: payments.map((payment) => remapPayment(payment, ownerId)),
      reminders: reminders.map((reminder) => remapReminder(reminder, ownerId)),
    },
  };
}

function coerceRecord<T>(row: unknown, migrate: (raw: Partial<T> & { id: string }) => T): T | null {
  if (!row || typeof row !== "object") return null;
  if (typeof (row as Record<string, unknown>).id !== "string") return null;
  return migrate(row as Partial<T> & { id: string });
}

function remapClient(client: Client, ownerId: string): Client {
  return { ...client, id: importId(ownerId, client.id) };
}

function remapProject(project: Project, ownerId: string): Project {
  return {
    ...project,
    id: importId(ownerId, project.id),
    clientId: project.clientId ? importId(ownerId, project.clientId) : null,
  };
}

function remapPayment(payment: Payment, ownerId: string): Payment {
  return { ...payment, id: importId(ownerId, payment.id), projectId: importId(ownerId, payment.projectId) };
}

function remapReminder(reminder: Reminder, ownerId: string): Reminder {
  return {
    ...reminder,
    id: importId(ownerId, reminder.id),
    clientId: reminder.clientId ? importId(ownerId, reminder.clientId) : null,
    projectId: reminder.projectId ? importId(ownerId, reminder.projectId) : null,
  };
}

// Кожен рядок, що йде в базу, отримує власника лише з перевіреної серверної
// сесії: ownerId передається окремим аргументом і ніколи не читається з даних
// клієнта. Назви полів, які в базі інакші (date → paid_on, type →
// payment_type), переписує dbColumn; для справ місцевий datetime перетворюється
// на пару (due_at — момент, timezone — пояс власника). Порожній/зіпсований
// createdAt локальних даних не ламає вставку — рядок отримує час БД.
export function toImportRow(
  entity: Record<string, unknown>,
  ownerId: string,
  table: string,
  timeZone: string
): Parsed<Record<string, unknown>> {
  const row: Record<string, unknown> = { owner_id: ownerId };
  for (const [key, value] of Object.entries(entity)) {
    // owner_id із даних клієнта ігнорується: власник визначає лише сесія.
    if (key === "owner_id" || key === "user_id") continue;
    if (key === "createdAt" && typeof value === "string" && Number.isNaN(new Date(value).getTime())) {
      continue;
    }
    // Локальні дані — «брудні»: порожній дедлайн має стати NULL, а не ""
    // (crm_projects.deadline — date, і порожній рядок для нього некоректний).
    const column = dbColumn(table, key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
    row[column] = dbValueForWrite(table, column, value);
  }
  if (table === TABLE_REMINDERS) {
    const wall = typeof row.datetime === "string" ? row.datetime : "";
    delete row.datetime;
    const converted = reminderToDb(wall, timeZone);
    if (!converted.ok) return { ok: false, error: converted.error };
    Object.assign(row, converted.fields);
  }
  return { ok: true, value: row };
}
