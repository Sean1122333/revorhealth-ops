import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import DailyLog from "./pages/DailyLog";
import Agents from "./pages/Agents";
import Clients from "./pages/Clients";
import Reports from "./pages/Reports";
import Seed from "./pages/Seed";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/log" element={<DailyLog />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/seed" element={<Seed />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
