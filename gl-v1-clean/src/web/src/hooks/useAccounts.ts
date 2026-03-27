
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, buildQuery } from "../lib/api";
import type { Account } from "../types/api";

export function useAccounts(filters: Record<string, string> = {}) {
  return useQuery<Account[]>({
    queryKey: ["accounts", filters],
    queryFn: () => apiFetch<Account[]>("/accounts" + buildQuery(filters)),
  });
}

export function useAccountBalance(code: string, params: Record<string, string> = {}) {
  return useQuery<{ debit: string; credit: string; net: string }>({
    queryKey: ["accounts", code, "balance", params],
    queryFn: () => apiFetch("/accounts/" + code + "/balance" + buildQuery(params)),
    enabled: !!code,
  });
}

export function useAccountLedger(code: string, params: Record<string, string | number> = {}) {
  return useQuery<{ entries: unknown[]; total: number }>({
    queryKey: ["accounts", code, "ledger", params],
    queryFn: () => apiFetch("/accounts/" + code + "/ledger" + buildQuery(params as Record<string, string>)),
    enabled: !!code,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Account>) =>
      apiFetch<Account>("/accounts", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, data }: { code: string; data: Partial<Account> }) =>
      apiFetch<Account>("/accounts/" + code, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
}
