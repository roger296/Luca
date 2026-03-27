import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuthStore } from "./store/authStore";
import type { AuthUser } from "./store/authStore";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Journal } from "./pages/Journal";
import { AccountLedger } from "./pages/AccountLedger";
import { ApprovalQueue } from "./pages/ApprovalQueue";
import { ChartOfAccounts } from "./pages/ChartOfAccounts";
import { PeriodManagement } from "./pages/PeriodManagement";
import { TrialBalance } from "./pages/TrialBalance";
import { ProfitAndLoss } from "./pages/ProfitAndLoss";
import { BalanceSheet } from "./pages/BalanceSheet";
import { CashFlow } from "./pages/CashFlow";
import { AuditTrail } from "./pages/AuditTrail";
import { WebhookManagement } from "./pages/WebhookManagement";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  const { isAuthenticated, token, login, logout } = useAuthStore();

  // Refresh JWT every 20 minutes to keep the session alive
  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/v1/auth/refresh", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token },
        });
        const json = await res.json() as { success: boolean; data?: { token: string; user: AuthUser } };
        if (res.ok && json.success && json.data) {
          login(json.data.token, json.data.user);
        } else {
          // Token no longer valid -- log out cleanly
          logout();
        }
      } catch {
        // Network error -- don't log out, just let the user keep working until next attempt
      }
    }, 20 * 60 * 1000); // 20 minutes

    return () => clearInterval(interval);
  }, [isAuthenticated, token, login, logout]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public route -- no auth required */}
        <Route path="/login" element={<Login />} />

        {/* All other routes require authentication */}
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/journal" element={<Journal />} />
                  <Route path="/journal/:id" element={<Journal />} />
                  <Route path="/approvals" element={<ApprovalQueue />} />
                  <Route path="/accounts" element={<ChartOfAccounts />} />
                  <Route path="/accounts/:code" element={<AccountLedger />} />
                  <Route path="/periods" element={<PeriodManagement />} />
                  <Route path="/trial-balance" element={<TrialBalance />} />
                  <Route path="/profit-and-loss" element={<ProfitAndLoss />} />
                  <Route path="/balance-sheet" element={<BalanceSheet />} />
                  <Route path="/cash-flow" element={<CashFlow />} />
                  <Route path="/audit-trail" element={<AuditTrail />} />
                  <Route path="/webhooks" element={<WebhookManagement />} />
                </Routes>
              </Layout>
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
