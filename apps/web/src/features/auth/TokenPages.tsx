import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../../api/client.js";
import { Alert, Button, Field, Input } from "../../components/ui/index.js";
import { ROLE_LABELS, type Role } from "./api.js";
import { AuthCard } from "./LoginPage.js";

const MIN = 8;

/** Принять приглашение: новый пользователь задаёт имя и пароль, существующий — вводит свой. */
export function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () =>
      api<{
        email: string;
        role: Role;
        tenantName: string;
        hasAccount: boolean;
      }>(`/auth/invites/${token}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: (v: { name?: string; password: string }) =>
      api<{ twoFactorRequired: boolean }>(`/auth/invites/${token}/accept`, {
        method: "POST",
        body: v,
      }),
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  if (info.isPending) return <AuthCard title="Приглашение">Загрузка…</AuthCard>;
  if (info.isError)
    return (
      <AuthCard title="Приглашение">
        <Alert>{info.error.message}</Alert>
        <Link to="/login" className="mt-3 block text-sm text-brand-700 underline">
          Перейти ко входу
        </Link>
      </AuthCard>
    );
  const i = info.data;
  const mismatch = !i.hasAccount && password2 !== "" && password !== password2;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    accept.mutate(i.hasAccount ? { password } : { name, password }, {
      onSuccess: async (r) => {
        await qc.resetQueries();
        navigate(r.twoFactorRequired ? "/login" : "/map", { replace: true });
      },
    });
  };

  return (
    <AuthCard
      title={`Приглашение в «${i.tenantName}»`}
      subtitle={
        <>
          {i.email} · роль «{ROLE_LABELS[i.role]}».{" "}
          {i.hasAccount ? "У вас уже есть учётная запись — введите свой пароль." : "Задайте имя и пароль для входа."}
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        {!i.hasAccount && (
          <Field label="Имя и фамилия">
            <Input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
        )}
        <Field label="Пароль" hint={i.hasAccount ? undefined : `Не короче ${MIN} символов`}>
          <Input
            type="password"
            required
            minLength={i.hasAccount ? 1 : MIN}
            autoComplete={i.hasAccount ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {!i.hasAccount && (
          <Field label="Пароль ещё раз">
            <Input
              type="password"
              required
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </Field>
        )}
        {mismatch && <Alert tone="warning">Пароли не совпадают</Alert>}
        {accept.isError && <Alert>{accept.error.message}</Alert>}
        <Button type="submit" variant="primary" className="w-full" disabled={accept.isPending || mismatch}>
          Принять приглашение
        </Button>
      </form>
    </AuthCard>
  );
}

/** Смена пароля по ссылке от администратора. */
export function ResetPage() {
  const { token = "" } = useParams();
  const info = useQuery({
    queryKey: ["reset", token],
    queryFn: () => api<{ email: string }>(`/auth/reset/${token}`),
    retry: false,
  });
  const reset = useMutation({
    mutationFn: (password: string) => api(`/auth/reset/${token}`, { method: "POST", body: { password } }),
  });
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const mismatch = password2 !== "" && password !== password2;

  if (info.isPending) return <AuthCard title="Новый пароль">Загрузка…</AuthCard>;
  if (info.isError)
    return (
      <AuthCard title="Новый пароль">
        <Alert>{info.error.message}</Alert>
        <Link to="/login" className="mt-3 block text-sm text-brand-700 underline">
          Перейти ко входу
        </Link>
      </AuthCard>
    );
  if (reset.isSuccess)
    return (
      <AuthCard title="Пароль изменён">
        <p className="text-sm text-slate-600">Войдите с новым паролем. На других устройствах вход сброшен.</p>
        <Link to="/login" className="mt-4 block">
          <Button variant="primary" className="w-full">
            Ко входу
          </Button>
        </Link>
      </AuthCard>
    );

  return (
    <AuthCard title="Новый пароль" subtitle={info.data.email}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) reset.mutate(password);
        }}
      >
        <Field label="Новый пароль" hint={`Не короче ${MIN} символов`}>
          <Input
            type="password"
            required
            minLength={MIN}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Ещё раз">
          <Input
            type="password"
            required
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
          />
        </Field>
        {mismatch && <Alert tone="warning">Пароли не совпадают</Alert>}
        {reset.isError && <Alert>{reset.error.message}</Alert>}
        <Button type="submit" variant="primary" className="w-full" disabled={reset.isPending || mismatch}>
          Сохранить пароль
        </Button>
      </form>
    </AuthCard>
  );
}

/** «Забыли пароль?» — письмо со ссылкой; ответ одинаковый, есть такой адрес или нет. */
export function ForgotPage() {
  const [email, setEmail] = useState("");
  const send = useMutation({ mutationFn: () => api("/auth/forgot", { method: "POST", body: { email } }) });
  if (send.isSuccess)
    return (
      <AuthCard title="Проверьте почту">
        <p className="text-sm text-slate-600">
          Если {email} зарегистрирован, на него пришло письмо со ссылкой для смены пароля. Ссылка действует 1 час. Не видите письма —
          загляните в «Спам».
        </p>
        <Link to="/login" className="mt-4 block text-sm text-brand-700 underline">
          Вернуться ко входу
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title="Восстановление пароля" subtitle="Пришлём ссылку для смены пароля на e-mail, с которым вы входите.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field label="E-mail">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        {send.isError && <Alert>{send.error.message}</Alert>}
        <Button type="submit" variant="primary" className="w-full" disabled={send.isPending}>
          Отправить ссылку
        </Button>
        <Link to="/login" className="block text-center text-sm text-brand-700 underline">
          Вернуться ко входу
        </Link>
      </form>
    </AuthCard>
  );
}

/** Переход по ссылке из письма подтверждения: подтверждаем сразу. */
export function VerifyPage() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const verify = useQuery({
    queryKey: ["verify", token],
    queryFn: async () => {
      await api(`/auth/verify/${token}`, { method: "POST" });
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
      return true;
    },
    retry: false,
    staleTime: Infinity,
  });
  return (
    <AuthCard title="Подтверждение e-mail">
      {verify.isPending && <p className="text-sm text-slate-600">Проверяем ссылку…</p>}
      {verify.isError && <Alert>{verify.error.message}</Alert>}
      {verify.isSuccess && <Alert tone="success">Адрес подтверждён. Теперь можно приглашать сотрудников.</Alert>}
      {!verify.isPending && (
        <Link to="/map" className="mt-4 block">
          <Button variant="primary" className="w-full">
            Открыть карту
          </Button>
        </Link>
      )}
    </AuthCard>
  );
}
