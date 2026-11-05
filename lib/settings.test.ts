import { describe, expect, it } from "vitest";
import {
  coerceSettings,
  initials,
  isTimeZone,
  readSettings,
  timeZoneChoices,
  writeSettings,
  type Settings,
} from "./settings";

const fallback: Settings = { displayName: "Марія Кравець", baseCurrency: "UAH", timeZone: "Europe/Kyiv" };

function fakeStorage(value = "") {
  const store = new Map<string, string>();
  if (value) store.set("quickstride.settings.v1", value);
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, item: string) => {
      store.set(key, item);
    },
  };
}

describe("перевірка значень налаштувань", () => {
  it("бере лише валідну валюту й пояс, решту повертає до fallback", () => {
    const coerced = coerceSettings(
      { displayName: "  Остап   ", baseCurrency: "PLN", timeZone: "Mars/Olympus_Mons" },
      fallback,
    );
    expect(coerced).toEqual({ displayName: "Остап", baseCurrency: "UAH", timeZone: "Europe/Kyiv" });
  });

  it("обмежує ім’я 60 символами й ігнорує невідомі ключі", () => {
    const coerced = coerceSettings(
      { displayName: "a".repeat(90), baseCurrency: "EUR", timeZone: "UTC", theme: "dark", locale: "en" },
      fallback
    );
    expect(coerced.displayName).toHaveLength(60);
    expect(coerced.baseCurrency).toBe("EUR");
    expect(coerced.timeZone).toBe("UTC");
    expect(Object.keys(coerced)).toEqual(["displayName", "baseCurrency", "timeZone"]);
  });

  it("пояс приймається лише той, який знає Intl", () => {
    expect(isTimeZone("Europe/Kyiv")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Kyiv")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(undefined)).toBe(false);
  });
});

describe("список часових поясів для вибору", () => {
  it("додає поточний пояс на початок, якщо його немає в готовому списку", () => {
    const choices = timeZoneChoices("Asia/Tokyo");
    expect(choices[0]).toBe("Asia/Tokyo");
    expect(choices).toContain("Europe/Kyiv");
  });

  it("не дублює пояс, який уже є в списку, і не додає сміття", () => {
    expect(timeZoneChoices("Europe/Kyiv").filter((zone) => zone === "Europe/Kyiv")).toHaveLength(1);
    expect(timeZoneChoices("не пояс")).toEqual(timeZoneChoices("Europe/Kyiv"));
  });
});

describe("читання й запис налаштувань", () => {
  it("без запису повертає fallback, із записом — збережені значення", () => {
    expect(readSettings(fallback, fakeStorage())).toEqual(fallback);

    const storage = fakeStorage();
    writeSettings({ displayName: "Ірина", baseCurrency: "USD", timeZone: "Europe/Warsaw" }, storage);
    expect(readSettings(fallback, storage)).toEqual({
      displayName: "Ірина",
      baseCurrency: "USD",
      timeZone: "Europe/Warsaw",
    });
  });

  it("пошкоджений JSON не викидає винятку й не губить fallback", () => {
    expect(readSettings(fallback, fakeStorage("{ не json"))).toEqual(fallback);
  });

  it("приватний режим (setItem кидає) лишає налаштування в пам’яті", () => {
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeSettings(fallback, blocked)).not.toThrow();
  });
});

describe("ініціали для заглушки аватара", () => {
  it("бере перші літери перших двох слів", () => {
    expect(initials("марія кравець")).toBe("МК");
    expect(initials("Тарас")).toBe("Т");
    expect(initials("   ")).toBe("—");
  });
});
