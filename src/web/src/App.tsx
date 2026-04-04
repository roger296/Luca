import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Journal } from './pages/Journal';
import { ChartOfAccounts } from './pages/ChartOfAccounts';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { TrialBalance } from './pages/TrialBalance';
import { PeriodManagement } from './pages/PeriodManagement';
import { ConnectClaude } from './pages/ConnectClaude';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/accounts" element={<ChartOfAccounts />} />
        <Route path="/approvals" element={<ApprovalQueue />} />
        <Route path="/trial-balance" element={<TrialBalance />} />
        <Route path="/periods" element={<PeriodManagement />} />
        <Route path="/connect-claude" element={<ConnectClaude />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
