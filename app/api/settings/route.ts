import { apiError, apiJson, readJsonBody, withUser } from "@/lib/server/http";
import { patchSettings, settingsOfRow } from "@/lib/server/users";
import { parseSettingsPatch } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return apiError(400, "Очікується JSON-обʼєкт налаштувань.");
  const parsed = parseSettingsPatch(body);
  if (!parsed.ok) return apiError(400, parsed.error);

  return withUser(async ({ rest, ownerId }) => {
    const row = await patchSettings(rest, ownerId, {
      ...(parsed.value.displayName !== undefined ? { display_name: parsed.value.displayName } : {}),
      ...(parsed.value.baseCurrency !== undefined ? { base_currency: parsed.value.baseCurrency } : {}),
      ...(parsed.value.timeZone !== undefined ? { time_zone: parsed.value.timeZone } : {}),
    });
    return apiJson({ settings: settingsOfRow(row) });
  });
}
