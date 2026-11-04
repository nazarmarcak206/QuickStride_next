import { pluralPayments } from "./text";
import { formatMoney } from "./money";
import type { CrmState, Currency, Payment, Project } from "./types";

// Політика валют для MVP: оплати проєкту існують лише в його валюті.
// Конвертації в застосунку немає ніде — тому запис в іншій валюті чи зміна
// валюти проєкту змішав би суми, яких насправді не існує.
// Ці функції — останній захист: їх викликає store перед будь-яким записом,
// навіть якщо форма пропустила порушення (або стан прийшов ззовні).

export type CurrencyRule = {
  allowed: boolean;
  // Причина, чому дія заборонена; порожня, коли дія дозволена.
  message: string;
};

const ALLOWED: CurrencyRule = { allowed: true, message: "" };

export function paymentsOfProject(state: CrmState, projectId: string): Payment[] {
  return state.payments.filter((payment) => payment.projectId === projectId);
}

// Валюти реальних записів, а не проєкту: legacy-оплати можуть бути в інших.
function currencyPhrase(payments: Payment[]): string {
  const list = [...new Set(payments.map((payment) => payment.currency))];
  return list.length === 1 ? `у ${list[0]}` : `у різних валютах (${list.join(", ")})`;
}

export function canAddPayment(
  state: CrmState,
  input: { projectId: string; currency: Currency }
): CurrencyRule {
  const project = state.projects.find((item) => item.id === input.projectId);
  // Оплати без проєкту порівнювати ні з чим — такий запис лишається як є.
  if (!project || project.currency === input.currency) return ALLOWED;
  return {
    allowed: false,
    message:
      `Оплата проєкту «${project.title}» можлива лише у ${project.currency} — валюті проєкту. ` +
      `Запис у ${input.currency} змішав би різні валюти в одній сумі, а конвертації немає.`,
  };
}

export function canUpdatePayment(
  state: CrmState,
  existing: Payment,
  patch: Partial<Payment>
): CurrencyRule {
  if (patch.currency === undefined && patch.projectId === undefined) return ALLOWED;
  return canAddPayment(state, {
    projectId: patch.projectId ?? existing.projectId,
    currency: patch.currency ?? existing.currency,
  });
}

export function canChangeProjectCurrency(
  state: CrmState,
  project: Project,
  nextCurrency: Currency
): CurrencyRule {
  const payments = paymentsOfProject(state, project.id);
  if (project.currency === nextCurrency || payments.length === 0) return ALLOWED;
  return {
    allowed: false,
    message:
      `У проєкті «${project.title}» уже є оплати ${currencyPhrase(payments)}, тому валюту проєкту ` +
      `змінити не можна: ${payments.length} ${pluralPayments(payments.length)} почали б показуватися ` +
      `як ${nextCurrency} без будь-якої конвертації. Видаліть оплати або створіть окремий проєкт у новій валюті.`,
  };
}

// Пояснення для заблокованого поля валюти в формі редагування проєкту.
export function projectCurrencyLockNote(payments: Payment[]): string {
  const count = payments.length;
  return (
    `Валюту проєкту не змінити: у ньому вже ${count} ${pluralPayments(count)} ` +
    `${currencyPhrase(payments)}. Зміна валюти показала б ці записи в іншій валюті, а конвертації немає.`
  );
}

// Переплата — узгоджене рішення: надлишок попереджає, але не блокує запис
// і нікуди не переноситься. Рахуються лише оплати в валюті проєкту.
export function receivedAfterMinor(
  project: Project,
  payments: Payment[],
  input: { amountMinor: number; currency: Currency; replaceId?: string }
): number {
  const base = payments
    .filter((payment) => payment.id !== input.replaceId && payment.currency === project.currency)
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  return input.currency === project.currency ? base + input.amountMinor : base;
}

export function overpayMinor(project: Project, receivedMinor: number): number {
  return Math.max(0, receivedMinor - project.amountMinor);
}

// Текст попередження до збереження. Точна сума та недоплата його не дають.
export function overpayNotice(project: Project, afterMinor: number): string | null {
  return overpayNoticeFor(project.amountMinor, project.currency, afterMinor);
}

// Той самий текст для ще не створеного проєкту: форма проєкту рахує передоплату
// до того, як у запису з'явиться id.
export function overpayNoticeFor(amountMinor: number, currency: Currency, afterMinor: number): string | null {
  const over = afterMinor - amountMinor;
  if (over <= 0) return null;
  return (
    `Переплата: ${formatMoney(afterMinor, currency)} проти погоджених ` +
    `${formatMoney(amountMinor, currency)} — надлишок ${formatMoney(over, currency)}. ` +
    `Залишок лишиться 0, на інший проєкт сума не перейде. Записати все одно можна.`
  );
}
