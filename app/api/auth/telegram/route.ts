import { NextResponse } from "next/server";
import { apiError, isSecureRequest, readJsonBody, withServices } from "@/lib/server/http";
import { SESSION_COOKIE, createSessionToken } from "@/lib/server/session";
import { validateInitData } from "@/lib/server/telegramAuth";
import { findOrCreateUser, telegramFullName, type AppUserRow } from "@/lib/server/users";

export const dynamic = "force-dynamic";

// Обмін Telegram initData на серверну сесію. Клієнт надсилає сирі initData;
// усе інше (валідація підпису, актуальність, створення акаунта) відбувається тут.
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const initData = typeof body?.initData === "string" ? body.initData : "";
  if (!initData) return apiError(400, "Не надіслано initData.");

  return withServices(async ({ env, rest }) => {
    const result = validateInitData(initData, env.botToken, { maxAgeSeconds: env.authMaxAgeSeconds });
    if (!result.ok) return apiError(401, result.message);

    const { row, isNew } = await findOrCreateUser(rest, result.user);
    const token = createSessionToken(row.id, env.sessionTtlSeconds, env.sessionSecret);

    const response = NextResponse.json({
      isNew,
      user: {
        id: row.id,
        telegramName: telegramFullName(result.user),
        telegramPhotoUrl: (row as AppUserRow).telegram_photo_url ?? "",
      },
    });
    // SameSite=None: сторінка відкривається у WebView Telegram як сторонній контекст.
    response.cookies.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "none",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: env.sessionTtlSeconds,
    });
    return response;
  });
}
