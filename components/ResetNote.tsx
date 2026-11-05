"use client";

import { useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { useCrm } from "@/lib/store";
import { pluralClients, pluralPayments, pluralProjects, pluralReminders } from "@/lib/text";
import { haptic } from "@/lib/telegram";

// Демо-режим: дані живуть у localStorage браузера, а не в базі.
// База даних ще не обрана й не підключена.
//
// Підтвердження — не window.confirm: у WebView він може не з’явитися й мовчки
// заблокувати дію. Тому два кроки тут само, з переліком того, що саме йде.
export function ResetNote() {
  const { state, resetDemo } = useCrm();
  const [confirming, setConfirming] = useState(false);

  const counts = [
    `${state.projects.length} ${pluralProjects(state.projects.length)}`,
    `${state.payments.length} ${pluralPayments(state.payments.length)}`,
    `${state.clients.length} ${pluralClients(state.clients.length)}`,
    `${state.reminders.length} ${pluralReminders(state.reminders.length)}`,
  ].join(", ");

  return (
    <section className="card reset-card">
      <div className="card-head">
        <h2>Демо-дані</h2>
      </div>
      {confirming ? (
        <>
          <p className="reset-text warn">
            <TriangleAlert size={14} />
            <span>
              Скидання замінить поточні {counts} на початкові демодані. Ім’я, основна валюта й часовий пояс
              лишаться незмінними.
            </span>
          </p>
          <div className="reset-actions">
            <button
              type="button"
              className="button-danger"
              onClick={() => {
                resetDemo();
                haptic("warning");
                setConfirming(false);
              }}
            >
              <RotateCcw size={15} /> Так, скинути
            </button>
            <button type="button" className="button-secondary" onClick={() => setConfirming(false)}>
              Скасувати
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="reset-text">
            Записи зберігаються лише в цьому браузері — бази даних ще немає. Скидання повертає демонстраційні
            проєкти, оплати, клієнтів і справи.
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              haptic("light");
              setConfirming(true);
            }}
          >
            <RotateCcw size={15} /> Скинути демодані
          </button>
        </>
      )}
    </section>
  );
}
