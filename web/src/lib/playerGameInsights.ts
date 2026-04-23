/**
 * Per-player per-game stat aggregations that the Game Report and Session
 * Report surface beyond the raw `game_players` row. Some fields come
 * straight from PB Vision (serve/return depth, kitchen-arrival %), others
 * are computed from shots + rallies (3rd-shot drop success %).
 *
 * All helpers return nulls when source data is missing — a compact import
 * that hasn't had augmented insights merged in won't carry serve/return
 * depth, and those stats simply won't render in that case.
 */
import type {
  DepthDistribution,
  GamePlayer,
  KitchenArrivalFraction,
  Rally,
  RallyShot,
} from "../types/database";
import {
  computePlayerScripts,
  type PlayerInfo,
  type RallyInfo,
} from "./firstFourShots";

export interface DepthBreakdown {
  /** Raw counts from PB Vision's {out, net, shallow, medium, deep}. */
  deep: number;
  medium: number;
  shallow: number;
  net: number;
  out: number;
  total: number;
  /** Percent landed in the deep zone (good). */
  pctDeep: number;
  /** Percent landed in PB Vision's "shallow" zone (short). */
  pctShort: number;
  /** Net + out, combined. Faults for a serve; either way a lost attempt. */
  pctFault: number;
}

export interface KitchenArrivalStat {
  pct: number;
  numerator: number;
  denominator: number;
}

export interface PlayerGameInsights {
  serveDepth: DepthBreakdown | null;
  returnDepth: DepthBreakdown | null;
  /** % of times the player got to the kitchen on the serving side. */
  kitchenArrivalServing: KitchenArrivalStat | null;
  /** % of times the player got to the kitchen on the returning side. */
  kitchenArrivalReturning: KitchenArrivalStat | null;
  /** Partner's kitchen arrival alongside this player — useful for "are
   *  you closing up as a unit?" coaching. */
  kitchenArrivalPartnerServing: KitchenArrivalStat | null;
  kitchenArrivalPartnerReturning: KitchenArrivalStat | null;
  /** 3rd-shot drop success % per the WMPC rule (includes drive → 5th-drop
   *  as a pass). null when the player never hit a 3rd-shot drop. */
  thirdDropSuccess: { pct: number; correct: number; total: number } | null;
}

function breakdown(d: DepthDistribution | null): DepthBreakdown | null {
  if (!d) return null;
  const total = d.deep + d.medium + d.shallow + d.net + d.out;
  if (total === 0) return null;
  return {
    deep: d.deep,
    medium: d.medium,
    shallow: d.shallow,
    net: d.net,
    out: d.out,
    total,
    pctDeep: (d.deep / total) * 100,
    pctShort: (d.shallow / total) * 100,
    pctFault: ((d.net + d.out) / total) * 100,
  };
}

function arrivalStat(f: KitchenArrivalFraction | null | undefined): KitchenArrivalStat | null {
  if (!f || !f.denominator || f.denominator <= 0) return null;
  return {
    numerator: f.numerator,
    denominator: f.denominator,
    pct: (f.numerator / f.denominator) * 100,
  };
}

export function computePlayerGameInsights(args: {
  gp: GamePlayer;
  player: PlayerInfo;
  allPlayers: PlayerInfo[];
  rallies: RallyInfo[];
  shots: RallyShot[];
}): PlayerGameInsights {
  const { gp, player, allPlayers, rallies, shots } = args;

  // 3rd-shot drop — we already compute this in computePlayerScripts, so
  // just pull the rate for the selected player.
  const scripts = computePlayerScripts(shots, rallies, allPlayers);
  const mine = scripts.find((s) => s.player.id === player.id);
  const td = mine?.thirdDrop;
  const thirdDropSuccess =
    td && td.total > 0
      ? {
          pct: Math.round((td.correct / td.total) * 100),
          correct: td.correct,
          total: td.total,
        }
      : null;

  return {
    serveDepth: breakdown(gp.serve_depth),
    returnDepth: breakdown(gp.return_depth),
    kitchenArrivalServing: arrivalStat(gp.kitchen_arrival_pct?.serving?.oneself ?? null),
    kitchenArrivalReturning: arrivalStat(gp.kitchen_arrival_pct?.returning?.oneself ?? null),
    kitchenArrivalPartnerServing: arrivalStat(gp.kitchen_arrival_pct?.serving?.partner ?? null),
    kitchenArrivalPartnerReturning: arrivalStat(
      gp.kitchen_arrival_pct?.returning?.partner ?? null,
    ),
    thirdDropSuccess,
  };
}

// ─────────────── Session rollups ───────────────

export interface AggregateBreakdown extends DepthBreakdown {}

/** Sum depth breakdowns across games (skipping nulls) into a single
 *  weighted breakdown. */
export function sumDepthBreakdowns(items: Array<DepthBreakdown | null>): DepthBreakdown | null {
  let deep = 0,
    medium = 0,
    shallow = 0,
    net = 0,
    out = 0;
  let any = false;
  for (const b of items) {
    if (!b) continue;
    any = true;
    deep += b.deep;
    medium += b.medium;
    shallow += b.shallow;
    net += b.net;
    out += b.out;
  }
  if (!any) return null;
  const total = deep + medium + shallow + net + out;
  if (total === 0) return null;
  return {
    deep,
    medium,
    shallow,
    net,
    out,
    total,
    pctDeep: (deep / total) * 100,
    pctShort: (shallow / total) * 100,
    pctFault: ((net + out) / total) * 100,
  };
}

/** Sum kitchen-arrival fractions across games. */
export function sumArrivalStats(
  items: Array<KitchenArrivalStat | null>,
): KitchenArrivalStat | null {
  let num = 0,
    den = 0;
  for (const s of items) {
    if (!s) continue;
    num += s.numerator;
    den += s.denominator;
  }
  if (den === 0) return null;
  return { numerator: num, denominator: den, pct: (num / den) * 100 };
}

/** Sum 3rd-shot drop results across games. */
export function sumDropSuccess(
  items: Array<{ correct: number; total: number } | null>,
): { pct: number; correct: number; total: number } | null {
  let correct = 0,
    total = 0;
  for (const s of items) {
    if (!s) continue;
    correct += s.correct;
    total += s.total;
  }
  if (total === 0) return null;
  return { pct: Math.round((correct / total) * 100), correct, total };
}
