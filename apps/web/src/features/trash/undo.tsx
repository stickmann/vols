import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../../api/client.js";

/**
 * Плашка «Отменить» после удаления, очистки разварки и т.п. Показывается внизу экрана
 * на 15 секунд; то же действие потом можно отменить из корзины.
 */

interface UndoItem {
  operationId: string;
  title: string;
}

let current: UndoItem | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Показать плашку для только что выполненной операции. */
export function offerUndo(r: { operationId?: string; operationTitle?: string } | undefined) {
  if (!r?.operationId) return;
  current = { operationId: r.operationId, title: r.operationTitle ?? "Действие выполнено" };
  emit();
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Отмена операции: вернуть всё как было и обновить все экраны. */
export function useUndo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (operationId: string) => api<{ operationId: string; title: string }>(`/operations/${operationId}/undo`, { method: "POST" }),
    onSuccess: (_r, operationId) => {
      // Если операцию отменили из корзины, её плашка «Отменить» больше не нужна.
      if (current?.operationId === operationId) {
        current = null;
        emit();
      }
      void qc.invalidateQueries();
    },
  });
}

export function UndoToast() {
  const item = useSyncExternalStore(subscribe, () => current);
  const undo = useUndo();
  const [done, setDone] = useState<string | null>(null);

  // Новая операция — новая плашка (сообщение «Восстановлено» от прошлой убираем).
  useEffect(() => {
    if (!item) return;
    setDone(null);
    undo.reset();
    const t = setTimeout(() => {
      if (current === item) {
        current = null;
        emit();
      }
    }, 15_000);
    return () => clearTimeout(t);
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 5_000);
    return () => clearTimeout(t);
  }, [done]);

  if (!item && !done) return null;
  const close = () => {
    current = null;
    setDone(null);
    emit();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
    >
      <span className="min-w-0 flex-1">
        {done ? (
          <>Восстановлено: {done}</>
        ) : undo.isError ? (
          <span className="text-red-200">{undo.error.message}</span>
        ) : (
          <>Выполнено: {item!.title}</>
        )}
      </span>
      {!done && !undo.isError && (
        <button
          className="shrink-0 rounded-md px-2 py-1 font-semibold text-amber-300 hover:bg-white/10 disabled:opacity-50"
          disabled={undo.isPending}
          onClick={() => undo.mutate(item!.operationId, { onSuccess: (r) => ((current = null), setDone(r.title)) })}
        >
          {undo.isPending ? "Отмена…" : "Отменить"}
        </button>
      )}
      <button className="shrink-0 rounded-md px-2 py-1 text-slate-300 hover:bg-white/10" onClick={close} aria-label="Закрыть">
        ✕
      </button>
    </div>
  );
}
