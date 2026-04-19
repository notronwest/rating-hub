import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { useIsCoach } from "./useOrgRole";

export default function RequireCoach() {
  const { user, loading } = useAuth();
  const { orgId } = useParams();
  const isCoach = useIsCoach(orgId);
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", color: "#666" }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (!isCoach) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Access denied</h2>
        <p style={{ color: "#666", fontSize: 14 }}>
          You need a coach role in this organization to access this page.
          Contact an administrator.
        </p>
      </div>
    );
  }

  return <Outlet />;
}
