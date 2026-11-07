import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { findClient, findProject, insertReminder, newRecordId } from "@/lib/server/repo";
import type { Reminder } from "@/lib/types";
import { getOrCreateSettings, settingsOfRow } from "@/lib/server/users";
import { parseReminderPatch } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт справи.");
  const parsed = parseReminderPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);
  if (parsed.value.title === undefined) return apiError(400, "Назва справи: обовʼязкове поле");
  // due_at у базі — timestamptz NOT NULL: справа без дати не існує, і
  // інакше її нікуди поставити в «найближчих дедлайнах».
  if (!parsed.value.datetime) return apiError(400, "Дата й час: обовʼязкове поле — справа без дати не має коли наступати");
  const id = newRecordId(body.id);
  if (!id.ok) return apiError(400, id.error);

  const reminder: Reminder = {
    id: id.value,
    title: parsed.value.title,
    datetime: parsed.value.datetime,
    clientId: parsed.value.clientId ?? null,
    projectId: parsed.value.projectId ?? null,
    done: false,
    createdAt: new Date().toISOString(),
  };

  return withUser(async ({ rest, ownerId }) => {
    if (reminder.clientId) {
      const client = await findClient(rest, ownerId, reminder.clientId);
      if (!client) return apiError(404, "Клієнта не знайдено.");
    }
    if (reminder.projectId) {
      const project = await findProject(rest, ownerId, reminder.projectId);
      if (!project) return apiError(404, "Проєкт не знайдено.");
    }
    // Місцевий час перетворюється на момент у поясі власника; сам пояс
    // записуємо в crm_reminders.timezone.
    const settings = settingsOfRow(await getOrCreateSettings(rest, ownerId));
    const saved = await insertReminder(rest, ownerId, reminder, settings.timeZone);
    return apiJson({ reminder: saved }, 201);
  });
}
