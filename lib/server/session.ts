import { createHmac, timingSafeEqual } from "node:crypto";

// Сесія — підписаний HMAC-SHA256 токен у HttpOnly cookie: uid + строк дії.
// Клієнт не може ні прочитати, ні підробити токен; сервер перевіряє підпис
// і строк на кожному запиті.
export const SESSION_COOKIE = "qs_session";

export type SessionPayload = { uid: string; exp: number };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSessionToken(
  uid: string,
  ttlSeconds: number,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const body = Buffer.from(JSON.stringify({ uid, exp: nowSeconds + ttlSeconds } satisfies SessionPayload)).toString(
    "base64url"
  );
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SessionPayload | null {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const computed = Buffer.from(sign(body, secret));
  if (given.length !== computed.length || !timingSafeEqual(given, computed)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.uid !== "string" || !record.uid || record.uid.length > 120) return null;
  const exp = record.exp;
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp <= nowSeconds) return null;
  return { uid: record.uid, exp };
}
