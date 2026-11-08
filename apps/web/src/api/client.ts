
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

/** Сессия закончилась — интерфейс показывает вход (см. AuthGate). */
export const UNAUTHORIZED_EVENT = "vols:unauthorized";

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      // Сессия — в cookie; этот заголовок не может поставить чужой сайт (защита от подделки запросов).
      "x-requested-with": "vols",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
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

/** Скачать файл с API и сохранить под именем, которое дал сервер. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { headers: { "x-requested-with": "vols" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Ошибка сервера (${res.status})`, body);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]!) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
