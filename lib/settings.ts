import { CURRENCIES, type Currency } from "./types";

// Налаштування користувача живуть в окремому ключі й окремому шарі від CRM-стану
// (quickstride.crm.v1). Вони задають лише значення за замовчуванням для нових
// записів: жоден уже створений проєкт, оплата чи клієнт від їх зміни не оновлюється.
export const SETTINGS_STORAGE_KEY = "quickstride.settings.v1";

export type Settings = {
  displayName: string;
  baseCurrency: Currency;
  timeZone: string;
};

// Короткий список поясів для вибору: український користувацький контекст плюс
// валюти й часті релокації. Поточний системний пояс завжди додається окремо,
// якщо його тут немає, — інакше Польовий вибір показував би хибне значення.
export const TIME_ZONE_CHOICES = [
  "Europe/Kyiv",
  "Europe/Warsaw",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Istanbul",
  "Asia/Dubai",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

function isCurrency(value: unknown): value is Currency {
  return CURRENCIES.includes(value as Currency);
}

// Ім'я поясу перевіряється тим самим Intl, що й його подальше використання:
// випадковий рядок не потрапить у налаштування як «справжній» пояс.
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("uk-UA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function detectTimeZone(): string {
  const zone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  return isTimeZone(zone) ? zone : "UTC";
}

export function timeZoneChoices(current: string): string[] {
  return TIME_ZONE_CHOICES.includes(current) || !isTimeZone(current)
    ? [...TIME_ZONE_CHOICES]
    : [current, ...TIME_ZONE_CHOICES];
}

// Міграція налаштувань — адитивна: невідоме поле ігнорується, непотрібне
// не зберігається назад, пошкоджене значення повертається до fallback.
export function coerceSettings(raw: unknown, fallback: Settings): Settings {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    displayName: typeof value.displayName === "string" ? value.displayName.trim().slice(0, 60) : fallback.displayName,
    baseCurrency: isCurrency(value.baseCurrency) ? value.baseCurrency : fallback.baseCurrency,
    timeZone: isTimeZone(value.timeZone) ? value.timeZone : fallback.timeZone,
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function readSettings(fallback: Settings, storage = defaultStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    return coerceSettings(JSON.parse(raw) as unknown, fallback);
  } catch {
    return fallback;
  }
}

export function writeSettings(settings: Settings, storage = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Приватний режим або переповнене сховище: налаштування лишаються в пам'яті.
  }
}

// Ініціали для заглушки аватара: перші літери перших двох слів.
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "—";
}
