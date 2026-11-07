import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashPassword, totpCode, verifyPassword, verifyTotp } from "../src/services/auth/crypto.js";

describe("криптография входа", () => {
  it("пароль: верный проходит, неверный нет, хэш с солью", async () => {
    const h = await hashPassword("секрет-123");
    expect(h).toMatch(/^scrypt\$/);
    expect(await verifyPassword("секрет-123", h)).toBe(true);
    expect(await verifyPassword("секрет-124", h)).toBe(false);
    expect(await hashPassword("секрет-123")).not.toBe(h);
    expect(await verifyPassword("x", null)).toBe(false);
  });

  it("TOTP совпадает с эталоном RFC 6238 (SHA-1)", () => {
    // Секрет RFC 6238: ASCII «12345678901234567890»; время 59 c → шаг 1, код 94287082 (8 цифр) → 287082.
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(totpCode(secret, 1)).toBe("287082");
    // 1111111109 c → 07081804 → 081804
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });

  it("код принимается в окне ±30 с и только один раз", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1111111109 * 1000;
    const step = Math.floor(1111111109 / 30);
    expect(verifyTotp(secret, totpCode(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, "abc", null, now)).toBeNull();
  });
});
