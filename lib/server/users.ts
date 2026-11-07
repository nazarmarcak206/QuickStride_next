import { coerceSettings, type Settings } from "../settings";
import type { TelegramAuthUser } from "./telegramAuth";
import { RestError, type RestClient } from "./supabaseRest";

// Існуючі таблиці Supabase-проєкту QuickStride. Схема реальна, а не вигадана:
// id — uuid, власник запису — колонка owner_id. Міграції в supabase/ лише
// доповнюють їх (єдина таблиця, якої в базі немає, — crm_settings).
export const TABLE_USERS = "crm_users";
export const TABLE_SETTINGS = "crm_settings";
export const TABLE_CLIENTS = "crm_clients";
export const TABLE_PROJECTS = "crm_projects";
export const TABLE_PAYMENTS = "crm_payments";
export const TABLE_REMINDERS = "crm_reminders";

// З crm_users гарантовано відомі лише id і telegram_user_id. Профільні поля
// (username, імʼя, фото) читаються опційно: якщо їх у таблиці немає, рядок
// просто не матиме значення, а застосунок візьме імʼя з перевіреного initData.
export type AppUserRow = {
  id: string;
  telegram_user_id: string | number;
  demo_import_completed_at?: string | null;
  telegram_username?: string | null;
  telegram_first_name?: string | null;
  telegram_last_name?: string | null;
  telegram_photo_url?: string | null;
};

export type UserSettingsRow = {
  owner_id: string;
  display_name: string;
  base_currency: string;
  time_zone: string;
  updated_at: string;
};

export const SETTINGS_DEFAULTS = { display_name: "", base_currency: "UAH", time_zone: "Europe/Kyiv" } as const;

// Рядок БД → модель налаштувань: coerceSettings відсіює невідомі значення
// так само, як і локальне сховище.
export function settingsOfRow(row: UserSettingsRow): Settings {
  return coerceSettings(
    { displayName: row.display_name, baseCurrency: row.base_currency, timeZone: row.time_zone },
    {
      displayName: SETTINGS_DEFAULTS.display_name,
      baseCurrency: SETTINGS_DEFAULTS.base_currency,
      timeZone: SETTINGS_DEFAULTS.time_zone,
    }
  );
}

export function telegramFullName(user: { firstName: string; lastName: string }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim().slice(0, 60);
}

async function selectByTelegramId(rest: RestClient, telegramUserId: string): Promise<AppUserRow | undefined> {
  const rows = await rest.select<AppUserRow>(TABLE_USERS, {
    filters: [["telegram_user_id", "eq", telegramUserId]],
    limit: 1,
  });
  return rows[0];
}

// Акаунт знаходиться лише за перевіреним telegram_user_id із initData —
// ідентифікатор, надісланий клієнтом, тут не використовується взагалі.
// Перший вхід створює користувача й його налаштування; вхід без пароля й
// реєстрації. Записуємо тільки telegram_user_id: інших колонок crm_users може
// не бути, а імʼя з initData зберігається в керованій нами crm_settings.
export async function findOrCreateUser(
  rest: RestClient,
  user: TelegramAuthUser
): Promise<{ row: AppUserRow; isNew: boolean }> {
  const telegramUserId = String(user.id);
  const existing = await selectByTelegramId(rest, telegramUserId);
  if (existing) return { row: existing, isNew: false };
  try {
    const [created] = await rest.insert<AppUserRow>(TABLE_USERS, { telegram_user_id: telegramUserId });
    await rest.insert<UserSettingsRow>(TABLE_SETTINGS, {
      owner_id: created.id,
      display_name: telegramFullName(user),
      base_currency: SETTINGS_DEFAULTS.base_currency,
      time_zone: SETTINGS_DEFAULTS.time_zone,
    });
    return { row: created, isNew: true };
  } catch (error) {
    // Паралельний перший вхід з другого пристрою: хтось уже створив акаунт.
    if (error instanceof RestError && error.status === 409) {
      const raced = await selectByTelegramId(rest, telegramUserId);
      if (raced) return { row: raced, isNew: false };
    }
    throw error;
  }
}

export async function getOrCreateSettings(rest: RestClient, ownerId: string): Promise<UserSettingsRow> {
  const rows = await rest.select<UserSettingsRow>(TABLE_SETTINGS, {
    filters: [["owner_id", "eq", ownerId]],
    limit: 1,
  });
  if (rows[0]) return rows[0];
  try {
    const [created] = await rest.insert<UserSettingsRow>(TABLE_SETTINGS, { owner_id: ownerId, ...SETTINGS_DEFAULTS });
    return created;
  } catch (error) {
    if (error instanceof RestError && error.status === 409) {
      const raced = await rest.select<UserSettingsRow>(TABLE_SETTINGS, {
        filters: [["owner_id", "eq", ownerId]],
        limit: 1,
      });
      if (raced[0]) return raced[0];
    }
    throw error;
  }
}

// Патч налаштувань: рядок гарантовано існує після оновлення — за потреби
// дозаписується зі стандартними значеннями.
export async function patchSettings(
  rest: RestClient,
  ownerId: string,
  patch: Partial<Pick<UserSettingsRow, "display_name" | "base_currency" | "time_zone">>,
  now: Date = new Date()
): Promise<UserSettingsRow> {
  const updated = await rest.update<UserSettingsRow>(
    TABLE_SETTINGS,
    { ...patch, updated_at: now.toISOString() },
    [["owner_id", "eq", ownerId]]
  );
  if (updated[0]) return updated[0];
  const [created] = await rest.insert<UserSettingsRow>(
    TABLE_SETTINGS,
    { owner_id: ownerId, ...SETTINGS_DEFAULTS, ...patch, updated_at: now.toISOString() },
    { onConflict: "owner_id", merge: true }
  );
  return created;
}
