/**
 * Endpoint for the PBV Grab bookmarklet. The bookmarklet runs on a
 * pb.vision video page, extracts the Mux playback ID and PB Vision
 * video ID, and opens this page in a new tab with:
 *
 *   /pbv-link?pbv=<pbvision_video_id>&mux=<mux_playback_id>
 *
 * We look up the matching game in Supabase, save the playback ID,
 * and redirect to that game's analyze page.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import { setGameMuxPlaybackId } from "../lib/coachApi";

type Status = "loading" | "not-found" | "saved" | "error" | "unauth";

export default function PbvLinkPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [game, setGame] = useState<{
    id: string;
    session_name: string | null;
    org_slug: string;
  } | null>(null);

  const pbv = searchParams.get("pbv") ?? "";
  const mux = searchParams.get("mux") ?? "";

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setStatus("unauth");
      return;
    }
    if (!pbv || !mux) {
      setStatus("error");
      setMessage("Missing required query params (?pbv=... &mux=...).");
      return;
    }

    (async () => {
      // Find the game with this pbvision_video_id
      const { data: gameRows, error } = await supabase
        .from("games")
        .select("id, session_name, organizations!inner(slug)")
        .eq("pbvision_video_id", pbv)
        .limit(1);

      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }
      if (!gameRows || gameRows.length === 0) {
        setStatus("not-found");
        setMessage(`No game imported with PB Vision ID "${pbv}".`);
        return;
      }

      const g = gameRows[0] as unknown as {
        id: string;
        session_name: string | null;
        organizations: { slug: string };
      };
      const found = {
        id: g.id,
        session_name: g.session_name,
        org_slug: g.organizations.slug,
      };
      setGame(found);

      try {
        await setGameMuxPlaybackId(found.id, mux);
        setStatus("saved");
        // Redirect to analyze page after a short delay so the user sees the confirmation
        setTimeout(() => {
          navigate(`/org/${found.org_slug}/games/${found.id}/analyze`, { replace: true });
        }, 1200);
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [authLoading, user, pbv, mux, navigate]);

  return (
    <div
      style={{
        fontFamily: "system-ui",
        maxWidth: 520,
        margin: "80px auto",
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
        PB Vision → Rating Hub
      </h1>

      {status === "loading" && <p style={{ color: "#666" }}>Linking video…</p>}

      {status === "unauth" && (
        <>
          <p style={{ color: "#666", marginBottom: 16 }}>
            You need to be signed in to link a video.
          </p>
          <Link
            to={`/login?next=${encodeURIComponent(`/pbv-link?pbv=${pbv}&mux=${mux}`)}`}
            style={linkBtn}
          >
            Sign in
          </Link>
        </>
      )}

      {status === "saved" && game && (
        <div
          style={{
            padding: 20,
            background: "#e6f4ea",
            borderRadius: 10,
            color: "#1e7e34",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Video linked to {game.session_name || "this game"}
          </div>
          <div style={{ fontSize: 13, color: "#555" }}>
            Opening analyze page…
          </div>
        </div>
      )}

      {status === "not-found" && (
        <div
          style={{
            padding: 20,
            background: "#fff3cd",
            borderRadius: 10,
            color: "#856404",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Game not imported yet</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>{message}</div>
          <div style={{ fontSize: 12, color: "#666" }}>
            Import the game's insights JSON first, then run the bookmarklet again.
          </div>
        </div>
      )}

      {status === "error" && (
        <div
          style={{
            padding: 20,
            background: "#fce8e6",
            borderRadius: 10,
            color: "#c62828",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Error</div>
          <div style={{ fontSize: 13 }}>{message}</div>
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 600,
  background: "#1a73e8",
  color: "#fff",
  borderRadius: 6,
  textDecoration: "none",
};
