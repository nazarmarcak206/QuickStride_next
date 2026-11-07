import { todayISO } from "./money";
import type { Payment, Project } from "./types";

export type ProjectInput = Omit<Project, "id" | "createdAt">;

// Передоплата — це звичайний запис отриманої оплати, доданий одразу разом із
// проєктом. Порожнє поле або нуль не створюють платіж; статус проєкту сам по
// собі теж нічого не створює (гроші вносяться лише вручну).
export const PREPAYMENT_NOTE = "Передоплата під створення проєкту";

export function remainingAfterPrepayment(amountMinor: number, prepaymentMinor: number): number {
  return Math.max(0, amountMinor - prepaymentMinor);
}

type Deps = {
  addProject: (input: ProjectInput) => Project | Promise<Project>;
  addPayment: (input: Omit<Payment, "id" | "createdAt">) => Payment | Promise<Payment>;
  // Режим акаунта: сервер зберігає проєкт і передоплату однією транзакцією.
  // Якщо надано — використовується саме він, і два окремі виклики не потрібні.
  addProjectWithPayment?: (
    input: ProjectInput,
    prepaymentMinor: number,
    date: string
  ) => Promise<{ project: Project; payment: Payment | null }>;
};

/**
 * Один виклик = один проєкт і щонайбільше одна оплата. Викликається з форми,
 * яка блокує повторне надсилання, тож подвійний клік не створює другого запису.
 * Очікує завершення запису (у режимі акаунта — відповіді сервера), тому помилка
 * зберігання доходить до форми як відхилення, а проєкт не «зникає».
 */
export async function createProjectWithPrepayment(
  deps: Deps,
  input: ProjectInput,
  prepaymentMinor: number,
  date: string = todayISO()
): Promise<{ project: Project; payment: Payment | null }> {
  if (deps.addProjectWithPayment) {
    return deps.addProjectWithPayment(input, prepaymentMinor, date);
  }
  const project = await deps.addProject(input);
  if (!(prepaymentMinor > 0)) return { project, payment: null };
  const payment = await deps.addPayment({
    projectId: project.id,
    amountMinor: prepaymentMinor,
    // Валюта платежу — валюта проєкту: змішування валют заборонене політикою MVP.
    currency: project.currency,
    date,
    type: "Передоплата",
    note: PREPAYMENT_NOTE,
  });
  return { project, payment };
}
