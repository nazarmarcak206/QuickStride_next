import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

const SECRET = "тести-секрет-не-менше-тридцяти-двох-символів!";

describe("сесійні токени", () => {
  it("створений токен перевіряється і повертає uid та строк", () => {
    const token = createSessionToken("user-1", 3600, SECRET, 1000);
    const payload = verifySessionToken(token, SECRET, 1500);
    expect(payload).toEqual({ uid: "user-1", exp: 4600 });
  });

  it("прострочений токен не приймається", () => {
    const token = createSessionToken("user-1", 3600, SECRET, 1000);
    expect(verifySessionToken(token, SECRET, 4600)).toBeNull();
    expect(verifySessionToken(token, SECRET, 4601)).toBeNull();
  });

  it("підроблена підпис не приймається", () => {
    const token = createSessionToken("user-1", 3600, SECRET, 1000);
    const [body] = token.split(".");
    const forged = `${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(verifySessionToken(forged, SECRET, 1500)).toBeNull();
  });

  it("змінене тіло токена ламає підпис", () => {
    const token = createSessionToken("user-1", 3600, SECRET, 1000);
    const [body, mac] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { uid: string };
    decoded.uid = "user-2";
    const reencoded = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    expect(verifySessionToken(`${reencoded}.${mac}`, SECRET, 1500)).toBeNull();
  });

  it("токен, підписаний іншим секретом, не приймається", () => {
    const token = createSessionToken("user-1", 3600, SECRET, 1000);
    expect(verifySessionToken(token, "інший-секрет-також-не-менше-тридцяти-двох!!", 1500)).toBeNull();
  });

  it("сміття замість токена не приймається", () => {
    for (const garbage of ["", ".", "a.b", "abc", "Y2hyb21l.AAAA"]) {
      expect(verifySessionToken(garbage, SECRET, 1500)).toBeNull();
    }
  });
});
