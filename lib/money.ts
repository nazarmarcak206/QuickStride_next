import type { Currency } from "./types";

// Суми зберігаються в найменших одиницях валюти (копійки/центи), щоб
// уникати помилок округлення при підсумовуванні.
export function toMinor(value: string | number): number {
  const normalized = String(value).replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(fromMinor(minor));
}

export function formatAmountPlain(minor: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(
    fromMinor(minor)
  );
}

/**
 * Проміжна сума для показу під час лічби: округлюємо до цілої одиниці валюти,
 * щоб не блимали копійки, але ніколи не перестрибуємо цільове значення.
 * Фінальне значення повертається без змін — форматування копійок лишається точним.
 */
export function snapMinor(value: number, target: number): number {
  if (value === target) return target;
  const step = Math.round(value / 100) * 100;
  return target >= value ? Math.min(target, step) : Math.max(target, step);
}

export function currencySymbol(currency: Currency): string {
  return (
    new Intl.NumberFormat("uk-UA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find(part => part.type === "currency")?.value ?? currency
  );
}

export function monthKey(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonthKey(): string {
  return monthKey(new Date());
}

// Українські назви місяців у відмінках, які справді трапляються в підписах:
// «3 листопада» (родовий), «за листопад» (знахідний), «у листопаді» (місцевий).
const MONTH_NAMES_GEN = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];
const MONTH_NAMES_NOM = [
  "січень",
  "лютий",
  "березень",
  "квітень",
  "травень",
  "червень",
  "липень",
  "серпень",
  "вересень",
  "жовтень",
  "листопад",
  "грудень",
];
const MONTH_NAMES_LOC = [
  "січні",
  "лютому",
  "березні",
  "квітні",
  "травні",
  "червні",
  "липні",
  "серпні",
  "вересні",
  "жовтні",
  "листопаді",
  "грудні",
];

export type MonthForm = "nominative" | "genitive" | "accusative" | "locative";

const MONTH_FORMS: Record<MonthForm, string[]> = {
  nominative: MONTH_NAMES_NOM,
  genitive: MONTH_NAMES_GEN,
  // Назви місяців — чоловічі неістотні: знахідний збігається з називним.
  accusative: MONTH_NAMES_NOM,
  locative: MONTH_NAMES_LOC,
};

export function monthName(key: string, form: MonthForm): string {
  const month = Number(key.split("-")[1]);
  return MONTH_FORMS[form][month - 1];
}

export function monthLabel(key: string, form: MonthForm = "genitive"): string {
  const year = key.split("-")[0];
  return `${monthName(key, form)} ${year}`;
}

// «Січ», «Лис» — короткі підписи для осі графіка.
export function monthShortLabel(key: string): string {
  return monthName(key, "genitive").slice(0, 3);
}

// Окремий заголовок місяця (перемикач, title) — з великої літери.
export function monthTitle(key: string): string {
  const label = monthLabel(key, "nominative");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDay(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getDate()} ${MONTH_NAMES_GEN[d.getMonth()]}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return monthKey(d);
}
