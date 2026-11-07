import { canUpdatePayment } from "@/lib/payments";
import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import {
  deletePaymentRow,
  findPayment,
  findProject,
  listProjectPayments,
  updatePaymentRow,
} from "@/lib/server/repo";
import type { CrmState } from "@/lib/types";
import { parsePaymentPatch, parseRecordId } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const recordId = parseRecordId(id);
  if (!recordId.ok) return apiError(400, recordId.error);
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт із змінами.");
  const parsed = parsePaymentPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);

  return withUser(async ({ rest, ownerId }) => {
    const existing = await findPayment(rest, ownerId, recordId.value);
    if (!existing) return apiError(404, "Оплату не знайдено.");

    const targetProjectId = parsed.value.projectId ?? existing.projectId;
    if (parsed.value.projectId !== undefined) {
      const target = await findProject(rest, ownerId, targetProjectId);
      if (!target) return apiError(404, "Проєкт не знайдено.");
    }

    // Правило валюти застосовується і до редагування: оплата не може
    // опинитися у проєкті іншої валюти.
    if (parsed.value.currency !== undefined || parsed.value.projectId !== undefined) {
      const project = await findProject(rest, ownerId, targetProjectId);
      if (project) {
        const payments = await listProjectPayments(rest, ownerId, project.id);
        const state: CrmState = { clients: [], projects: [project], payments, reminders: [] };
        const rule = canUpdatePayment(state, existing, parsed.value);
        if (!rule.allowed) return apiError(409, rule.message);
      }
    }

    const payment = await updatePaymentRow(rest, ownerId, recordId.value, parsed.value);
    if (!payment) return apiError(404, "Оплату не знайдено.");
    return apiJson({ payment });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const recordId = parseRecordId(id);
  if (!recordId.ok) return apiError(400, recordId.error);
  return withUser(async ({ rest, ownerId }) => {
    const deleted = await deletePaymentRow(rest, ownerId, recordId.value);
    if (!deleted) return apiError(404, "Оплату не знайдено.");
    return new Response(null, { status: 204 });
  });
}
