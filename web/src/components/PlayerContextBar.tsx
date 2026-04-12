import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";

interface Crumb {
  label: string;
  to?: string;
}

export default function PlayerContextBar() {
  const { orgId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const fromPlayer = searchParams.get("from") === "player";
  const playerSlug = searchParams.get("slug") ?? "";

  const [playerName, setPlayerName] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [sessionIdResolved, setSessionIdResolved] = useState<string | null>(null);
  const [gameName, setGameName] = useState<string | null>(null);

  // Parse current path
  const path = location.pathname;
  const sessionMatch = path.match(/\/sessions\/([^/]+)/);
  const gameMatch = path.match(/\/games\/([^/]+)/);
  const sessionId = sessionMatch?.[1] ?? null;
  const gameId = gameMatch?.[1] ?? null;

  const queryString = `?from=player&slug=${playerSlug}`;

  // Fetch names — always runs (hooks must not be conditional)
  useEffect(() => {
    if (!orgId || !playerSlug || !fromPlayer) {
      setPlayerName(null);
      setSessionLabel(null);
      setGameName(null);
      return;
    }

    (async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgId)
        .single();
      if (!org) return;

      const { data: p } = await supabase
        .from("players")
        .select("display_name")
        .eq("org_id", org.id)
        .eq("slug", playerSlug)
        .maybeSingle();
      if (p) setPlayerName(p.display_name);

      if (sessionId) {
        const { data: s } = await supabase
          .from("sessions")
          .select("label")
          .eq("id", sessionId)
          .maybeSingle();
        if (s) setSessionLabel(s.label);
        setSessionIdResolved(sessionId);
      }

      if (gameId) {
        const { data: g } = await supabase
          .from("games")
          .select("session_name, pbvision_video_id, session_id")
          .eq("id", gameId)
          .maybeSingle();
        if (g) {
          setGameName(g.session_name || g.pbvision_video_id);
          if (g.session_id) {
            setSessionIdResolved(g.session_id);
            if (!sessionId) {
              const { data: s } = await supabase
                .from("sessions")
                .select("label")
                .eq("id", g.session_id)
                .maybeSingle();
              if (s) setSessionLabel(s.label);
            }
          }
        }
      }
    })();
  }, [orgId, playerSlug, fromPlayer, sessionId, gameId]);

  // Don't render if no player context
  if (!fromPlayer || !playerSlug) return null;

  // Build breadcrumbs
  const crumbs: Crumb[] = [];

  crumbs.push({
    label: playerName ?? playerSlug,
    to: `/org/${orgId}/players/${playerSlug}`,
  });

  if (sessionIdResolved || sessionLabel) {
    crumbs.push({
      label: sessionLabel ?? "Session",
      to: sessionIdResolved
        ? `/org/${orgId}/sessions/${sessionIdResolved}${queryString}`
        : undefined,
    });
  }

  if (gameId) {
    crumbs.push({
      label: gameName ?? "Game",
    });
  }

  return (
    <div
      style={{
        padding: "10px 16px",
        background: "#f0f4ff",
        borderBottom: "1px solid #d4dff7",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        marginBottom: 20,
        borderRadius: 8,
      }}
    >
      <span style={{ color: "#1a73e8", fontWeight: 600, marginRight: 4 }}>
        Viewing:
      </span>

      {crumbs.map((crumb, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span style={{ color: "#bbb" }}>›</span>}
          {crumb.to && i < crumbs.length - 1 ? (
            <Link
              to={crumb.to}
              style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 500 }}
            >
              {crumb.label}
            </Link>
          ) : (
            <span style={{ color: "#333", fontWeight: i === 0 ? 600 : 400 }}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}

      <Link
        to={location.pathname}
        style={{
          marginLeft: "auto",
          color: "#999",
          textDecoration: "none",
          fontSize: 11,
          padding: "2px 6px",
          borderRadius: 4,
        }}
        title="Exit player view"
      >
        ✕
      </Link>
    </div>
  );
}
