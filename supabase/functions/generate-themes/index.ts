/**
 * generate-themes — Supabase Edge Function that runs Anthropic's Claude
 * over all of a player's games in a session and returns N "common
 * themes" for coaching. Each theme is a { title, problem, solution }.
 *
 * The function:
 *   1. Pulls every game_analysis + flags + sequences + topic recommendations +
 *      game_players row for the player in the session.
 *   2. Assembles a structured prompt.
 *   3. Calls Claude (claude-3-5-haiku-latest by default — cheap and fast).
 *   4. Persists the returned themes in `player_coaching_themes`, replacing
 *      any previous AI-generated set for this session+player (coach edits
 *      are preserved separately: the client keeps the old rows if the coach
 *      wants a fresh batch, they click Regenerate and we replace).
 *
 * Env required:
 *   - ANTHROPIC_API_KEY       — Anthropic API key
 *   - SUPABASE_URL            — auto-provided
 *   - SUPABASE_SERVICE_ROLE_KEY — auto-provided (bypasses RLS for our reads)
 *   - THEMES_MODEL (optional) — override Claude model
 *
 * Auth: requires a Bearer token matching WEBHOOK_SECRET. The web client
 * passes this from an env var; for production we'll move to proper
 * Supabase Auth in a follow-up.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Claude Haiku 4.5 — cheap, fast, and the smallest tier provisioned on
// this account. Override with the `THEMES_MODEL` env var on the edge
// function to upgrade without redeploying.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface ThemeBody {
  title: string;
  problem: string;
  solution: string;
}

interface Payload {
  sessionId: string;
  playerId: string;
  /** How many themes to ask Claude for. Default 5. */
  n?: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Auth
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
  const n = Math.max(1, Math.min(10, body.n ?? 5));
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

  const [gps, analyses] = await Promise.all([
    supabase.from("game_players").select("*").in("game_id", gameIds).eq("player_id", playerId),
    supabase.from("game_analyses").select("*").in("game_id", gameIds),
  ]);

  const analysisIds = (analyses.data ?? []).map((a: any) => a.id);
  const [seqs, flags, topicRecs] = await Promise.all([
    analysisIds.length > 0
      ? supabase.from("game_analysis_sequences").select("*").in("analysis_id", analysisIds)
      : { data: [] },
    analysisIds.length > 0
      ? supabase.from("analysis_flagged_shots").select("*").in("analysis_id", analysisIds)
      : { data: [] },
    analysisIds.length > 0
      ? supabase
          .from("analysis_topic_recommendations")
          .select("*")
          .in("analysis_id", analysisIds)
          .eq("player_id", playerId)
      : { data: [] },
  ]);

  // ── Assemble prompt ───────────────────────────────────────────
  const promptContext = buildPromptContext({
    player: player as any,
    session: session as any,
    games: (games ?? []) as any[],
    gamePlayers: (gps.data ?? []) as any[],
    analyses: (analyses.data ?? []) as any[],
    sequences: (seqs.data ?? []) as any[],
    flags: (flags.data ?? []) as any[],
    topicRecs: (topicRecs.data ?? []) as any[],
  });

  const systemPrompt = `You are a pickleball coaching assistant. Your job is to find recurring coaching themes across a player's recent games and articulate each one concisely.

You will receive a structured dump of a single player's games: stats, the coach's written notes, FPTM (Footwork/Paddle/Tactics/Mindset) diagnoses, flagged moments, and review-topic recommendations.

Return EXACTLY ${n} themes, prioritizing things that appear across multiple games (2+). Each theme must be a JSON object:
  - "title": a short headline, 3-7 words, no trailing punctuation
  - "problem": 1-3 sentences explaining what the player is doing (or not doing) that shows up across games. Use plain coaching language, not stats jargon.
  - "solution": 1-3 sentences prescribing concrete practice steps the player can work on. Tactical and actionable.

Respond with ONLY a JSON array of ${n} objects. No prose, no markdown, no code fences. Example shape:
[{"title":"Drifting off the kitchen line","problem":"...","solution":"..."}]`;

  const userPrompt = `Player: ${(player as any).display_name}\nSession: ${(session as any).label ?? "session"} on ${(session as any).played_date}\n\n${promptContext}`;

  const model = Deno.env.get("THEMES_MODEL") ?? DEFAULT_MODEL;
  const anthropicRes = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
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
  let themes: ThemeBody[];
  try {
    // Claude sometimes wraps the array in ```json fences despite our ask;
    // strip them defensively.
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    themes = parsed.slice(0, n).map((t: any) => ({
      title: String(t.title ?? "").trim(),
      problem: String(t.problem ?? "").trim(),
      solution: String(t.solution ?? "").trim(),
    }));
    if (themes.some((t) => !t.title || !t.problem || !t.solution)) {
      throw new Error("malformed theme");
    }
  } catch (e) {
    return json({
      error: `Could not parse Claude output: ${(e as Error).message}`,
      raw: rawText,
    }, 502);
  }

  // ── Persist: replace any AI-generated rows; leave coach-edited alone ──
  // Coach-edited rows have `source = 'coach'` or `edited = true`.
  const { error: delErr } = await supabase
    .from("player_coaching_themes")
    .delete()
    .eq("session_id", sessionId)
    .eq("player_id", playerId)
    .eq("source", "ai")
    .eq("edited", false);
  if (delErr) return json({ error: `delete old themes: ${delErr.message}` }, 500);

  const rows = themes.map((t, i) => ({
    org_id: (session as any).org_id,
    player_id: playerId,
    session_id: sessionId,
    title: t.title,
    problem: t.problem,
    solution: t.solution,
    order_idx: i,
    source: "ai",
    edited: false,
  }));
  const { data: inserted, error: insErr } = await supabase
    .from("player_coaching_themes")
    .insert(rows)
    .select();
  if (insErr) return json({ error: `insert themes: ${insErr.message}` }, 500);

  return json({ themes: inserted }, 200);
});

// ─────────────────────── Prompt context ───────────────────────

function buildPromptContext(args: {
  player: any;
  session: any;
  games: any[];
  gamePlayers: any[];
  analyses: any[];
  sequences: any[];
  flags: any[];
  topicRecs: any[];
}): string {
  const { games, gamePlayers, analyses, sequences, flags, topicRecs } = args;
  const lines: string[] = [];

  const orderedGames = [...games].sort((a, b) => {
    const ai = parseGameIdx(a.session_name);
    const bi = parseGameIdx(b.session_name);
    if (ai != null && bi != null) return ai - bi;
    return 0;
  });

  for (let i = 0; i < orderedGames.length; i++) {
    const game = orderedGames[i];
    const gp = gamePlayers.find((g) => g.game_id === game.id);
    const ana = analyses.find((a) => a.game_id === game.id);
    if (!gp) continue;

    lines.push(`\n=== Game ${i + 1} ===`);
    lines.push(
      [
        `Rating: overall ${fmt(gp.rating_overall)}, serve ${fmt(gp.rating_serve)}, return ${fmt(gp.rating_return)}, offense ${fmt(gp.rating_offense)}, defense ${fmt(gp.rating_defense)}, agility ${fmt(gp.rating_agility)}, consistency ${fmt(gp.rating_consistency)}`,
        `Rallies won: ${gp.num_rallies_won ?? 0}/${gp.num_rallies ?? 0}`,
        `Shots: ${gp.shot_count ?? 0}`,
      ].join("\n"),
    );
    if (gp.serve_depth) {
      lines.push(`Serve depth (out/net/shallow/medium/deep): ${JSON.stringify(gp.serve_depth)}`);
    }
    if (gp.return_depth) {
      lines.push(`Return depth: ${JSON.stringify(gp.return_depth)}`);
    }
    if (gp.kitchen_arrival_pct) {
      lines.push(`Kitchen arrival %: ${JSON.stringify(gp.kitchen_arrival_pct)}`);
    }

    if (ana) {
      if (ana.overall_notes?.trim()) {
        lines.push(`Coach's overall note: "${ana.overall_notes.trim()}"`);
      }
      if (ana.overall_tone) {
        lines.push(`Coach's framing: ${ana.overall_tone}`);
      }

      // Topic recommendations on this game for this player
      const recs = topicRecs.filter((r) => r.analysis_id === ana.id);
      for (const r of recs) {
        if (r.dismissed) continue;
        if (!r.recommendation && !r.drills && (!r.fptm || Object.keys(r.fptm).length === 0)) {
          continue;
        }
        lines.push(
          `Topic ${r.topic_id}: recommendation="${r.recommendation ?? ""}" drills="${r.drills ?? ""}" fptm=${JSON.stringify(r.fptm ?? {})}`,
        );
      }

      // Sequences tagged to this player
      const seqsHere = sequences.filter(
        (s) =>
          s.analysis_id === ana.id &&
          (s.player_id === args.player.id || (s.player_ids ?? []).includes(args.player.id)),
      );
      for (const s of seqsHere) {
        if (!s.what_went_wrong && !s.drills && (!s.fptm || Object.keys(s.fptm).length === 0)) {
          continue;
        }
        lines.push(
          `Sequence "${s.label ?? ""}": what_went_wrong="${s.what_went_wrong ?? ""}" drills="${s.drills ?? ""}" fptm=${JSON.stringify(s.fptm ?? {})}`,
        );
      }

      // Flags on this player's shots in this game
      const flagsHere = flags.filter((f) => f.analysis_id === ana.id);
      for (const f of flagsHere) {
        if (!f.note && !f.drills && (!f.fptm || Object.keys(f.fptm).length === 0)) {
          continue;
        }
        lines.push(
          `Flag: note="${f.note ?? ""}" drills="${f.drills ?? ""}" fptm=${JSON.stringify(f.fptm ?? {})}`,
        );
      }
    }
  }

  return lines.join("\n");
}

function parseGameIdx(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.match(/gm-(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function fmt(v: unknown): string {
  return typeof v === "number" ? v.toFixed(2) : "—";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
