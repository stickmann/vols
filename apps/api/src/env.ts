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
});

export const env = schema.parse(process.env);
