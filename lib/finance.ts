import { monthKey } from "./money";
import type { CrmState, Currency } from "./types";

// Тиждень починається з понеділка (українська convention). Ключ тижня —
// ISO-дата його понеділка.
export function weekStartISO(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  const shift = (parsed.getDay() + 6) % 7; // 0 для понеділка … 6 для неділі
  parsed.setDate(parsed.getDate() - shift);
  return toISODate(parsed);
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  parsed.setDate(parsed.getDate() + days);
  return toISODate(parsed);
}

export const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"] as const;

export type WeekDay = { iso: string; label: string; minor: number };

// Серія по 7 днях тижня (Пн–Нд) для однієї валюти, з дат фактичних оплат.
export function weeklySeriesForWeek(state: CrmState, currency: Currency, weekStart: string): WeekDay[] {
  const totals = new Array<number>(7).fill(0);
  for (const payment of state.payments) {
    if (payment.currency !== currency) continue;
    const offset = daysBetween(weekStart, payment.date);
    if (offset >= 0 && offset < 7) totals[offset] += payment.amountMinor;
  }
  return totals.map((minor, index) => ({
    iso: addDaysISO(weekStart, index),
    label: WEEKDAY_LABELS[index],
    minor,
  }));
}

// Різниця в днях між двома ISO-датами (локальні дати, без часових поясів).
export function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd).getTime();
  const to = new Date(ty, tm - 1, td).getTime();
  return Math.round((to - from) / 86_400_000);
}

export function weekTotal(series: WeekDay[]): number {
  return series.reduce((sum, day) => sum + day.minor, 0);
}

// Чи тиждень, що містить сьогодні, — щоб вимикати «наступний тиждень».
export function isCurrentWeek(weekStart: string, todayISODate: string): boolean {
  return weekStartISO(todayISODate) === weekStart;
}

export function monthOfPaymentDate(date: string): string {
  return monthKey(date);
}
