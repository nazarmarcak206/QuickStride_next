"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { addDaysISO, isCurrentWeek } from "@/lib/finance";
import { formatDay } from "@/lib/money";

// Підпис тижня: «2–8 листопада», через місяць — «26 жовтня — 1 листопада»,
// через рік — з роками.
export function weekLabel(weekStart: string): string {
  const end = addDaysISO(weekStart, 6);
  const startDay = formatDay(weekStart);
  const endDay = formatDay(end);
  const startYear = weekStart.slice(0, 4);
  const endYear = end.slice(0, 4);
  const startMonth = weekStart.slice(0, 7);
  const endMonth = end.slice(0, 7);
  if (startMonth === endMonth) {
    return `${Number(weekStart.slice(8, 10))}–${endDay}`;
  }
  if (startYear === endYear) {
    return `${startDay} — ${endDay}`;
  }
  return `${startDay} ${startYear} — ${endDay} ${endYear}`;
}

export function WeekSwitcher({ weekStart, onChange, todayISODate }: { weekStart: string; onChange: (weekStart: string) => void; todayISODate: string }) {
  return (
    <div className="month-switcher">
      <button type="button" className="icon-button" onClick={() => onChange(addDaysISO(weekStart, -7))} aria-label="Попередній тиждень">
        <ArrowLeft size={16} />
      </button>
      <strong>{weekLabel(weekStart)}</strong>
      <button
        type="button"
        className="icon-button"
        onClick={() => onChange(addDaysISO(weekStart, 7))}
        aria-label="Наступний тиждень"
        disabled={isCurrentWeek(weekStart, todayISODate)}
      >
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
