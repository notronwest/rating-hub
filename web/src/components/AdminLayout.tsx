import { NavLink, Outlet, useParams } from "react-router-dom";
import PlayerContextBar from "./PlayerContextBar";

const NAV_ITEMS = [
  { to: "players", label: "Players" },
  { to: "sessions", label: "Sessions" },
  { to: "import", label: "Import" },
];

export default function AdminLayout() {
  const { orgId } = useParams();

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui" }}>
      {/* Sidebar */}
      <nav
        style={{
          width: 220,
          borderRight: "1px solid #e2e2e2",
          background: "#fafafa",
          padding: "20px 0",
          flexShrink: 0,
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

        {NAV_ITEMS.map((item) => (
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
          </NavLink>
        ))}

        <div style={{ padding: "16px 20px 0", borderTop: "1px solid #e2e2e2", marginTop: 16 }}>
          <NavLink
            to="/"
            style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
          >
            &larr; Switch org
          </NavLink>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
        <PlayerContextBar />
        <Outlet />
      </main>
    </div>
  );
}
