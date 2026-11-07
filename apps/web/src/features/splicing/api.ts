export type { CableIn, Conn, Device, FiberIn, Port, SplicingData } from "@vols/shared";
import type { SplicingData } from "@vols/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.js";


const key = (id: string) => ["splicing", id] as const;

export const useSplicing = (id: string) => useQuery({ queryKey: key(id), queryFn: () => api<SplicingData>(`/equipment/${id}/splicing`) });

function useSpliceMutation<V, R>(equipmentId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(equipmentId) });
      void qc.invalidateQueries({ queryKey: ["network"] });
      void qc.invalidateQueries({ queryKey: ["site"] });
      void qc.invalidateQueries({ queryKey: ["cable"] });
      void qc.invalidateQueries({ queryKey: ["trace"] });
    },
  });
}

type Kind = "fusion" | "mechanical" | "patch";

export const useConnect = (equipmentId: string) =>
  useSpliceMutation(equipmentId, (v: { aTerminalId: string; bTerminalId: string; kind?: Kind }) =>
    api<{ id: string }>("/connections", { method: "POST", body: { equipmentId, ...v } }),
  );

export const useConnectBatch = (equipmentId: string) =>
  useSpliceMutation(equipmentId, (v: { pairs: { aTerminalId: string; bTerminalId: string }[]; kind?: Kind; trayNo?: number | null }) =>
    api<{ ids: string[] }>("/connections/batch", { method: "POST", body: { equipmentId, ...v } }),
  );

export const useUpdateConnection = (equipmentId: string) =>
  useSpliceMutation(
    equipmentId,
    ({ id, ...v }: { id: string; kind?: Kind; lossDb?: number | null; trayNo?: number | null; slotNo?: number | null; notes?: string | null }) =>
      api<void>(`/connections/${id}`, { method: "PATCH", body: v }),
  );

export const useDisconnect = (equipmentId: string) =>
  useSpliceMutation(equipmentId, (id: string) => api<void>(`/connections/${id}`, { method: "DELETE" }));

/** Удалить несколько соединений подряд (например, разрезать транзит целого модуля). */
export const useDisconnectMany = (equipmentId: string) =>
  useSpliceMutation(equipmentId, async (ids: string[]) => {
    for (const id of ids) await api<void>(`/connections/${id}`, { method: "DELETE" });
  });

export const useEnterCable = (equipmentId: string) =>
  useSpliceMutation(equipmentId, (spanId: string) =>
    api<{ split: boolean }>(`/equipment/${equipmentId}/cables`, { method: "POST", body: { spanId } }),
  );

/** Вывести кабель из корпуса; force — вместе с соединениями на его волокнах. Транзит склеивается в один пролёт. */
export const useLeaveCable = (equipmentId: string) =>
  useSpliceMutation(equipmentId, ({ spanId, force }: { spanId: string; force?: boolean }) =>
    api<{ merged: boolean }>(`/equipment/${equipmentId}/cables/${spanId}${force ? "?force=true" : ""}`, { method: "DELETE" }),
  );

/** Удалить все сварки и патч-корды корпуса; restoreThrough — вернуть транзит разрезанным волокнам. */
export const useClearSplicing = (equipmentId: string) =>
  useSpliceMutation(equipmentId, (restoreThrough: boolean) =>
    api<{ deleted: number; restored: number }>(`/equipment/${equipmentId}/clear-splicing`, { method: "POST", body: { restoreThrough } }),
  );
