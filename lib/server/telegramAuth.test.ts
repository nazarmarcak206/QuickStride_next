import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initDataHash, validateInitData } from "./telegramAuth";

const BOT_TOKEN = "123456:AAE-test-bot-token";
const OTHER_BOT_TOKEN = "654321:BBE-other-bot-token";

// Підписуємо initData так, як це робить Telegram: HMAC усіх полів, крім hash.
function signedInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const params = new URLSearchParams(fields);
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const pairs = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  params.set("hash", createHmac("sha256", secretKey).update(pairs.join("\n")).digest("hex"));
  return params.toString();
}

const USER_A = JSON.stringify({ id: 111111, first_name: "Оля", last_name: "Коваленко", username: "olya" });
const USER_B = JSON.stringify({ id: 222222, first_name: "Іван", username: "ivanp" });

function authData(secondsAgo = 0): Record<string, string> {
  return {
    auth_date: String(Math.floor(Date.now() / 1000) - secondsAgo),
    query_id: "AAF-test",
    user: USER_A,
  };
}

describe("validateInitData", () => {
  it("приймає свіжі підписані дані", () => {
    const result = validateInitData(signedInitData(authData()), BOT_TOKEN, { maxAgeSeconds: 3600 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(111111);
      expect(result.user.firstName).toBe("Оля");
      expect(result.user.lastName).toBe("Коваленко");
      expect(result.user.username).toBe("olya");
    }
  });

  it("різні Telegram-акаунти дають різних користувачів", () => {
    const dataA = validateInitData(signedInitData(authData()), BOT_TOKEN, { maxAgeSeconds: 3600 });
    const dataB = validateInitData(
      signedInitData({ ...authData(), user: USER_B }),
      BOT_TOKEN,
      { maxAgeSeconds: 3600 }
    );
    expect(dataA.ok && dataB.ok).toBe(true);
    if (dataA.ok && dataB.ok) {
      expect(dataA.user.id).not.toBe(dataB.user.id);
      expect(dataA.user.username).toBe("olya");
      expect(dataB.user.username).toBe("ivanp");
    }
  });

  it("відхиляє дані, підписані чужим ботом", () => {
    const result = validateInitData(signedInitData(authData(), OTHER_BOT_TOKEN), BOT_TOKEN, {
      maxAgeSeconds: 3600,
    });
    expect(result).toMatchObject({ ok: false, reason: "hash" });
  });

  it("відхиляє змінені після підпису поля", () => {
    const tampered = signedInitData(authData()).replace("olya", "hacker");
    const result = validateInitData(tampered, BOT_TOKEN, { maxAgeSeconds: 3600 });
    expect(result).toMatchObject({ ok: false, reason: "hash" });
  });

  it("відхиляє підроблений hash", () => {
    const params = new URLSearchParams(signedInitData(authData()));
    params.set("hash", "0".repeat(64));
    const result = validateInitData(params.toString(), BOT_TOKEN, { maxAgeSeconds: 3600 });
    expect(result).toMatchObject({ ok: false, reason: "hash" });
  });

  it("відхиляє застарілий auth_date", () => {
    const result = validateInitData(signedInitData(authData(7200)), BOT_TOKEN, { maxAgeSeconds: 3600 });
    expect(result).toMatchObject({ ok: false, reason: "stale" });
  });

  it("приймає дані рівно на межі строку давності", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = validateInitData(
      signedInitData({ auth_date: String(nowSeconds - 3600), user: USER_A }),
      BOT_TOKEN,
      { maxAgeSeconds: 3600, nowSeconds }
    );
    expect(result.ok).toBe(true);
  });

  it("відхиляє auth_date з майбутнього за межами допуску годинника", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const future = validateInitData(signedInitData({ auth_date: String(nowSeconds + 400), user: USER_A }), BOT_TOKEN, {
      maxAgeSeconds: 3600,
      nowSeconds,
    });
    expect(future).toMatchObject({ ok: false, reason: "future" });
    // Розбіжність до 5 хвилин — ще приймається.
    const skewed = validateInitData(signedInitData({ auth_date: String(nowSeconds + 300), user: USER_A }), BOT_TOKEN, {
      maxAgeSeconds: 3600,
      nowSeconds,
    });
    expect(skewed.ok).toBe(true);
  });

  it("відхиляє дані без користувача, без hash або з некоректним JSON user", () => {
    const { user: _user, ...withoutUser } = authData();
    expect(validateInitData(signedInitData(withoutUser), BOT_TOKEN, { maxAgeSeconds: 3600 })).toMatchObject({
      ok: false,
      reason: "no_user",
    });
    expect(validateInitData(signedInitData({ ...authData(), user: "{зіпсований" }), BOT_TOKEN, { maxAgeSeconds: 3600 })).toMatchObject({
      ok: false,
      reason: "no_user",
    });
    expect(validateInitData("query_id=AAF", BOT_TOKEN, { maxAgeSeconds: 3600 })).toMatchObject({
      ok: false,
      reason: "format",
    });
  });

  it("обчислює той самий hash, що й Telegram", () => {
    const data = signedInitData(authData());
    const hash = new URLSearchParams(data).get("hash") ?? "";
    expect(initDataHash(data, BOT_TOKEN)).toBe(hash);
  });

  it("поле signature входить у HMAC: підписані дані приймаються, змінені — ні", () => {
    const withSignature = signedInitData({ ...authData(), signature: "dGVzdC1zaWduYXR1cmU" });
    expect(validateInitData(withSignature, BOT_TOKEN, { maxAgeSeconds: 3600 }).ok).toBe(true);
    // signature — звичайне підписане поле: підміна ламає hash.
    const tampered = withSignature.replace("dGVzdC1zaWduYXR1cmU", "підроблено");
    expect(validateInitData(tampered, BOT_TOKEN, { maxAgeSeconds: 3600 })).toMatchObject({ ok: false, reason: "hash" });
  });
});

// Незалежний вектор: initData і hash згенеровані openssl (HMAC-SHA256 у два
// кроки за офіційною схемою) поза кодом, який тестується. Вектор зафіксований
// — він ловить і відхилення алгоритму, і випадкові зміни реалізації.
const VECTOR_BOT_TOKEN = "123456:AAE-independent-vector";
const VECTOR_AUTH_DATE = 1_700_000_000;
const VECTOR_INIT_DATA = [
  "auth_date=1700000000",
  "hash=3871fc367255ecc00bbb5a2b8c730fa39863f69ff5a1538ec7c1dbb0a8992f24",
  "query_id=AAF-vector",
  "signature=dGVzdC1zaWduYXR1cmU",
  'user={"id":333333,"first_name":"Test","username":"vector"}',
].join("&");

describe("validateInitData: незалежний вектор (openssl)", () => {
  it("приймає initData, підписаний поза тестованим алгоритмом", () => {
    const result = validateInitData(VECTOR_INIT_DATA, VECTOR_BOT_TOKEN, {
      maxAgeSeconds: 3600,
      nowSeconds: VECTOR_AUTH_DATE + 60,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(333333);
      expect(result.user.username).toBe("vector");
      expect(result.authDate).toBe(VECTOR_AUTH_DATE);
    }
  });

  it("підроблений hash вектора відхиляється", () => {
    const forged = VECTOR_INIT_DATA.replace(/hash=[0-9a-f]{64}/, `hash=${"0".repeat(64)}`);
    expect(
      validateInitData(forged, VECTOR_BOT_TOKEN, { maxAgeSeconds: 3600, nowSeconds: VECTOR_AUTH_DATE + 60 })
    ).toMatchObject({ ok: false, reason: "hash" });
  });

  it("застарілий вектор відхиляється", () => {
    expect(
      validateInitData(VECTOR_INIT_DATA, VECTOR_BOT_TOKEN, {
        maxAgeSeconds: 3600,
        nowSeconds: VECTOR_AUTH_DATE + 3601,
      })
    ).toMatchObject({ ok: false, reason: "stale" });
  });

  it("hash іншого бота для того ж initData відхиляється", () => {
    expect(
      validateInitData(VECTOR_INIT_DATA, "654321:BBE-other-bot-token", {
        maxAgeSeconds: 3600,
        nowSeconds: VECTOR_AUTH_DATE + 60,
      })
    ).toMatchObject({ ok: false, reason: "hash" });
  });
});
