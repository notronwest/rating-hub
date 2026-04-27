/**
 * generate-priorities — Supabase Edge Function that runs Claude over a
 * player's session and produces 10 ranked top priorities.
 *
 * Key differences from generate-themes:
 *   1. Computes a stat snapshot server-side (cheaper / smaller prompt).
 *   2. Asks the model to emit `evidence_chips` alongside title/problem/
 *      solution + a tier; server post-classifies tier from the first
 *      stat-bad chip when possible (consistent with the player report
 *      palette) and falls back to the model's tier for non-stat
 *      priorities.
 *   3. Honors the protection set: rows where pinned=true OR edited=true
 *      keep their content AND their priority_rank. Fresh model output
 *      slot-fills the remaining ranks.
 *   4. Topic-collision filter: drops fresh priorities whose primary
 *      stat-bad chip key matches a protected row's primary chip key,
 *      so a pinned "serve depth" priority isn't shadowed by a duplicate.
 *   5. Snapshots ai_original_* on insert so coach edits never overwrite
 *      the model's original draft (training corpus for later).
 *
 * Env required:
 *   - ANTHROPIC_API_KEY
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
 *   - WEBHOOK_SECRET (Bearer auth, same as generate-themes)
 *   - PRIORITIES_MODEL (optional override)
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
/** Total ranks to keep populated. UI shows top 4 by default + expander
 *  to ranks 5..10 the coach can promote. */
const TARGET_N = 10;

type Tier = "needs_work" | "ok" | "good" | "great";

interface EvidenceChip {
  key: string;
  label: string;
  /** "stat-bad" = deficit (red), "stat-good" = strength (green),
   *  "neutral" = pointer / count, no judgement. */
  kind: "stat-bad" | "stat-good" | "neutral";
}

interface PriorityBody {
  title: string;
  problem: string;
  solution: string;
  tier: Tier;
  evidence_chips: EvidenceChip[];
}

interface Payload {
  sessionId: string;
  playerId: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || token !== secret) return json({ error: "unauthorized" }, 401);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const { sessionId, playerId } = body;
  if (!sessionId || !playerId) {
    return json({ error: "sessionId and playerId required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Gather context ────────────────────────────────────────────
  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id, label, played_date, org_id")
    .eq("id", sessionId)
    .single();
  if (sessErr || !session) return json({ error: "session not found" }, 404);

  const { data: player } = await supabase
    .from("players")
    .select("id, display_name")
    .eq("id", playerId)
    .single();
  if (!player) return json({ error: "player not found" }, 404);

  const { data: games } = await supabase
    .from("games")
    .select("id, session_name, played_at")
    .eq("session_id", sessionId);
  const gameIds = (games ?? []).map((g: any) => g.id);
  if (gameIds.length === 0) {
    return json({ error: "session has no games" }, 400);
  }

  const [gpsRes, analysesRes] = await Promise.all([
    supabase.from("game_players").select("*").in("game_id", gameIds).eq("player_id", playerId),
    supabase.from("game_analyses").select("*").in("game_id", gameIds),
  ]);
  const gps = (gpsRes.data ?? []) as any[];
  const analyses = (analysesRes.data ?? []) as any[];
  const analysisIds = analyses.map((a) => a.id);

  const [seqsRes, flagsRes, recsRes, existingPrioritiesRes] = await Promise.all([
    analysisIds.length > 0
      ? supabase.from("game_analysis_sequences").select("*").in("analysis_id", analysisIds)
      : Promise.resolve({ data: [] }),
    analysisIds.length > 0
      ? supabase.from("analysis_flagged_shots").select("*").in("analysis_id", analysisIds)
      : Promise.resolve({ data: [] }),
    analysisIds.length > 0
      ? supabase
          .from("analysis_topic_recommendations")
          .select("*")
          .in("analysis_id", analysisIds)
          .eq("player_id", playerId)
      : Promise.resolve({ data: [] }),
    supabase
      .from("player_coaching_themes")
      .select("*")
      .eq("session_id", sessionId)
      .eq("player_id", playerId)
      .eq("kind", "priority"),
  ]);
  const sequences = (seqsRes.data ?? []) as any[];
  const flags = (flagsRes.data ?? []) as any[];
  const topicRecs = (recsRes.data ?? []) as any[];
  const existingPriorities = (existingPrioritiesRes.data ?? []) as any[];

  // Protected = pinned OR edited. These rows survive regen at their
  // current rank with their current content. Fresh AI output fills the
  // remaining slots.
  const protectedRows = existingPriorities.filter(
    (r) => r.pinned === true || r.edited === true,
  );
  const protectedRanks = new Set(
    protectedRows.map((r) => r.priority_rank).filter((r) => r != null),
  );
  const availableRanks: number[] = [];
  for (let r = 1; r <= TARGET_N; r++) {
    if (!protectedRanks.has(r)) availableRanks.push(r);
  }
  const slotsToFill = availableRanks.length;

  // Topic keys already covered by protected rows — used to filter
  // duplicate suggestions and to nudge the model away in the prompt.
  const protectedTopicKeys = new Set<string>();
  for (const row of protectedRows) {
    const chips = (row.evidence_chips ?? []) as EvidenceChip[];
    const lead = chips.find((c) => c.kind === "stat-bad") ?? chips[0];
    if (lead?.key) protectedTopicKeys.add(lead.key);
  }

  // ── Compute the stat snapshot ─────────────────────────────────
  const snapshot = computeStatSnapshot({ gps, analyses, sequences, flags });

  // ── Assemble the prompt ───────────────────────────────────────
  const systemPrompt = buildSystemPrompt(slotsToFill);
  const userPrompt = buildUserPrompt({
    player,
    session,
    snapshot,
    protectedRows,
    topicRecs,
    analyses,
    sequences,
    flags,
    slotsToFill,
  });

  if (slotsToFill === 0) {
    // Every rank is protected — nothing to regenerate. Just return the
    // existing rows in their current state.
    return json({ priorities: existingPriorities, regenerated: 0 }, 200);
  }

  const model = Deno.env.get("PRIORITIES_MODEL") ?? DEFAULT_MODEL;
  const anthropicRes = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!anthropicRes.ok) {
    const t = await anthropicRes.text();
    return json({ error: `anthropic failed: ${anthropicRes.status} ${t}` }, 502);
  }
  const anthropicJson = await anthropicRes.json();
  const rawText: string = anthropicJson?.content?.[0]?.text ?? "";

  let drafted: PriorityBody[];
  try {
    drafted = parsePriorities(rawText, slotsToFill);
  } catch (e) {
    return json({
      error: `Could not parse Claude output: ${(e as Error).message}`,
      raw: rawText,
    }, 502);
  }

  // ── Topic-collision filter ────────────────────────────────────
  // Drop any drafted priority whose lead chip key is already covered
  // by a protected row. The model is told not to do this in the prompt
  // but we enforce server-side as a safety net.
  const fresh: PriorityBody[] = [];
  const seen = new Set<string>(protectedTopicKeys);
  for (const p of drafted) {
    const lead = leadChipKey(p);
    if (lead && seen.has(lead)) continue;
    if (lead) seen.add(lead);
    fresh.push(p);
    if (fresh.length === slotsToFill) break;
  }

  // ── Server-classify tier from the lead stat-bad chip ──────────
  for (const p of fresh) {
    const overridden = classifyTierFromChips(p, snapshot);
    if (overridden) p.tier = overridden;
  }

  // ── Persist: delete unprotected rows + journal, insert fresh ──
  const protectedIds = new Set(protectedRows.map((r) => r.id));
  const toDelete = existingPriorities.filter((r) => !protectedIds.has(r.id));
  if (toDelete.length > 0) {
    const ids = toDelete.map((r) => r.id);
    await supabase.from("player_coaching_themes").delete().in("id", ids);
    // Journal the deletions.
    await supabase.from("coaching_theme_edits").insert(
      toDelete.map((r) => ({
        theme_id: r.id,
        org_id: r.org_id,
        field: "deleted",
        old_value: JSON.stringify({
          title: r.title,
          problem: r.problem,
          solution: r.solution,
        }),
      })),
    );
  }

  const generatedAt = new Date().toISOString();
  const orgId = (session as any).org_id;
  const insertRows = fresh.map((p, i) => ({
    org_id: orgId,
    player_id: playerId,
    session_id: sessionId,
    kind: "priority",
    priority_rank: availableRanks[i],
    title: p.title,
    problem: p.problem,
    solution: p.solution,
    evidence_chips: p.evidence_chips,
    order_idx: availableRanks[i] - 1,
    source: "ai",
    edited: false,
    pinned: false,
    ai_original_title: p.title,
    ai_original_problem: p.problem,
    ai_original_solution: p.solution,
    ai_model: model,
    ai_generated_at: generatedAt,
  }));
  const { data: inserted, error: insErr } = await supabase
    .from("player_coaching_themes")
    .insert(insertRows)
    .select();
  if (insErr) return json({ error: `insert priorities: ${insErr.message}` }, 500);

  // Journal the creations.
  if (inserted && inserted.length > 0) {
    await supabase.from("coaching_theme_edits").insert(
      (inserted as any[]).map((r) => ({
        theme_id: r.id,
        org_id: r.org_id,
        field: "created",
        new_value: JSON.stringify({
          rank: r.priority_rank,
          title: r.title,
        }),
      })),
    );
  }

  // Return the merged set, sorted by rank ascending.
  const merged = [...protectedRows, ...(inserted ?? [])].sort(
    (a, b) => (a.priority_rank ?? 99) - (b.priority_rank ?? 99),
  );
  return json({
    priorities: merged,
    regenerated: inserted?.length ?? 0,
    pinned_kept: protectedRows.length,
  }, 200);
});

// ───────────────────────── Stat snapshot ─────────────────────────

function computeStatSnapshot(args: {
  gps: any[];
  analyses: any[];
  sequences: any[];
  flags: any[];
}): Record<string, number> {
  const { gps, sequences, flags } = args;
  const snap: Record<string, number> = {};
  if (gps.length === 0) return snap;

  // Ratings (averages)
  const avg = (k: string) => {
    const vals = gps.map((g) => g[k]).filter((v) => typeof v === "number");
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  for (const k of [
    "rating_overall",
    "rating_serve",
    "rating_return",
    "rating_offense",
    "rating_defense",
    "rating_agility",
    "rating_consistency",
  ]) {
    const v = avg(k);
    if (v != null) snap[k] = round(v, 2);
  }

  // Depth distribution → percentage of "deep" landings, weighted by total.
  const depthDeepPct = (key: string) => {
    let deep = 0;
    let total = 0;
    for (const g of gps) {
      const d = g[key];
      if (!d) continue;
      const sum =
        (d.out ?? 0) +
        (d.net ?? 0) +
        (d.shallow ?? 0) +
        (d.medium ?? 0) +
        (d.deep ?? 0);
      if (sum === 0) continue;
      deep += d.deep ?? 0;
      total += sum;
    }
    return total > 0 ? Math.round((deep / total) * 100) : null;
  };
  const sd = depthDeepPct("serve_depth");
  if (sd != null) snap["stat.serve_deep_pct"] = sd;
  const rd = depthDeepPct("return_depth");
  if (rd != null) snap["stat.return_deep_pct"] = rd;

  // Kitchen arrival — average serving / receiving
  const ka = (side: "serving" | "returning") => {
    let num = 0;
    let den = 0;
    for (const g of gps) {
      const ka = g.kitchen_arrival_pct;
      if (!ka) continue;
      const role = side === "serving" ? ka.serving : ka.returning;
      const f = role?.oneself;
      if (!f || !f.denominator) continue;
      num += f.numerator ?? 0;
      den += f.denominator;
    }
    return den > 0 ? Math.round((num / den) * 100) : null;
  };
  const kaServ = ka("serving");
  if (kaServ != null) snap["stat.kitchen_arrival.serving"] = kaServ;
  const kaRet = ka("returning");
  if (kaRet != null) snap["stat.kitchen_arrival.returning"] = kaRet;

  // Rallies won (overall rate)
  let won = 0;
  let total = 0;
  for (const g of gps) {
    won += g.num_rallies_won ?? 0;
    total += g.num_rallies ?? 0;
  }
  if (total > 0) snap["stat.rally_win"] = Math.round((won / total) * 100);

  // Shot accuracy ("in" rate)
  let inN = 0;
  let inT = 0;
  for (const g of gps) {
    const sa = g.shot_accuracy;
    if (!sa) continue;
    const sum = (sa.in ?? 0) + (sa.net ?? 0) + (sa.out ?? 0);
    if (sum === 0) continue;
    inN += sa.in ?? 0;
    inT += sum;
  }
  if (inT > 0) snap["stat.shots_in_pct"] = Math.round((inN / inT) * 100);

  // Coach-tagged signals
  snap["flags.count"] = flags.length;
  snap["sequences.count"] = sequences.length;

  return snap;
}

function round(v: number, d: number): number {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

// ───────────────────────── Prompt assembly ─────────────────────────

function buildSystemPrompt(slotsToFill: number): string {
  return `You are a pickleball coaching assistant for the White Mountain Pickleball Club.
Your job: produce ${slotsToFill} RANKED top priorities for a single player based
on this session's games. Each priority is a short coaching prescription
that the player will work on before their next session.

Optimize for IMPACT, not frequency. Pick priorities that:
  - Address the biggest gaps (lowest tiers below) when there is one
  - Compound — fixing #1 makes #2 easier
  - Are coachable in 2–4 weeks of focused practice, not season-long projects
  - Cite concrete evidence (a stat % or a flagged-moment count)

Tone: warm but direct. Plain coaching language, no jargon. Speak TO the
player ("your serve depth", "you're sitting back at 6 ft"). Avoid robotic
phrasings.

Tier scale (mirrors the rest of the report):
  - "needs_work"  — < 60%        (most priorities live here)
  - "ok"          — 60–70%       (room to grow)
  - "good"        — 71–89%       (a positive callout — "lean into this")
  - "great"       — 90–100%      (rare; recognize a strength)

Solution must be a CONCRETE drill plus a check-back target:
  WRONG: "Work on serve depth"
  RIGHT: "25 serves with cones at 28 ft, 3x/week. Target 70% deep before next session."

EVIDENCE VOCABULARY — use these keys in evidence_chips. Do not invent keys.
  Stat-backed (label them with the value, e.g. "Serve deep · 52%"):
    stat.serve_deep_pct
    stat.return_deep_pct
    stat.kitchen_arrival.serving
    stat.kitchen_arrival.returning
    stat.rally_win
    stat.shots_in_pct
    stat.shot_quality

  WMPC review topics:
    topic.script.deep_serve
    topic.script.deep_return_kitchen
    topic.script.third_drop
    topic.script.fourth_volley
    topic.script.poach_awareness
    topic.beats.direct
    topic.beats.diagonal

  Coach-tagged signals:
    flags.count
    sequences.count
    coach.notes

Output: ONLY a JSON array of EXACTLY ${slotsToFill} objects, ranked 1..${slotsToFill}
by impact. No markdown, no prose, no code fences. Each object:
{
  "title":       3–7 words, no trailing punctuation
  "problem":     1–3 sentences, plain coaching language
  "solution":    1–3 sentences, concrete drill + measurable target
  "tier":        "needs_work" | "ok" | "good" | "great"
  "evidence_chips": [
    { "key": one of the vocabulary keys above,
      "label": coach-facing text (include the value, e.g. "Serve deep · 52%"),
      "kind":  "stat-bad" | "stat-good" | "neutral" }
  ]
}

Evidence chip rules:
  - 2 to 4 chips per priority
  - The FIRST chip should be the headline (the deficit you're addressing
    on a needs_work priority, the strength on a good/great one)
  - "stat-bad" = deficit (renders red); "stat-good" = strength (green);
    "neutral" = pointer / context (gray)`;
}

function buildUserPrompt(args: {
  player: any;
  session: any;
  snapshot: Record<string, number>;
  protectedRows: any[];
  topicRecs: any[];
  analyses: any[];
  sequences: any[];
  flags: any[];
  slotsToFill: number;
}): string {
  const { player, session, snapshot, protectedRows, topicRecs, analyses, sequences, flags, slotsToFill } = args;
  const lines: string[] = [];
  lines.push(`Player: ${player.display_name}`);
  lines.push(`Session: ${session.label ?? "session"} on ${session.played_date}`);
  lines.push("");
  lines.push(`Generate ${slotsToFill} priorities to fill the available ranks.`);

  if (protectedRows.length > 0) {
    lines.push("");
    lines.push(`PROTECTED — generate priorities on DIFFERENT topics than these:`);
    for (const row of protectedRows) {
      const chips = (row.evidence_chips ?? []) as EvidenceChip[];
      const lead = chips.find((c) => c.kind === "stat-bad") ?? chips[0];
      const keyHint = lead?.key ? `  (lead key: ${lead.key})` : "";
      lines.push(`  - "${row.title}"${keyHint}`);
    }
  }

  lines.push("");
  lines.push("SESSION STAT SNAPSHOT (averages across games):");
  for (const [k, v] of Object.entries(snapshot)) {
    lines.push(`  ${k} = ${v}`);
  }

  // Per-game color: coach notes + non-dismissed topic recs + sequences + flags.
  // We deliberately keep this concise — the snapshot above is the "what",
  // this is the "why / how the coach already framed it."
  if (analyses.length > 0) {
    lines.push("");
    lines.push("PER-GAME COACH CONTEXT:");
    for (const a of analyses) {
      const game = a;
      const gid = a.id;
      const recs = topicRecs.filter((r) => r.analysis_id === gid && !r.dismissed);
      const seqs = sequences.filter(
        (s) => s.analysis_id === gid && (s.player_id === player.id || (s.player_ids ?? []).includes(player.id)),
      );
      const flgs = flags.filter((f) => f.analysis_id === gid);
      if (
        !game.overall_notes &&
        recs.length === 0 &&
        seqs.length === 0 &&
        flgs.length === 0
      ) {
        continue;
      }
      lines.push(`  --- Analysis ${gid.slice(0, 8)} ---`);
      if (game.overall_notes?.trim()) {
        lines.push(`    Coach overall note: "${game.overall_notes.trim()}"`);
      }
      if (game.overall_tone) {
        lines.push(`    Coach framing: ${game.overall_tone}`);
      }
      for (const r of recs) {
        if (!r.recommendation && !r.drills && (!r.fptm || Object.keys(r.fptm).length === 0)) continue;
        lines.push(
          `    Topic ${r.topic_id}: rec="${r.recommendation ?? ""}" drills="${r.drills ?? ""}" fptm=${JSON.stringify(r.fptm ?? {})}`,
        );
      }
      for (const s of seqs) {
        if (!s.what_went_wrong && !s.drills && (!s.fptm || Object.keys(s.fptm).length === 0)) continue;
        lines.push(
          `    Sequence "${s.label ?? ""}": ww="${s.what_went_wrong ?? ""}" drills="${s.drills ?? ""}"`,
        );
      }
      for (const f of flgs) {
        if (!f.note && !f.drills) continue;
        lines.push(`    Flag: note="${f.note ?? ""}" drills="${f.drills ?? ""}"`);
      }
    }
  }

  return lines.join("\n");
}

function parsePriorities(rawText: string, max: number): PriorityBody[] {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("not an array");
  const out: PriorityBody[] = [];
  for (const item of parsed) {
    const title = String(item.title ?? "").trim();
    const problem = String(item.problem ?? "").trim();
    const solution = String(item.solution ?? "").trim();
    const tierRaw = String(item.tier ?? "needs_work");
    const tier: Tier =
      tierRaw === "ok" || tierRaw === "good" || tierRaw === "great"
        ? tierRaw
        : "needs_work";
    const chipsArr = Array.isArray(item.evidence_chips) ? item.evidence_chips : [];
    const evidence_chips: EvidenceChip[] = chipsArr.map((c: any) => {
      const kindRaw = String(c.kind ?? "neutral");
      const kind: EvidenceChip["kind"] =
        kindRaw === "stat-bad" || kindRaw === "stat-good" ? kindRaw : "neutral";
      return {
        key: String(c.key ?? "").trim(),
        label: String(c.label ?? "").trim(),
        kind,
      };
    }).filter((c: EvidenceChip) => c.key && c.label);
    if (!title || !problem || !solution) continue;
    out.push({ title, problem, solution, tier, evidence_chips });
    if (out.length === max) break;
  }
  if (out.length === 0) throw new Error("no usable priorities returned");
  return out;
}

function leadChipKey(p: PriorityBody): string | null {
  const bad = p.evidence_chips.find((c) => c.kind === "stat-bad");
  if (bad) return bad.key;
  return p.evidence_chips[0]?.key ?? null;
}

/** Server-side tier classification — uses the player report's
 *  `< 60 / 60-70 / 71-89 / 90+` bands on the lead stat-bad chip's
 *  value. Returns null when there's no stat-bad chip with a
 *  recognizable value (model's tier wins). */
function classifyTierFromChips(
  p: PriorityBody,
  snapshot: Record<string, number>,
): Tier | null {
  const lead = p.evidence_chips.find((c) => c.kind === "stat-bad");
  if (!lead) return null;
  const value = snapshot[lead.key];
  if (typeof value !== "number") return null;
  if (value < 60) return "needs_work";
  if (value <= 70) return "ok";
  if (value <= 89) return "good";
  return "great";
}

// ───────────────────────── HTTP helpers ─────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}
