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
  addProject: (input: ProjectInput) => Project;
  addPayment: (input: Omit<Payment, "id" | "createdAt">) => Payment;
};

/**
 * Один виклик = один проєкт і щонайбільше одна оплата. Викликається з форми,
 * яка блокує повторне надсилання, тож подвійний клік не створює другого запису.
 */
export function createProjectWithPrepayment(
  deps: Deps,
  input: ProjectInput,
  prepaymentMinor: number,
  date: string = todayISO()
): { project: Project; payment: Payment | null } {
  const project = deps.addProject(input);
  if (!(prepaymentMinor > 0)) return { project, payment: null };
  const payment = deps.addPayment({
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
