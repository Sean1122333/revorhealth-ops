import type { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import Layout from './components/Layout';
import MyQueue from './pages/MyQueue';
import TeamQueue from './pages/TeamQueue';
import Pipeline from './pages/Pipeline';
import Reports from './pages/Reports';

function RoleRedirect() {
  const { staff } = useAuth();
  if (!staff) return null;
  if (staff.role === 'manager') return <Navigate to="/pipeline" replace />;
  if (staff.role === 'team_lead') return <Navigate to="/team" replace />;
  return <Navigate to="/queue" replace />;
}

function RoleRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { staff, loading } = useAuth();
  if (loading || !staff) return null;
  if (!roles.includes(staff.role)) return <RoleRedirect />;
  return <>{children}</>;
}

function ProtectedLayout() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route element={<ProtectedLayout />}>
        <Route index element={<RoleRedirect />} />
        <Route path="/queue"    element={<RoleRoute roles={['associate', 'senior_associate']}><MyQueue /></RoleRoute>} />
        <Route path="/team"     element={<RoleRoute roles={['team_lead']}><TeamQueue /></RoleRoute>} />
        <Route path="/pipeline" element={<RoleRoute roles={['manager']}><Pipeline /></RoleRoute>} />
        <Route path="/reports"  element={<RoleRoute roles={['manager']}><Reports /></RoleRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
