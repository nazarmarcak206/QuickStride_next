"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Trash2, TrendingUp, Wallet } from "lucide-react";
import { EmptyState, Sheet, Toast, useToast } from "@/components/ui";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { WeekSwitcher, weekLabel } from "@/components/WeekSwitcher";
import { ListPicker } from "@/components/ListPicker";
import { paymentTypeOptions } from "@/components/forms";
import { AnimatedMoney } from "@/components/AnimatedNumbers";
import { currentMonthKey, formatDay, formatMoney, monthLabel, monthShortLabel, todayISO } from "@/lib/money";
import { pluralProjects } from "@/lib/text";
import { weekStartISO, weekTotal, weeklySeriesForWeek, type WeekDay } from "@/lib/finance";
import {
  currenciesInUse,
  expectedByCurrency,
  monthlySeriesMinor,
  projectRemainingMinor,
  receivedInMonthMinor,
  useCrm,
} from "@/lib/store";
import { haptic } from "@/lib/telegram";
import { CURRENCIES, type Currency, type Payment } from "@/lib/types";

type Period = "week" | "month";

// Скільки проєктів показувати в розбивці до натискання «Показати всі».
const EXPECTED_PREVIEW = 3;

// Тижневі бари: 7 слотів Пн–Нд з підписами дня. Дні з оплат позначені
// жирним підписом, значення доступні текстом («Розбивка по днях»),
// тож графік читається і без кольору.
function WeekBars({ series, ariaLabel }: { series: WeekDay[]; ariaLabel: string }) {
  const max = Math.max(...series.map((item) => item.minor), 1);
  return (
    <div className="day-bars" role="img" aria-label={ariaLabel}>
      {series.map((item) => (
        <span className="day-bar-slot" key={item.iso}>
          <span
            className={`day-bar ${item.minor > 0 ? "filled" : ""}`}
            style={{ height: `${item.minor > 0 ? Math.max(6, (item.minor / max) * 64) : 3}px` }}
          />
          <i className={item.minor > 0 ? "has-payments" : ""}>{item.label}</i>
        </span>
      ))}
    </div>
  );
}

function MonthBars({
  series,
  currency,
}: {
  series: { key: string; minor: number }[];
  currency: Currency;
}) {
  const max = Math.max(...series.map(item => item.minor), 1);
  const current = currentMonthKey();
  return (
    <div
      className="month-bars"
      role="img"
      aria-label={`Надходження за останні 6 місяців, ${currency}`}
    >
      {series.map(item => (
        <div className="month-bar-slot" key={item.key}>
          <span className="month-bar-value">
            {item.minor > 0 ? <AnimatedMoney minor={item.minor} currency={currency} /> : ""}
          </span>
          <div
            className={`month-bar ${item.key === current ? "is-current" : ""}`}
            style={{ height: `${Math.max(4, (item.minor / max) * 96)}px` }}
          />
          <span className="month-bar-label">
            {monthShortLabel(item.key)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Finance() {
  const { state, updatePayment, deletePayment } = useCrm();
  const { toast, notify } = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const [chartCurrency, setChartCurrency] = useState<Currency | null>(null);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState<Payment["type"]>("Доплата");
  const [period, setPeriod] = useState<Period>("month");
  const [expectedOpen, setExpectedOpen] = useState<Record<string, boolean>>({});
  const [weekStart, setWeekStart] = useState(() => weekStartISO(todayISO()));
  const [weekCurrency, setWeekCurrency] = useState<Currency | null>(null);
  const todayDate = todayISO();

  const currencies = useMemo(() => {
    const list = currenciesInUse(state);
    return CURRENCIES.filter(currency => list.includes(currency));
  }, [state]);

  const activeChartCurrency =
    chartCurrency && currencies.includes(chartCurrency)
      ? chartCurrency
      : (currencies[0] ?? "UAH");
  const series = useMemo(
    () => monthlySeriesMinor(state, activeChartCurrency),
    [state, activeChartCurrency]
  );

  const weekCurrencyActive =
    weekCurrency && currencies.includes(weekCurrency)
      ? weekCurrency
      : (currencies[0] ?? "UAH");
  const weekSeries = useMemo(
    () => weeklySeriesForWeek(state, weekCurrencyActive, weekStart),
    [state, weekCurrencyActive, weekStart]
  );
  const weekSum = weekTotal(weekSeries);
  const weekPaidDays = weekSeries.filter(day => day.minor > 0);

  const receivedByCurrency = useMemo(
    () =>
      currencies
        .map(currency => ({
          currency,
          minor:
            period === "month"
              ? receivedInMonthMinor(state, currency, month)
              : weekTotal(weeklySeriesForWeek(state, currency, weekStart)),
        }))
        .filter(row => row.minor > 0),
    [currencies, state, period, month, weekStart]
  );

  const expectedByCurrencyList = currencies
    .map(currency => ({
      currency,
      minor: expectedByCurrency(state, currency),
      projects: state.projects
        .filter(
          project =>
            project.currency === currency && project.status !== "Скасований"
        )
        .map(project => ({
          project,
          remaining: projectRemainingMinor(state, project),
        }))
        .filter(row => row.remaining > 0)
        .sort((a, b) => b.remaining - a.remaining),
    }))
    .filter(row => row.projects.length > 0);

  const clientName = (projectId: string) => {
    const project = state.projects.find(item => item.id === projectId);
    const client = project
      ? state.clients.find(item => item.id === project.clientId)
      : undefined;
    return client?.name ?? "";
  };

  const sortedPayments = [...state.payments].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );

  const openEdit = (payment: Payment) => {
    setEditing(payment);
    setEditAmount(String(payment.amountMinor / 100));
    setEditDate(payment.date);
    setEditType(payment.type);
  };

  const saveEdit = () => {
    if (!editing) return;
    const amountMinor = Math.round(
      (Number.parseFloat(editAmount.replace(",", ".")) || 0) * 100
    );
    if (amountMinor <= 0) return;
    const patch: Partial<Payment> = {
      amountMinor,
      date: editDate,
      type: editType,
    };
    void updatePayment(editing.id, patch)
      .then(() => {
        setEditing(null);
        haptic("success");
        notify("Оплату оновлено — підсумки перераховано");
      })
      .catch(error => notify(error instanceof Error ? error.message : "Не вдалося зберегти оплату."));
  };

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1>Фінанси</h1>
        <p className="page-sub">Лише вручну внесені оплати.</p>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>Отримано за період</h2>
          <div className="segment" role="group" aria-label="Період підсумку">
            <button type="button" aria-pressed={period === "week"} className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>
              Тиждень
            </button>
            <button type="button" aria-pressed={period === "month"} className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>
              Місяць
            </button>
          </div>
        </div>
        {period === "month" ? (
          <MonthSwitcher month={month} onChange={setMonth} currentMonth={currentMonthKey()} />
        ) : (
          <WeekSwitcher weekStart={weekStart} onChange={setWeekStart} todayISODate={todayDate} />
        )}
        {receivedByCurrency.length > 0 ? (
          <div className="stat-rows">
            {receivedByCurrency.map(row => (
              <div className="stat-row" key={row.currency}>
                <span className="stat-currency">{row.currency}</span>
                <strong className="stat-value">
                  <AnimatedMoney minor={row.minor} currency={row.currency} />
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="card-empty">
            {period === "month"
              ? `У ${monthLabel(month, "locative")} оплат ще немає.`
              : `У тиждень ${weekLabel(weekStart)} оплат ще не було.`}
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Очікувані доплати</h2>
        </div>
        {expectedByCurrencyList.length > 0 ? (
          <div className="stat-rows">
            {expectedByCurrencyList.map(row => {
              const expanded = expectedOpen[row.currency] ?? false;
              const visible = expanded ? row.projects : row.projects.slice(0, EXPECTED_PREVIEW);
              return (
                <div key={row.currency} className="expected-group">
                  <div className="stat-row">
                    <span className="stat-currency">
                      {row.currency}
                      <small className="stat-count">· {row.projects.length} {pluralProjects(row.projects.length)}</small>
                    </span>
                    <strong className="stat-value accent">
                      <AnimatedMoney minor={row.minor} currency={row.currency} />
                    </strong>
                  </div>
                  {visible.map(({ project, remaining }) => (
                    <div className="expected-project" key={project.id}>
                      <span>{project.title}</span>
                      <strong>{formatMoney(remaining, row.currency)}</strong>
                    </div>
                  ))}
                  {row.projects.length > EXPECTED_PREVIEW && (
                    <button
                      type="button"
                      className="show-all"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpectedOpen((current) => ({ ...current, [row.currency]: !expanded }))
                      }
                    >
                      {expanded
                        ? "Згорнути список"
                        : `Показати всі ${row.projects.length} ${pluralProjects(row.projects.length)}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="card-empty">
            Усі оплати за активними проєктами надійшли. 🎉
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Тиждень по днях</h2>
          {currencies.length > 1 && (
            <div className="chip-row" role="group" aria-label="Валюта тижневого графіка">
              {currencies.map(currency => (
                <button
                  type="button"
                  key={currency}
                  className={`chip ${weekCurrencyActive === currency ? "active" : ""}`}
                  aria-pressed={weekCurrencyActive === currency}
                  onClick={() => setWeekCurrency(currency)}
                >
                  {currency}
                </button>
              ))}
            </div>
          )}
        </div>
        <WeekSwitcher weekStart={weekStart} onChange={setWeekStart} todayISODate={todayDate} />
        <WeekBars series={weekSeries} ariaLabel={`Оплати по днях тижня ${weekLabel(weekStart)}, ${weekCurrencyActive}. Разом ${formatMoney(weekSum, weekCurrencyActive)}`} />
        {weekSum > 0 ? (
          <>
            <p className="chart-total">
              <span>Разом за тиждень {weekLabel(weekStart)}</span>
              <strong>
                <AnimatedMoney minor={weekSum} currency={weekCurrencyActive} />
              </strong>
            </p>
            <details className="chart-details">
              <summary>Розбивка по днях</summary>
              <ul className="chart-days">
                {weekPaidDays.map(day => (
                  <li key={day.iso}>
                    {formatDay(day.iso)} ({day.label}) —{" "}
                    {formatMoney(day.minor, weekCurrencyActive)}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="card-empty">
            У тиждень {weekLabel(weekStart)} оплат у {weekCurrencyActive} не було.
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Надходження за 6 місяців</h2>
          {currencies.length > 1 && (
            <div className="chip-row" role="group" aria-label="Валюта місячного графіка">
              {currencies.map(currency => (
                <button
                  type="button"
                  key={currency}
                  className={`chip ${activeChartCurrency === currency ? "active" : ""}`}
                  aria-pressed={activeChartCurrency === currency}
                  onClick={() => setChartCurrency(currency)}
                >
                  {currency}
                </button>
              ))}
            </div>
          )}
        </div>
        <MonthBars series={series} currency={activeChartCurrency} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Список оплат</h2>
        </div>
        {sortedPayments.length > 0 ? (
          <div className="payment-list">
            {sortedPayments.map(payment => {
              const project = state.projects.find(
                item => item.id === payment.projectId
              );
              return (
                <button
                  type="button"
                  className="payment-row"
                  key={payment.id}
                  onClick={() => openEdit(payment)}
                >
                  <span className="payment-icon">
                    <Wallet size={16} />
                  </span>
                  <span className="payment-main">
                    <strong>{project?.title ?? "Проєкт видалено"}</strong>
                    <small>
                      {clientName(payment.projectId) || "Без клієнта"} ·{" "}
                      {formatDay(payment.date)} · {payment.type}
                    </small>
                    {project && payment.currency !== project.currency && (
                      <small className="foreign-currency">
                        оплата в {payment.currency} — не входить до сум у {project.currency}
                      </small>
                    )}
                  </span>
                  <strong className="payment-amount">
                    {formatMoney(payment.amountMinor, payment.currency)}
                  </strong>
                  <ChevronRight size={15} className="row-chevron" />
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<TrendingUp size={26} />}
            title="Оплат ще немає"
            hint="Додайте першу оплату в картці проєкту."
          />
        )}
      </section>

      {editing && (
        <Sheet title="Редагувати оплату" onClose={() => setEditing(null)}>
          <form
            className="form-stack"
            onSubmit={event => {
              event.preventDefault();
              saveEdit();
            }}
          >
            <label className="field">
              Сума, {editing.currency}
              <input
                autoFocus
                required
                inputMode="decimal"
                value={editAmount}
                onChange={event => setEditAmount(event.target.value)}
              />
            </label>
            <div className="form-row">
              <label className="field">
                Дата
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={event => setEditDate(event.target.value)}
                />
              </label>
              <ListPicker
                label="Тип"
                title="Тип оплати"
                options={paymentTypeOptions}
                value={editType}
                onChange={setEditType}
              />
            </div>
            <div className="form-row">
              <button
                type="button"
                className="button-danger"
                onClick={() => {
                  if (
                    window.confirm(
                      "Видалити цю оплату? Підсумки проєкту й фінансів перерахуються."
                    )
                  ) {
                    deletePayment(editing.id)
                      .then(() => {
                        setEditing(null);
                        haptic("warning");
                        notify("Оплату видалено");
                      })
                      .catch(error => notify(error instanceof Error ? error.message : "Не вдалося видалити оплату."));
                  }
                }}
              >
                <Trash2 size={15} /> Видалити
              </button>
              <button type="submit" className="button-primary">
                Зберегти
              </button>
            </div>
          </form>
        </Sheet>
      )}

      <Toast toast={toast} />
    </div>
  );
}
