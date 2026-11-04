import type { CableTypeInput, Color } from "@vols/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";

export interface CableTypeListItem {
  id: string;
  name: string;
  construction: CableTypeInput["construction"];
  fiberStandard: string | null;
  outerDiameterMm: number | null;
  fiberCount: number;
  modules: (Color & { fiberCount: number })[];
  inUse: boolean;
  updatedAt: string;
}

export interface CableTypeView extends CableTypeInput {
  id: string;
  fiberCount: number;
  inUse: boolean;
}

export interface ColorSchemeRow {
  id: string;
  name: string;
  colors: { name: string; hex: string }[];
}

const keys = {
  cableTypes: ["cable-types"] as const,
  cableType: (id: string) => ["cable-types", id] as const,
  colorSchemes: ["color-schemes"] as const,
};

export const useCableTypes = () =>
  useQuery({ queryKey: keys.cableTypes, queryFn: () => api<CableTypeListItem[]>("/cable-types") });

export const useCableType = (id: string | undefined) =>
  useQuery({
    queryKey: keys.cableType(id ?? ""),
    queryFn: () => api<CableTypeView>(`/cable-types/${id}`),
    enabled: !!id,
  });

export const useColorSchemes = () =>
  useQuery({ queryKey: keys.colorSchemes, queryFn: () => api<ColorSchemeRow[]>("/color-schemes"), staleTime: 300_000 });

export function useSaveCableType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CableTypeInput }) =>
      id
        ? api<CableTypeView>(`/cable-types/${id}`, { method: "PUT", body: input })
        : api<CableTypeView>("/cable-types", { method: "POST", body: input }),
    onSuccess: (saved) => {
      qc.setQueryData(keys.cableType(saved.id), saved);
      void qc.invalidateQueries({ queryKey: keys.cableTypes, exact: true });
    },
  });
}

export function useDeleteCableType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/cable-types/${id}`, { method: "DELETE" }),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: keys.cableType(id) });
      void qc.invalidateQueries({ queryKey: keys.cableTypes, exact: true });
    },
  });
}
