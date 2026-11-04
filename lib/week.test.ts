import { describe, expect, it } from "vitest";
import { addDaysISO, daysBetween, isCurrentWeek, weekStartISO, weekTotal, weeklySeriesForWeek } from "./finance";
import type { CrmState, Payment } from "./types";

function payment(partial: Partial<Payment>): Payment {
  return { id: partial.id ?? "p", projectId: "proj", amountMinor: 100_00, currency: "UAH", date: "2026-11-04", type: "Доплата", note: "", createdAt: "", ...partial };
}

const baseState: CrmState = { clients: [], projects: [], payments: [], reminders: [] };

describe("межі тижня", () => {
  it("тиждень починається з понеділка", () => {
    // 2026-11-02 — понеділок, 2026-11-08 — неділя
    expect(weekStartISO("2026-11-02")).toBe("2026-11-02");
    expect(weekStartISO("2026-11-08")).toBe("2026-11-02");
  });

  it("середа тижня дає понеділок того ж тижня", () => {
    expect(weekStartISO("2026-11-04")).toBe("2026-11-02");
  });

  it("неділя належить до тижня, що почався минулого понеділка", () => {
    // 2026-11-01 — неділя: тиждень 26.10–01.11
    expect(weekStartISO("2026-11-01")).toBe("2026-10-26");
  });
});

describe("межа року в тижнях", () => {
  it("оплата 31 грудня потрапляє у свій тиждень, а не в січневий", () => {
    // 2026-12-31 — четвер тижня 28.12–03.01
    const dec = weeklySeriesForWeek({ ...baseState, payments: [payment({ date: "2026-12-31" })] }, "UAH", "2026-12-28");
    const jan = weeklySeriesForWeek({ ...baseState, payments: [payment({ date: "2026-12-31" })] }, "UAH", "2027-01-04");
    expect(weekTotal(dec)).toBe(100_00);
    expect(weekTotal(jan)).toBe(0);
  });

  it("оплата 1 січня рахується в тижні січня, попри той самий рік тижня грудня", () => {
    const newYear = weeklySeriesForWeek({ ...baseState, payments: [payment({ date: "2027-01-01", amountMinor: 50_00 })] }, "UAH", "2026-12-28");
    expect(weekTotal(newYear)).toBe(50_00);
  });
});

describe("денна серія тижня", () => {
  it("містить рівно 7 днів з підписами Пн–Нд", () => {
    const series = weeklySeriesForWeek(baseState, "UAH", "2026-11-02");
    expect(series).toHaveLength(7);
    expect(series[0].label).toBe("Пн");
    expect(series[6].label).toBe("Нд");
    expect(series[0].iso).toBe("2026-11-02");
    expect(series[6].iso).toBe("2026-11-08");
  });

  it("сумує кілька оплат одного дня, інші дні нульові", () => {
    const state: CrmState = {
      ...baseState,
      payments: [payment({ date: "2026-11-03", amountMinor: 30_00 }), payment({ date: "2026-11-03", amountMinor: 70_00 }), payment({ date: "2026-11-07", amountMinor: 5_00 })],
    };
    const series = weeklySeriesForWeek(state, "UAH", "2026-11-02");
    expect(series[1].minor).toBe(100_00);
    expect(series[5].minor).toBe(5_00);
    expect(series[0].minor).toBe(0);
    expect(weekTotal(series)).toBe(105_00);
  });

  it("валюти не змішуються", () => {
    const state: CrmState = {
      ...baseState,
      payments: [payment({ date: "2026-11-03", amountMinor: 100_00, currency: "UAH" }), payment({ date: "2026-11-03", amountMinor: 20_00, currency: "EUR" })],
    };
    expect(weeklySeriesForWeek(state, "UAH", "2026-11-02")[1].minor).toBe(100_00);
    expect(weeklySeriesForWeek(state, "EUR", "2026-11-02")[1].minor).toBe(20_00);
    expect(weeklySeriesForWeek(state, "USD", "2026-11-02")[1].minor).toBe(0);
  });

  it("порожній тиждень дає нульову суму, але повну серію", () => {
    const series = weeklySeriesForWeek(baseState, "USD", "2026-11-02");
    expect(weekTotal(series)).toBe(0);
    expect(series).toHaveLength(7);
  });
});

describe("допоміжні обчислення", () => {
  it("додає дні через межу місяця й року", () => {
    expect(addDaysISO("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-11-02", -1)).toBe("2026-11-01");
  });

  it("різниця днів коректна через межі місяців", () => {
    expect(daysBetween("2026-10-26", "2026-11-02")).toBe(7);
    expect(daysBetween("2026-12-28", "2027-01-03")).toBe(6);
  });

  it("поточний тиждень розпізнається, сусідні — ні", () => {
    expect(isCurrentWeek("2026-11-02", "2026-11-05")).toBe(true);
    expect(isCurrentWeek("2026-10-26", "2026-11-05")).toBe(false);
    expect(isCurrentWeek("2026-11-09", "2026-11-05")).toBe(false);
  });
});
