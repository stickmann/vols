import { useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "../../api/client.js";
import { useAuthConfig } from "./SignupPage.js";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Field, Input } from "../../components/ui/index.js";
import { ROLE_LABELS, useChangePassword, useCurrentUser, useDisable2fa, useEnable2fa, useStart2fa } from "./api.js";

export function ProfilePage() {
  const me = useCurrentUser();
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Профиль</h1>
        <p className="text-sm text-slate-500">
          {me.user.name} · {me.user.email}
          {me.role && me.tenant && (
            <>
              {" "}
              · {ROLE_LABELS[me.role]} в «{me.tenant.name}»
            </>
          )}
        </p>
      </div>
      {me.mustSetup2fa && (
        <Alert tone="warning">
          У «{me.tenant?.name}» двухфакторный вход обязателен. Настройте его ниже — после этого откроется работа с сетью.
        </Alert>
      )}
      <VerifyEmailBanner />
      <TwoFactorSection />
      <PasswordSection />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function TwoFactorSection() {
  const me = useCurrentUser();
  const start = useStart2fa();
  const enable = useEnable2fa();
  const disable = useDisable2fa();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (start.data)
      void QRCode.toDataURL(start.data.otpauthUrl, {
        margin: 1,
        width: 200,
      }).then(setQr);
  }, [start.data]);

  if (codes)
    return (
      <Section title="Двухфакторный вход включён">
        <p className="mb-3 text-sm text-slate-600">
          Сохраните коды восстановления — каждый можно использовать один раз, если телефон потерян. Больше они показаны не будут.
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded-lg bg-slate-50 p-3 font-mono text-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}>Скопировать</Button>
          <Button variant="primary" onClick={() => setCodes(null)}>
            Я сохранил коды
          </Button>
        </div>
      </Section>
    );

  if (me.user.twoFactor)
    return (
      <Section title="Двухфакторный вход">
        <p className="mb-3 text-sm text-slate-600">
          <Badge tone="green">включён</Badge> При входе запрашивается код из приложения. Кодов восстановления осталось:{" "}
          <b>{me.user.recoveryCodesLeft}</b>.
        </p>
        {!me.tenant?.require2fa && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              disable.mutate(password, { onSuccess: () => setPassword("") });
            }}
          >
            <Field label="Пароль для отключения" className="min-w-0 flex-1">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={disable.isPending}>
              Отключить
            </Button>
          </form>
        )}
        {disable.isError && (
          <div className="mt-2">
            <Alert>{disable.error.message}</Alert>
          </div>
        )}
      </Section>
    );

  return (
    <Section title="Двухфакторный вход">
      {!start.data ? (
        <>
          <p className="mb-3 text-sm text-slate-600">
            Кроме пароля, при входе будет нужен код из приложения на телефоне: Яндекс Ключ, Google Authenticator, Microsoft
            Authenticator и др. Так пароль сам по себе не даёт доступ к сети.
          </p>
          <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
            Настроить
          </Button>
          {start.isError && <Alert>{start.error.message}</Alert>}
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            enable.mutate(code, {
              onSuccess: (r) => setCodes(r.recoveryCodes),
            });
          }}
        >
          <p className="text-sm text-slate-600">1. Отсканируйте QR-код в приложении или введите ключ вручную.</p>
          <div className="flex flex-wrap items-center gap-4">
            {qr && (
              <img
                src={qr}
                width={200}
                height={200}
                alt="QR-код для приложения-аутентификатора"
                className="rounded border border-slate-200"
              />
            )}
            <div className="min-w-0 text-xs text-slate-500">
              Ключ:
              <code className="mt-1 block break-all rounded bg-slate-50 p-2 font-mono text-sm text-slate-800">
                {start.data.secret}
              </code>
            </div>
          </div>
          <Field label="2. Код из приложения">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-40 text-center font-mono text-lg tracking-widest"
            />
          </Field>
          {enable.isError && <Alert>{enable.error.message}</Alert>}
          <Button type="submit" variant="primary" disabled={enable.isPending}>
            Включить
          </Button>
        </form>
      )}
    </Section>
  );
}

function PasswordSection() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const mismatch = next2 !== "" && next !== next2;
  return (
    <Section title="Пароль">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) change.mutate({ current, next }, { onSuccess: () => (setCurrent(""), setNext(""), setNext2("")) });
        }}
      >
        <Field label="Текущий">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="Новый" hint="Не короче 8 символов">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Новый ещё раз">
          <Input type="password" autoComplete="new-password" required value={next2} onChange={(e) => setNext2(e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          {mismatch && <Alert tone="warning">Пароли не совпадают</Alert>}
          {change.isError && <Alert>{change.error.message}</Alert>}
          {change.isSuccess && <Alert tone="info">Пароль изменён. На других устройствах вход сброшен.</Alert>}
          <Button type="submit" className="mt-2" disabled={change.isPending || mismatch}>
            Сменить пароль
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** E-mail не подтверждён (почта настроена): без подтверждения нельзя приглашать сотрудников. */
function VerifyEmailBanner() {
  const me = useCurrentUser();
  const mail = useAuthConfig().data?.mail;
  const resend = useMutation({ mutationFn: () => api("/auth/verify/resend", { method: "POST" }) });
  if (me.user.emailVerified || !mail) return null;
  return (
    <Alert tone="warning">
      <p>
        E-mail {me.user.email} не подтверждён — откройте ссылку из письма. Без подтверждения нельзя приглашать сотрудников.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => resend.mutate()} disabled={resend.isPending || resend.isSuccess}>
          Отправить письмо ещё раз
        </Button>
        {resend.isSuccess && <span className="text-sm">Письмо отправлено — проверьте почту и «Спам».</span>}
        {resend.isError && <span className="text-sm text-red-700">{resend.error.message}</span>}
      </div>
    </Alert>
  );
}
