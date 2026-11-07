import { createHmac, timingSafeEqual } from "node:crypto";

// Перевірка Telegram initData за офіційною схемою (core.telegram.org/bots/webapps,
// «Validating data received via the Mini App»):
// secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token),
// hash       = HMAC_SHA256(key=secret_key, msg=data_check_string).
// У data-check-string входять УСІ поля, крім hash: поле signature — звичайне
// підписане поле (його виключає лише Ed25519-перевірка сторонніх сервісів).
// Довіряємо лише перевіреному підпису; initDataUnsafe клієнта не використовується.
export type TelegramAuthUser = {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  photoUrl: string;
};

export type TelegramAuthFailureReason = "format" | "hash" | "stale" | "future" | "no_user";

export type TelegramAuthResult =
  | { ok: true; user: TelegramAuthUser; authDate: number }
  | { ok: false; reason: TelegramAuthFailureReason; message: string };

// Поле signature — Ed25519-підпис для сторонньої перевірки; у HMAC-рядок
// воно не входить, як і сам hash.
export function initDataHash(initData: string, botToken: string): string {
  const pairs = [...new URLSearchParams(initData).entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secretKey).update(pairs.join("\n")).digest("hex");
}

// Розбіжність годинників клієнта й сервера допускаємо в межах 5 хвилин.
const CLOCK_SKEW_SECONDS = 300;
const MAX_INIT_DATA_LENGTH = 8192;

export function validateInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds: number; nowSeconds?: number }
): TelegramAuthResult {
  if (typeof initData !== "string" || !initData || initData.length > MAX_INIT_DATA_LENGTH) {
    return { ok: false, reason: "format", message: "initData відсутній або завеликий" };
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return { ok: false, reason: "format", message: "initData без коректного hash" };
  }
  const given = Buffer.from(hash, "hex");
  const computed = Buffer.from(initDataHash(initData, botToken), "hex");
  if (given.length !== computed.length || !timingSafeEqual(given, computed)) {
    return { ok: false, reason: "hash", message: "Підпис initData не збігається — дані підроблені" };
  }
  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw === null ? Number.NaN : Number.parseInt(authDateRaw, 10);
  if (!Number.isInteger(authDate) || authDate <= 0) {
    return { ok: false, reason: "format", message: "initData без коректної auth_date" };
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (authDate > now + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "future", message: "auth_date з майбутнього — перевірте годинник пристрою" };
  }
  if (now - authDate > options.maxAgeSeconds) {
    return { ok: false, reason: "stale", message: "initData застарілий — перевідкрийте застосунок у Telegram" };
  }
  const user = parseAuthUser(params.get("user"));
  if (!user) {
    return { ok: false, reason: "no_user", message: "initData без даних користувача Telegram" };
  }
  return { ok: true, user, authDate };
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseAuthUser(raw: string | null): TelegramAuthUser | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const id =
    typeof record.id === "number"
      ? record.id
      : typeof record.id === "string"
        ? Number.parseInt(record.id, 10)
        : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  const photoUrl = typeof record.photo_url === "string" && record.photo_url.startsWith("https://") ? record.photo_url : "";
  return {
    id,
    firstName: bounded(record.first_name, 100),
    lastName: bounded(record.last_name, 100),
    username: bounded(record.username, 64).replace(/^@/, ""),
    photoUrl,
  };
}
