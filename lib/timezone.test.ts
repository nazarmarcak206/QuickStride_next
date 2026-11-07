import { describe, expect, it } from "vitest";
import { isKnownTimeZone, utcToWallClock, wallClockToUtc } from "./timezone";

const KYIV = "Europe/Kyiv";

function iso(wall: string, timeZone = KYIV): string {
  const result = wallClockToUtc(wall, timeZone);
  if (!result.ok) throw new Error(`не вдалося: ${result.reason}`);
  return result.iso;
}

describe("wall-clock → абсолютний момент (Europe/Kyiv)", () => {
  it("зимовий час: UTC+2", () => {
    expect(iso("2026-11-05T09:00")).toBe("2026-11-05T07:00:00.000Z");
    expect(iso("2026-01-15T23:59")).toBe("2026-01-15T21:59:00.000Z");
  });

  it("літній час: UTC+3", () => {
    expect(iso("2026-07-01T12:00")).toBe("2026-07-01T09:00:00.000Z");
  });

  it("межа доби й межа року не зсувають дату", () => {
    expect(iso("2026-12-31T23:30")).toBe("2026-12-31T21:30:00.000Z");
    expect(iso("2027-01-01T00:15")).toBe("2026-12-31T22:15:00.000Z");
    expect(utcToWallClock("2026-12-31T22:15:00.000Z", KYIV)).toBe("2027-01-01T00:15");
  });

  it("ніч і ранок навколо півночі", () => {
    expect(iso("2026-06-21T00:00")).toBe("2026-06-20T21:00:00.000Z");
    expect(iso("2026-06-21T04:30")).toBe("2026-06-21T01:30:00.000Z");
  });

  it("секунди зберігаються", () => {
    expect(iso("2026-11-05T09:00:45")).toBe("2026-11-05T07:00:45.000Z");
  });
});

describe("переходи літнього/зимового часу", () => {
  it("2026-03-29: 03:00→04:00, місцевого часу 03:30 не існує → зсув вперед на 04:30", () => {
    const result = wallClockToUtc("2026-03-29T03:30", KYIV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shifted).toBe(true);
    expect(result.ambiguous).toBe(false);
    // 01:00Z — момент переходу; 03:30 місцевого «перестрибує» на 04:30 = 01:30Z
    expect(result.iso).toBe("2026-03-29T01:30:00.000Z");
    expect(utcToWallClock(result.iso, KYIV)).toBe("2026-03-29T04:30");
  });

  it("2026-10-25: 04:00→03:00, місцевий час 03:30 буває двічі → беремо першу подію (літній час)", () => {
    const result = wallClockToUtc("2026-10-25T03:30", KYIV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ambiguous).toBe(true);
    expect(result.iso).toBe("2026-10-25T00:30:00.000Z"); // UTC+3 — перший прохід
    expect(utcToWallClock(result.iso, KYIV)).toBe("2026-10-25T03:30");
    // друга подія (зимовий час) — інший момент, але ми його не обираємо
    expect(utcToWallClock("2026-10-25T01:30:00.000Z", KYIV)).toBe("2026-10-25T03:30");
  });

  it("останній момент перед стрибком і перший після — обидва коректні", () => {
    expect(iso("2026-03-29T02:59")).toBe("2026-03-29T00:59:00.000Z");
    expect(iso("2026-03-29T04:00")).toBe("2026-03-29T01:00:00.000Z");
  });
});

describe("round-trip", () => {
  const samples = [
    "2026-01-04T00:00",
    "2026-02-28T23:45",
    "2026-03-29T02:30",
    "2026-03-29T04:15",
    "2026-05-20T13:05",
    "2026-08-01T08:00",
    "2026-10-25T02:45",
    "2026-10-25T04:00",
    "2026-12-31T23:59",
  ];

  it("місцевий час повертається тим самим (окрім «пропущеного»)", () => {
    for (const wall of samples) {
      const result = wallClockToUtc(wall, KYIV);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const back = utcToWallClock(result.iso, KYIV);
      if (result.shifted) {
        // зсунутий час не може повернути неіснуючу мітку — але має бути на
        // тих самих 0–59 хвилин і того самого дня
        expect(back.slice(0, 10)).toBe(wall.slice(0, 10));
        expect(Number(back.slice(11, 13))).toBeGreaterThan(Number(wall.slice(11, 13)));
      } else {
        expect(back).toBe(wall);
      }
    }
  });

  it("абсолютний момент → місцевий час → момент (окрім повторної години)", () => {
    // Поза межами «повторної» години round-trip точний.
    for (const instant of ["2026-03-29T00:30:00.000Z", "2026-07-15T23:15:00.000Z", "2026-11-05T07:00:00.000Z"]) {
      const wall = utcToWallClock(instant, KYIV);
      expect(iso(wall)).toBe(instant);
    }
    // Усередині повторної години місцевий час не розрізняє дві події, тому
    // зворотний перетворення дає ПЕРШУ з них. Саме через це в базі зберігається
    // абсолютний момент (due_at), а не місцевий рядок: прочитаний рядок завжди
    // показує правильний місцевий час.
    const secondOccurrence = "2026-10-25T01:30:00.000Z";
    expect(utcToWallClock(secondOccurrence, KYIV)).toBe("2026-10-25T03:30");
    expect(iso("2026-10-25T03:30")).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("інші пояси та помилки", () => {
  it("тот самий місцевий час у різних поясах — різні моменти", () => {
    expect(iso("2026-11-05T09:00", "America/New_York")).toBe("2026-11-05T14:00:00.000Z");
    expect(iso("2026-07-05T09:00", "America/New_York")).toBe("2026-07-05T13:00:00.000Z");
    expect(iso("2026-11-05T09:00", "Asia/Tashkent")).toBe("2026-11-05T04:00:00.000Z");
  });

  it("літній час Нью-Йорка й зимовий дають різні зміщення", () => {
    expect(utcToWallClock("2026-08-01T16:00:00.000Z", "America/New_York")).toBe("2026-08-01T12:00");
    expect(utcToWallClock("2026-01-01T16:00:00.000Z", "America/New_York")).toBe("2026-01-01T11:00");
  });

  it("невідомий пояс і некоректний формат — зрозуміла відмова", () => {
    expect(wallClockToUtc("2026-11-05T09:00", "Mars/Olympus")).toEqual({ ok: false, reason: "zone" });
    expect(wallClockToUtc("2026-11-05 09:00", KYIV)).toEqual({ ok: false, reason: "format" });
    expect(wallClockToUtc("", KYIV)).toEqual({ ok: false, reason: "format" });
    expect(wallClockToUtc("2026-13-45T99:99", KYIV).ok).toBe(true); // Date.UTC нормалізує — перевіряється валідацією форми
  });

  it("isKnownTimeZone відсіює вигадані назви", () => {
    expect(isKnownTimeZone(KYIV)).toBe(true);
    expect(isKnownTimeZone("Europe/Kiev")).toBe(true);
    expect(isKnownTimeZone("Nowhere/Island")).toBe(false);
  });
});
