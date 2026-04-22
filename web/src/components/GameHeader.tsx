/**
 * Unified workspace header used on Game Stats, Analyze, and Coach Review pages.
 * Shows:
 *   Row 1 — session chip (← to session) and prev/next game arrows
 *   Row 2 — "Game N" title + 4 clickable player chips
 *   Row 3 — three-tab toggle (stats/analyze/review) + review-status chip
 *   Row 4 — optional drill chip (e.g. player focus on Coach Review)
 *
 * Fetches its own dependencies (game, session, siblings, roster, analysis
 * content counts) so pages only pass `gameId` + `mode`.
 */

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";

type Mode = "stats" | "analyze" | "review";

interface Props {
  orgId: string;
  gameId: string;
  mode: Mode;
  /**
   * Optional override for clicking a player chip. Default behavior: navigate
   * to the player's detail page. Review page passes this to drill into the
   * player in-place instead.
   */
  onPlayerClick?: (playerId: string) => void;
  /** Optional drill chip rendered in its own row below the tabs. */
  drill?: React.ReactNode;
}

interface PlayerLite {
  id: string;
  display_name: string;
  slug: string;
  avatar_url: string | null;
  player_index: number;
  team: number;
}

interface SessionLite {
  id: string;
  label: string | null;
  played_date: string;
}

interface SiblingGame {
  id: string;
  played_at: string | null;
}

export default function GameHeader({
  orgId,
  gameId,
  mode,
  onPlayerClick,
  drill,
}: Props) {
  const { user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  // Preserve ?from=player&slug=... in the session chip so going back lands in
  // player-context if that's where the user came from.
  const playerQuery =
    searchParams.get("from") === "player" && searchParams.get("slug")
      ? `?from=player&slug=${searchParams.get("slug")}`
      : "";

  const [session, setSession] = useState<SessionLite | null>(null);
  const [siblings, setSiblings] = useState<SiblingGame[]>([]);
  const [players, setPlayers] = useState<PlayerLite[]>([]);
  const [reviewCount, setReviewCount] = useState<{
    sequences: number;
    flags: number;
    notes: number;
  } | null>(null);

  // Non-auth-gated data: game, session, siblings, players
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    (async () => {
      // Fetch this game to learn session_id
      const { data: g } = await supabase
        .from("games")
        .select("id, session_id")
        .eq("id", gameId)
        .single();
      if (cancelled || !g) return;

      // Session + siblings in parallel
      if (g.session_id) {
        const [sessRes, sibsRes] = await Promise.all([
          supabase
            .from("sessions")
            .select("id, label, played_date")
            .eq("id", g.session_id)
            .single(),
          supabase
            .from("games")
            .select("id, played_at")
            .eq("session_id", g.session_id)
            .order("played_at", { ascending: true }),
        ]);
        if (cancelled) return;
        if (sessRes.data) setSession(sessRes.data);
        setSiblings(sibsRes.data ?? []);
      }

      // Roster
      const { data: gps } = await supabase
        .from("game_players")
        .select("player_index, team, players!inner(id, display_name, slug, avatar_url)")
        .eq("game_id", gameId)
        .order("player_index");
      if (cancelled) return;
      const roster: PlayerLite[] = (gps ?? []).map((gp: unknown) => {
        const row = gp as {
          player_index: number;
          team: number;
          players: {
            id: string;
            display_name: string;
            slug: string;
            avatar_url: string | null;
          };
        };
        return {
          id: row.players.id,
          display_name: row.players.display_name,
          slug: row.players.slug,
          avatar_url: row.players.avatar_url,
          player_index: row.player_index,
          team: row.team,
        };
      });
      setPlayers(roster);
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Review content counts — auth-gated (private analyses require org access)
  useEffect(() => {
    if (authLoading || !user) return;
    if (!gameId) return;
    let cancelled = false;

    (async () => {
      const { data: analyses } = await supabase
        .from("game_analyses")
        .select("id")
        .eq("game_id", gameId);
      if (cancelled || !analyses || analyses.length === 0) {
        setReviewCount({ sequences: 0, flags: 0, notes: 0 });
        return;
      }
      const analysisIds = analyses.map((a) => a.id);
      const [seqRes, flagRes, noteRes] = await Promise.all([
        supabase
          .from("game_analysis_sequences")
          .select("id")
          .in("analysis_id", analysisIds),
        supabase
          .from("analysis_flagged_shots")
          .select("id")
          .in("analysis_id", analysisIds),
        supabase
          .from("game_analysis_notes")
          .select("id")
          .in("analysis_id", analysisIds),
      ]);
      if (cancelled) return;
      setReviewCount({
        sequences: seqRes.data?.length ?? 0,
        flags: flagRes.data?.length ?? 0,
        notes: noteRes.data?.length ?? 0,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId, user, authLoading]);

  // Derived values
  const myIdx = siblings.findIndex((s) => s.id === gameId);
  const gameNumber = myIdx >= 0 ? myIdx + 1 : null;
  const totalGames = siblings.length;
  const prevGameId = myIdx > 0 ? siblings[myIdx - 1].id : null;
  const nextGameId =
    myIdx >= 0 && myIdx < siblings.length - 1 ? siblings[myIdx + 1].id : null;

  const reviewStarted =
    reviewCount != null &&
    reviewCount.sequences + reviewCount.flags + reviewCount.notes > 0;
  const reviewStatusText = reviewStarted
    ? reviewPartsText(reviewCount!)
    : reviewCount == null
    ? null
    : "Review not started";

  const sessionLabel =
    session?.label ||
    (session?.played_date ? formatDate(session.played_date) : "Session");

  const gameHref = (suffix: string) =>
    `/org/${orgId}/games/${gameId}${suffix}${playerQuery}`;

  return (
    <div style={outerStyle}>
      {/* ── Row 1: session chip + prev/next ── */}
      <div style={rowStyle}>
        {session ? (
          <Link
            to={`/org/${orgId}/sessions/${session.id}${playerQuery}`}
            style={sessionChipStyle}
            title="Back to session"
          >
            <span style={{ color: "#999" }}>←</span>
            <span>{sessionLabel}</span>
          </Link>
        ) : (
          <span style={{ fontSize: 12, color: "#999" }}>No session</span>
        )}
        <span style={{ flex: 1 }} />
        {totalGames > 1 && (
          <span style={gameNavStyle}>
            <ArrowBtn
              to={prevGameId ? `/org/${orgId}/games/${prevGameId}${modeSuffix(mode)}${playerQuery}` : null}
              label="‹"
              title="Previous game in session"
            />
            <span style={gameNavPosStyle}>
              Game {gameNumber} of {totalGames}
            </span>
            <ArrowBtn
              to={nextGameId ? `/org/${orgId}/games/${nextGameId}${modeSuffix(mode)}${playerQuery}` : null}
              label="›"
              title="Next game in session"
            />
          </span>
        )}
      </div>

      {/* ── Row 2: title + roster ── */}
      <div style={{ ...rowStyle, marginTop: 8 }}>
        <h2 style={titleStyle}>
          {gameNumber ? `Game ${gameNumber}` : "Game"}
        </h2>
        <span style={{ flex: 1 }} />
        {players.length > 0 && (
          <div style={rosterStyle}>
            {players.map((p) => (
              <PlayerChip
                key={p.id}
                player={p}
                orgId={orgId}
                onClick={onPlayerClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Row 3: tabs + status ── */}
      <div style={{ ...rowStyle, marginTop: 10 }}>
        <div style={tabsWrapStyle} role="tablist">
          <Tab to={gameHref("")} active={mode === "stats"} icon="📊" label="Game Stats" />
          <Tab to={gameHref("/analyze")} active={mode === "analyze"} icon="🎬" label="Analyze" />
          <Tab
            to={gameHref("/coach-review")}
            active={mode === "review"}
            icon="🎓"
            label="Review"
            dot={reviewStarted}
          />
        </div>
        <span style={{ flex: 1 }} />
        {reviewStatusText && (
          <span
            style={{
              ...statusChipStyle,
              ...(reviewStarted ? statusChipActive : statusChipIdle),
            }}
            title={
              reviewStarted
                ? "Coach has started work on this game"
                : "No sequences, flags, or notes yet"
            }
          >
            {reviewStarted ? "• " : ""}
            {reviewStatusText}
          </span>
        )}
      </div>

      {drill && <div style={{ marginTop: 10 }}>{drill}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function PlayerChip({
  player,
  orgId,
  onClick,
}: {
  player: PlayerLite;
  orgId: string;
  onClick?: (playerId: string) => void;
}) {
  const content = (
    <>
      {player.avatar_url ? (
        <img
          src={player.avatar_url}
          alt=""
          style={avatarImgStyle}
        />
      ) : (
        <span style={avatarFallbackStyle}>
          {initialsOf(player.display_name)}
        </span>
      )}
      <span style={playerNameStyle}>{firstNameOf(player.display_name)}</span>
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    padding: "4px 8px",
    borderRadius: 10,
    textDecoration: "none",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    fontFamily: "inherit",
  };

  const hoverIn = (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.background = "#f0f4ff";
  };
  const hoverOut = (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.background = "transparent";
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(player.id)}
        title={player.display_name}
        style={baseStyle}
        onMouseOver={hoverIn}
        onMouseOut={hoverOut}
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      to={`/org/${orgId}/players/${player.slug}`}
      title={player.display_name}
      style={baseStyle}
      onMouseOver={hoverIn}
      onMouseOut={hoverOut}
    >
      {content}
    </Link>
  );
}

function ArrowBtn({
  to,
  label,
  title,
}: {
  to: string | null;
  label: string;
  title: string;
}) {
  const base: React.CSSProperties = {
    width: 26,
    height: 26,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 6,
    fontSize: 14,
    fontFamily: "inherit",
    textDecoration: "none",
  };
  if (!to) {
    return (
      <span
        style={{
          ...base,
          opacity: 0.35,
          color: "#666",
          cursor: "default",
        }}
        aria-disabled="true"
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      to={to}
      title={title}
      style={{ ...base, color: "#666", cursor: "pointer" }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = "#e8f0fe";
        e.currentTarget.style.color = "#1a73e8";
        e.currentTarget.style.borderColor = "#c6dafc";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "#fff";
        e.currentTarget.style.color = "#666";
        e.currentTarget.style.borderColor = "#e2e2e2";
      }}
    >
      {label}
    </Link>
  );
}

function Tab({
  to,
  active,
  icon,
  label,
  dot,
}: {
  to: string;
  active: boolean;
  icon: string;
  label: string;
  dot?: boolean;
}) {
  return (
    <Link
      to={to}
      role="tab"
      aria-selected={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? "#1a73e8" : "#555",
        textDecoration: "none",
        background: active ? "#fff" : "transparent",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
        fontFamily: "inherit",
      }}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      {label}
      {dot && (
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: 3,
            background: "#7c3aed",
          }}
        />
      )}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function modeSuffix(mode: Mode): string {
  return mode === "stats" ? "" : mode === "analyze" ? "/analyze" : "/coach-review";
}

function firstNameOf(name: string): string {
  return name.split(" ")[0] ?? name;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function reviewPartsText(c: {
  sequences: number;
  flags: number;
  notes: number;
}): string {
  const parts: string[] = [];
  if (c.sequences > 0)
    parts.push(`${c.sequences} ${c.sequences === 1 ? "sequence" : "sequences"}`);
  if (c.flags > 0) parts.push(`${c.flags} ${c.flags === 1 ? "flag" : "flags"}`);
  if (c.notes > 0) parts.push(`${c.notes} ${c.notes === 1 ? "note" : "notes"}`);
  return parts.join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const outerStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e2e2",
  borderRadius: 12,
  padding: "14px 18px 12px",
  marginBottom: 18,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const sessionChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 12px",
  background: "#f7f7f8",
  border: "1px solid #e2e2e2",
  borderRadius: 999,
  color: "#333",
  fontSize: 12,
  fontWeight: 500,
  textDecoration: "none",
};

const gameNavStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "#666",
};

const gameNavPosStyle: React.CSSProperties = {
  padding: "0 6px",
  fontWeight: 600,
  color: "#333",
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: 0,
  color: "#333",
};

const rosterStyle: React.CSSProperties = {
  display: "inline-flex",
  gap: 6,
  flexWrap: "wrap",
};

const avatarImgStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  objectFit: "cover",
  border: "2px solid #fff",
  boxShadow: "0 0 0 1px #e2e2e2",
};

const avatarFallbackStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "50%",
  background: "#8899a6",
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  border: "2px solid #fff",
  boxShadow: "0 0 0 1px #e2e2e2",
};

const playerNameStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#1a73e8",
  fontWeight: 600,
};

const tabsWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  gap: 4,
  padding: 4,
  background: "#f7f7f8",
  borderRadius: 10,
};

const statusChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
};

const statusChipActive: React.CSSProperties = {
  background: "#7c3aed12",
  color: "#7c3aed",
};

const statusChipIdle: React.CSSProperties = {
  background: "#f7f7f8",
  color: "#666",
  border: "1px dashed #ccc",
};
