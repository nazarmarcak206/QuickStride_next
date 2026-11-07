import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverEnv, type ServerEnv } from "./env";
import { RestError, createRestClient, type RestClient } from "./supabaseRest";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export function apiJson<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function sessionOwnerId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, serverEnv().sessionSecret);
  return payload?.uid ?? null;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

// Спільна обгортка маршрутів: налаштування, REST-клієнт і єдиний рівень
// перетворення помилок інфраструктури у відповіді 503/500.
export async function withServices(
  handler: (context: { env: ServerEnv; rest: RestClient }) => Promise<Response>
): Promise<Response> {
  let env: ServerEnv;
  try {
    env = serverEnv();
  } catch (error) {
    console.error("[env]", error instanceof Error ? error.message : error);
    return apiError(503, "Сервер не налаштовано: відсутні змінні середовища.");
  }
  const rest = createRestClient({ url: env.supabaseUrl, serviceRoleKey: env.supabaseServiceRoleKey });
  try {
    return await handler({ env, rest });
  } catch (error) {
    if (error instanceof RestError && error.status === 0) {
      console.error("[db]", error.message);
      return apiError(503, "База даних недоступна. Спробуйте ще раз за мить.");
    }
    console.error("[api]", error instanceof Error ? error.stack : error);
    return apiError(500, "Внутрішня помилка сервера. Спробуйте ще раз.");
  }
}

// Кожен маршрут даних проходить через withUser: без дійсної сесії доступу немає.
export function withUser(
  handler: (context: { env: ServerEnv; rest: RestClient; ownerId: string }) => Promise<Response>
): Promise<Response> {
  return withServices(async ({ env, rest }) => {
    const ownerId = await sessionOwnerId();
    if (!ownerId) return apiError(401, "Сесія недійсна — перевідкрийте застосунок.");
    return handler({ env, rest, ownerId });
  });
}
