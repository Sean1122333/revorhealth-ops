import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import Layout from './components/Layout';
import MyQueue from './pages/MyQueue';
import TeamQueue from './pages/TeamQueue';
import Pipeline from './pages/Pipeline';

function RoleRedirect() {
  const { staff } = useAuth();
  if (!staff) return null;
  if (staff.role === 'manager') return <Navigate to="/pipeline" replace />;
  if (staff.role === 'team_lead') return <Navigate to="/team" replace />;
  return <Navigate to="/queue" replace />;
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
        <Route path="/queue" element={<MyQueue />} />
        <Route path="/team" element={<TeamQueue />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
