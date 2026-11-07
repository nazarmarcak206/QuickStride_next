// Ворота локального режиму розробки без Telegram.
// Повертають числовий Telegram id власника, узятий ВИКЛЮЧНО з серверного
// середовища. У продакшн-середовищі — завжди null, незалежно від того, чи
// хтось випадково залишив DEV_LOGIN: маршрут тоді відповідає 404, а отже
// локальний режим не може стати обходом авторизації на проді.
export type DevLoginEnv = {
  NODE_ENV?: string;
  DEV_LOGIN?: string;
  DEV_TELEGRAM_USER_ID?: string;
};

export function devTelegramUserId(env: DevLoginEnv = process.env): string | null {
  if (env.NODE_ENV !== "development") return null;
  if (env.DEV_LOGIN !== "true") return null;
  const raw = (env.DEV_TELEGRAM_USER_ID ?? "").trim();
  // Дозволяємо лише додатне ціле, що вміщується у точне число JavaScript.
  return /^[1-9]\d{0,14}$/.test(raw) ? raw : null;
}
