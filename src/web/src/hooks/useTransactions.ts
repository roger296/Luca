
import { useQuery } from "@tanstack/react-query";
import { apiFetch, buildQuery } from "../lib/api";
import type { Transaction } from "../types/api";

export interface TransactionFilters {
  period?: string;
  date_from?: string;
  date_to?: string;
  transaction_type?: string;
  account_code?: string;
  source_module?: string;
  correlation_id?: string;
  reference?: string;
  currency?: string;
  page?: number;
  page_size?: number;
}

export function useTransactions(filters: TransactionFilters = {}) {
  return useQuery<{ transactions: Transaction[]; total: number; page: number; page_size: number }>({
    queryKey: ["transactions", filters],
    queryFn: () => apiFetch("/transactions" + buildQuery(filters as Record<string, string | number>)),
  });
}

export function useTransaction(id: string) {
  return useQuery<Transaction>({
    queryKey: ["transactions", id],
    queryFn: () => apiFetch<Transaction>("/transactions/" + id),
    enabled: !!id,
  });
}
