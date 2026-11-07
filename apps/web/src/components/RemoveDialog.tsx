import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { offerUndo } from "../features/trash/undo.js";
import { Alert, Button, Dialog } from "./ui/index.js";

export type RemovableKind = "sites" | "routes" | "cables" | "equipment";

interface Impact {
  title: string;
  effects: { kind: "delete" | "change"; text: string }[];
}

const NOUN: Record<RemovableKind, string> = { sites: "место", routes: "трассу", cables: "кабель", equipment: "оборудование" };

/**
 * Удаление объекта с подтверждением: сервер перечисляет, что удалится и что изменится,
 * после подтверждения объект удаляется вместе со всем зависимым.
 */
export function RemoveDialog({
  kind,
  id,
  onClose,
  onRemoved,
}: {
  kind: RemovableKind;
  /** null — окно закрыто. */
  id: string | null;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const qc = useQueryClient();
  const impact = useQuery({
    queryKey: ["impact", kind, id],
    queryFn: () => api<Impact>(`/${kind}/${id}/impact`),
    enabled: !!id,
    gcTime: 0,
  });
  const remove = useMutation({
    mutationFn: () => api<{ operationId: string; operationTitle: string }>(`/${kind}/${id}?force=true`, { method: "DELETE" }),
    onSuccess: (r) => {
      offerUndo(r);
      onRemoved?.();
      onClose();
      // Удаление задевает карту, панели, разварку соседних корпусов и трассы. Запросы самого
      // удалённого объекта не обновляем: они вернут 404, а их экран уже закрывается.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "impact" ? false : q.queryKey[1] !== id });
    },
  });

  const close = () => {
    remove.reset();
    onClose();
  };

  return (
    <Dialog
      open={!!id}
      onClose={close}
      title={impact.data ? `Удалить ${NOUN[kind]} «${impact.data.title}»?` : `Удалить ${NOUN[kind]}?`}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button variant="danger" disabled={!impact.data || remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? "Удаление…" : "Удалить"}
          </Button>
        </>
      }
    >
      {impact.isPending && <p className="text-sm text-slate-500">Проверяю, что связано с объектом…</p>}
      {impact.isError && <Alert>{impact.error.message}</Alert>}
      {impact.data && (
        <div className="space-y-3 text-sm">
          <ul className="space-y-1.5">
            {impact.data.effects.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className={e.kind === "delete" ? "text-red-600" : "text-slate-400"}>
                  {e.kind === "delete" ? "✕" : "↻"}
                </span>
                <span className={e.kind === "delete" ? "text-slate-800" : "text-slate-600"}>
                  <span className="sr-only">{e.kind === "delete" ? "Будет удалено: " : "Изменится: "}</span>
                  {e.text}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">Удаление можно отменить сразу или позже из корзины (30 дней).</p>
        </div>
      )}
      {remove.isError && (
        <div className="mt-3">
          <Alert>{remove.error.message}</Alert>
        </div>
      )}
    </Dialog>
  );
}
