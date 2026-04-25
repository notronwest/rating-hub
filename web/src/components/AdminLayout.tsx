import { NavLink, Outlet, useParams } from "react-router-dom";
import PlayerContextBar from "./PlayerContextBar";
import { useAuth } from "../auth/AuthProvider";
import { useIsCoach } from "../auth/useOrgRole";

// `import` link was dropped from the nav — the PB Vision webhook +
// session-manager push handles ingestion automatically now. The route
// itself stays in App.tsx so any bookmarked links still work.
const BASE_NAV = [
  { to: "players", label: "Players" },
  { to: "sessions", label: "Sessions" },
];

export default function AdminLayout() {
  const { orgId } = useParams();
  const { user, signOut } = useAuth();
  const isCoach = useIsCoach(orgId);

  // Coach-only additions: the Coach dashboard + Email history (the
  // latter exposes player email addresses + delivery log, so org-
  // member-only is the right scope even though the RLS policy would
  // also allow it).
  const navItems = isCoach
    ? [...BASE_NAV, { to: "coach", label: "Coach" }, { to: "emails", label: "Emails" }]
    : BASE_NAV;

  return (
    <div
      className="admin-layout"
      style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui" }}
    >
      {/* Global print styles — hide the nav chrome so `window.print()` on
          any nested page (rating reports, game report, etc.) produces a
          clean PDF without the sidebar or player-context bar bleeding in.
          Each report page layers its own @media print rules on top. */}
      <style>{`
        @media print {
          .admin-sidebar, .admin-context-bar { display: none !important; }
          .admin-main { padding: 0 !important; overflow: visible !important; }
          .admin-layout { min-height: 0 !important; display: block !important; }
        }
      `}</style>
      {/* Sidebar */}
      <nav
        className="admin-sidebar"
        style={{
          width: 220,
          borderRight: "1px solid #e2e2e2",
          background: "#fafafa",
          padding: "20px 0",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "0 20px 16px",
            borderBottom: "1px solid #e2e2e2",
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#999", letterSpacing: 1 }}>
            Organization
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
            {orgId?.toUpperCase()}
          </div>
        </div>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={`/org/${orgId}/${item.to}`}
            style={({ isActive }) => ({
              display: "block",
              padding: "10px 20px",
              textDecoration: "none",
              color: isActive ? "#1a73e8" : "#333",
              background: isActive ? "#e8f0fe" : "transparent",
              fontWeight: isActive ? 600 : 400,
              fontSize: 14,
              borderLeft: isActive ? "3px solid #1a73e8" : "3px solid transparent",
            })}
          >
            {item.label}
            {item.to === "coach" && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 9,
                  padding: "2px 5px",
                  background: "#1a73e8",
                  color: "#fff",
                  borderRadius: 3,
                  verticalAlign: "middle",
                  letterSpacing: 0.5,
                }}
              >
                NEW
              </span>
            )}
          </NavLink>
        ))}

        <div style={{ flex: 1 }} />

        {/* User + sign out */}
        {user ? (
          <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e2e2" }}>
            <div style={{ fontSize: 11, color: "#999", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Signed in as
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#333",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                marginBottom: 6,
              }}
              title={user.email ?? ""}
            >
              {user.email}
              {isCoach && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    padding: "1px 5px",
                    background: "#e8f0fe",
                    color: "#1a73e8",
                    borderRadius: 3,
                    fontWeight: 600,
                  }}
                >
                  COACH
                </span>
              )}
            </div>
            <button
              onClick={signOut}
              style={{
                fontSize: 11,
                color: "#888",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e2e2" }}>
            <NavLink
              to="/login"
              style={{ fontSize: 12, color: "#1a73e8", textDecoration: "none" }}
            >
              Sign in
            </NavLink>
          </div>
        )}

        <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e2e2" }}>
          <NavLink
            to="/"
            style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
          >
            &larr; Switch org
          </NavLink>
        </div>
      </nav>

      {/* Main content */}
      <main
        className="admin-main"
        style={{ flex: 1, padding: 24, overflow: "auto" }}
      >
        <div className="admin-context-bar">
          <PlayerContextBar />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
