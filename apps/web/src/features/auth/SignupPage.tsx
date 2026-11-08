import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { api } from "../../api/client.js";
import { Alert, Button, Field, Input } from "../../components/ui/index.js";
import { AuthCard } from "./LoginPage.js";

export const useAuthConfig = () =>
  useQuery({ queryKey: ["auth", "config"], queryFn: () => api<{ signup: boolean; termsUrl: string | null }>("/auth/config"), staleTime: 300_000 });

/** Регистрация оператора: компания и её владелец. Бесплатный тариф, по желанию — демо-сеть. */
export function SignupPage() {
  const config = useAuthConfig();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ company: "", name: "", email: "", password: "", password2: "", demo: true, acceptTerms: false, website: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const signup = useMutation({
    mutationFn: () => {
      const { password2: _, ...body } = f;
      return api("/auth/signup", { method: "POST", body });
    },
    onSuccess: async () => {
      await qc.resetQueries();
      navigate("/map", { replace: true });
    },
  });
  const mismatch = f.password2 !== "" && f.password !== f.password2;

  if (config.isPending) return <AuthCard title="Регистрация">Загрузка…</AuthCard>;
  if (!config.data?.signup) return <Navigate to="/login" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) signup.mutate();
  };

  return (
    <AuthCard title="Регистрация" subtitle="Бесплатно: до 200 точек учёта (муфты, ящики, кроссы, OLT, ONU) и 3 пользователей.">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Компания">
          <Input required autoComplete="organization" value={f.company} onChange={(e) => set("company", e.target.value)} autoFocus />
        </Field>
        <Field label="Ваше имя">
          <Input required autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="E-mail">
          <Input type="email" required autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Пароль" hint="Не короче 8 символов">
          <Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} />
        </Field>
        <Field label="Пароль ещё раз">
          <Input type="password" required autoComplete="new-password" value={f.password2} onChange={(e) => set("password2", e.target.value)} />
        </Field>
        {/* Ловушка для ботов: людям не видна. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="hidden"
          value={f.website}
          onChange={(e) => set("website", e.target.value)}
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={f.demo} onChange={(e) => set("demo", e.target.checked)} />
          <span>Создать демо-сеть для знакомства (узел, опоры, муфта, ящик — можно удалить)</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" required checked={f.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} />
          <span>
            Согласен с{" "}
            {config.data.termsUrl ? (
              <a href={config.data.termsUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                условиями использования и обработкой персональных данных
              </a>
            ) : (
              "условиями использования и обработкой персональных данных"
            )}
          </span>
        </label>
        {mismatch && <Alert tone="warning">Пароли не совпадают</Alert>}
        {signup.isError && <Alert>{signup.error.message}</Alert>}
        <Button type="submit" variant="primary" className="w-full" disabled={signup.isPending || mismatch || !f.acceptTerms}>
          {signup.isPending ? "Создаём…" : "Зарегистрироваться"}
        </Button>
        <p className="text-center text-sm text-slate-500">
          Уже есть учётная запись?{" "}
          <Link to="/login" className="text-brand-700 underline">
            Войти
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
