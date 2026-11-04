// Мінімальна інтеграція з Telegram WebApp: у браузері все працює без неї.
// Розширену перевірку initData зробить сервер, коли з'явиться бекенд.
type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (
      style: "light" | "medium" | "heavy" | "rigid" | "soft"
    ) => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
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
    app.setHeaderColor?.("#F7F2EC");
    app.setBackgroundColor?.("#F7F2EC");
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
