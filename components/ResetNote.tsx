"use client";

import { RotateCcw } from "lucide-react";
import { useCrm } from "@/lib/store";
import { haptic } from "@/lib/telegram";

// Демо-режим: дані живуть у localStorage браузера, а не в базі.
// База даних ще не обрана й не підключена.
export function ResetNote({ onDone }: { onDone?: () => void }) {
  const { resetDemo, isDemo } = useCrm();

  return (
    <div className="reset-card">
      <p className="reset-title">Демо-режим</p>
      <p className="reset-text">
        {isDemo
          ? "Зараз відображаються демонстраційні дані. Ваші зміни зберігаються лише в цьому браузері (localStorage) — база даних ще не підключена."
          : "Дані з ваших змін збережені локально в браузері. База даних ще не підключена."}
      </p>
      <button
        type="button"
        className="button-secondary"
        onClick={() => {
          if (window.confirm("Повернути початкові демодані? Ваші зміни буде вилучено.")) {
            resetDemo();
            haptic("warning");
            onDone?.();
          }
        }}
      >
        <RotateCcw size={15} /> Скинути демодані
      </button>
    </div>
  );
}
