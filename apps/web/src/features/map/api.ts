import type { CableInput, EquipmentInput, RouteInput, SiteInput, TraceResult } from "@vols/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import type { CableDetails, Network, RouteDetails, SiteDetails } from "./types.js";

export const netKeys = {
  network: ["network"] as const,
  site: (id: string) => ["site", id] as const,
  route: (id: string) => ["route", id] as const,
  cable: (id: string) => ["cable", id] as const,
};

export const useNetwork = () => useQuery({ queryKey: netKeys.network, queryFn: () => api<Network>("/network") });

export const useSite = (id: string | null) =>
  useQuery({ queryKey: netKeys.site(id ?? ""), queryFn: () => api<SiteDetails>(`/sites/${id}`), enabled: !!id });

export const useRoute = (id: string | null) =>
  useQuery({ queryKey: netKeys.route(id ?? ""), queryFn: () => api<RouteDetails>(`/routes/${id}`), enabled: !!id });

export const useCable = (id: string | null) =>
  useQuery({ queryKey: netKeys.cable(id ?? ""), queryFn: () => api<CableDetails>(`/cables/${id}`), enabled: !!id });

export interface EquipmentModel {
  id: string;
  kind: string;
  name: string;
  portCount: number | null;
}
export const useEquipmentModels = () =>
  useQuery({ queryKey: ["equipment-models"], queryFn: () => api<EquipmentModel[]>("/equipment-models"), staleTime: 300_000 });

export const findPath = (fromSiteId: string, toSiteId: string) =>
  api<{ siteIds: string[]; routeIds: string[]; lengthM: number }>("/routing/path", {
    method: "POST",
    body: { fromSiteId, toSiteId },
  });

/** Любое изменение сети: после него обновляем карту и открытые карточки. */
function useNetMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: netKeys.network });
      void qc.invalidateQueries({ queryKey: ["site"] });
      void qc.invalidateQueries({ queryKey: ["route"] });
      void qc.invalidateQueries({ queryKey: ["trace"] });
      void qc.invalidateQueries({ queryKey: ["cable"] });
      void qc.invalidateQueries({ queryKey: ["cable-types"] });
    },
  });
}

export const useCreateSite = () => useNetMutation((v: SiteInput) => api<{ id: string }>("/sites", { method: "POST", body: v }));
export const useUpdateSite = () =>
  useNetMutation(({ id, ...v }: Partial<SiteInput> & { id: string }) => api<void>(`/sites/${id}`, { method: "PATCH", body: v }));
export const useDeleteSite = () => useNetMutation((id: string) => api<void>(`/sites/${id}`, { method: "DELETE" }));

export const useCreateRoute = () => useNetMutation((v: RouteInput) => api<{ id: string }>("/routes", { method: "POST", body: v }));
export const useUpdateRoute = () =>
  useNetMutation(({ id, ...v }: Partial<Omit<RouteInput, "fromSiteId" | "toSiteId">> & { id: string }) =>
    api<void>(`/routes/${id}`, { method: "PATCH", body: v }),
  );
export const useDeleteRoute = () => useNetMutation((id: string) => api<void>(`/routes/${id}`, { method: "DELETE" }));

export const useCreateEquipment = () =>
  useNetMutation((v: EquipmentInput) => api<{ id: string }>("/equipment", { method: "POST", body: v }));
export const useDeleteEquipment = () => useNetMutation((id: string) => api<void>(`/equipment/${id}`, { method: "DELETE" }));

export const useCreateCable = () => useNetMutation((v: CableInput) => api<{ id: string }>("/cables", { method: "POST", body: v }));
export const useUpdateCable = () =>
  useNetMutation(
    ({ id, ...v }: { id: string; name?: string | null; status?: CableInput["status"]; notes?: string | null; fromEquipmentId?: string | null; toEquipmentId?: string | null }) =>
      api<void>(`/cables/${id}`, { method: "PATCH", body: v }),
  );
export const useDeleteCable = () => useNetMutation((id: string) => api<void>(`/cables/${id}`, { method: "DELETE" }));

export const useTrace = (terminalId: string | null) =>
  useQuery({
    queryKey: ["trace", terminalId ?? ""],
    queryFn: () => api<TraceResult>("/trace", { method: "POST", body: { terminalId } }),
    enabled: !!terminalId,
  });

export interface LocateResult {
  beyond: boolean;
  totalM: number;
  description: string;
  position?: [number, number];
  siteId?: string;
  routeId?: string;
}

export const locateFault = (terminalId: string, leafTerminalId: string, distanceM: number) =>
  api<LocateResult>("/trace/locate", { method: "POST", body: { terminalId, leafTerminalId, distanceM } });
