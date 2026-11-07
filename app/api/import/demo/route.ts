import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { planDemoImport, toImportRow } from "@/lib/server/importDemo";
import {
  getOrCreateSettings,
  settingsOfRow,
  TABLE_USERS,
  TABLE_CLIENTS,
  TABLE_PAYMENTS,
  TABLE_PROJECTS,
  TABLE_REMINDERS,
  type AppUserRow,
} from "@/lib/server/users";

export const dynamic = "force-dynamic";

// Явне перенесення локальних даних в акаунт. Запускається лише кнопкою
// підтвердження на сторінці налаштувань; локальні дані після імпорту
// не видаляються — це окрема свідома дія користувача.
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт зі станом.");

  return withUser(async ({ rest, ownerId }) => {
    const userRows = await rest.select<AppUserRow>(TABLE_USERS, { filters: [["id", "eq", ownerId]], limit: 1 });
    if (userRows[0]?.demo_import_completed_at) {
      return apiError(409, "Локальні дані вже перенесено в цей акаунт — повторне перенесення вимкнено.");
    }

    const plan = planDemoImport(body.state, ownerId);
    if (!plan.ok) return apiError(422, plan.error);

    // Місцевий час локальних справ перетворюється на момент у поясі
    // налаштувань власника; без нього due_at (timestamptz) не визначений.
    const timeZone = settingsOfRow(await getOrCreateSettings(rest, ownerId)).timeZone;
    const batches = [
      [TABLE_CLIENTS, plan.value.clients],
      [TABLE_PROJECTS, plan.value.projects],
      [TABLE_PAYMENTS, plan.value.payments],
      [TABLE_REMINDERS, plan.value.reminders],
    ] as const;

    const prepared: { table: string; rows: Record<string, unknown>[] }[] = [];
    for (const [table, records] of batches) {
      const rows: Record<string, unknown>[] = [];
      for (const record of records) {
        const converted = toImportRow(record as unknown as Record<string, unknown>, ownerId, table, timeZone);
        if (!converted.ok) return apiError(422, converted.error);
        rows.push(converted.value);
      }
      if (rows.length > 0) prepared.push({ table, rows });
    }

    // Детерміновані id + ignore-duplicates: обрив на середині не залишає
    // дублікати, повторна спроба дописує лише відсутні записи.
    for (const batch of prepared) {
      await rest.insert(batch.table, batch.rows, { onConflict: "id", ignoreDuplicates: true });
    }

    // Позначка «перенесення виконано» — best-effort: колонки
    // demo_import_completed_at у фактичній crm_users може не бути. Дані вже
    // записані з детермінованими id, тож повторне перенесення дублікатів не
    // створить навіть без цієї позначки.
    try {
      await rest.update(TABLE_USERS, { demo_import_completed_at: new Date().toISOString() }, [["id", "eq", ownerId]]);
    } catch (error) {
      console.warn("[import] не вдалося позначити завершення перенесення:", error instanceof Error ? error.message : error);
    }

    return apiJson({
      imported: {
        clients: plan.value.clients.length,
        projects: plan.value.projects.length,
        payments: plan.value.payments.length,
        reminders: plan.value.reminders.length,
      },
    });
  });
}
