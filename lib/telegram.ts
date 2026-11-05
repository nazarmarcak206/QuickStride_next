// Мінімальна інтеграція з Telegram WebApp: у браузері все працює без неї.
// Розширену перевірку initData зробить сервер, коли з'явиться бекенд.
type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  // Дані клієнта: показуємо їх як підказку, бо server-side перевірка initData
  // з'явиться разом із бекендом — до того це не підтверджений вхід.
  initDataUnsafe?: { user?: TelegramUser };
  HapticFeedback?: {
    impactOccurred: (
      style: "light" | "medium" | "heavy" | "rigid" | "soft"
    ) => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
};

type TelegramUser = {
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function telegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function initTelegram(): void {
  const app = telegramWebApp();
  if (!app) return;
  try {
    app.ready();
    app.expand();
    app.setHeaderColor?.("#211D1B");
    app.setBackgroundColor?.("#211D1B");
  } catch {
    // Стара версія клієнта Telegram — не критично.
  }
}

export function haptic(type: "success" | "warning" | "light" = "light"): void {
  const app = telegramWebApp();
  try {
    if (type === "light") app?.HapticFeedback?.impactOccurred("light");
    else app?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // HapticFeedback недоступний поза Telegram.
  }
}

/**
 * Те, що клієнт Telegram показав як «себе»: лише підказка для першого запуску.
 * поза Telegram повертає null, і профіль починається порожнім.
 */
export function telegramProfile(): { name: string; photoUrl: string } | null {
  const user = telegramWebApp()?.initDataUnsafe?.user;
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const photoUrl = typeof user.photo_url === "string" ? user.photo_url : "";
  if (!name && !photoUrl) return null;
  return { name, photoUrl };
}
