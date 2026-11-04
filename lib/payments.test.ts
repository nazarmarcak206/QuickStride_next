import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";
import {
  canAddPayment,
  canChangeProjectCurrency,
  canUpdatePayment,
  overpayMinor,
  overpayNotice,
  paymentsOfProject,
  projectCurrencyLockNote,
  receivedAfterMinor,
} from "./payments";
import { expectedByCurrency, projectOtherCurrencyReceived, projectReceivedByCurrency, projectReceivedMinor, projectRemainingMinor } from "./store";
import type { CrmState, Payment, Project } from "./types";

// Фіктури — сценарії з аудиту: проєкт на 15 000 грн з оплатою 7 000 грн.
function project(partial: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    clientId: null,
    title: "Редизайн сайту",
    description: "",
    amountMinor: 1_500_000,
    currency: "UAH",
    status: "У роботі",
    deadline: "",
    nextAction: "",
    note: "",
    createdAt: "",
    ...partial,
  };
}

function payment(partial: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    projectId: "proj-1",
    amountMinor: 700_000,
    currency: "UAH",
    date: "2026-11-05",
    type: "Доплата",
    note: "",
    createdAt: "",
    ...partial,
  };
}

const empty: CrmState = { clients: [], projects: [], payments: [], reminders: [] };

describe("шлях 1: оплата в іншій валюті заборонена", () => {
  const state: CrmState = { ...empty, projects: [project({})], payments: [payment()] };

  it("оплата у валюті проєкту проходить", () => {
    expect(canAddPayment(state, { projectId: "proj-1", currency: "UAH" }).allowed).toBe(true);
  });

  it("оплата в іншій валюті блокується з поясненням обох валют", () => {
    const rule = canAddPayment(state, { projectId: "proj-1", currency: "USD" });
    expect(rule.allowed).toBe(false);
    expect(rule.message).toContain("лише у UAH");
    expect(rule.message).toContain("USD");
    expect(rule.message).toContain("Редизайн сайту");
  });

  it("блокування не залежить від статусу чи суми проєкту", () => {
    const cancelled: CrmState = { ...state, projects: [project({ status: "Скасований", amountMinor: 0 })] };
    expect(canAddPayment(cancelled, { projectId: "proj-1", currency: "EUR" }).allowed).toBe(false);
  });

  it("редагування суми чи дати оплати не чіпає валюту", () => {
    const rule = canUpdatePayment(state, payment(), { amountMinor: 900_000, date: "2026-11-06" });
    expect(rule.allowed).toBe(true);
  });

  it("спроба змінити валюту наявного запису блокується", () => {
    const rule = canUpdatePayment(state, payment(), { currency: "EUR" });
    expect(rule.allowed).toBe(false);
    expect(rule.message).toContain("лише у UAH");
  });

  it("перенесення оплати в проєкт іншої валюти блокується", () => {
    const two: CrmState = { ...state, projects: [project({}), project({ id: "proj-2", currency: "EUR" })] };
    expect(canUpdatePayment(two, payment(), { projectId: "proj-2" }).allowed).toBe(false);
    expect(canUpdatePayment(two, payment(), { projectId: "proj-2", currency: "EUR" }).allowed).toBe(true);
  });

  it("оплата без проєкту не вимирає на перевірці валюти", () => {
    expect(canAddPayment(empty, { projectId: "not-there", currency: "USD" }).allowed).toBe(true);
  });
});

describe("шлях 2: валюта проєкту з оплатами не змінюється", () => {
  const state: CrmState = { ...empty, projects: [project({})], payments: [payment()] };

  it("проєкт без оплат можна перевести в іншу валюту", () => {
    const noPayments: CrmState = { ...state, payments: [] };
    expect(canChangeProjectCurrency(noPayments, project({}), "EUR").allowed).toBe(true);
  });

  it("та сама валюта — не зміна, тому не блокується", () => {
    expect(canChangeProjectCurrency(state, project({}), "UAH").allowed).toBe(true);
  });

  it("наявні оплати блокують зміну валюти", () => {
    const rule = canChangeProjectCurrency(state, project({}), "EUR");
    expect(rule.allowed).toBe(false);
    expect(rule.message).toContain("уже є оплати у UAH");
    expect(rule.message).toContain("як EUR");
    expect(rule.message).toContain("конвертації");
  });

  it("блокується й спроба UAH → USD, і скасований проєкт з оплатами", () => {
    expect(canChangeProjectCurrency(state, project({}), "USD").allowed).toBe(false);
    const cancelled: CrmState = { ...state, projects: [project({ status: "Скасований" })] };
    expect(canChangeProjectCurrency(cancelled, cancelled.projects[0], "EUR").allowed).toBe(false);
  });

  it("пояснення у формі узгоджується з підмогою сховища", () => {
    const note = projectCurrencyLockNote(paymentsOfProject(state, "proj-1"));
    expect(note).toContain("1 оплата");
    expect(note).toContain("у UAH");
    expect(projectCurrencyLockNote([payment(), payment({ id: "pay-2", currency: "USD" })])).toContain(
      "2 оплати у різних валютах (UAH, USD)"
    );
  });
});

describe("наявні різновалютні записи не складаються в одну валюту", () => {
  // Сценарій аудиту: проєкт на 15 000 грн, оплати 7 000 грн і 300 USD.
  const mixed: CrmState = {
    ...empty,
    projects: [project({})],
    payments: [payment(), payment({ id: "pay-2", amountMinor: 30_000, currency: "USD" })],
  };
  const target = mixed.projects[0];

  it("отримано рахується лише в валюті проєкту", () => {
    expect(projectReceivedMinor(mixed, target)).toBe(700_000);
    expect(projectRemainingMinor(mixed, target)).toBe(800_000);
  });

  it("оплати в інших валютах видно окремо", () => {
    expect(projectReceivedByCurrency(mixed, target)).toEqual([
      { currency: "UAH", minor: 700_000 },
      { currency: "USD", minor: 30_000 },
    ]);
    expect(projectOtherCurrencyReceived(mixed, target)).toEqual([{ currency: "USD", minor: 30_000 }]);
  });

  it("залишок проєкту не зменшується чужою валютою", () => {
    // 300 USD не перетворюються на «отримано 7 300 грн» і не входять у доплати.
    expect(expectedByCurrency(mixed, "UAH")).toBe(800_000);
    expect(expectedByCurrency(mixed, "USD")).toBe(0);
  });

  it("старі різновалютні записи лишаються окремими, а не злитими в одну суму", () => {
    // Такі дані можливі в записях, створених до виправлення: проєкт у EUR, оплата в UAH.
    const legacy: CrmState = {
      ...empty,
      projects: [project({ currency: "EUR" })],
      payments: [payment()],
    };
    const legacyProject = legacy.projects[0];
    expect(legacyProject.currency).toBe("EUR");
    expect(legacy.payments[0].currency).toBe("UAH");
    expect(projectReceivedMinor(legacy, legacyProject)).toBe(0);
    expect(projectRemainingMinor(legacy, legacyProject)).toBe(1_500_000);
    expect(projectOtherCurrencyReceived(legacy, legacyProject)).toEqual([{ currency: "UAH", minor: 700_000 }]);
    expect(expectedByCurrency(legacy, "EUR")).toBe(1_500_000);
    expect(expectedByCurrency(legacy, "UAH")).toBe(0);
    // Пояснення називають валюти реальних записів, а не проєкту.
    expect(canChangeProjectCurrency(legacy, legacyProject, "USD").message).toContain("уже є оплати у UAH");
    expect(projectCurrencyLockNote(legacy.payments)).toContain("1 оплата у UAH");
  });
});

describe("переплата: попереджаємо, але записуємо", () => {
  const target = project({}); // 15 000 грн
  const first = payment(); // 7 000 грн

  it("переплата не є порушенням — store її пропускає", () => {
    const state: CrmState = { ...empty, projects: [target], payments: [first] };
    expect(canAddPayment(state, { projectId: "proj-1", currency: "UAH" }).allowed).toBe(true);
  });

  it("точна оплата погодженої суми — без попередження", () => {
    const after = receivedAfterMinor(target, [first], { amountMinor: 800_000, currency: "UAH" });
    expect(after).toBe(1_500_000);
    expect(overpayMinor(target, after)).toBe(0);
    expect(overpayNotice(target, after)).toBeNull();
  });

  it("недоплата — без попередження", () => {
    expect(overpayNotice(target, 1_499_900)).toBeNull();
  });

  it("надлишок дає текст і суму надлишку", () => {
    const after = receivedAfterMinor(target, [first], { amountMinor: 1_000_000, currency: "UAH" });
    expect(after).toBe(1_700_000);
    expect(overpayMinor(target, after)).toBe(200_000);
    const note = overpayNotice(target, after) ?? "";
    expect(note).toContain(`Переплата: ${formatMoney(1_700_000, "UAH")}`);
    expect(note).toContain(formatMoney(200_000, "UAH"));
    expect(note).toContain("на інший проєкт сума не перейде");
  });

  it("редагування власного запису не рахує його двічі", () => {
    const list = [first, payment({ id: "pay-2", amountMinor: 300_000 })];
    expect(receivedAfterMinor(target, list, { amountMinor: 1_200_000, currency: "UAH", replaceId: "pay-1" })).toBe(1_500_000);
    expect(receivedAfterMinor(target, list, { amountMinor: 1_300_000, currency: "UAH", replaceId: "pay-1" })).toBe(1_600_000);
  });

  it("лише оплати в валюті проєкту беруться до рахунку", () => {
    const mixed = [first, payment({ id: "pay-usd", currency: "USD", amountMinor: 900_000 })];
    // Новий запис у USD не наближає переплату в грн і не рахується замість них.
    expect(receivedAfterMinor(target, mixed, { amountMinor: 100_000, currency: "USD", replaceId: "pay-usd" })).toBe(700_000);
    expect(overpayNotice(target, receivedAfterMinor(target, mixed, { amountMinor: 100_000, currency: "USD", replaceId: "pay-usd" }))).toBeNull();
  });

  it("старий запис в чужій валюті не робить переплату в валюті проєкту", () => {
    const euroProject = project({ currency: "EUR" });
    const legacy = [payment({ currency: "UAH", amountMinor: 900_000 })];
    expect(overpayMinor(euroProject, 0)).toBe(0);
    expect(projectOtherCurrencyReceived({ ...empty, projects: [euroProject], payments: legacy }, euroProject)).toEqual([
      { currency: "UAH", minor: 900_000 },
    ]);
    expect(overpayNotice(euroProject, receivedAfterMinor(euroProject, legacy, { amountMinor: 100_000, currency: "UAH", replaceId: "pay-1" }))).toBeNull();
  });

  it("переплата не дає від'ємного залишку й не виходить за 100%", () => {
    const overpaid: CrmState = {
      ...empty,
      projects: [project({ status: "Завершений" })],
      payments: [payment({ amountMinor: 2_000_000 })],
    };
    const done = overpaid.projects[0];
    expect(projectReceivedMinor(overpaid, done)).toBe(2_000_000);
    expect(projectRemainingMinor(overpaid, done)).toBe(0);
    expect(expectedByCurrency(overpaid, "UAH")).toBe(0);
    expect(Math.min(100, Math.round((2_000_000 / done.amountMinor) * 100))).toBe(100);
  });
});
