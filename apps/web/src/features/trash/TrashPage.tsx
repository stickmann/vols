import { useCan } from "../auth/api.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client.js";
import { Alert, Badge, Button, cx } from "../../components/ui/index.js";
import { useUndo } from "./undo.js";

interface Operation {
  id: string;
  kind: string;
  title: string;
  summary: { kind: "delete" | "change"; text: string }[] | null;
  createdAt: string;
  undoneAt: string | null;
  userName: string | null;
  canUndo: boolean;
}

const fmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** Корзина: удаления и другие операции за 30 дней, с восстановлением. */
export function TrashPage() {
  const canEdit = useCan("designer");
  const list = useQuery({
    queryKey: ["operations"],
    queryFn: () => api<Operation[]>("/operations"),
  });
  const undo = useUndo();
  const [errorFor, setErrorFor] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="text-xl font-semibold">Корзина</h1>
      <p className="mb-4 text-sm text-slate-500">
        Удаления, очистки разварки и выводы кабелей за 30 дней. Восстановление возвращает всё, что изменила операция: объекты,
        сварки, транзит, пролёты кабелей.
      </p>
      {restored && (
        <div className="mb-3">
          <Alert tone="info">Восстановлено: {restored}</Alert>
        </div>
      )}
      {list.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
      {list.isError && <Alert>{list.error.message}</Alert>}
      {list.data?.length === 0 && <p className="text-sm text-slate-500">Пока пусто.</p>}

      <ul className="space-y-2">
        {list.data?.map((op) => {
          const isUndo = op.kind === "undo";
          return (
            <li
              key={op.id}
              className={cx("rounded-lg border border-slate-200 bg-white p-3", (op.undoneAt || isUndo) && "bg-slate-50")}
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className={cx("text-sm font-medium", isUndo && "text-slate-500")}>{op.title}</div>
                  <div className="text-xs text-slate-500">
                    {fmt.format(new Date(op.createdAt))}
                    {op.userName && ` · ${op.userName}`}
                  </div>
                </div>
                {op.undoneAt && <Badge tone="green">восстановлено</Badge>}
                {op.canUndo && canEdit && (
                  <Button
                    size="sm"
                    disabled={undo.isPending}
                    onClick={() => {
                      setErrorFor(null);
                      setRestored(null);
                      undo.mutate(op.id, {
                        onSuccess: (r) => setRestored(r.title),
                        onError: (e) => setErrorFor({ id: op.id, message: e.message }),
                      });
                    }}
                  >
                    Восстановить
                  </Button>
                )}
              </div>
              {op.summary && op.summary.length > 0 && !isUndo && (
                <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                  {op.summary.map((e, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span aria-hidden className={e.kind === "delete" ? "text-red-500" : "text-slate-400"}>
                        {e.kind === "delete" ? "✕" : "↻"}
                      </span>
                      {e.text}
                    </li>
                  ))}
                </ul>
              )}
              {errorFor?.id === op.id && (
                <div className="mt-2">
                  <Alert>{errorFor.message}</Alert>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
