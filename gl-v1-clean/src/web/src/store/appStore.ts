
import { create } from "zustand";

interface AppState {
  selectedPeriod: string;
  currencyDisplay: "base" | "transaction";
  sidebarCollapsed: boolean;
  setSelectedPeriod: (period: string) => void;
  setCurrencyDisplay: (display: "base" | "transaction") => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedPeriod: "",
  currencyDisplay: "base",
  sidebarCollapsed: false,
  setSelectedPeriod: (period) => set({ selectedPeriod: period }),
  setCurrencyDisplay: (display) => set({ currencyDisplay: display }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
