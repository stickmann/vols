import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://vols_app:vols_app@localhost:5432/vols"),
  MIGRATION_DATABASE_URL: z.string().default("postgres://vols:vols@localhost:5432/vols"),
  API_PORT: z.coerce.number().int().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  /**
   * Оператор из заголовка X-Tenant-Id без входа в систему. По умолчанию включено
   * только вне production. На сервере для просмотра включается явно, а сайт целиком
   * закрывается паролем на уровне веб-сервера (Caddy).
   */
  ALLOW_TENANT_HEADER: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? process.env.NODE_ENV !== "production" : v === "true")),
  /** Самостоятельная регистрация операторов: open — для облака, closed (по умолчанию) — для установок у клиента. */
  SIGNUP: z.enum(["open", "closed"]).default("closed"),
  /** Ссылка на условия использования и обработки ПДн для формы регистрации (необязательно). */
  TERMS_URL: z.string().url().optional(),
  /** Адрес сайта для ссылок в письмах: https://vols.example.ru */
  PUBLIC_URL: z.string().url().optional(),
  /** Почта (SMTP). Без SMTP_HOST письма не отправляются — ссылки копируются вручную. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  /** SSL с начала соединения (порт 465); false — STARTTLS (порт 587). По умолчанию — по порту. */
  SMTP_SECURE: z.enum(["true", "false"]).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** От кого: «ВОЛС <noreply@example.ru>» — адрес должен принадлежать ящику SMTP_USER. */
  MAIL_FROM: z.string().optional(),
});

// Пустые строки из .env.prod (KEY='') — как не заданные.
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
