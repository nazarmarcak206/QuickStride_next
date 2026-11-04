import { describe, expect, it } from "vitest";
import { migrateClient, migrateState } from "./migrate";

// Стара схема: у клієнта ще не було поля `kind`.
const legacy = {
  clients: [{ id: "c1", name: "Олена Марченко", company: "Misto", phone: "+380", telegram: "@olena", email: "a@b.c", note: "", archived: false, createdAt: "2026-01-01" }],
  projects: [{ id: "p1", clientId: "c1", title: "Сайт", description: "", amountMinor: 1500_00, currency: "UAH", status: "У роботі", deadline: "", nextAction: "", note: "", createdAt: "" }],
  payments: [{ id: "pay1", projectId: "p1", amountMinor: 700_00, currency: "UAH", date: "2026-11-05", type: "Доплата", note: "", createdAt: "" }],
  reminders: [{ id: "r1", title: "Подзвонити", datetime: "2026-11-05T09:00", clientId: "c1", projectId: "p1", done: false, createdAt: "" }],
};

// Симулюємо довільний запис із localStorage: тип даних ніхто не гарантує.
function raw(value: Record<string, unknown>): Parameters<typeof migrateClient>[0] {
  return value as Parameters<typeof migrateClient>[0];
}

describe("міграція сховища", () => {
  it("старий запис клієнта отримує тип «не задано», решта даних лишається", () => {
    const state = migrateState(legacy);
    expect(state?.clients[0].kind).toBeNull();
    expect(state?.clients[0].name).toBe("Олена Марченко");
    expect(state?.clients[0].phone).toBe("+380");
  });

  it("наявний тип зберігається, а сміття стає «не задано»", () => {
    expect(migrateClient({ id: "c1", kind: "Постійний" }).kind).toBe("Постійний");
    // Нещо, що могло залишитися в сховищі від іншої версії або з іншого застосунку.
    expect(migrateClient(raw({ id: "c1", kind: "постійний" })).kind).toBeNull();
    expect(migrateClient(raw({ id: "c1", kind: 42 })).kind).toBeNull();
    expect(migrateClient(raw({ id: "c1" })).kind).toBeNull();
  });

  it("нічого не додається і не видаляється: кількість записів однакова", () => {
    const state = migrateState(legacy);
    expect(state).not.toBeNull();
    expect(state?.clients).toHaveLength(1);
    expect(state?.projects).toHaveLength(1);
    expect(state?.payments).toHaveLength(1);
    expect(state?.reminders).toHaveLength(1);
    expect(state?.payments[0].amountMinor).toBe(700_00);
  });

  it("невідомі валюта, статус і тип оплати не викидають запис, а отримують значення за замовчуванням", () => {
    const state = migrateState({
      clients: [],
      projects: [{ id: "p1", clientId: null, title: "Тест", currency: "PLN", status: "Заморожений", amountMinor: 1000 }],
      payments: [{ id: "pay1", projectId: "p1", amountMinor: 1000, currency: "UAH", date: "2026-01-01", type: "Кешбек" }],
      reminders: [],
    });
    expect(state?.projects).toHaveLength(1);
    expect(state?.projects[0].currency).toBe("UAH");
    expect(state?.projects[0].status).toBe("Новий");
    expect(state?.payments[0].type).toBe("Інша оплата");
  });

  it("некоректні типи полів безпечні: порожній текст і хибний архів", () => {
    const client = migrateClient(raw({ id: "c1", name: null, archived: "так" }));
    expect(client.name).toBe("");
    expect(client.archived).toBe(false);
  });

  it("запис без id відкидається — його нічим прив'язати", () => {
    const state = migrateState({ ...legacy, clients: [{ name: "Без ідентифікатора" }] });
    expect(state?.clients).toHaveLength(0);
    expect(state?.projects).toHaveLength(1);
  });

  it("немає жодного списку — повертаємо null, і підхоплюються демодані", () => {
    expect(migrateState(null)).toBeNull();
    expect(migrateState("{}")).toBeNull();
    expect(migrateState({ clients: [], projects: [] })).toBeNull();
    expect(migrateState({ clients: [], projects: [], payments: [], reminders: [] })).toEqual({
      clients: [],
      projects: [],
      payments: [],
      reminders: [],
    });
  });

  it("повний стан після міграції можна мігрувати ще раз без змін", () => {
    const once = migrateState(legacy);
    expect(migrateState(once)).toEqual(once);
  });
});
