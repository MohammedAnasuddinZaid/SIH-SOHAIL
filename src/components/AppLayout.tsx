import { lazy, Suspense, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { branding } from "../config/branding";
import { useAuthStore } from "../stores/authStore";
import { useNotifStore, useUnreadCount } from "../stores/notificationStore";
import { AvatarIcon } from "./Primitives";
import { ThemeToggle } from "./ThemeToggle";
import { Icon, type IconName } from "./Icons";
import { syncPlayerToDirectory } from "../core/social/directorySync";
import "./layout.css";

const ArenaBackground = lazy(() => import("./ArenaBackground").then((m) => ({ default: m.ArenaBackground })));

interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
}

const NAV_SECTIONS: Array<{ heading?: string; entry?: NavEntry }> = [
  { heading: "Train" },
  { entry: { to: "/", label: "Home", icon: "home" } },
  { entry: { to: "/train", label: "Train", icon: "dumbbell" } },
  { entry: { to: "/battle", label: "Battle", icon: "zap" } },
  { heading: "Compete" },
  { entry: { to: "/leaderboard", label: "Ranks", icon: "trophy" } },
  { entry: { to: "/social", label: "Friends", icon: "users" } },
  { heading: "Guide" },
  { entry: { to: "/coach", label: "Coach", icon: "chat" } },
  { entry: { to: "/auth", label: "Your code", icon: "shield" } },
];

const MOBILE_NAV: NavEntry[] = [
  { to: "/", icon: "home", label: "Home" },
  { to: "/train", icon: "dumbbell", label: "Train" },
  { to: "/battle", icon: "zap", label: "Battle" },
  { to: "/coach", icon: "chat", label: "Coach" },
  { to: "/social", icon: "users", label: "Friends" },
];

function PageTitle() {
  const { pathname } = useLocation();
  const title =
    pathname === "/"
      ? "Home"
      : pathname.startsWith("/train")
        ? "Train"
        : pathname.startsWith("/workout")
          ? "Live Workout"
          : pathname.startsWith("/battle")
            ? "Battle Arena"
            : pathname.startsWith("/leaderboard")
              ? "Rankings"
              : pathname.startsWith("/coach")
                ? "AI Coach"
                : pathname.startsWith("/social")
                  ? "Friends"
                  : pathname.startsWith("/profile")
                    ? "Profile"
                    : pathname.startsWith("/settings")
                      ? "Settings"
                      : pathname.startsWith("/privacy") || pathname.startsWith("/terms")
                        ? "Legal"
                        : "ZELUX";
  return <span className="topbar__title">{title}</span>;
}

export function AppLayout() {
  const player = useAuthStore((s) => s.player);
  const unread = useUnreadCount();
  const subscribe = useNotifStore((s) => s.subscribe);
  const refresh = useAuthStore((s) => s.refreshProfile);
  const playerId = player?.playerId;

  useEffect(() => {
    if (!playerId) return;
    const unsub = subscribe(playerId);
    void refresh();
    void syncPlayerToDirectory(playerId);
    return unsub;
  }, [playerId, subscribe, refresh]);

  return (
    <>
      <Suspense fallback={null}>
        <ArenaBackground />
      </Suspense>
      <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <img src={branding.APP_LOGO} alt="" />
          <strong>
            <span className="grad-text">{branding.APP_NAME}</span>
          </strong>
        </div>
        {NAV_SECTIONS.map((s, i) =>
          s.heading ? (
            <div key={`h-${i}`} className="nav-section">
              {s.heading}
            </div>
          ) : (
            <NavLink key={s.entry!.to} to={s.entry!.to} end={s.entry!.to === "/"} className={({ isActive }) => `nav-item ${isActive ? "is-active" : ""}`}>
              <span aria-hidden>
                <Icon name={s.entry!.icon} size={18} />
              </span>
              <span>{s.entry!.label}</span>
              {s.entry!.to === "/social" && unread > 0 ? <span className="badge badge--brand nav-badge">{unread}</span> : null}
            </NavLink>
          ),
        )}
        <div style={{ flex: 1 }} />
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "is-active" : ""}`}>
          <span aria-hidden>
            <Icon name="settings" size={18} />
          </span>
          <span>Settings</span>
        </NavLink>
      </aside>

      <div className="layout__main">
        <header className="topbar">
          <PageTitle />
          <div className="topbar__spacer" />
          <ThemeToggle />
          {player ? (
            <NavLink to="/profile" className="topbar__user">
              <AvatarIcon name={player.username} size="sm" />
              <span>{player.username}</span>
            </NavLink>
          ) : null}
        </header>
        <main className="content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>
            {branding.APP_NAME} v{branding.APP_VERSION}
          </span>
          <nav>
            <NavLink to="/privacy">Privacy Policy</NavLink>
            <NavLink to="/terms">Terms &amp; Conditions</NavLink>
          </nav>
        </footer>
      </div>

      <nav className="bottom-nav">
          {MOBILE_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "is-active" : "")}>
              <span aria-hidden>
                <Icon name={n.icon} size={18} />
              </span>
              <span>{n.label}</span>
            </NavLink>
          ))}
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "is-active" : "")}>
            <span aria-hidden>
              <Icon name="settings" size={18} />
            </span>
            <span>Set</span>
          </NavLink>
        </nav>
    </div>
    </>
  );
}