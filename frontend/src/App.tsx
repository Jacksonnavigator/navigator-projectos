import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { ErrorState, Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { setUserTimeZone } from "./lib/format";
import BoardPage from "./pages/BoardPage";
import BusinessPage from "./pages/BusinessPage";
import CalendarPage from "./pages/CalendarPage";
import DashboardPage from "./pages/DashboardPage";
import DocumentsPage from "./pages/DocumentsPage";
import GitHubPage from "./pages/GitHubPage";
import HealthPage from "./pages/HealthPage";
import ImportPage from "./pages/ImportPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ProjectsPage from "./pages/ProjectsPage";
import SettingsPage from "./pages/SettingsPage";
import TasksPage from "./pages/TasksPage";
import TimelinePage from "./pages/TimelinePage";

export default function App() {
  const { user, loading, error } = useAuth();
  setUserTimeZone(user?.timezone);
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
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="github" element={<GitHubPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="business" element={<BusinessPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
