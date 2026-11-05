"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, Sheet, Toast, useToast } from "@/components/ui";
import { ReminderForm } from "@/components/forms";
import { groupReminders } from "@/lib/dashboard";
import { formatDay, todayISO } from "@/lib/money";
import { useCrm } from "@/lib/store";
import { haptic } from "@/lib/telegram";
import type { Reminder } from "@/lib/types";

const GROUP_TONES = ["overdue", "today", "upcoming", "done"] as const;
type GroupTone = (typeof GROUP_TONES)[number];

const GROUP_LABELS: Record<GroupTone, string> = {
  overdue: "Прострочені",
  today: "Сьогодні",
  upcoming: "Майбутні",
  done: "Виконані",
};

// Зрозумілий час: для сьогоднішніх — лише час, для інших — день тижня і дата.
function taskWhen(reminder: Reminder, today: string): string {
  const date = reminder.datetime.slice(0, 10);
  const time = reminder.datetime.slice(11, 16);
  if (date === today) return time;
  const weekday = new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(new Date(`${date}T12:00`));
  return `${weekday}, ${formatDay(date)} · ${time}`;
}

export default function Reminders() {
  const { state, addClient, addReminder, updateReminder, toggleReminder, deleteReminder } = useCrm();
  const { toast, notify } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [finishing, setFinishing] = useState<Set<string>>(() => new Set());
  const finishingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const today = todayISO();

  useEffect(() => {
    const timers = finishingTimers.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  const completeReminder = (reminder: Reminder) => {
    if (finishingTimers.current.has(reminder.id)) return;
    haptic("light");
    if (reminder.done || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      toggleReminder(reminder.id);
      return;
    }
    setFinishing((previous) => new Set(previous).add(reminder.id));
    toggleReminder(reminder.id);
    const timer = setTimeout(() => {
      finishingTimers.current.delete(reminder.id);
      setFinishing((previous) => {
        const next = new Set(previous);
        next.delete(reminder.id);
        return next;
      });
    }, 480);
    finishingTimers.current.set(reminder.id, timer);
  };

  const groups = useMemo(() => groupReminders({
    ...state,
    reminders: state.reminders.map((reminder) => finishing.has(reminder.id) ? { ...reminder, done: false } : reminder),
  }, today), [state, today, finishing]);

  const linkedNames = (reminder: Reminder) => {
    const project = state.projects.find((item) => item.id === reminder.projectId)?.title;
    const client = state.clients.find((item) => item.id === reminder.clientId)?.name;
    return [client, project].filter(Boolean).join(" · ");
  };

  const renderRow = (reminder: Reminder, tone: GroupTone) => {
    const linked = linkedNames(reminder);
    const isFinishing = finishing.has(reminder.id);
    return (
      <div className={`mini-row task-row ${reminder.done ? "is-done" : ""} ${isFinishing ? "is-completing" : ""}`} key={reminder.id}>
        <button
          type="button"
          className={`check-button ${reminder.done || isFinishing ? "checked" : ""}`}
          onClick={() => completeReminder(reminder)}
          disabled={isFinishing}
          aria-label={reminder.done ? "Повернути до активних" : "Позначити виконаним"}
        >
          {(reminder.done || isFinishing) && <Check size={13} />}
        </button>
        <span className="mini-title">
          <span className="task-title-text">{reminder.title}</span>
          <small>
            {tone === "overdue" ? "прострочено · " : ""}
            {taskWhen(reminder, today)}
            {linked ? ` · ${linked}` : ""}
          </small>
        </span>
        <button type="button" className="icon-button" onClick={() => setEditing(reminder)} aria-label={`Редагувати справу «${reminder.title}»`}>
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            if (window.confirm("Видалити цю справу?")) {
              deleteReminder(reminder.id);
              haptic("warning");
              notify("Справу видалено");
            }
          }}
          aria-label={`Видалити справу «${reminder.title}»`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  const activeGroups = ["overdue", "today", "upcoming"] as const;
  const hasAny = state.reminders.length > 0;

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1>Справи</h1>
      </header>

      {!hasAny ? (
        <EmptyState
          icon={<Bell size={26} />}
          title="Справ поки немає"
          hint="Створіть першу справу — бот нагадає про неї."
          action={
            <button type="button" className="button-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Нова справа
            </button>
          }
        />
      ) : (
        <>
          {activeGroups.map((key) => {
            const items = groups[key];
            if (items.length === 0) return null;
            return (
              <section className={`card task-group tone-${key}`} key={key}>
                <div className="card-head">
                  <h2>
                    {GROUP_LABELS[key]} <span className="count-bubble small">{items.length}</span>
                  </h2>
                </div>
                <div className="mini-list">{items.map((item) => renderRow(item, key))}</div>
              </section>
            );
          })}
          {groups.overdue.length === 0 && groups.today.length === 0 && groups.upcoming.length === 0 && (
            <section className="card">
              <p className="card-empty">Активних справ немає — усе виконано. 🎉</p>
            </section>
          )}
          {groups.done.length > 0 && (
            <section className="card task-group tone-done">
              <div className="card-head">
                <h2>
                  Виконані <span className="count-bubble small">{groups.done.length}</span>
                </h2>
              </div>
              <div className="mini-list">{groups.done.map((item) => renderRow(item, "done"))}</div>
            </section>
          )}
        </>
      )}

      <button type="button" className="fab" onClick={() => setCreating(true)} aria-label="Нова справа">
        <Plus size={22} />
      </button>

      {creating && (
        <Sheet title="Нова справа" variant="form" onClose={() => setCreating(false)}>
          <ReminderForm
            projects={state.projects.filter((project) => project.status !== "Скасований")}
            clients={state.clients}
            onCreateClient={addClient}
            onSubmit={(input) => {
              addReminder(input);
              setCreating(false);
              haptic("success");
              notify("Справу додано");
            }}
          />
        </Sheet>
      )}

      {editing && (
        <Sheet title="Редагувати справу" variant="form" onClose={() => setEditing(null)}>
          <ReminderForm
            projects={state.projects.filter((project) => project.status !== "Скасований")}
            clients={state.clients}
            initial={editing}
            onSubmit={(input) => {
              updateReminder(editing.id, input);
              setEditing(null);
              haptic("success");
              notify("Справу оновлено");
            }}
          />
        </Sheet>
      )}

      <Toast toast={toast} />
    </div>
  );
}
