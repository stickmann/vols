import type { Color, ConnectionKind, ObjectStatus, SiteKind } from "@vols/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.js";

export interface FiberIn {
  terminalId: string;
  fiberId: string;
  number: number;
  module: number;
  position: number;
  condition: "ok" | "damaged" | "reserved";
  color: Color;
  moduleColor: Color;
}

export interface CableIn {
  spanId: string;
  cableId: string;
  name: string | null;
  typeName: string;
  /** a — пролёт начинается в этом корпусе (уходит), b — заканчивается (приходит). */
  side: "a" | "b";
  otherSiteName: string | null;
  otherSiteKind: SiteKind;
  fibers: FiberIn[];
}

export interface Port {
  terminalId: string;
  role: "in" | "out" | "adapter" | "pon";
  no: number;
  face: "rear" | "front" | null;
}

export interface Device {
  id: string;
  kind: string;
  name: string | null;
  modelName: string;
  insertionLossDb: number | null;
  ports: Port[] | null;
}

export interface Conn {
  id: string;
  kind: ConnectionKind;
  aTerminalId: string;
  bTerminalId: string;
  lossDb: number | null;
  trayNo: number | null;
  slotNo: number | null;
  notes: string | null;
}

export interface SplicingData {
  equipment: {
    id: string;
    kind: string;
    name: string | null;
    status: ObjectStatus;
    modelName: string;
    maxSplices: number | null;
    siteId: string;
    siteName: string | null;
    siteKind: SiteKind;
  };
  cables: CableIn[];
  devices: Device[];
  connections: Conn[];
  candidates: { spanId: string; name: string | null; typeName: string; mode: "end" | "transit" }[];
}

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

export const useLeaveCable = (equipmentId: string) =>
  useSpliceMutation(equipmentId, (spanId: string) => api<void>(`/equipment/${equipmentId}/cables/${spanId}`, { method: "DELETE" }));
