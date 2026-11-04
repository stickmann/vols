import { DEMO_TENANT_ID } from "@vols/shared";

/**
 * Пока нет авторизации, оператор задаётся вручную (по умолчанию демо-оператор из сида).
 * После появления входа заменится на сессию.
 */
const KEY = "vols.devTenantId";

export function getTenantId(): string {
  try {
    return localStorage.getItem(KEY) || DEMO_TENANT_ID;
  } catch {
    return DEMO_TENANT_ID;
  }
}

export function setTenantId(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* хранилище недоступно — останется значение по умолчанию */
  }
}
