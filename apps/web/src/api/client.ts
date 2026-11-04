import { getTenantId } from "../lib/tenant.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: string;
  issues?: { path: (string | number)[]; message: string }[];
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-tenant-id": getTenantId(),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const b = (body ?? {}) as ErrorBody;
    const message =
      b.issues?.map((i) => i.message).join("; ") || b.error || `Ошибка сервера (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
