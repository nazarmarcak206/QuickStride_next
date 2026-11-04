import { describe, expect, it } from "vitest";
import { PREPAYMENT_NOTE, createProjectWithPrepayment, remainingAfterPrepayment, type ProjectInput } from "./projectCreate";
import type { Payment, Project } from "./types";

const input: ProjectInput = {
  clientId: null,
  title: "Лендінг для школи",
  description: "",
  amountMinor: 1200_000,
  currency: "UAH",
  status: "Новий",
  deadline: "",
  nextAction: "",
  note: "",
};

// Залежності-лабораторія: збираємо те, що дістав store від одного виклику.
function deps() {
  const projects: Project[] = [];
  const payments: Payment[] = [];
  return {
    projects,
    payments,
    addProject: (next: ProjectInput): Project => {
      const project: Project = { ...next, id: `project-${projects.length + 1}`, createdAt: "" };
      projects.push(project);
      return project;
    },
    addPayment: (next: Omit<Payment, "id" | "createdAt">): Payment => {
      const payment: Payment = { ...next, id: `payment-${payments.length + 1}`, createdAt: "" };
      payments.push(payment);
      return payment;
    },
  };
}

describe("залишок після передоплати", () => {
  it("різниця погодженої суми та передоплати", () => {
    expect(remainingAfterPrepayment(1200_000, 500_000)).toBe(700_000);
  });

  it("передплата більше за погоджену суму не дає від'ємного залишку", () => {
    expect(remainingAfterPrepayment(1200_000, 1500_000)).toBe(0);
  });

  it("нульова передплата — це повний залишок", () => {
    expect(remainingAfterPrepayment(1200_000, 0)).toBe(1200_000);
  });
});

describe("створення проєкту з передоплатою", () => {
  it("порожня передплата створює лише проєкт", () => {
    const d = deps();
    const result = createProjectWithPrepayment(d, input, 0);
    expect(d.projects).toHaveLength(1);
    expect(d.payments).toHaveLength(0);
    expect(result.payment).toBeNull();
  });

  it("передплата дає рівно один запис оплати, прив'язаний до нового проєкту", () => {
    const d = deps();
    const { project, payment } = createProjectWithPrepayment(d, input, 500_000, "2026-11-04");
    expect(d.projects).toHaveLength(1);
    expect(d.payments).toHaveLength(1);
    expect(payment?.id).toBeDefined();
    expect(d.payments[0]).toMatchObject({
      projectId: project.id,
      amountMinor: 500_000,
      currency: "UAH",
      date: "2026-11-04",
      type: "Передоплата",
      note: PREPAYMENT_NOTE,
    });
  });

  it("проєкт в EUR створює оплату в EUR — змішування валют немає", () => {
    const d = deps();
    createProjectWithPrepayment(d, { ...input, currency: "EUR" }, 20_000);
    expect(d.payments[0].currency).toBe("EUR");
  });

  it("дата без явного значення — сьогодні", () => {
    const d = deps();
    const { payment } = createProjectWithPrepayment(d, input, 10_000);
    expect(payment?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("один виклик — один проєкт: другий запис оплати з'являється лише з другої передоплати", () => {
    const d = deps();
    createProjectWithPrepayment(d, input, 500_000);
    createProjectWithPrepayment(d, { ...input, title: "Другий лендінг" }, 0);
    expect(d.projects).toHaveLength(2);
    expect(d.payments).toHaveLength(1);
  });
});
