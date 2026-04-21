/**
 * FPTM — Footwork, Paddle, Tactics, Mindset.
 * A professional pickleball coaching framework used to diagnose issues when
 * reviewing flagged shots or saved sequences.
 *
 * This module is the single source of truth for pillar/sub-item definitions
 * and for the shape of coach-entered FPTM analysis. Both the UI editor and
 * the DB payload round-trip through `FptmValue`.
 */

export interface FptmItemDef {
  id: string;
  label: string;
}

export interface FptmPillarDef {
  id: FptmPillarId;
  letter: string;
  label: string;
  summary: string;
  color: string;
  items: FptmItemDef[];
}

export type FptmPillarId = "footwork" | "paddle" | "tactics" | "mindset";

export const FPTM_PILLARS: FptmPillarDef[] = [
  {
    id: "footwork",
    letter: "F",
    label: "Footwork",
    summary: "Movement, balance, court positioning",
    color: "#1a73e8",
    items: [
      { id: "ready_split", label: "Ready Position & Split Step" },
      { id: "first_step", label: "First Step Direction" },
      { id: "adjustment", label: "Adjustment Steps" },
      { id: "spacing_balance", label: "Spacing & Balance at Contact" },
      { id: "recovery_alignment", label: "Recovery & Partner Alignment" },
    ],
  },
  {
    id: "paddle",
    letter: "P",
    label: "Paddle",
    summary: "Paddle control, contact, shot execution",
    color: "#d97706",
    items: [
      { id: "grip_stability", label: "Grip Pressure & Stability" },
      { id: "face_control", label: "Paddle Face Control" },
      { id: "compact_swing", label: "Compact Swing Path" },
      { id: "contact_timing", label: "Contact Point & Timing" },
      { id: "spin_margin", label: "Spin & Margin Management" },
    ],
  },
  {
    id: "tactics",
    letter: "T",
    label: "Tactics",
    summary: "Shot choice, patterns, court awareness",
    color: "#1e7e34",
    items: [
      { id: "readiness", label: "Shot Readiness Assessment" },
      { id: "shot_target", label: "Shot–Target Selection" },
      { id: "patterns", label: "Pattern Execution" },
      { id: "geometry", label: "Court Geometry Awareness" },
      { id: "score_context", label: "Score-Context Discipline" },
    ],
  },
  {
    id: "mindset",
    letter: "M",
    label: "Mindset",
    summary: "Composure, tempo, competitive discipline",
    color: "#7e57c2",
    items: [
      { id: "emotional", label: "Emotional Regulation" },
      { id: "reset", label: "Reset Efficiency" },
      { id: "tempo", label: "Tempo Control" },
      { id: "competitive", label: "Competitive Discipline" },
      { id: "partner_trust", label: "Partner Trust & Communication" },
    ],
  },
];

export const FPTM_PILLAR_BY_ID: Record<FptmPillarId, FptmPillarDef> =
  FPTM_PILLARS.reduce(
    (acc, p) => {
      acc[p.id] = p;
      return acc;
    },
    {} as Record<FptmPillarId, FptmPillarDef>,
  );

export type FptmTone = "strength" | "weakness";

export interface FptmPillarState {
  /** Pillar has been tagged at all */
  on: boolean;
  /** Coach framing — is this something the player does well or needs work on? */
  tone?: FptmTone;
  /** Specific sub-item ids the coach called out */
  items: string[];
  /** Optional free-text detail on this pillar */
  note?: string | null;
}

export type FptmValue = Partial<Record<FptmPillarId, FptmPillarState>>;

export function emptyFptm(): FptmValue {
  return {};
}

/** Compact chip-list summary — returns [{pillarId, count, label}] for populated pillars. */
export function summarizeFptm(
  value: FptmValue | null | undefined,
): Array<{ pillar: FptmPillarDef; itemCount: number }> {
  if (!value) return [];
  return FPTM_PILLARS.filter((p) => {
    const st = value[p.id];
    return st?.on || (st?.items?.length ?? 0) > 0 || !!st?.note;
  }).map((p) => ({
    pillar: p,
    itemCount: value[p.id]?.items?.length ?? 0,
  }));
}

/** True iff the coach entered anything at all. */
export function isFptmEmpty(value: FptmValue | null | undefined): boolean {
  return summarizeFptm(value).length === 0;
}
