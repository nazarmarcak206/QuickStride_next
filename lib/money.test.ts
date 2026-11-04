import { describe, expect, it } from "vitest";
import { currencySymbol, formatDay, formatMoney, fromMinor, monthKey, monthLabel, monthName, monthShortLabel, monthTitle, shiftMonth, snapMinor, toMinor } from "./money";

describe("гроші зберігаються в найменших одиницях", () => {
  it("перетворює введення користувача в копійки", () => {
    expect(toMinor("10000")).toBe(1_000_000);
    expect(toMinor("3000,50")).toBe(300_050);
    expect(toMinor("0.99")).toBe(99);
    expect(toMinor("1 234.56")).toBe(123_456);
    expect(toMinor("abc")).toBe(0);
    expect(toMinor("")).toBe(0);
  });

  it("повертає з копійок без втрати точності", () => {
    expect(fromMinor(300_050)).toBe(3000.5);
    expect(fromMinor(99)).toBe(0.99);
  });

  it("форматує суми з копійками та без", () => {
    // Intl використовує нерозривні пробіли — нормалізуємо для порівняння
    const plain = (value: string) => value.replace(/\u00A0/g, " ");
    expect(plain(formatMoney(1_000_000, "UAH"))).toContain("10 000");
    expect(plain(formatMoney(1_000_050, "UAH"))).toContain("10 000,50");
  });

  it("символи валют відрізняються", () => {
    const symbols = new Set(["UAH", "EUR", "USD"].map((c) => currencySymbol(c as never)));
    expect(symbols.size).toBe(3);
  });
});

describe("лічба сум для показу", () => {
  const plain = (value: string) => value.replace(/\u00A0/g, " ");

  it("прибирає копійки з проміжних значень", () => {
    expect(snapMinor(498_732, 500_000)).toBe(498_700);
    expect(plain(formatMoney(snapMinor(498_732, 500_000), "UAH"))).not.toContain(",");
  });

  it("не перестрибує ціль: вгору при лічбі, вниз при зменшенні", () => {
    // Ціль більша за проміжне значення — округлення не може перевищити ціль.
    expect(snapMinor(5_000_049, 5_000_100)).toBe(5_000_000);
    // Ціль менша — округлення не може впасти нижче за ціль.
    expect(snapMinor(123_480, 123_450)).toBe(123_500);
    expect(snapMinor(5_004_999, 5_000_000)).toBe(5_005_000);
  });

  it("повертає точне значення в кінці лічби", () => {
    expect(snapMinor(300_050, 300_050)).toBe(300_050);
    expect(plain(formatMoney(snapMinor(300_050, 300_050), "UAH"))).toContain("3 000,50");
  });
});

describe("ключі місяців", () => {
  it("будує ключ із дати", () => {
    expect(monthKey(new Date(2026, 9, 30))).toBe("2026-10");
    expect(monthKey("2026-01-05")).toBe("2026-01");
  });

  it("зсуває місяць через межу року", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", -6)).toBe("2026-04");
  });
});

describe("відмінювання місяців у підписах", () => {
  it("родовий — для днів: «3 листопада», «1 березня»", () => {
    expect(formatDay("2026-11-03")).toBe("3 листопада");
    expect(formatDay("2026-03-01")).toBe("1 березня");
  });

  it("знахідний — для «за …» на головній і у фінансах", () => {
    expect(monthLabel("2026-11", "accusative")).toBe("листопад 2026");
    expect(monthLabel("2026-02", "accusative")).toBe("лютий 2026");
  });

  it("місцевий — для «у …» в порожніх станах", () => {
    expect(monthLabel("2026-11", "locative")).toBe("листопаді 2026");
    expect(monthLabel("2026-03", "locative")).toBe("березні 2026");
    expect(monthLabel("2026-08", "locative")).toBe("серпні 2026");
  });

  it("називний і заголовок перемикача — з великої літери", () => {
    expect(monthLabel("2026-11", "nominative")).toBe("листопад 2026");
    expect(monthTitle("2026-11")).toBe("Листопад 2026");
  });

  it("коротка підпис графіка та замовчування залишаються родовими", () => {
    expect(monthLabel("2026-11")).toBe("листопада 2026");
    expect(monthShortLabel("2026-11")).toBe("лис");
    expect(monthShortLabel("2026-03")).toBe("бер");
  });

  it("жоден місяць не підставляє родову форму замість знахідного чи місцевого", () => {
    for (let index = 1; index <= 12; index += 1) {
      const key = `2026-${String(index).padStart(2, "0")}`;
      const genitive = monthName(key, "genitive");
      expect(monthName(key, "accusative")).not.toBe(genitive);
      expect(monthName(key, "locative")).not.toBe(genitive);
    }
  });
});
