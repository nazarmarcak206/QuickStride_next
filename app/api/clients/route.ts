import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { insertClient, newRecordId } from "@/lib/server/repo";
import type { Client } from "@/lib/types";
import { parseClientPatch } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт клієнта.");
  const parsed = parseClientPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);
  if (parsed.value.name === undefined) return apiError(400, "Імʼя: обовʼязкове поле");
  const id = newRecordId(body.id);
  if (!id.ok) return apiError(400, id.error);

  const client: Client = {
    id: id.value,
    name: parsed.value.name,
    company: parsed.value.company ?? "",
    phone: parsed.value.phone ?? "",
    telegram: parsed.value.telegram ?? "",
    email: parsed.value.email ?? "",
    note: parsed.value.note ?? "",
    kind: parsed.value.kind ?? null,
    archived: parsed.value.archived ?? false,
    createdAt: new Date().toISOString(),
  };

  return withUser(async ({ rest, ownerId }) => {
    const saved = await insertClient(rest, ownerId, client);
    return apiJson({ client: saved }, 201);
  });
}
