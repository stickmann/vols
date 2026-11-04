import { expect } from "vitest";

/** Ждём ошибку Postgres с кодом SQLSTATE (через обёртку DrizzleQueryError). */
export async function expectPgError(p: Promise<unknown>, code: string, message?: RegExp) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "ожидалась ошибка БД").toBeDefined();
  let pg: any = err;
  for (let i = 0; i < 5 && pg && pg.code === undefined; i++) pg = pg.cause;
  expect(pg?.code, String((err as Error)?.message)).toBe(code);
  if (message) expect(pg.message).toMatch(message);
}
