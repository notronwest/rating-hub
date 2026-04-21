/**
 * Shared header for the Analyze and Coach Review screens. Presents a title
 * (game name + score), a back-link to the game detail page, and a tab toggle
 * that routes between the two screens so the coach always knows which mode
 * they're in and can flip quickly.
 */

import { Link } from "react-router-dom";

type Mode = "analyze" | "review";

interface Props {
  orgId: string;
  gameId: string;
  mode: Mode;
  title: string;
  score?: { team0: number | null; team1: number | null } | null;
  /** Optional right-side slot (e.g. a player picker on the review page) */
  right?: React.ReactNode;
}

export default function GameWorkspaceHeader({
  orgId,
  gameId,
  mode,
  title,
  score,
  right,
}: Props) {
  return (
    <div style={{ marginBottom: 16 }}>
      {/* Back + title row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <Link
          to={`/org/${orgId}/games/${gameId}`}
          style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
        >
          &larr; Game detail
        </Link>
        <span style={{ color: "#ddd" }}>|</span>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: 0,
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </h2>
        {score && score.team0 != null && score.team1 != null && (
          <span style={{ fontSize: 18, fontWeight: 700, color: "#333" }}>
            {score.team0}–{score.team1}
          </span>
        )}
      </div>

      {/* Tab toggle + right slot */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          role="tablist"
          style={{
            display: "inline-flex",
            border: "1px solid #ddd",
            borderRadius: 8,
            overflow: "hidden",
            background: "#fafafa",
          }}
        >
          <Tab
            to={`/org/${orgId}/games/${gameId}/analyze`}
            active={mode === "analyze"}
            icon="🎬"
            label="Analyze"
            sub="Build sequences · flag shots · explore"
          />
          <Tab
            to={`/org/${orgId}/games/${gameId}/coach-review`}
            active={mode === "review"}
            icon="🎓"
            label="Review"
            sub="Diagnose · report card"
          />
        </div>
        <span style={{ flex: 1 }} />
        {right}
      </div>
    </div>
  );
}

function Tab({
  to,
  active,
  icon,
  label,
  sub,
}: {
  to: string;
  active: boolean;
  icon: string;
  label: string;
  sub: string;
}) {
  return (
    <Link
      to={to}
      role="tab"
      aria-selected={active}
      style={{
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        textDecoration: "none",
        background: active ? "#fff" : "transparent",
        color: active ? "#1a73e8" : "#555",
        borderRight: "1px solid #ddd",
        fontFamily: "inherit",
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span>
        <div style={{ fontSize: 13, fontWeight: active ? 700 : 600 }}>{label}</div>
        <div style={{ fontSize: 10, color: "#888", fontWeight: 400 }}>{sub}</div>
      </span>
    </Link>
  );
}
