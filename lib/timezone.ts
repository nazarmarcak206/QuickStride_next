// Часові пояси для справ (crm_reminders.due_at — timestamp with time zone).
//
// Модель застосунку зберігає місцевий («wall-clock») час справи: "YYYY-MM-DDTHH:mm".
// У базі лежить абсолютний момент, тому на межі бази час перетворюється за
// поясом, а не обрізається рядок:
//
//   запис:   wall-clock + пояс → мить (ISO UTC) → due_at, і той самий пояс у timezone
//   читання: due_at (мить) + timezone рядка → wall-clock у цьому поясі
//
// Використовуємо Intl — ті самі дані про пояси, що й у браузері, тому клієнт і
// сервер дають однаковий результат.

const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

export function isKnownTimeZone(timeZone: string): boolean {
  return partsFormatter(timeZone) !== null;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsOf(instantMs: number, timeZone: string): LocalParts | null {
  const formatter = partsFormatter(timeZone);
  if (!formatter) return null;
  const pieces = formatter.formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(pieces.find((piece) => piece.type === type)?.value ?? "");
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

// Зміщення поясу в мілісекундах для конкретного моменту: local = utc + offset.
function offsetAt(instantMs: number, timeZone: string): number | null {
  const local = partsOf(instantMs, timeZone);
  if (!local) return null;
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

// Абсолютний момент → місцевий час "YYYY-MM-DDTHH:mm" у поясі.
export function utcToWallClock(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return "";
  const local = partsOf(instant, timeZone);
  if (!local) return "";
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;
}

export type WallClockResult =
  | { ok: true; iso: string; ambiguous: boolean; shifted: boolean }
  | { ok: false; reason: "format" | "zone" };

/**
 * Місцевий час + пояс → абсолютний момент.
 *
 * Визначена поведінка для складних випадків:
 *  • місцевому часу, якого не буває (весняний стрибок 03:00→04:00), відповідає
 *    перший реальний момент після пропуску — зсуваємо вперед і повертаємо
 *    shifted: true;
 *  • подвійний місцевий час (осінній перехід, та сама година двічі) — беремо
 *    ПЕРШУ подію, тобто літній час, і повертаємо ambiguous: true.
 * Це підхід «compatible»: ніколи не створюємо моменту, якого не існує, і не
 * обираємо другу подію безпідставно.
 */
export function wallClockToUtc(wall: string, timeZone: string): WallClockResult {
  const match = WALL_PATTERN.exec(wall);
  if (!match) return { ok: false, reason: "format" };
  const [, year, month, day, hour, minute, second] = match;
  const wallMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +(second ?? "0"));

  // Зміщення поясу знімаємо з кількох точок навколо цього часу: за добу до і
  // після, а також безпосередньо. Так видно обидва зміщення навіть тоді, коли
  // перехід стався між ними (осіннє «повторне» коло).
  const dayMs = 24 * 60 * 60 * 1000;
  const probes = [wallMs - dayMs - 3600_000, wallMs - 3600_000, wallMs, wallMs + 3600_000, wallMs + dayMs + 3600_000];
  const offsets = new Set<number>();
  for (const probe of probes) {
    const offset = offsetAt(probe, timeZone);
    if (offset !== null) offsets.add(offset);
  }
  if (offsets.size === 0) return { ok: false, reason: "zone" };

  const candidates = [...offsets].map((offset) => wallMs - offset).sort((left, right) => left - right);
  const expected = wall.slice(0, 16);
  const valid = candidates.filter((candidate) => utcToWallClock(new Date(candidate).toISOString(), timeZone) === expected);

  if (valid.length >= 2) {
    // Подвійний місцевий час: перша подія — раніший момент.
    return { ok: true, iso: new Date(valid[0]).toISOString(), ambiguous: true, shifted: false };
  }
  if (valid.length === 1) {
    return { ok: true, iso: new Date(valid[0]).toISOString(), ambiguous: false, shifted: false };
  }
  // Жоден кандидат не дає того самого місцевого часу → час у «пропущеній» годині
  // весняного переходу: зсуваємо вперед на перший реальний момент.
  return { ok: true, iso: new Date(candidates[candidates.length - 1]).toISOString(), ambiguous: false, shifted: true };
}
