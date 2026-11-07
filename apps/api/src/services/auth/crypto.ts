import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// scrypt: ~16 МБ памяти и десятки миллисекунд на проверку — дорого для перебора, терпимо для входа.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, expected);
}

/** Случайный токен для cookie и ссылок (в базе хранится только его SHA-256). */
export const randomToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- TOTP (RFC 6238)

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Некорректный секрет base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

const STEP_SECONDS = 30;
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, "0");
}

/**
 * Проверить код: допускаем расхождение часов на один шаг (±30 с). Возвращает принятый шаг
 * или null. Шаг не больше уже использованного не принимается — код нельзя ввести повторно.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = currentStep(now);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = totpCode(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = "ВОЛС") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Коды восстановления: 10 штук вида xxxx-xxxx; в базе — SHA-256. */
export function newRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: 10 }, () => {
    const s = randomBytes(5).toString("hex");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { plain, hashed: plain.map((c) => sha256(c)) };
}
