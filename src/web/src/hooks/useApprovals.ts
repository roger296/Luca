
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, buildQuery } from "../lib/api";
import type { StagingEntry } from "../types/api";

export function usePendingApprovals(filters: Record<string, string> = {}) {
  return useQuery<StagingEntry[]>({
    queryKey: ["approvals", "pending", filters],
    queryFn: () => apiFetch<StagingEntry[]>("/approvals/pending" + buildQuery(filters)),
    refetchInterval: 15_000,
  });
}

export function useApprovalDetail(stagingId: string) {
  return useQuery<StagingEntry>({
    queryKey: ["approvals", stagingId],
    queryFn: () => apiFetch<StagingEntry>("/approvals/" + stagingId),
    enabled: !!stagingId,
  });
}

export function useApproveTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stagingId, notes }: { stagingId: string; notes?: string }) =>
      apiFetch("/approvals/" + stagingId + "/approve", { method: "POST", body: JSON.stringify({ notes }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approvals"] }); },
  });
}

export function useRejectTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stagingId, reason }: { stagingId: string; reason: string }) =>
      apiFetch("/approvals/" + stagingId + "/reject", { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approvals"] }); },
  });
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stagingIds, notes }: { stagingIds: string[]; notes?: string }) =>
      apiFetch("/approvals/bulk-approve", { method: "POST", body: JSON.stringify({ staging_ids: stagingIds, notes }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approvals"] }); },
  });
}
