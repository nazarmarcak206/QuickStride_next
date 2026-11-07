// Серверні секрети читаються лише тут, у модулях під app/api/.
// Клієнтський бандл цей код не імпортує — ключі не потрапляють у браузер.
export type ServerEnv = {
  botToken: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  sessionSecret: string;
  authMaxAgeSeconds: number;
  sessionTtlSeconds: number;
};

export class EnvError extends Error {}

const DEFAULT_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24; // initData старший за 24 год — не приймаємо
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // сесія живе 30 днів

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new EnvError(`Не задано змінну середовища ${name}`);
  }
  return value.trim();
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EnvError(`${name} має бути додатним цілим числом, отримано «${raw}»`);
  }
  return parsed;
}

export function serverEnv(): ServerEnv {
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new EnvError("SESSION_SECRET має містити щонайменше 32 символи");
  }
  return {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    supabaseUrl: required("SUPABASE_URL").replace(/\/+$/, ""),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    sessionSecret,
    authMaxAgeSeconds: optionalInt("TELEGRAM_AUTH_MAX_AGE_SECONDS", DEFAULT_AUTH_MAX_AGE_SECONDS),
    sessionTtlSeconds: optionalInt("SESSION_TTL_SECONDS", DEFAULT_SESSION_TTL_SECONDS),
  };
}
