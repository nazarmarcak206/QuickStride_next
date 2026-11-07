import { describe, expect, it } from "vitest";
import { dbColumn, dbValueForWrite, modelField, reminderToDb, reminderWallClockFromDb, rowFromDb, rowToDb, toDateOnly } from "./columns";
import { TABLE_PAYMENTS, TABLE_REMINDERS, TABLE_CLIENTS, TABLE_PROJECTS } from "./users";

const KYIV = "Europe/Kyiv";

describe("відповідність колонок фактичної бази", () => {
  it("crm_payments: date → paid_on, type → payment_type", () => {
    expect(dbColumn(TABLE_PAYMENTS, "date")).toBe("paid_on");
    expect(dbColumn(TABLE_PAYMENTS, "type")).toBe("payment_type");
    expect(modelField(TABLE_PAYMENTS, "paid_on")).toBe("date");
    expect(modelField(TABLE_PAYMENTS, "payment_type")).toBe("type");
  });

  it("crm_reminders: datetime — не перейменований ключ, а пара колонок", () => {
    // due_at (timestamptz) + timezone (text): звичайний map неможливий, бо
    // місцевий час без поясу не перетворити на абсолютний момент.
    expect(dbColumn(TABLE_REMINDERS, "datetime")).toBe("datetime");
    expect(reminderToDb("2026-11-05T09:00", KYIV)).toEqual({
      ok: true,
      fields: { due_at: "2026-11-05T07:00:00.000Z", timezone: KYIV },
    });
  });

  it("решта назв не змінюється", () => {
    expect(dbColumn(TABLE_CLIENTS, "name")).toBe("name");
    expect(dbColumn(TABLE_PAYMENTS, "amount_minor")).toBe("amount_minor");
    expect(dbColumn(TABLE_PAYMENTS, "owner_id")).toBe("owner_id");
  });

  it("запис оплати: внутрішні ключі стають колонками бази", () => {
    expect(rowToDb(TABLE_PAYMENTS, { id: "1", date: "2026-11-05", type: "Доплата", note: "" })).toEqual({
      id: "1",
      paid_on: "2026-11-05",
      payment_type: "Доплата",
      note: "",
    });
  });

  it("читання оплати: колонки бази стають внутрішніми ключами", () => {
    expect(rowFromDb(TABLE_PAYMENTS, { id: "1", paid_on: "2026-11-05", payment_type: "Доплата" })).toEqual({
      id: "1",
      date: "2026-11-05",
      type: "Доплата",
    });
  });

  it("paid_on NOT NULL: порожню дату не підміняємо NULL — її відхиляє валідація", () => {
    expect(rowToDb(TABLE_PAYMENTS, { date: "" }).paid_on).toBe("");
  });

  it("deadline (date NULL): порожнє значення моделі стає NULL", () => {
    expect(rowToDb(TABLE_PROJECTS, { deadline: "" }).deadline).toBeNull();
    expect(rowToDb(TABLE_PROJECTS, { deadline: "2026-12-20" }).deadline).toBe("2026-12-20");
    // інші текстові поля не чіпаємо
    expect(rowToDb(TABLE_PROJECTS, { next_action: "" }).next_action).toBe("");
  });

  it("dbValueForWrite діє лише для оголошених nullable date-колонок", () => {
    expect(dbValueForWrite(TABLE_PROJECTS, "deadline", "")).toBeNull();
    expect(dbValueForWrite(TABLE_PAYMENTS, "paid_on", "")).toBe("");
    expect(dbValueForWrite(TABLE_CLIENTS, "note", "")).toBe("");
  });
});

describe("crm_reminders: місцевий час ↔ (due_at + timezone)", () => {
  it("запис у поясі власника дає абсолютний момент", () => {
    expect(reminderToDb("2026-11-05T09:00", KYIV)).toEqual({
      ok: true,
      fields: { due_at: "2026-11-05T07:00:00.000Z", timezone: KYIV },
    });
    expect(reminderToDb("2026-07-01T12:00", KYIV)).toEqual({
      ok: true,
      fields: { due_at: "2026-07-01T09:00:00.000Z", timezone: KYIV },
    });
  });

  it("читання повертає той самий місцевий час у поясі рядка", () => {
    expect(reminderWallClockFromDb({ due_at: "2026-11-05T07:00:00.000Z", timezone: KYIV }, "Asia/Tashkent")).toBe("2026-11-05T09:00");
    // легасі-рядок без поясу — пояс налаштувань власника
    expect(reminderWallClockFromDb({ due_at: "2026-11-05T07:00:00.000Z" }, KYIV)).toBe("2026-11-05T09:00");
    // рядок із власним поясом не «перефарбовується» поясом власника
    expect(reminderWallClockFromDb({ due_at: "2026-11-05T07:00:00.000Z", timezone: "Asia/Tashkent" }, KYIV)).toBe("2026-11-05T12:00");
  });

  it("некоректні вхідні дані дають зрозумілу помилку, а не тиху втрату", () => {
    expect(reminderToDb("", KYIV)).toEqual({ ok: false, error: "Дата й час: очікується формат YYYY-MM-DDTHH:mm" });
    expect(reminderToDb("2026-11-05 09:00", KYIV).ok).toBe(false);
    expect(reminderToDb("2026-11-05T09:00", "Mars/Olympus")).toEqual({
      ok: false,
      error: "Часовий пояс «Mars/Olympus» не підтримується сервером",
    });
    expect(reminderWallClockFromDb({ due_at: "не дата", timezone: KYIV }, KYIV)).toBe("");
    expect(reminderWallClockFromDb({ due_at: "2026-11-05T07:00:00.000Z", timezone: "Mars/Olympus" }, "Теж-не-пояс")).toBe("");
  });

  it("дата оплати з будь-якого формату зводиться до дня", () => {
    expect(toDateOnly("2026-11-05")).toBe("2026-11-05");
    expect(toDateOnly("2026-11-05T00:00:00+00:00")).toBe("2026-11-05");
    expect(toDateOnly("")).toBe("");
  });
});
