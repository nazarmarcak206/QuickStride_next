"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, ArrowRight, Briefcase, Check, CircleAlert, Plus, Users, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { AnimatedCount, AnimatedMoney } from "@/components/AnimatedNumbers";
import { ClientForm, PaymentForm, ProjectForm, ReminderForm, type ClientInput, type PaymentInput, type ReminderInput } from "@/components/forms";
import { PickerSheet, type PickerOption } from "@/components/ListPicker";
import { Sheet, Toast, useToast } from "@/components/ui";
import { dailySeriesForMonth, nearestDeadlines, seriesTotal, splitReminders, statusCounts, type DayValue, type StatusCount } from "@/lib/dashboard";
import { currentMonthKey, formatDay, formatMoney, monthLabel, todayISO } from "@/lib/money";
import { createProjectWithPrepayment } from "@/lib/projectCreate";
import { pluralProjects } from "@/lib/text";
import { currenciesInUse, expectedByCurrency, projectPayments, projectRemainingMinor, receivedInMonthMinor, useCrm } from "@/lib/store";
import { haptic } from "@/lib/telegram";
import { CURRENCIES, type Currency, type Project } from "@/lib/types";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброї ночі";
  if (hour < 12) return "Доброго ранку";
  if (hour < 18) return "Доброго дня";
  return "Доброго вечора";
}

// Підпис під головним екраном: де зараз живуть дані.
function DemoNote() {
  const { isDemo } = useCrm();
  return (
    <p className="demo-note">
      {isDemo
        ? "Демо-режим: дані збережені локально в цьому браузері."
        : "Дані збережено в базі QuickStride і доступні на всіх пристроях акаунта."}
    </p>
  );
}

const STATUS_BAR_CLASS: Record<string, string> = {
  "Новий": "bar-muted",
  "Обговорення": "bar-coral",
  "У роботі": "bar-accent",
  "Очікує клієнта": "bar-muted",
  "Завершений": "bar-positive",
  "Скасований": "bar-danger",
};

// Компактна дія «швидко додати»: маленький «+» біля іконки каже, що це створення,
// а не перехід до розділу.
function QuickAction({
  icon,
  label,
  name,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className="quick-tile"
      onClick={() => {
        haptic("light");
        onPress();
      }}
      aria-label={name}
    >
      <span className="quick-icon" aria-hidden="true">
        {icon}
        <span className="quick-badge">
          <Plus size={9} strokeWidth={3.4} />
        </span>
      </span>
      <span className="quick-label">{label}</span>
    </button>
  );
}

// Денні бари: висота пропорційна сумі дня. Значення доступні текстом
// («Розбивка по днях» нижче), тож графік читається й без кольору.
function DayBars({ series, ariaLabel }: { series: DayValue[]; ariaLabel: string }) {
  const max = Math.max(...series.map((item) => item.minor), 1);
  const lastDay = series.length;
  const showLabel = (day: number) => [1, 8, 15, 22].includes(day) || (day === 29 && lastDay - 29 > 1) || day === lastDay;
  return (
    <div className="day-bars" role="img" aria-label={ariaLabel}>
      {series.map((item) => (
        <span className="day-bar-slot" key={item.day}>
          <span
            className={`day-bar ${item.minor > 0 ? "filled" : ""}`}
            style={{ height: `${item.minor > 0 ? Math.max(6, (item.minor / max) * 64) : 3}px` }}
          />
          {showLabel(item.day) ? <i>{item.day}</i> : null}
        </span>
      ))}
    </div>
  );
}

function StatusDiagram({ counts, total }: { counts: StatusCount[]; total: number }) {
  return (
    <div className="status-diagram" role="img" aria-label={`Проєкти за статусами, разом ${total}`}>
      {counts.map(({ status, count }) => (
        <div className="status-row" key={status}>
          <span className="status-name">{status}</span>
          <span className="status-track">
            <span className={`status-bar ${STATUS_BAR_CLASS[status] ?? "bar-muted"}`} style={{ width: `${Math.max(4, (count / total) * 100)}%` }} />
          </span>
          <span className="status-count"><AnimatedCount value={count} /></span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const { state, addProject, addProjectWithPayment, addClient, addPayment, addReminder, toggleReminder } = useCrm();
  const { toast, notify } = useToast();
  const router = useRouter();
  const [projectOpen, setProjectOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [paymentPickerOpen, setPaymentPickerOpen] = useState(false);
  const [payFor, setPayFor] = useState<Project | null>(null);
  const [month, setMonth] = useState(currentMonthKey());
  const [chartCurrency, setChartCurrency] = useState<Currency | null>(null);

  const [finishing, setFinishing] = useState<Set<string>>(() => new Set());
  const finishingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const todayDate = todayISO();

  useEffect(() => {
    const timers = finishingTimers.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  const completeReminder = (id: string) => {
    if (finishingTimers.current.has(id)) return;
    haptic("light");
    const save = () => toggleReminder(id).catch(() => notify("Не вдалося зберегти справу"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void save();
      return;
    }
    setFinishing((previous) => new Set(previous).add(id));
    void save();
    const timer = setTimeout(() => {
      finishingTimers.current.delete(id);
      setFinishing((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }, 480);
    finishingTimers.current.set(id, timer);
  };

  const currencies = useMemo(() => {
    const inUse = currenciesInUse(state);
    return CURRENCIES.filter((currency) => inUse.includes(currency));
  }, [state]);

  const activeCurrency = chartCurrency && currencies.includes(chartCurrency) ? chartCurrency : currencies[0] ?? "UAH";
  const daySeries = useMemo(() => dailySeriesForMonth(state, activeCurrency, month), [state, activeCurrency, month]);
  const dayTotal = seriesTotal(daySeries);
  const paidDays = daySeries.filter((item) => item.minor > 0);

  const receivedByCurrency = useMemo(
    () => currencies.map((currency) => ({ currency, minor: receivedInMonthMinor(state, currency, month) })).filter((row) => row.minor > 0),
    [state, currencies, month],
  );

  const expected = useMemo(
    () =>
      currencies
        .map((currency) => ({
          currency,
          minor: expectedByCurrency(state, currency),
          // Скільки проєктів дають цю суму — без неї підсумок виглядає незрозумілим.
          projects: state.projects.filter(
            (project) =>
              project.currency === currency &&
              project.status !== "Скасований" &&
              projectRemainingMinor(state, project) > 0
          ).length,
        }))
        .filter((row) => row.minor > 0),
    [state, currencies],
  );

  const counts = useMemo(() => statusCounts(state), [state]);

  const { overdue, today: todayTasks } = useMemo(() => splitReminders({
    ...state,
    reminders: state.reminders.map((reminder) => finishing.has(reminder.id) ? { ...reminder, done: false } : reminder),
  }, todayDate), [state, todayDate, finishing]);

  const deadlines = useMemo(() => nearestDeadlines(state, 3), [state]);

  // Сценарій оплати лишається двоетапним: спершу проєкт, потім сума.
  const paymentOptions: PickerOption<string>[] = useMemo(
    () =>
      state.projects
        .filter((project) => project.status !== "Скасований")
        .sort((a, b) => a.title.localeCompare(b.title, "uk"))
        .map((project) => {
          const remaining = projectRemainingMinor(state, project);
          return {
            value: project.id,
            label: project.title,
            hint:
              remaining > 0
                ? `${project.status} · залишок ${formatMoney(remaining, project.currency)}`
                : `${project.status} · оплачено повністю`,
          };
        }),
    [state],
  );

  const payForClientName = payFor
    ? state.clients.find((client) => client.id === payFor.clientId)?.name
    : undefined;

  const dateLabel = new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1>{greeting()} 👋</h1>
        <p className="page-sub">{dateLabel}</p>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>Фінансовий огляд</h2>
          <button type="button" className="text-link" onClick={() => router.push("/finance")}>
            Усі фінанси <ArrowRight size={13} />
          </button>
        </div>
        <MonthSwitcher month={month} onChange={setMonth} currentMonth={currentMonthKey()} />
        <p className="overview-label">Отримано за {monthLabel(month, "accusative")}</p>
        {receivedByCurrency.length > 0 ? (
          <div className="stat-rows">
            {receivedByCurrency.map((row) => (
              <div className="stat-row" key={row.currency}>
                <span className="stat-currency">{row.currency}</span>
                <strong className="stat-value">
                  <AnimatedMoney minor={row.minor} currency={row.currency} />
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="card-empty">У {monthLabel(month, "locative")} оплат ще не було.</p>
        )}
        <div className="overview-divider" />
        <p className="overview-label">Очікувані доплати</p>
        {expected.length > 0 ? (
          <div className="stat-rows">
            {expected.map((row) => (
              <div className="stat-row" key={row.currency}>
                <span className="stat-currency">
                  {row.currency}
                  <small className="stat-count">· {row.projects} {pluralProjects(row.projects)}</small>
                </span>
                <strong className="stat-value accent">
                  <AnimatedMoney minor={row.minor} currency={row.currency} />
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="card-empty">Усі оплати за активними проєктами надійшли.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Дохід по днях</h2>
          {currencies.length > 1 && (
            <div className="chip-row" role="group" aria-label="Валюта графіка доходу">
              {currencies.map((currency) => (
                <button type="button" key={currency} className={`chip ${activeCurrency === currency ? "active" : ""}`} aria-pressed={activeCurrency === currency} onClick={() => setChartCurrency(currency)}>
                  {currency}
                </button>
              ))}
            </div>
          )}
        </div>
        <DayBars series={daySeries} ariaLabel={`Оплати по днях за ${monthLabel(month, "accusative")}, ${activeCurrency}. Разом ${formatMoney(dayTotal, activeCurrency)}`} />
        {dayTotal > 0 ? (
          <>
            <p className="chart-total">
              <span>Разом за {monthLabel(month, "accusative")}</span>
              <strong>
                <AnimatedMoney minor={dayTotal} currency={activeCurrency} />
              </strong>
            </p>
            <details className="chart-details">
              <summary>Розбивка по днях</summary>
              <ul className="chart-days">
                {paidDays.map((item) => (
                  <li key={item.day}>
                    {formatDay(`${month}-${String(item.day).padStart(2, "0")}`)} — {formatMoney(item.minor, activeCurrency)}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="card-empty">У {monthLabel(month, "locative")} оплат у {activeCurrency} не було.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Проєкти за статусами</h2>
          <button type="button" className="text-link" onClick={() => router.push("/projects")}>
            Усі <ArrowRight size={13} />
          </button>
        </div>
        {counts.length > 0 ? (
          <StatusDiagram counts={counts} total={state.projects.length} />
        ) : (
          <p className="card-empty">Проєктів поки немає. Створіть перший через швидку дію нижче.</p>
        )}
      </section>

      <section className="quick-add" aria-labelledby="quick-add-title">
        <h2 className="quick-add-title" id="quick-add-title">Швидко додати</h2>
        <div className="quick-grid">
          <QuickAction icon={<Briefcase size={17} />} label="Проєкт" name="Додати проєкт" onPress={() => setProjectOpen(true)} />
          <QuickAction icon={<Users size={17} />} label="Клієнта" name="Додати клієнта" onPress={() => setClientOpen(true)} />
          <QuickAction icon={<AlarmClock size={17} />} label="Справу" name="Додати справу" onPress={() => setReminderOpen(true)} />
          <QuickAction icon={<Wallet size={17} />} label="Оплату" name="Додати оплату" onPress={() => setPaymentPickerOpen(true)} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Справи</h2>
          <button type="button" className="text-link" onClick={() => router.push("/reminders")}>
            Усі справи <ArrowRight size={13} />
          </button>
        </div>
        {overdue.length === 0 && todayTasks.length === 0 ? (
          <p className="card-empty">Прострочених і сьогоднішніх справ немає. Спокійного дня ✨</p>
        ) : (
          <>
            {overdue.length > 0 && (
              <>
                <p className="overview-label warn">
                  <CircleAlert size={13} /> Прострочені · {overdue.length}
                </p>
                <div className="mini-list tone-overdue">
                  {overdue.map((reminder) => (
                    <div className={`mini-row task-row ${finishing.has(reminder.id) ? "is-completing" : ""}`} key={reminder.id}>
                      <button
                        type="button"
                        className={`check-button ${finishing.has(reminder.id) ? "checked" : ""}`}
                        onClick={() => completeReminder(reminder.id)}
                        disabled={finishing.has(reminder.id)}
                        aria-label="Позначити виконаним"
                      >
                        {finishing.has(reminder.id) && <Check size={13} />}
                      </button>
                      <span className="mini-title">
                        <span className="task-title-text">{reminder.title}</span>
                        <small>
                          прострочено {formatDay(reminder.datetime.slice(0, 10))} · {reminder.datetime.slice(11, 16)}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {todayTasks.length > 0 && (
              <>
                <p className="overview-label">Сьогодні · {todayTasks.length}</p>
                <div className="mini-list tone-today">
                  {todayTasks.map((reminder) => (
                    <div className={`mini-row task-row ${finishing.has(reminder.id) ? "is-completing" : ""}`} key={reminder.id}>
                      <button
                        type="button"
                        className={`check-button ${finishing.has(reminder.id) ? "checked" : ""}`}
                        onClick={() => completeReminder(reminder.id)}
                        disabled={finishing.has(reminder.id)}
                        aria-label="Позначити виконаним"
                      >
                        {finishing.has(reminder.id) && <Check size={13} />}
                      </button>
                      <span className="mini-title">
                        <span className="task-title-text">{reminder.title}</span>
                        <small>{reminder.datetime.slice(11, 16)}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Найближчі дедлайни</h2>
          <button type="button" className="text-link" onClick={() => router.push("/projects")}>
            Усі проєкти <ArrowRight size={13} />
          </button>
        </div>
        {deadlines.length > 0 ? (
          <div className="mini-list">
            {deadlines.map(({ project, receivedMinor }) => (
              <div className="mini-row" key={project.id}>
                <span className="mini-time">{formatDay(project.deadline)}</span>
                <span className="mini-title">
                  {project.title}
                  <small>
                    {formatMoney(receivedMinor, project.currency)} з {formatMoney(project.amountMinor, project.currency)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="card-empty">Активних дедлайнів немає.</p>
        )}
      </section>

      <DemoNote />

      {projectOpen && (
        <Sheet title="Новий проєкт" variant="form" onClose={() => setProjectOpen(false)}>
          <ProjectForm
            clients={state.clients}
            onCreateClient={addClient}
            onSubmit={async ({ project: input, prepaymentMinor }) => {
              const { payment } = await createProjectWithPrepayment({ addProject, addPayment, addProjectWithPayment }, input, prepaymentMinor);
              setProjectOpen(false);
              haptic("success");
              notify(payment ? `Проєкт і передоплату ${formatMoney(payment.amountMinor, payment.currency)} записано` : "Проєкт створено");
            }}
          />
        </Sheet>
      )}
      {clientOpen && (
        <Sheet title="Новий клієнт" variant="form" onClose={() => setClientOpen(false)}>
          <ClientForm
            existing={state.clients}
            onSubmit={async (input: ClientInput) => {
              await addClient(input);
              setClientOpen(false);
              haptic("success");
              notify("Клієнта додано");
            }}
          />
        </Sheet>
      )}
      {reminderOpen && (
        <Sheet title="Нова справа" variant="form" onClose={() => setReminderOpen(false)}>
          <ReminderForm
            projects={state.projects.filter((project) => project.status !== "Скасований")}
            clients={state.clients}
            onCreateClient={addClient}
            onSubmit={async (input: ReminderInput) => {
              await addReminder(input);
              setReminderOpen(false);
              haptic("success");
              notify("Справу додано");
            }}
          />
        </Sheet>
      )}

      {paymentPickerOpen && (
        <PickerSheet
          title="Проєкт для оплати"
          options={paymentOptions}
          onSelect={(projectId) => {
            const project = state.projects.find((item) => item.id === projectId);
            if (project) setPayFor(project);
            setPaymentPickerOpen(false);
          }}
          onClose={() => setPaymentPickerOpen(false)}
          empty={
            <div className="sheet-empty-action">
              <p className="card-empty">
                Ще немає проєкту, на який можна записати оплату. Створіть проєкт —
                оплата прив’язується до нього.
              </p>
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  setPaymentPickerOpen(false);
                  setProjectOpen(true);
                }}
              >
                <Plus size={15} /> Створити проєкт
              </button>
            </div>
          }
        />
      )}

      {payFor && (
        <Sheet title="Додати оплату" variant="form" onClose={() => setPayFor(null)}>
          <div className="pay-context">
            <strong>{payFor.title}</strong>
            <small>
              {payForClientName ? `${payForClientName} · ` : ""}
              залишок {formatMoney(projectRemainingMinor(state, payFor), payFor.currency)}
            </small>
          </div>
          <PaymentForm
            project={payFor}
            payments={projectPayments(state, payFor.id)}
            onSubmit={async (input: PaymentInput) => {
              await addPayment({ projectId: payFor.id, ...input });
              setPayFor(null);
              haptic("success");
              notify("Оплату записано — фінанси оновлено");
            }}
          />
        </Sheet>
      )}

      <Toast toast={toast} />
    </div>
  );
}
