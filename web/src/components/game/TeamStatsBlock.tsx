/**
 * Team-level stats panel for the Game Detail page.
 *
 * Three sections, all using a shared "mirrored player rows on a 0-100% scale"
 * layout for the per-player stats that a coach might add to Stat Review:
 *
 *   1. Kitchen Arrival — serving-side % + returning-side % per player.
 *      Reviewable. Plus a Team-percentage-to-the-kitchen footer (display only).
 *   2. Shot Distribution & Positioning — per-player share-of-partner-pair
 *      shots (reviewable), plus existing Left-side and Speedups team-split
 *      rows (display only).
 *   3. Rallies Won — per-player rally win rate (reviewable), plus the
 *      existing Rallies-Won-by-length team breakdown (display only).
 *
 * The "+ Add to review" affordance is rendered next to each reviewable row
 * for coaches; the click handler is a placeholder (console.log) until the
 * Stat Review backend lands. Non-coaches don't see the button at all.
 */

import { useEffect, useState } from "react";
import type { GamePlayer, GamePlayerShotType, Rally } from "../../types/database";
import { useIsCoach } from "../../auth/useOrgRole";
import { useAuth } from "../../auth/AuthProvider";
import {
  classifyPct,
  PERF_TIERS,
  type PerfTierSpec,
} from "../../lib/playerRatingReport";
import {
  addStatReview,
  getOrCreateAnalysis,
  listStatReviews,
  removeStatReview,
} from "../../lib/coachApi";

interface PlayerLite {
  id: string;
  player_index: number;
  display_name: string;
  team: number;
  avatar_url: string | null;
}

interface Props {
  players: PlayerLite[];
  gamePlayers: GamePlayer[];
  shotTypes: GamePlayerShotType[];
  rallies: Pick<Rally, "shot_count" | "winning_team">[];
  team0KitchenPct: number | null;
  team1KitchenPct: number | null;
  /** Org slug — used to gate the coach-only "+ Add to review" buttons. */
  orgSlug?: string;
  /** Game id and org uuid — needed to look up / create the game's
   *  analysis row when a coach adds a stat to review. */
  gameId?: string;
  orgUuid?: string;
}

const TEAM0 = "#1a73e8";
const TEAM1 = "#f59e0b";

/** Tier for "bigger is better" stats (Kitchen Arrival, Rallies Won) — uses
 *  the shared 4-tier scale from playerRatingReport.classifyPct. Falls back
 *  to a neutral grey when the value is missing. */
function tierBigIsBetter(pct: number): PerfTierSpec {
  return classifyPct(pct) ?? PERF_TIERS.needs_work;
}

/** Tier for Shot Distribution — distance from 50% mapped onto the same
 *  4-tier scale, so the colors stay consistent with the rest of the page.
 *
 *   |dist| ≤ 5  → Great   (45–55%, very balanced)
 *   |dist| ≤ 10 → Good    (40–60%, healthy split)
 *   |dist| ≤ 20 → OK      (30–70%, leaning)
 *   else        → Needs work (extreme: hogging or isolated) */
function tierBalance(pct: number): PerfTierSpec {
  const dist = Math.abs(pct - 50);
  if (dist <= 5) return PERF_TIERS.great;
  if (dist <= 10) return PERF_TIERS.good;
  if (dist <= 20) return PERF_TIERS.ok;
  return PERF_TIERS.needs_work;
}

/** Tier for zero-sum team stats (Rallies Won, by length, etc.) — these
 *  total 100% across the two teams, so 50% is par and 51% is already an
 *  advantage. Breakpoints are centered on 50% rather than the standard
 *  "bigger is better" curve.
 *
 *   ≥ 65 → Great        (decisive win)
 *   50–64 → Good         (advantage)
 *   35–49 → OK           (close loss, recoverable)
 *   < 35 → Needs work   (clearly losing) */
function tierZeroSum(pct: number): PerfTierSpec {
  if (pct >= 65) return PERF_TIERS.great;
  if (pct >= 50) return PERF_TIERS.good;
  if (pct >= 35) return PERF_TIERS.ok;
  return PERF_TIERS.needs_work;
}

export default function TeamStatsBlock({
  players,
  gamePlayers,
  shotTypes,
  rallies,
  team0KitchenPct,
  team1KitchenPct,
  orgSlug,
  gameId,
  orgUuid,
}: Props) {
  const isCoach = useIsCoach(orgSlug);
  const { user } = useAuth();

  // Lazily resolve the game's analysis on first add-click. We don't
  // need the analysis up-front, but loading the existing stat reviews
  // does require it — so we kick off resolution as soon as we know the
  // user is a coach for this game.
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  /** Set of "playerId|statKey" strings — flips the button to "✓ Added". */
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isCoach || !gameId || !orgUuid || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const analysis = await getOrCreateAnalysis(gameId, orgUuid, user.id);
        if (cancelled) return;
        setAnalysisId(analysis.id);
        const rows = await listStatReviews(analysis.id);
        if (cancelled) return;
        setAdded(new Set(rows.map((r) => `${r.player_id}|${r.stat_key}`)));
      } catch (e) {
        console.error("Failed to load stat reviews:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCoach, gameId, orgUuid, user]);

  async function toggleStatReview(playerId: string, statKey: string) {
    if (!analysisId) return;
    const key = `${playerId}|${statKey}`;
    const isAdded = added.has(key);
    // Optimistically flip the UI so the click feels instant.
    setAdded((prev) => {
      const next = new Set(prev);
      if (isAdded) next.delete(key);
      else next.add(key);
      return next;
    });
    try {
      if (isAdded) {
        await removeStatReview({ analysisId, playerId, statKey });
      } else {
        await addStatReview({ analysisId, playerId, statKey });
      }
    } catch (e) {
      // Roll back on failure.
      console.error("Stat review toggle failed:", e);
      setAdded((prev) => {
        const next = new Set(prev);
        if (isAdded) next.add(key);
        else next.delete(key);
        return next;
      });
    }
  }

  // Sort players by index for consistent ordering
  const sortedPlayers = [...players].sort(
    (a, b) => a.player_index - b.player_index,
  );
  const team0Players = sortedPlayers.filter((p) => p.team === 0);
  const team1Players = sortedPlayers.filter((p) => p.team === 1);

  const getGP = (playerId: string) =>
    gamePlayers.find((gp) => gp.player_id === playerId);

  // ── Kitchen arrival: serving-side and returning-side % per player ──
  function kitchenFor(playerId: string, side: "serving" | "returning"): {
    pct: number;
    denom: string | null;
  } {
    const gp = getGP(playerId);
    const pct = (() => {
      const summary = gp?.kitchen_arrivals_summary as
        | { serving_side?: number; receiving_side?: number }
        | null;
      const raw = side === "serving" ? summary?.serving_side : summary?.receiving_side;
      return raw != null ? Math.round(raw * 100) : 0;
    })();
    // Prefer the precise numerator/denominator from kitchen_arrival_pct when
    // present — gives us the "8/17" suffix that matches PB Vision's display.
    const ka = gp?.kitchen_arrival_pct;
    const f = side === "serving" ? ka?.serving?.oneself : ka?.returning?.oneself;
    const denom = f && f.denominator > 0 ? `${f.numerator}/${f.denominator}` : null;
    return { pct, denom };
  }

  // ── Shot Distribution (per-player share of partner-pair) ──
  function shotShare(player: PlayerLite): { pct: number; shots: number } {
    const gp = getGP(player.id);
    const shots = gp?.shot_count ?? 0;
    const pair = player.team === 0 ? team0Players : team1Players;
    const teamTotal = pair.reduce((s, p) => s + (getGP(p.id)?.shot_count ?? 0), 0);
    const pct = teamTotal > 0 ? Math.round((shots / teamTotal) * 100) : 0;
    return { pct, shots };
  }

  // ── Shots and Speedups: existing team-vs-team SplitBarRow data ──
  const team0Shots = team0Players.reduce(
    (s, p) => s + (getGP(p.id)?.shot_count ?? 0),
    0,
  );
  const team1Shots = team1Players.reduce(
    (s, p) => s + (getGP(p.id)?.shot_count ?? 0),
    0,
  );
  const totalShots = Math.max(1, team0Shots + team1Shots);

  function teamPlayerSplit(
    team: 0 | 1,
    field: "shot_count" | "left_side_percentage",
  ) {
    const ps = team === 0 ? team0Players : team1Players;
    const vals = ps.map((p) => {
      const gp = getGP(p.id);
      if (!gp) return 0;
      if (field === "shot_count") return gp.shot_count ?? 0;
      return gp.left_side_percentage ?? 0;
    });
    const sum = Math.max(1, vals.reduce((a, b) => a + b, 0));
    return vals.map((v) => Math.round((v / sum) * 100));
  }

  const speedupCount = (playerId: string) =>
    shotTypes.find(
      (st) => st.player_id === playerId && st.shot_type === "speedups",
    )?.count ?? 0;
  const team0Speedups = team0Players.reduce(
    (s, p) => s + speedupCount(p.id),
    0,
  );
  const team1Speedups = team1Players.reduce(
    (s, p) => s + speedupCount(p.id),
    0,
  );
  const totalSpeedups = Math.max(1, team0Speedups + team1Speedups);

  // ── Rallies Won ──
  function rallyWinFor(playerId: string): {
    pct: number;
    won: number;
    total: number;
  } {
    const gp = getGP(playerId);
    const total = gp?.num_rallies ?? 0;
    const won = gp?.num_rallies_won ?? 0;
    const pct = total > 0 ? Math.round((won / total) * 100) : 0;
    return { pct, won, total };
  }

  const ralliesByBucket = { short: 0, medium: 0, long: 0 };
  const ralliesWonByBucket = { short: [0, 0], medium: [0, 0], long: [0, 0] };
  for (const r of rallies) {
    const n = r.shot_count ?? 0;
    const bucket: "short" | "medium" | "long" =
      n <= 5 ? "short" : n <= 10 ? "medium" : "long";
    ralliesByBucket[bucket] += 1;
    if (r.winning_team === 0 || r.winning_team === 1) {
      ralliesWonByBucket[bucket][r.winning_team] += 1;
    }
  }

  const renderReviewableRow = (
    player: PlayerLite,
    pct: number,
    tier: PerfTierSpec,
    suffix: string | null,
    statKey: string,
    /** Override the fill color (e.g. team-based stats use team color
     *  instead of tier color). */
    fillColor?: string,
  ) => (
    <ReviewableRow
      key={player.id + statKey}
      player={player}
      pct={pct}
      tier={tier}
      fillColor={fillColor}
      suffix={suffix}
      isCoach={isCoach}
      isAdded={added.has(`${player.id}|${statKey}`)}
      canToggle={analysisId != null}
      onToggle={() => toggleStatReview(player.id, statKey)}
    />
  );

  const teamColor = (team: number) => (team === 0 ? TEAM0 : TEAM1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Kitchen Arrival ── */}
      <div style={sectionStyle}>
        <SectionHeader title="Kitchen Arrival" />
        <SubGroup label="When on Serving Team">
          {sortedPlayers.map((p) => {
            const { pct, denom } = kitchenFor(p.id, "serving");
            return renderReviewableRow(
              p,
              pct,
              tierBigIsBetter(pct),
              denom,
              "stat.kitchen_arrival.serving",
            );
          })}
        </SubGroup>
        <SubGroup label="When on Returning Team">
          {sortedPlayers.map((p) => {
            const { pct, denom } = kitchenFor(p.id, "returning");
            return renderReviewableRow(
              p,
              pct,
              tierBigIsBetter(pct),
              denom,
              "stat.kitchen_arrival.returning",
            );
          })}
        </SubGroup>
        {(team0KitchenPct != null || team1KitchenPct != null) && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}>
            <div style={subHeaderStyle}>Team percentage to the kitchen</div>
            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              <TeamBarCell
                pct={team0KitchenPct != null ? Math.round(team0KitchenPct * 100) : 0}
                color={TEAM0}
                align="right"
              />
              <TeamBarCell
                pct={team1KitchenPct != null ? Math.round(team1KitchenPct * 100) : 0}
                color={TEAM1}
                align="left"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Shot Distribution ── */}
      <div style={sectionStyle}>
        <SectionHeader title="Shot Distribution & Positioning" />
        <SubGroup label="Share of partner-pair's shots">
          {sortedPlayers.map((p) => {
            const { pct, shots } = shotShare(p);
            return renderReviewableRow(
              p,
              pct,
              tierBalance(pct),
              `${shots} shots`,
              "stat.shot_share",
            );
          })}
        </SubGroup>
        {/* tierBalance keeps the 4-color palette but maps it to distance-from-50% */}

        {/* Existing team-split bars — kept as additional context, not reviewable */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}>
          <SplitBarRow
            label="Total team shots"
            leftLabel={`${Math.round((team0Shots / totalShots) * 100)}%`}
            rightLabel={`${Math.round((team1Shots / totalShots) * 100)}%`}
            team0Split={teamPlayerSplit(0, "shot_count")}
            team1Split={teamPlayerSplit(1, "shot_count")}
            team0Players={team0Players}
            team1Players={team1Players}
          />
          <SplitBarRow
            label="Left side"
            leftLabel=""
            rightLabel=""
            team0Split={teamPlayerSplit(0, "left_side_percentage")}
            team1Split={teamPlayerSplit(1, "left_side_percentage")}
            team0Players={team0Players}
            team1Players={team1Players}
          />
          {totalSpeedups > 1 && (
            <SplitBarRow
              label="Speedups"
              leftLabel={`${Math.round((team0Speedups / totalSpeedups) * 100)}%`}
              rightLabel={`${Math.round((team1Speedups / totalSpeedups) * 100)}%`}
              team0Split={team0Players.map((p) => speedupCount(p.id))}
              team1Split={team1Players.map((p) => speedupCount(p.id))}
              team0Players={team0Players}
              team1Players={team1Players}
            />
          )}
        </div>
      </div>

      {/* ── Rallies Won ── */}
      {rallies.length > 0 && (
        <div style={sectionStyle}>
          <SectionHeader title="Rallies Won" />
          <SubGroup label="Rally win rate when on court">
            {sortedPlayers.map((p) => {
              const { pct, won, total } = rallyWinFor(p.id);
              return renderReviewableRow(
                p,
                pct,
                tierZeroSum(pct),
                total > 0 ? `${won}/${total}` : null,
                "stat.rally_win",
                teamColor(p.team),
              );
            })}
          </SubGroup>

          {(["short", "medium", "long"] as const).map((bucket) => {
            const total = ralliesByBucket[bucket];
            if (total === 0) return null;
            const range =
              bucket === "short" ? "1–5 shots" : bucket === "medium" ? "6–10 shots" : "11+ shots";
            const labelName = bucket.charAt(0).toUpperCase() + bucket.slice(1);
            const wonByTeam = ralliesWonByBucket[bucket];
            return (
              <div
                key={bucket}
                style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}
              >
                <div style={{ ...subHeaderStyle, marginBottom: 8 }}>
                  {labelName} rallies
                  <span
                    style={{
                      fontWeight: 400,
                      textTransform: "none",
                      letterSpacing: 0,
                      color: "#999",
                      marginLeft: 8,
                    }}
                  >
                    {range} · {total} total
                  </span>
                </div>
                {sortedPlayers.map((p) => {
                  const won = wonByTeam[p.team] ?? 0;
                  const pct = total > 0 ? Math.round((won / total) * 100) : 0;
                  return renderReviewableRow(
                    p,
                    pct,
                    tierZeroSum(pct),
                    `${won}/${total}`,
                    `stat.rally_win.${bucket}`,
                    teamColor(p.team),
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable per-player Option-2 row — used by all three reviewable stats.
// ─────────────────────────────────────────────────────────────────────────────

function ReviewableRow({
  player,
  pct,
  tier,
  fillColor,
  suffix,
  isCoach,
  isAdded,
  canToggle,
  onToggle,
}: {
  player: PlayerLite;
  pct: number;
  tier: PerfTierSpec;
  /** Optional fill override — when set (e.g. team-color for zero-sum
   *  stats), it replaces the tier color on the bar. */
  fillColor?: string;
  suffix: string | null;
  isCoach: boolean;
  isAdded: boolean;
  canToggle: boolean;
  onToggle: () => void;
}) {
  const fill = fillColor ?? tier.color;
  // The "OK" tier (amber #d97706) reads dark against fill, but the Great
  // and Good tiers contrast better with white. needs_work is red and also
  // looks fine with white text. Team-color overrides always use white text.
  const onFill = fillColor != null ? "#fff" : tier.tier === "ok" ? "#5b4400" : "#fff";
  return (
    <div
      className="stat-row"
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr 110px",
        gap: 10,
        alignItems: "center",
        padding: "5px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          minWidth: 0,
        }}
      >
        <PlayerAvatar player={player} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {player.display_name.split(" ")[0]}
        </span>
      </div>

      <div
        style={{
          position: "relative",
          height: 22,
          background: "#f1f3f5",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {/* center 50% tick — reference line for the eye */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 2,
            bottom: 2,
            width: 1,
            background: "rgba(0,0,0,0.08)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(2, pct)}%`,
            background: fill,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "0 8px",
            color: onFill,
            fontSize: 11,
            fontWeight: 700,
            gap: 4,
          }}
        >
          <span>{pct}%</span>
          {suffix && (
            <span style={{ fontWeight: 500, fontSize: 10, opacity: 0.85 }}>
              {suffix}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {isCoach && (
          <AddToReviewButton
            isAdded={isAdded}
            disabled={!canToggle}
            onClick={onToggle}
          />
        )}
      </div>
    </div>
  );
}

function AddToReviewButton({
  isAdded,
  disabled,
  onClick,
}: {
  isAdded: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        isAdded
          ? "Click to remove this stat from the Stat Review"
          : "Add this stat to the player's Stat Review"
      }
      style={{
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 600,
        background: isAdded ? "#e6f4ea" : "#fff",
        color: isAdded ? "#1e7e34" : "#1a73e8",
        border: isAdded ? "1px solid #b7e1c4" : "1px dashed #c6dafc",
        borderRadius: 4,
        cursor: disabled ? "wait" : "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {isAdded ? "✓ Added" : "+ Add to review"}
    </button>
  );
}

function PlayerAvatar({ player }: { player: PlayerLite }) {
  const teamColor = player.team === 0 ? TEAM0 : TEAM1;
  if (player.avatar_url) {
    return (
      <img
        src={player.avatar_url}
        alt={player.display_name}
        title={player.display_name}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      title={player.display_name}
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: teamColor,
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {player.display_name[0]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: "#333",
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: "1px solid #eee",
      }}
    >
      {title}
    </div>
  );
}

function SubGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...subHeaderStyle, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-existing helpers — unchanged display-only stats
// ─────────────────────────────────────────────────────────────────────────────

function SplitBarRow({
  label,
  leftLabel,
  rightLabel,
  team0Split,
  team1Split,
  team0Players,
  team1Players,
}: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  team0Split: number[];
  team1Split: number[];
  team0Players: PlayerLite[];
  team1Players: PlayerLite[];
}) {
  const team0Total = Math.max(0, team0Split.reduce((a, b) => a + b, 0));
  const team1Total = Math.max(0, team1Split.reduce((a, b) => a + b, 0));
  const grandTotal = Math.max(1, team0Total + team1Total);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 4, height: 24 }}>
        <div
          style={{
            flex: team0Total / grandTotal || 0.01,
            display: "flex",
            gap: 1,
            overflow: "hidden",
            borderRadius: "4px 0 0 4px",
          }}
        >
          {team0Split.map((v, i) => (
            <SegmentBar
              key={i}
              weight={v}
              color={i === 0 ? TEAM0 : "#60a5fa"}
              label={i === 0 && leftLabel ? leftLabel : ""}
              align="left"
              player={team0Players[i]}
            />
          ))}
        </div>
        <div
          style={{
            flex: team1Total / grandTotal || 0.01,
            display: "flex",
            gap: 1,
            overflow: "hidden",
            borderRadius: "0 4px 4px 0",
          }}
        >
          {team1Split.map((v, i) => (
            <SegmentBar
              key={i}
              weight={v}
              color={i === 0 ? TEAM1 : "#ef5350"}
              label={i === team1Split.length - 1 && rightLabel ? rightLabel : ""}
              align="right"
              player={team1Players[i]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SegmentBar({
  weight,
  color,
  label,
  align,
  player,
}: {
  weight: number;
  color: string;
  label: string;
  align: "left" | "right";
  player?: PlayerLite;
}) {
  return (
    <div
      title={player ? `${player.display_name}: ${weight}` : undefined}
      style={{
        flex: Math.max(weight, 0.01),
        background: color,
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
}

function TeamBarCell({
  pct,
  color,
  align,
}: {
  pct: number;
  color: string;
  align: "left" | "right";
}) {
  return (
    <div
      style={{
        flex: 1,
        height: 28,
        background: "#f0f0f0",
        borderRadius: align === "right" ? "4px 0 0 4px" : "0 4px 4px 0",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: color,
          [align === "right" ? "right" : "left"]: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: align === "right" ? "flex-start" : "flex-end",
          padding: "0 10px",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {pct}%
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e2e2",
  borderRadius: 10,
  padding: 16,
};

const subHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
