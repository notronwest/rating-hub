import { Route, Routes } from "react-router-dom";
import OrgPickerPage from "./pages/OrgPickerPage";
import AdminLayout from "./components/AdminLayout";
import PlayerListPage from "./pages/PlayerListPage";
import PlayerDetailPage from "./pages/PlayerDetailPage";
import SessionListPage from "./pages/SessionListPage";
import SessionDetailPage from "./pages/SessionDetailPage";
import GameDetailPage from "./pages/GameDetailPage";
import ImportPage from "./pages/ImportPage";
import LoginPage from "./pages/LoginPage";
import AnalyzePage from "./pages/AnalyzePage";
import CoachReviewPage from "./pages/CoachReviewPage";
import CoachDashboardPage from "./pages/CoachDashboardPage";
import PbvLinkPage from "./pages/PbvLinkPage";
import RequireCoach from "./auth/RequireCoach";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<OrgPickerPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pbv-link" element={<PbvLinkPage />} />

      {/* Org-scoped pages with shared layout */}
      <Route path="/org/:orgId" element={<AdminLayout />}>
        <Route index element={<PlayerListPage />} />
        <Route path="players" element={<PlayerListPage />} />
        <Route path="players/:slug" element={<PlayerDetailPage />} />
        <Route path="sessions" element={<SessionListPage />} />
        <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="games/:gameId" element={<GameDetailPage />} />
        <Route path="import" element={<ImportPage />} />

        {/* Coach-only pages */}
        <Route element={<RequireCoach />}>
          <Route path="coach" element={<CoachDashboardPage />} />
          <Route path="games/:gameId/analyze" element={<AnalyzePage />} />
          <Route path="games/:gameId/coach-review" element={<CoachReviewPage />} />
        </Route>
      </Route>

      <Route path="*" element={<div style={{ padding: 16 }}>Not found</div>} />
    </Routes>
  );
}
