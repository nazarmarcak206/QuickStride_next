import { apiJson, withUser } from "@/lib/server/http";
import { listState } from "@/lib/server/repo";
import { getOrCreateSettings, settingsOfRow, TABLE_USERS } from "@/lib/server/users";

export const dynamic = "force-dynamic";

// Повний знімок даних акаунта: стан CRM і налаштування. Завжди лише
// власні записи — вибірка скоуплена ownerId сесії.
export async function GET(): Promise<Response> {
  return withUser(async ({ rest, ownerId }) => {
    // Налаштування читаються першими: часовий пояс потрібен, щоб перетворити
    // абсолютні моменти справ (due_at) на місцевий час.
    const settingsRow = await getOrCreateSettings(rest, ownerId);
    const settings = settingsOfRow(settingsRow);
    const [userRows, state] = await Promise.all([
      rest.select<Record<string, unknown>>(TABLE_USERS, { filters: [["id", "eq", ownerId]], limit: 1 }),
      listState(rest, ownerId, settings.timeZone),
    ]);
    const user = userRows[0];
    // Імʼя беремо з керованих нами налаштувань: профільні колонки crm_users
    // записуємо лише якщо вони існують у базі.
    const telegramName =
      settings.displayName ||
      [user?.telegram_first_name, user?.telegram_last_name]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .trim();
    return apiJson({
      user: {
        id: ownerId,
        telegramName,
        telegramPhotoUrl: typeof user?.telegram_photo_url === "string" ? user.telegram_photo_url : "",
        demoImported: Boolean(user?.demo_import_completed_at),
      },
      settings,
      state,
    });
  });
}
