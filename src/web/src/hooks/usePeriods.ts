
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { Period } from "../types/api";

export function usePeriods() {
  return useQuery<Period[]>({
    queryKey: ["periods"],
    queryFn: () => apiFetch<Period[]>("/periods"),
  });
}

export function useCurrentPeriod() {
  return useQuery<Period>({
    queryKey: ["periods", "current"],
    queryFn: () => apiFetch<Period>("/periods/current"),
  });
}

export function usePeriodStatus(periodId: string) {
  return useQuery<Period>({
    queryKey: ["periods", periodId, "status"],
    queryFn: () => apiFetch<Period>("/periods/" + periodId + "/status"),
    enabled: !!periodId,
  });
}

export function useSoftClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periodId: string) =>
      apiFetch("/periods/" + periodId + "/soft-close", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["periods"] }); },
  });
}

export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periodId: string) =>
      apiFetch("/periods/" + periodId + "/close", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["periods"] }); },
  });
}
