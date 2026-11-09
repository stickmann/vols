import nodemailer from "nodemailer";

/**
 * Отправка писем через SMTP оператора сервиса (Яндекс 360, Mail.ru для бизнеса и т.п.).
 * Не настроено — enabled = false, и интерфейс по-прежнему даёт ссылки для копирования.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  enabled: boolean;
  /** Адрес сайта для ссылок в письмах (без завершающего слэша). */
  publicUrl: string | null;
  send(mail: Mail): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  publicUrl: string;
  /** Только для тестов: самоподписанный сертификат локального сервера. */
  allowSelfSigned?: boolean;
}

export const disabledMailer: Mailer = {
  enabled: false,
  publicUrl: null,
  send: async () => {
    throw new Error("Отправка писем не настроена");
  },
};

export function smtpMailer(c: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.password ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: c.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
  });
  return {
    enabled: true,
    publicUrl: c.publicUrl.replace(/\/+$/, ""),
    async send(m) {
      await transport.sendMail({ from: c.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}

// ---------------------------------------------------------------- шаблоны

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Простое письмо: заголовок, абзацы, кнопка со ссылкой и та же ссылка текстом. */
function letter(o: { title: string; paragraphs: string[]; button: string; url: string; footer: string }) {
  const text = [o.title, "", ...o.paragraphs, "", `${o.button}: ${o.url}`, "", o.footer].join("\n");
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="padding:24px">
<div style="font-weight:bold;font-size:16px;margin-bottom:16px">ВОЛС</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(o.title)}</h1>
${o.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${esc(p)}</p>`).join("")}
<p style="margin:20px 0"><a href="${esc(o.url)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:15px;display:inline-block">${esc(o.button)}</a></p>
<p style="font-size:12px;color:#64748b;word-break:break-all;margin:0 0 12px">Если кнопка не работает, откройте ссылку: ${esc(o.url)}</p>
<p style="font-size:12px;color:#64748b;margin:0">${esc(o.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

const ROLE_RU: Record<string, string> = {
  owner: "владелец",
  admin: "администратор",
  designer: "инженер",
  technician: "монтажник",
  viewer: "просмотр",
};

export function inviteMail(o: {
  to: string;
  tenantName: string;
  inviterName: string | null;
  role: string;
  url: string;
  days: number;
}): Mail {
  return {
    to: o.to,
    subject: `Приглашение в «${o.tenantName}» — ВОЛС`,
    ...letter({
      title: `Приглашение в «${o.tenantName}»`,
      paragraphs: [
        `${o.inviterName ?? "Администратор"} приглашает вас работать с оптической сетью «${o.tenantName}» в сервисе ВОЛС. Роль: ${ROLE_RU[o.role] ?? o.role}.`,
        "По ссылке вы зададите имя и пароль (или войдёте своим паролем, если учётная запись уже есть).",
      ],
      button: "Принять приглашение",
      url: o.url,
      footer: `Ссылка действует ${o.days} дней и только один раз. Если вы не ждали приглашения, просто удалите письмо.`,
    }),
  };
}

export function resetMail(o: { to: string; name: string; url: string; hours: number; byAdmin: boolean }): Mail {
  return {
    to: o.to,
    subject: "Смена пароля — ВОЛС",
    ...letter({
      title: "Смена пароля",
      paragraphs: [
        `${o.name}, ${o.byAdmin ? "администратор выдал вам ссылку для смены пароля" : "кто-то (надеемся, вы) запросил смену пароля"} в сервисе ВОЛС.`,
        "После смены пароля вход на других устройствах будет сброшен.",
      ],
      button: "Задать новый пароль",
      url: o.url,
      footer: `Ссылка действует ${o.hours} ч и только один раз. Если вы не запрашивали смену пароля, ничего не делайте — пароль останется прежним.`,
    }),
  };
}

export function verifyMail(o: { to: string; name: string; tenantName: string; url: string; hours: number }): Mail {
  return {
    to: o.to,
    subject: "Подтвердите e-mail — ВОЛС",
    ...letter({
      title: "Подтвердите e-mail",
      paragraphs: [
        `${o.name}, спасибо за регистрацию «${o.tenantName}» в сервисе ВОЛС.`,
        "Подтвердите адрес, чтобы приглашать сотрудников и восстанавливать пароль по почте.",
      ],
      button: "Подтвердить e-mail",
      url: o.url,
      footer: `Ссылка действует ${o.hours} ч. Если вы не регистрировались, просто удалите письмо.`,
    }),
  };
}

/** Отправить, не роняя действие: письмо не ушло — ссылку можно скопировать вручную. */
export async function deliver(mailer: Mailer, mail: Mail, log: { error: (o: object, msg: string) => void }) {
  if (!mailer.enabled) return { emailed: false as const, mailError: null };
  try {
    await mailer.send(mail);
    return { emailed: true as const, mailError: null };
  } catch (e) {
    log.error({ err: e, to: mail.to }, "Письмо не отправлено");
    return {
      emailed: false as const,
      mailError: `Письмо не отправлено (${e instanceof Error ? e.message : "ошибка почты"}) — передайте ссылку вручную.`,
    };
  }
}
