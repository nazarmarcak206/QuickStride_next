import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { updateClientRow } from "@/lib/server/repo";
import { parseClientPatch, parseRecordId } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const recordId = parseRecordId(id);
  if (!recordId.ok) return apiError(400, recordId.error);
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт із змінами.");
  const parsed = parseClientPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);

  return withUser(async ({ rest, ownerId }) => {
    const client = await updateClientRow(rest, ownerId, recordId.value, parsed.value);
    if (!client) return apiError(404, "Клієнта не знайдено.");
    return apiJson({ client });
  });
}
