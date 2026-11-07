import { canChangeProjectCurrency } from "@/lib/payments";
import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { findClient, findProject, listProjectPayments, updateProjectRow } from "@/lib/server/repo";
import type { CrmState } from "@/lib/types";
import { parseProjectPatch, parseRecordId } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const recordId = parseRecordId(id);
  if (!recordId.ok) return apiError(400, recordId.error);
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт із змінами.");
  const parsed = parseProjectPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);

  return withUser(async ({ rest, ownerId }) => {
    const existing = await findProject(rest, ownerId, recordId.value);
    if (!existing) return apiError(404, "Проєкт не знайдено.");

    if (parsed.value.clientId !== undefined && parsed.value.clientId) {
      const client = await findClient(rest, ownerId, parsed.value.clientId);
      if (!client) return apiError(404, "Клієнта не знайдено.");
    }

    // Валютні правила дублюються на сервері: навіть запит повз форму не
    // зміша́є валюти — зміна валюти з наявними оплатами заборонена.
    if (parsed.value.currency !== undefined && parsed.value.currency !== existing.currency) {
      const payments = await listProjectPayments(rest, ownerId, existing.id);
      const state: CrmState = { clients: [], projects: [existing], payments, reminders: [] };
      const rule = canChangeProjectCurrency(state, existing, parsed.value.currency);
      if (!rule.allowed) return apiError(409, rule.message);
    }

    const project = await updateProjectRow(rest, ownerId, recordId.value, parsed.value);
    if (!project) return apiError(404, "Проєкт не знайдено.");
    return apiJson({ project });
  });
}
