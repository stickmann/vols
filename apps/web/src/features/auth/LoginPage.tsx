import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Field, Input } from "../../components/ui/index.js";
import { useLogin, useLogin2fa } from "./api.js";

/** Карточка по центру экрана для входа, приглашения и сброса пароля. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">В</span>
          <span className="font-semibold">ВОЛС</span>
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/** Куда вернуться после входа: только свои страницы. */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/map";
}

export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const login = useLogin();
  const login2fa = useLogin2fa();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");

  const done = async () => {
    await qc.resetQueries();
    navigate(safeNext(params.get("next")), { replace: true });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "password") {
      login.mutate(
        { email, password },
        {
          onSuccess: (r) => (r.twoFactorRequired ? setStep("code") : void done()),
        },
      );
    } else {
      login2fa.mutate(code, { onSuccess: () => void done() });
    }
  };
  const error = (step === "password" ? login.error : login2fa.error)?.message;

  return (
    <AuthCard
      title={step === "password" ? "Вход" : "Код подтверждения"}
      subtitle={step === "code" ? "Введите 6 цифр из приложения-аутентификатора или один из кодов восстановления." : undefined}
    >
      <form className="space-y-3" onSubmit={submit}>
        {step === "password" ? (
          <>
            <Field label="E-mail">
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Пароль">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label="Код">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              className="text-center font-mono text-lg tracking-widest"
            />
          </Field>
        )}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" disabled={login.isPending || login2fa.isPending}>
          {step === "password" ? "Войти" : "Подтвердить"}
        </Button>
        <p className="text-center text-xs text-slate-500">
          Забыли пароль? Попросите администратора выдать ссылку для смены пароля.
        </p>
      </form>
    </AuthCard>
  );
}
