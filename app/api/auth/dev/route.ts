import { NextResponse } from "next/server";
import { apiError, isSecureRequest, withServices } from "@/lib/server/http";
import { SESSION_COOKIE, createSessionToken } from "@/lib/server/session";
import { devTelegramUserId } from "@/lib/server/devLogin";
import { findOrCreateUser } from "@/lib/server/users";
import type { TelegramAuthUser } from "@/lib/server/telegramAuth";

export const dynamic = "force-dynamic";

// Локальний режим розробки без Telegram: вхід під власним Telegram id
// розробника, щоб перевіряти CRUD і справжнє збереження в браузері.
// У продакшн-білді маршрут завжди 404 (див. devLogin.ts). Запит не передає
// жодних даних, тому обрати чужу особу неможливо.
export async function POST(request: Request): Promise<Response> {
  const telegramUserId = devTelegramUserId();
  if (!telegramUserId) return apiError(404, "Не знайдено.");

  const devUser: TelegramAuthUser = {
    id: Number(telegramUserId),
    firstName: "Розробник",
    lastName: "",
    username: "dev",
    photoUrl: "",
  };

  return withServices(async ({ env, rest }) => {
    const { row, isNew } = await findOrCreateUser(rest, devUser);
    const token = createSessionToken(row.id, env.sessionTtlSeconds, env.sessionSecret);

    const response = NextResponse.json({
      isNew,
      dev: true,
      user: { id: row.id, telegramName: "Локальний розробник", telegramPhotoUrl: row.telegram_photo_url ?? "" },
    });
    response.cookies.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: env.sessionTtlSeconds,
    });
    return response;
  });
}
