import { describe, expect, it } from "vitest";
import { makeDemoState } from "./demoData";
import { currentMonthKey } from "./money";
import { currenciesInUse, expectedByCurrency, monthlySeriesMinor, projectOtherCurrencyReceived, projectReceivedMinor, projectRemainingMinor, receivedInMonthMinor } from "./store";
import type { CrmState, Payment } from "./types";

const state = makeDemoState();

describe("фінансові селектори на демоданих", () => {
  it("отримано за проєктом = сума його оплат у валюті проєкту", () => {
    const identity = state.projects.find((p) => p.title.includes("Айдентика"))!;
    // 5 000 + 9 000 + 10 000 грн
    expect(projectReceivedMinor(state, identity)).toBe(24_000_00);
    expect(projectOtherCurrencyReceived(state, identity)).toEqual([]);
    expect(projectRemainingMinor(state, identity)).toBe(0);
  });

  it("залишок не буває від'ємним при переплаті", () => {
    const project = state.projects[0];
    const overpay: Payment = { id: "p1", projectId: project.id, amountMinor: project.amountMinor + 500, currency: project.currency, date: "2026-10-01", type: "Доплата", note: "", createdAt: "" };
    const paid: CrmState = { ...state, payments: [overpay] };
    expect(projectRemainingMinor(paid, project)).toBe(0);
  });

  it("отримано за місяць рахує лише потрібну валюту і місяць", () => {
    // Беремо місяць реальної UAH-оплати з демосіду, щоб тест не залежав від дати запуску
    const uahPayment = state.payments.find((p) => p.currency === "UAH")!;
    const month = uahPayment.date.slice(0, 7);
    const expected = state.payments
      .filter((p) => p.currency === "UAH" && p.date.slice(0, 7) === month)
      .reduce((sum, p) => sum + p.amountMinor, 0);
    expect(expected).toBeGreaterThan(0);
    expect(receivedInMonthMinor(state, "UAH", month)).toBe(expected);
    // Валюти не змішуються: за цей самий місяць EUR рахується окремо
    const eurInMonth = state.payments
      .filter((p) => p.currency === "EUR" && p.date.slice(0, 7) === month)
      .reduce((sum, p) => sum + p.amountMinor, 0);
    expect(receivedInMonthMinor(state, "EUR", month)).toBe(eurInMonth);
  });

  it("очікувані доплати не змішують валюти і включають завершені з недоотриманим", () => {
    expect(expectedByCurrency(state, "UAH")).toBeGreaterThan(0);
    expect(expectedByCurrency(state, "EUR")).toBe(100_000); // 1 000 EUR залишок
    const eurProjects = state.projects.filter((p) => p.currency === "EUR");
    expect(eurProjects.length).toBe(1);
  });

  it("графік за 6 місяців містить поточний місяць останнім", () => {
    const series = monthlySeriesMinor(state, "UAH");
    expect(series).toHaveLength(6);
    expect(series[series.length - 1].key).toBe(currentMonthKey());
    const total = series.reduce((sum, item) => sum + item.minor, 0);
    expect(total).toBe(receivedInMonthMinor(state, "UAH", series[0].key) + series.slice(1).reduce((s, i) => s + i.minor, 0));
  });

  it("валюти в ужитку беруться з проєктів і оплат", () => {
    expect(currenciesInUse(state)).toEqual(["UAH", "EUR"]);
  });
});
