import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { useAuthStore, usePlayerId } from "./stores/authStore";
import { useNotifStore } from "./stores/notificationStore";
import { AppLayout } from "./components/AppLayout";
import { ToastViewport } from "./components/ToastViewport";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { TrainPage } from "./pages/TrainPage";
import { WorkoutPage } from "./pages/WorkoutPage";
import { BattlePage } from "./pages/BattlePage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { CoachPage } from "./pages/CoachPage";
import { SocialPage } from "./pages/SocialPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { Skeleton } from "./components/Primitives";

function BootGate({ children }: { children: ReactNode }) {
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  if (!bootstrapped) {
    return (
      <div className="stack" style={{ maxWidth: 480, margin: "10vh auto", padding: "0 16px" }}>
        <Skeleton height={40} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </div>
    );
  }
  return <>{children}</>;
}

function AuthRedirect({ children }: { children: ReactNode }) {
  const player = useAuthStore((s) => s.player);
  const location = useLocation();
  if (!player) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const playerId = usePlayerId();
  const loadNotifs = useNotifStore((s) => s.load);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (playerId) void loadNotifs(playerId);
  }, [playerId, loadNotifs]);

  return (
    <BrowserRouter>
      <BootGate>
        <ToastViewport />
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route
            element={
              <AuthRedirect>
                <AppLayout />
              </AuthRedirect>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/train" element={<TrainPage />} />
            <Route path="/workout" element={<WorkoutPage />} />
            <Route path="/battle" element={<BattlePage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/coach" element={<CoachPage />} />
            <Route path="/social" element={<SocialPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BootGate>
    </BrowserRouter>
  );
}