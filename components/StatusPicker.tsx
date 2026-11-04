"use client";

import { PickerSheet, type PickerOption } from "./ListPicker";
import { StatusPill } from "./ui";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/types";

// Короткі підказки під кожним статусом — щоб вибір був зрозумілим без здогадок.
export const STATUS_HINTS: Record<ProjectStatus, string> = {
  "Новий": "Запит чи заявка, ще не узгоджено",
  "Обговорення": "Ведемо переговори про умови",
  "У роботі": "Працюємо над проєктом",
  "Очікує клієнта": "Крок за клієнтом — узгодження чи оплата",
  "Завершений": "Роботу виконано (оплата може бути ще не повна)",
  "Скасований": "Проєкт не відбувся",
};

const CLASS: Record<ProjectStatus, string> = {
  "Новий": "new",
  "Обговорення": "talk",
  "У роботі": "active",
  "Очікує клієнта": "waiting",
  "Завершений": "done",
  "Скасований": "cancelled",
};

export function statusOptions(): PickerOption<ProjectStatus>[] {
  return PROJECT_STATUSES.map((status) => ({
    value: status,
    label: status,
    hint: STATUS_HINTS[status],
    swatch: <StatusPill status={status} />,
  }));
}

// Нижній лист із великими варіантами статусу. Закриття без змін — хрестик,
// тло або Esc; вибір застосовується одразу.
export function StatusPicker({
  current,
  onSelect,
  onClose,
}: {
  current: ProjectStatus;
  onSelect: (status: ProjectStatus) => void;
  onClose: () => void;
}) {
  return (
    <PickerSheet
      title="Статус проєкту"
      options={statusOptions()}
      value={current}
      onSelect={onSelect}
      onClose={onClose}
      footer={<p className="form-hint">Поточний статус: {current}. Закрийте лист, щоб залишити його без змін.</p>}
    />
  );
}
