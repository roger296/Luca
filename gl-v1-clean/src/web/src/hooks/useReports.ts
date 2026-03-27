
import { useQuery } from "@tanstack/react-query";
import { apiFetch, buildQuery } from "../lib/api";
import type { TrialBalanceReport, ProfitAndLossReport, BalanceSheetReport, CashFlowReport } from "../types/api";

export function useTrialBalance(period: string, options: Record<string, string> = {}) {
  return useQuery<TrialBalanceReport>({
    queryKey: ["reports", "trial-balance", period, options],
    queryFn: () => apiFetch<TrialBalanceReport>("/reports/trial-balance" + buildQuery({ period, ...options })),
    enabled: !!period,
  });
}

export function useProfitAndLoss(period: string, options: Record<string, string> = {}) {
  return useQuery<ProfitAndLossReport>({
    queryKey: ["reports", "pnl", period, options],
    queryFn: () => apiFetch<ProfitAndLossReport>("/reports/profit-and-loss" + buildQuery({ period, ...options })),
    enabled: !!period,
  });
}

export function useBalanceSheet(period: string, options: Record<string, string> = {}) {
  return useQuery<BalanceSheetReport>({
    queryKey: ["reports", "balance-sheet", period, options],
    queryFn: () => apiFetch<BalanceSheetReport>("/reports/balance-sheet" + buildQuery({ period, ...options })),
    enabled: !!period,
  });
}

export function useCashFlow(period: string) {
  return useQuery<CashFlowReport>({
    queryKey: ["reports", "cash-flow", period],
    queryFn: () => apiFetch<CashFlowReport>("/reports/cash-flow?period=" + period),
    enabled: !!period,
  });
}
