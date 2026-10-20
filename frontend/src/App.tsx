import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { ErrorState, Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  const { user, loading, error } = useAuth();
  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState error={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
