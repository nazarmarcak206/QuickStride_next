import { describe, expect, it } from "vitest";
import { dailySeriesForMonth, daysInMonth, groupReminders, nearestDeadlines, seriesTotal, splitReminders, statusCounts } from "./dashboard";
import type { CrmState, Payment, Project, Reminder } from "./types";

function payment(partial: Partial<Payment>): Payment {
  return { id: partial.id ?? "p", projectId: "proj", amountMinor: 100_00, currency: "UAH", date: "2026-10-05", type: "Доплата", note: "", createdAt: "", ...partial };
}

const baseState: CrmState = { clients: [], projects: [], payments: [], reminders: [] };

describe("денний графік доходу", () => {
  it("містить усі дні місяця, включно з днями без оплат", () => {
    const series = dailySeriesForMonth(baseState, "UAH", "2026-10");
    expect(series).toHaveLength(31);
    expect(series.every((item) => item.minor === 0)).toBe(true);
  });

  it("довжина відповідає місяцю: лютий 2026 — 28 днів, січень — 31", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-01")).toBe(31);
    expect(dailySeriesForMonth(baseState, "USD", "2026-02")).toHaveLength(28);
  });

  it("місяць через межу року: оплата 31 грудня не потрапляє в січень", () => {
    const december = dailySeriesForMonth({ ...baseState, payments: [payment({ date: "2025-12-31" })] }, "UAH", "2025-12");
    const january = dailySeriesForMonth({ ...baseState, payments: [payment({ date: "2025-12-31" })] }, "UAH", "2026-01");
    expect(december[30].minor).toBe(100_00);
    expect(seriesTotal(january)).toBe(0);
  });

  it("дві оплати одного дня підсумовуються, інші дні лишаються нульовими", () => {
    const state: CrmState = {
      ...baseState,
      payments: [payment({ date: "2026-10-05", amountMinor: 30_00 }), payment({ date: "2026-10-05", amountMinor: 70_00 }), payment({ date: "2026-10-20", amountMinor: 5_00 })],
    };
    const series = dailySeriesForMonth(state, "UAH", "2026-10");
    expect(series[4].minor).toBe(100_00);
    expect(series[19].minor).toBe(5_00);
    expect(series[0].minor).toBe(0);
    expect(seriesTotal(series)).toBe(105_00);
  });

  it("валюти не змішуються: UAH і EUR рахуються окремо", () => {
    const state: CrmState = {
      ...baseState,
      payments: [payment({ date: "2026-10-05", amountMinor: 100_00, currency: "UAH" }), payment({ date: "2026-10-05", amountMinor: 20_00, currency: "EUR" })],
    };
    expect(dailySeriesForMonth(state, "UAH", "2026-10")[4].minor).toBe(100_00);
    expect(dailySeriesForMonth(state, "EUR", "2026-10")[4].minor).toBe(20_00);
    expect(dailySeriesForMonth(state, "USD", "2026-10")[4].minor).toBe(0);
  });

  it("порожній стан: без оплат сума нульова, серія все одно повна", () => {
    const series = dailySeriesForMonth(baseState, "EUR", "2026-11");
    expect(seriesTotal(series)).toBe(0);
    expect(series[0].day).toBe(1);
    expect(series[series.length - 1].day).toBe(30);
  });
});

describe("діаграма проєктів за статусами", () => {
  it("порожній стан: без проєктів статусів немає", () => {
    expect(statusCounts(baseState)).toEqual([]);
  });

  it("показує всі наявні статуси з кількостями, без приховування", () => {
    const project = (status: Project["status"]): Project =>
      ({ id: status, clientId: null, title: status, description: "", amountMinor: 0, currency: "UAH", status, deadline: "", nextAction: "", note: "", createdAt: "" });
    const state: CrmState = { ...baseState, projects: [project("Новий"), project("У роботі"), project("У роботі"), project("Завершений"), project("Скасований")] };
    const counts = statusCounts(state);
    expect(counts).toEqual([
      { status: "Новий", count: 1 },
      { status: "У роботі", count: 2 },
      { status: "Завершений", count: 1 },
      { status: "Скасований", count: 1 },
    ]);
  });

  it("статуси без проєктів не потрапляють у діаграму", () => {
    const project: Project = { id: "p", clientId: null, title: "Т", description: "", amountMinor: 0, currency: "UAH", status: "Обговорення", deadline: "", nextAction: "", note: "", createdAt: "" };
    const counts = statusCounts({ ...baseState, projects: [project] });
    expect(counts).toEqual([{ status: "Обговорення", count: 1 }]);
  });
});

describe("справи: прострочені та сьогодні", () => {
  const reminder = (partial: Partial<Reminder>): Reminder =>
    ({ id: partial.id ?? "r", title: "Справа", datetime: "2026-11-01T09:00", clientId: null, projectId: null, done: false, createdAt: "", ...partial });

  it("відокремлює прострочені від сьогоднішніх, виконані не показує", () => {
    const state: CrmState = {
      ...baseState,
      reminders: [
        reminder({ id: "1", datetime: "2026-10-30T11:30" }),
        reminder({ id: "2", datetime: "2026-11-02T15:00" }),
        reminder({ id: "3", datetime: "2026-10-31T09:00", done: true }),
      ],
    };
    const split = splitReminders(state, "2026-11-02");
    expect(split.overdue.map((r) => r.id)).toEqual(["1"]);
    expect(split.today.map((r) => r.id)).toEqual(["2"]);
  });

  it("сортує прострочені від давніших і не вважає майбутні простроченими", () => {
    const state: CrmState = {
      ...baseState,
      reminders: [reminder({ id: "a", datetime: "2026-11-01T10:00" }), reminder({ id: "b", datetime: "2026-10-25T08:00" }), reminder({ id: "c", datetime: "2026-11-05T12:00" })],
    };
    const split = splitReminders(state, "2026-11-02");
    expect(split.overdue.map((r) => r.id)).toEqual(["b", "a"]);
    expect(split.today).toEqual([]);
  });
});

describe("справи: повне групування", () => {
  const reminder = (partial: Partial<Reminder>): Reminder =>
    ({ id: partial.id ?? "r", title: "Справа", datetime: "2026-11-02T09:00", clientId: null, projectId: null, done: false, createdAt: "", ...partial });

  it("розкладає всі справи по чотирьох групах без втрат і дублів", () => {
    const state: CrmState = {
      ...baseState,
      reminders: [
        reminder({ id: "over", datetime: "2026-10-31T09:00" }),
        reminder({ id: "today", datetime: "2026-11-02T12:00" }),
        reminder({ id: "next", datetime: "2026-11-03T10:00" }),
        reminder({ id: "done", datetime: "2026-11-02T08:00", done: true }),
      ],
    };
    const groups = groupReminders(state, "2026-11-02");
    expect(groups.overdue.map((r) => r.id)).toEqual(["over"]);
    expect(groups.today.map((r) => r.id)).toEqual(["today"]);
    expect(groups.upcoming.map((r) => r.id)).toEqual(["next"]);
    expect(groups.done.map((r) => r.id)).toEqual(["done"]);
    const total = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.done.length;
    expect(total).toBe(state.reminders.length);
  });

  it("виконана справа не потрапляє у прострочені навіть із минулою датою", () => {
    const state: CrmState = { ...baseState, reminders: [reminder({ id: "x", datetime: "2026-10-01T09:00", done: true })] };
    const groups = groupReminders(state, "2026-11-02");
    expect(groups.done.map((r) => r.id)).toEqual(["x"]);
    expect(groups.overdue).toEqual([]);
  });

  it("всередині групи справи йдуть від ранніших", () => {
    const state: CrmState = {
      ...baseState,
      reminders: [reminder({ id: "late", datetime: "2026-11-03T18:00" }), reminder({ id: "early", datetime: "2026-11-03T09:00" })],
    };
    const groups = groupReminders(state, "2026-11-02");
    expect(groups.upcoming.map((r) => r.id)).toEqual(["early", "late"]);
  });
});

describe("найближчі дедлайни", () => {
  const project = (id: string, deadline: string, status: Project["status"]): Project =>
    ({ id, clientId: null, title: id, description: "", amountMinor: 10_000, currency: "UAH", status, deadline, nextAction: "", note: "", createdAt: "" });

  it("без дедлайнів і завершених — порожньо", () => {
    expect(nearestDeadlines(baseState)).toEqual([]);
  });

  it("обирає найближчі активні дедлайни з отриманими сумами", () => {
    const state: CrmState = {
      ...baseState,
      projects: [project("a", "2026-11-10", "У роботі"), project("b", "2026-11-05", "Очікує клієнта"), project("c", "2026-11-01", "Завершений"), project("d", "2026-11-20", "У роботі")],
      payments: [payment({ projectId: "b", amountMinor: 4_000, date: "2026-11-01" })],
    };
    const deadlines = nearestDeadlines(state, 2);
    expect(deadlines.map((row) => row.project.id)).toEqual(["b", "a"]);
    expect(deadlines[0].receivedMinor).toBe(4_000);
  });
});
