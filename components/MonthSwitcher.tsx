"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { monthTitle, shiftMonth } from "@/lib/money";

export function MonthSwitcher({ month, onChange, currentMonth }: { month: string; onChange: (month: string) => void; currentMonth: string }) {
  return (
    <div className="month-switcher">
      <button type="button" className="icon-button" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Попередній місяць">
        <ArrowLeft size={16} />
      </button>
      <strong>{monthTitle(month)}</strong>
      <button
        type="button"
        className="icon-button"
        onClick={() => onChange(shiftMonth(month, 1))}
        aria-label="Наступний місяць"
        disabled={month >= currentMonth}
      >
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
