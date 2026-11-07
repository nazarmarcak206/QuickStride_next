import { describe, expect, it } from "vitest";
import type { Client, Payment, Project, Reminder } from "../types";
import { importId, planDemoImport, toImportRow } from "./importDemo";
import { isUuid } from "../ids";
import { TABLE_CLIENTS, TABLE_PAYMENTS, TABLE_PROJECTS, TABLE_REMINDERS } from "./users";

const USER = "11111111-1111-4111-8111-111111111111";

function client(id: string): Client {
  return {
    id,
    name: "Клієнт",
    company: "",
    phone: "",
    telegram: "",
    email: "",
    note: "",
    kind: null,
    archived: false,
    createdAt: "2026-11-01T09:00:00.000Z",
  };
}

function project(id: string, clientId: string | null): Project {
  return {
    id,
    clientId,
    title: "Проєкт",
    description: "",
    amountMinor: 1_500_000,
    currency: "UAH",
    status: "У роботі",
    deadline: "",
    nextAction: "",
    note: "",
    createdAt: "2026-11-01T09:00:00.000Z",
  };
}

function payment(id: string, projectId: string): Payment {
  return {
    id,
    projectId,
    amountMinor: 700_000,
    currency: "UAH",
    date: "2026-11-05",
    type: "Передоплата",
    note: "",
    createdAt: "2026-11-05T10:00:00.000Z",
  };
}

function reminder(id: string, clientId: string | null, projectId: string | null): Reminder {
  return {
    id,
    title: "Справа",
    datetime: "2026-11-10T12:00",
    clientId,
    projectId,
    done: false,
    createdAt: "2026-11-01T09:00:00.000Z",
  };
}

describe("planDemoImport", () => {
  it("зв'язний стан приймається, id переписуються детерміновано", () => {
    const plan = planDemoImport(
      {
        clients: [client("c1")],
        projects: [project("p1", "c1")],
        payments: [payment("pay1", "p1")],
        reminders: [reminder("r1", "c1", "p1")],
      },
      USER
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.clients[0].id).toBe(importId(USER, "c1"));
    expect(plan.value.projects[0].id).toBe(importId(USER, "p1"));
    // Звʼязки переписуються на нові id разом із записами.
    expect(plan.value.projects[0].clientId).toBe(importId(USER, "c1"));
    expect(plan.value.payments[0].projectId).toBe(importId(USER, "p1"));
    expect(plan.value.reminders[0].clientId).toBe(importId(USER, "c1"));
    expect(plan.value.reminders[0].projectId).toBe(importId(USER, "p1"));
    // Детермінованість: той самий вхід — той самий id, тож повторна спроба не дублює.
    expect(importId(USER, "c1")).toBe(importId(USER, "c1"));
  });

  it("проєкт із неіснуючим клієнтом відхиляється, а не губиться", () => {
    const plan = planDemoImport(
      { clients: [], projects: [project("p1", "c-немає")], payments: [], reminders: [] },
      USER
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toContain("c-немає");
  });

  it("оплата без проєкту відхиляється", () => {
    const plan = planDemoImport(
      { clients: [], projects: [], payments: [payment("pay1", "p-немає")], reminders: [] },
      USER
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toContain("p-немає");
  });

  it("дублікати id відхиляються", () => {
    const plan = planDemoImport(
      { clients: [client("c1"), client("c1")], projects: [], payments: [], reminders: [] },
      USER
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toContain("дублікат");
  });

  it("порожній стан і не-об'єкт відхиляються", () => {
    expect(planDemoImport({ clients: [], projects: [], payments: [], reminders: [] }, USER).ok).toBe(false);
    expect(planDemoImport(null, USER).ok).toBe(false);
    expect(planDemoImport([client("c1")], USER).ok).toBe(false);
    expect(planDemoImport({ clients: "не список" }, USER).ok).toBe(false);
  });

  it("запис без id пропускається з поясненням, а не падає", () => {
    const plan = planDemoImport(
      {
        clients: [{ name: "Без id" }, client("c1")],
        projects: [],
        payments: [],
        reminders: [],
      },
      USER
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toContain("без id");
  });
});

describe("toImportRow: власник лише з серверної сесії", () => {
  const KYIV = "Europe/Kyiv";
  // toImportRow повертає Parsed: так само як решта сервера, він або дає рядок,
  // або пояснює, що не так.
  function row(entity: Record<string, unknown>, owner: string, table: string, timeZone = KYIV) {
    const result = toImportRow(entity, owner, table, timeZone);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  it("кожен рядок отримує owner_id із сесії, а не з даних клієнта", () => {
    const imported = row({ ...client("c1"), owner_id: "підставлений-зловмисник", user_id: "теж-підставлений" }, USER, TABLE_CLIENTS);
    expect(imported.owner_id).toBe(USER);
    expect(imported.user_id).toBeUndefined();
    expect(imported.name).toBe("Клієнт");
    expect(imported.created_at).toBe("2026-11-01T09:00:00.000Z");
  });

  it("імпорт пише фактичні колонки бази: paid_on, payment_type", () => {
    const plan = planDemoImport(
      { clients: [client("c1")], projects: [project("p1", "c1")], payments: [payment("pay1", "p1")], reminders: [] },
      USER
    );
    if (!plan.ok) throw new Error(plan.error);
    const imported = row(plan.value.payments[0], USER, TABLE_PAYMENTS);
    expect(imported.paid_on).toBe("2026-11-05");
    expect(imported.payment_type).toBe("Передоплата");
    expect(imported.date).toBeUndefined();
    expect(imported.type).toBeUndefined();
  });

  it("локальні справи: місцевий час стає моментом у поясі власника + timezone", () => {
    const plan = planDemoImport(
      { clients: [client("c1")], projects: [], payments: [], reminders: [reminder("r1", "c1", null)] },
      USER
    );
    if (!plan.ok) throw new Error(plan.error);
    const kyiv = row(plan.value.reminders[0], USER, TABLE_REMINDERS, KYIV);
    expect(kyiv.due_at).toBe("2026-11-10T10:00:00.000Z"); // 12:00 за Києвом = 10:00Z (зимовий час)
    expect(kyiv.timezone).toBe(KYIV);
    expect(kyiv.datetime).toBeUndefined();

    // той самий локальний запис в іншому поясі власника — інший момент
    const tashkent = row(plan.value.reminders[0], USER, TABLE_REMINDERS, "Asia/Tashkent");
    expect(tashkent.due_at).toBe("2026-11-10T07:00:00.000Z");
  });

  it("справа без дати не імпортується мовчки: база має due_at NOT NULL", () => {
    const plan = planDemoImport(
      { clients: [], projects: [], payments: [], reminders: [{ ...reminder("r1", null, null), datetime: "" }] },
      USER
    );
    if (!plan.ok) throw new Error(plan.error);
    expect(toImportRow(plan.value.reminders[0], USER, TABLE_REMINDERS, KYIV)).toEqual({
      ok: false,
      error: "Дата й час: очікується формат YYYY-MM-DDTHH:mm",
    });
  });

  it("імпортовані id — чинні uuid, бо в crm_* стовпець id має тип uuid", () => {
    const plan = planDemoImport({ clients: [client("c1")], projects: [project("p1", "c1")], payments: [], reminders: [] }, USER);
    if (!plan.ok) throw new Error(plan.error);
    expect(isUuid(plan.value.clients[0].id)).toBe(true);
    expect(isUuid(plan.value.projects[0].id)).toBe(true);
    expect(isUuid(plan.value.projects[0].clientId!)).toBe(true);
  });

  it("два різні користувачі отримують різних власників і неперетинні id", () => {
    const ownerB = "22222222-2222-4222-8222-222222222222";
    const planA = planDemoImport({ clients: [client("c1")], projects: [], payments: [], reminders: [] }, USER);
    const planB = planDemoImport({ clients: [client("c1")], projects: [], payments: [], reminders: [] }, ownerB);
    if (!planA.ok || !planB.ok) throw new Error("план не склався");
    const rowA = row(planA.value.clients[0], USER, TABLE_CLIENTS);
    const rowB = row(planB.value.clients[0], ownerB, TABLE_CLIENTS);
    expect(rowA.owner_id).toBe(USER);
    expect(rowB.owner_id).toBe(ownerB);
    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.id).toBe(importId(USER, "c1"));
    expect(rowB.id).toBe(importId(ownerB, "c1"));
  });

  it("повторна спроба після збою дає ті самі рядки — без дублікатів", () => {
    const plan = planDemoImport(
      { clients: [client("c1")], projects: [project("p1", "c1")], payments: [payment("pay1", "p1")], reminders: [reminder("r1", "c1", "p1")] },
      USER
    );
    if (!plan.ok) throw new Error(plan.error);
    const batch = () => [
      ...plan.value.clients.map((item) => row(item, USER, TABLE_CLIENTS)),
      ...plan.value.projects.map((item) => row(item, USER, TABLE_PROJECTS)),
      ...plan.value.payments.map((item) => row(item, USER, TABLE_PAYMENTS)),
      ...plan.value.reminders.map((item) => row(item, USER, TABLE_REMINDERS)),
    ];
    expect(batch()).toEqual(batch());
  });

  it("зіпсований createdAt відкидається — час ставить база", () => {
    expect(row({ ...client("c1"), createdAt: "не дата" }, USER, TABLE_CLIENTS).created_at).toBeUndefined();
  });
});
