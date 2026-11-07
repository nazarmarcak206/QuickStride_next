import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { findClient, insertProject, insertProjectWithPrepayment, newRecordId } from "@/lib/server/repo";
import type { Project } from "@/lib/types";
import { parseAmountMinor, parseDateText, parseProjectPatch } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт проєкта.");
  const parsed = parseProjectPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);
  const patch = parsed.value;
  if (patch.title === undefined) return apiError(400, "Назва проєкту: обовʼязкове поле");
  if (patch.amountMinor === undefined) return apiError(400, "Сума: обовʼязкове поле");
  if (patch.currency === undefined) return apiError(400, "Валюта: обовʼязкове поле");
  if (patch.status === undefined) return apiError(400, "Статус: обовʼязкове поле");
  const id = newRecordId(body.id);
  if (!id.ok) return apiError(400, id.error);

  // Передоплата приходить разом із проєктом і зберігається з ним однією
  // операцією в базі — не окремим запитом після створення.
  let prepayment: { id: string; amountMinor: number; date: string } | null = null;
  if (body.prepayment !== undefined && body.prepayment !== null) {
    if (typeof body.prepayment !== "object" || Array.isArray(body.prepayment)) {
      return apiError(400, "Передоплата: очікується обʼєкт.");
    }
    const raw = body.prepayment as Record<string, unknown>;
    const paymentId = newRecordId(raw.id);
    if (!paymentId.ok) return apiError(400, paymentId.error);
    const amount = parseAmountMinor(raw.amountMinor, "Сума передоплати", { positive: true });
    if (!amount.ok) return apiError(400, amount.error);
    const date = parseDateText(raw.date, "Дата передоплати");
    if (!date.ok) return apiError(400, date.error);
    prepayment = { id: paymentId.value, amountMinor: amount.value, date: date.value };
  }

  const project: Project = {
    id: id.value,
    clientId: patch.clientId ?? null,
    title: patch.title,
    description: patch.description ?? "",
    amountMinor: patch.amountMinor,
    currency: patch.currency,
    status: patch.status,
    deadline: patch.deadline ?? "",
    nextAction: patch.nextAction ?? "",
    note: patch.note ?? "",
    createdAt: new Date().toISOString(),
  };

  return withUser(async ({ rest, ownerId }) => {
    // Проєкт можна привʼязати лише до власного клієнта: чужий id або
    // неіснуючий тут же відхиляється, не доводячи до помилки зовнішнього ключа.
    if (project.clientId) {
      const client = await findClient(rest, ownerId, project.clientId);
      if (!client) return apiError(404, "Клієнта не знайдено.");
    }
    if (prepayment) {
      const saved = await insertProjectWithPrepayment(rest, ownerId, project, prepayment);
      return apiJson(saved, 201);
    }
    const saved = await insertProject(rest, ownerId, project);
    return apiJson({ project: saved }, 201);
  });
}
