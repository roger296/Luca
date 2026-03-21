
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { ChainEntry } from "../types/api";

export function useChainVerify(period: string) {
  return useQuery<{ valid: boolean; entries: number; merkle_valid?: boolean; error?: string }>({
    queryKey: ["chain", "verify", period],
    queryFn: () => apiFetch("/chain/verify?period=" + period),
    enabled: !!period,
    staleTime: 0,
  });
}

export function useChainCheckpoint(period: string) {
  return useQuery<{ closing_hash: string; merkle_root: string; period_id: string }>({
    queryKey: ["chain", "checkpoint", period],
    queryFn: () => apiFetch("/chain/checkpoint/" + period),
    enabled: !!period,
  });
}

export function useMerkleProof(transactionId: string) {
  return useQuery({
    queryKey: ["chain", "proof", transactionId],
    queryFn: () => apiFetch("/chain/proof/" + transactionId),
    enabled: !!transactionId,
  });
}

export function useChainEntries(period: string) {
  return useQuery<ChainEntry[]>({
    queryKey: ["chain", "entries", period],
    queryFn: () => apiFetch<ChainEntry[]>("/chain/entries?period=" + period),
    enabled: !!period,
  });
}
