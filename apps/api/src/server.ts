import { disabledMailer, smtpMailer } from "./services/mail.js";
import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { env } from "./env.js";

const { db, close } = createDb(env.DATABASE_URL);
const mailer =
  env.SMTP_HOST && env.MAIL_FROM && env.PUBLIC_URL
    ? smtpMailer({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : env.SMTP_PORT === 465,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.MAIL_FROM,
        publicUrl: env.PUBLIC_URL,
      })
    : disabledMailer;
const app = buildApp({ db, devTenantHeader: env.ALLOW_TENANT_HEADER, signup: env.SIGNUP === "open", termsUrl: env.TERMS_URL, mailer, logger: true });
if (!mailer.enabled) app.log.info("Отправка писем не настроена (SMTP_HOST, MAIL_FROM, PUBLIC_URL) — ссылки копируются вручную");
if (env.ALLOW_TENANT_HEADER && process.env.NODE_ENV === "production") {
  app.log.warn("ALLOW_TENANT_HEADER=true: оператор берётся из заголовка без входа. Только для просмотра за паролем веб-сервера.");
}

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
