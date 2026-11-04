// Українська плюралізація іменників: форми [1, 2-4, 5+] — «оплата», «оплати», «оплат».
export function pluralize(count: number, forms: readonly [string, string, string]): string {
  const lastTwo = count % 100;
  const lastOne = count % 10;
  if (lastOne === 1 && lastTwo !== 11) return forms[0];
  if (lastOne >= 2 && lastOne <= 4 && (lastTwo < 12 || lastTwo > 14)) return forms[1];
  return forms[2];
}

export function pluralPayments(count: number): string {
  return pluralize(count, ["оплата", "оплати", "оплат"]);
}

export function pluralProjects(count: number): string {
  return pluralize(count, ["проєкт", "проєкти", "проєктів"]);
}
