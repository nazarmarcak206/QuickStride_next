import { describe, expect, it } from "vitest";
import { devTelegramUserId } from "./devLogin";

const OWN_ID = "123456789";
const DEV = { NODE_ENV: "development" };
const PROD = { NODE_ENV: "production" };

describe("devTelegramUserId — ворота локального режиму розробки", () => {
  it("у продакшні вимкнено, навіть за увімкнених flagів", () => {
    expect(devTelegramUserId({ ...PROD, DEV_LOGIN: "true", DEV_TELEGRAM_USER_ID: OWN_ID })).toBeNull();
    expect(devTelegramUserId({ NODE_ENV: "test", DEV_LOGIN: "true", DEV_TELEGRAM_USER_ID: OWN_ID })).toBeNull();
  });

  it("у development потрібне свідоме DEV_LOGIN=true", () => {
    expect(devTelegramUserId({ ...DEV, DEV_TELEGRAM_USER_ID: OWN_ID })).toBeNull();
    expect(devTelegramUserId({ ...DEV, DEV_LOGIN: "false", DEV_TELEGRAM_USER_ID: OWN_ID })).toBeNull();
    expect(devTelegramUserId({ ...DEV, DEV_LOGIN: "true", DEV_TELEGRAM_USER_ID: OWN_ID })).toBe(OWN_ID);
  });

  it("без значення або зі сміттєвим id — вимкнено", () => {
    const base = { ...DEV, DEV_LOGIN: "true" };
    expect(devTelegramUserId({ ...base })).toBeNull();
    expect(devTelegramUserId({ ...base, DEV_TELEGRAM_USER_ID: "" })).toBeNull();
    expect(devTelegramUserId({ ...base, DEV_TELEGRAM_USER_ID: "abc" })).toBeNull();
    expect(devTelegramUserId({ ...base, DEV_TELEGRAM_USER_ID: "0" })).toBeNull();
    expect(devTelegramUserId({ ...base, DEV_TELEGRAM_USER_ID: "-5" })).toBeNull();
    expect(devTelegramUserId({ ...base, DEV_TELEGRAM_USER_ID: "12345678901234567890123" })).toBeNull();
    expect(devTelegramUserId({ ...base, DEV_TELEGRAM_USER_ID: " 123456789 " })).toBe(OWN_ID);
  });

  it("особа береться лише з серверного середовища: даних запиту функція не читає", () => {
    expect(devTelegramUserId.length).toBeLessThanOrEqual(1);
  });
});
