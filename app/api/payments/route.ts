import { canAddPayment } from "@/lib/payments";
import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { findProject, insertPayment, listProjectPayments, newRecordId } from "@/lib/server/repo";
import type { CrmState, Payment } from "@/lib/types";
import { parsePaymentPatch } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт оплати.");
  const parsed = parsePaymentPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);
  const patch = parsed.value;
  if (patch.projectId === undefined) return apiError(400, "Проєкт: обовʼязкове поле");
  if (patch.amountMinor === undefined) return apiError(400, "Сума: обовʼязкове поле");
  if (patch.currency === undefined) return apiError(400, "Валюта: обовʼязкове поле");
  if (patch.type === undefined) return apiError(400, "Тип оплати: обовʼязкове поле");
  const id = newRecordId(body.id);
  if (!id.ok) return apiError(400, id.error);

  const payment: Payment = {
    id: id.value,
    projectId: patch.projectId,
    amountMinor: patch.amountMinor,
    currency: patch.currency,
    date: patch.date ?? new Date().toISOString().slice(0, 10),
    type: patch.type,
    note: patch.note ?? "",
    createdAt: new Date().toISOString(),
  };

  return withUser(async ({ rest, ownerId }) => {
    const project = await findProject(rest, ownerId, payment.projectId);
    if (!project) return apiError(404, "Проєкт не знайдено.");

    // Оплати існують лише у валюті проєкту — правило перевіряється сервером
    // на власних даних користувача, незалежно від того, звідки прийшов запит.
    const projectPayments = await listProjectPayments(rest, ownerId, project.id);
    const state: CrmState = { clients: [], projects: [project], payments: projectPayments, reminders: [] };
    const rule = canAddPayment(state, { projectId: project.id, currency: payment.currency });
    if (!rule.allowed) return apiError(409, rule.message);

    const saved = await insertPayment(rest, ownerId, payment);
    return apiJson({ payment: saved.payment, duplicate: saved.duplicate }, 201);
  });
}
