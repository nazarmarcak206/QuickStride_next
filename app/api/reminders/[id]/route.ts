import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { deleteReminderRow, findClient, findProject, updateReminderRow } from "@/lib/server/repo";
import { getOrCreateSettings, settingsOfRow } from "@/lib/server/users";
import { parseReminderPatch, parseRecordId } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const recordId = parseRecordId(id);
  if (!recordId.ok) return apiError(400, recordId.error);
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт із змінами.");
  const parsed = parseReminderPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);

  return withUser(async ({ rest, ownerId }) => {
    if (parsed.value.clientId) {
      const client = await findClient(rest, ownerId, parsed.value.clientId);
      if (!client) return apiError(404, "Клієнта не знайдено.");
    }
    if (parsed.value.projectId) {
      const project = await findProject(rest, ownerId, parsed.value.projectId);
      if (!project) return apiError(404, "Проєкт не знайдено.");
    }
    // datetime перетворюється на момент у поясі власника (due_at + timezone).
    const settings = settingsOfRow(await getOrCreateSettings(rest, ownerId));
    const reminder = await updateReminderRow(rest, ownerId, recordId.value, parsed.value, settings.timeZone);
    if (!reminder) return apiError(404, "Справу не знайдено.");
    return apiJson({ reminder });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const recordId = parseRecordId(id);
  if (!recordId.ok) return apiError(400, recordId.error);
  return withUser(async ({ rest, ownerId }) => {
    const deleted = await deleteReminderRow(rest, ownerId, recordId.value);
    if (!deleted) return apiError(404, "Справу не знайдено.");
    return new Response(null, { status: 204 });
  });
}
