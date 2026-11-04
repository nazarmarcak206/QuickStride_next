import { currentMonthKey, monthKey } from "./money";
import { projectReceivedMinor } from "./store";
import { PROJECT_STATUSES, type CrmState, type Currency, type ProjectStatus, type Reminder } from "./types";

// --- Денний графік доходу ---------------------------------------------------

export type DayValue = { day: number; minor: number };

export function daysInMonth(month: string): number {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(year, monthIndex, 0).getDate();
}

// Серія по всіх днях обраного місяця для однієї валюти. Використовуються дати
// фактично внесених оплат; коригувань окремого типу в моделі немає — редагування
// чи видалення оплати змінюють сам запис, тож графік завжди відображає актуальні
// підтверджені операції.
export function dailySeriesForMonth(state: CrmState, currency: Currency, month: string): DayValue[] {
  const totals = new Array<number>(daysInMonth(month)).fill(0);
  for (const payment of state.payments) {
    if (payment.currency !== currency) continue;
    if (monthKey(payment.date) !== month) continue;
    const day = Number(payment.date.slice(8, 10));
    if (day >= 1 && day <= totals.length) totals[day - 1] += payment.amountMinor;
  }
  return totals.map((minor, index) => ({ day: index + 1, minor }));
}

export function seriesTotal(series: DayValue[]): number {
  return series.reduce((sum, item) => sum + item.minor, 0);
}

// --- Проєкти за статусами ---------------------------------------------------

export type StatusCount = { status: ProjectStatus; count: number };

// Усі статуси, що зустрічаються серед проєктів, у фіксованому порядку.
// Статусів без проєктів у списку немає — нульові значення не приховуємо
// всередині інших, їх просто не малюємо.
export function statusCounts(state: CrmState): StatusCount[] {
  return PROJECT_STATUSES.map((status) => ({
    status,
    count: state.projects.filter((project) => project.status === status).length,
  })).filter((row) => row.count > 0);
}

// --- Справи: групи прострочені / сьогодні / майбутні / виконані --------------

export type ReminderGroups = {
  overdue: Reminder[];
  today: Reminder[];
  upcoming: Reminder[];
  done: Reminder[];
};

// Єдине групування для сторінки «Справи» і дашборда: виконані — окремо,
// решта за датою (локальна дата з datetime), кожна група від ранніших.
export function groupReminders(state: CrmState, today: string): ReminderGroups {
  const groups: ReminderGroups = { overdue: [], today: [], upcoming: [], done: [] };
  for (const reminder of state.reminders) {
    if (reminder.done) {
      groups.done.push(reminder);
      continue;
    }
    const date = reminder.datetime.slice(0, 10);
    if (date < today) groups.overdue.push(reminder);
    else if (date === today) groups.today.push(reminder);
    else groups.upcoming.push(reminder);
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.datetime.localeCompare(b.datetime));
  return groups;
}

export type ReminderSplit = {
  overdue: Reminder[];
  today: Reminder[];
};

export function splitReminders(state: CrmState, today: string): ReminderSplit {
  const { overdue, today: todayList } = groupReminders(state, today);
  return { overdue, today: todayList };
}

// --- Найближчі дедлайни ------------------------------------------------------

export function nearestDeadlines(state: CrmState, limit = 3) {
  return state.projects
    .filter((project) => project.deadline && project.status !== "Завершений" && project.status !== "Скасований")
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, limit)
    .map((project) => ({
      project,
      receivedMinor: projectReceivedMinor(state, project),
    }));
}

export function currentMonth(): string {
  return currentMonthKey();
}
