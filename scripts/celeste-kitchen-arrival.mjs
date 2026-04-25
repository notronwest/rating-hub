#!/usr/bin/env node
/**
 * Lists rallies where a given player was on the SERVING team and did NOT
 * reach the kitchen — using PB Vision's per-rally
 * `players[i].kitchen_arrivals` field from the public augmented insights
 * JSON (no auth required).
 *
 * Why pull augmented JSON directly? The compact import we store in our DB
 * doesn't carry per-rally arrival flags or per-shot player_positions —
 * only the per-game roll-ups (`kitchen_arrivals_summary`,
 * `kitchen_arrival_pct`). The augmented file has the truth, public.
 *
 * Usage:
 *   node scripts/celeste-kitchen-arrival.mjs [gameId] [partial-name]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv(path.join(repoRoot, "web/.env.local"));

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;

const GAME_ID = process.argv[2] || "203e43ce-de5c-4536-9433-81b0bd7b9435";
const PLAYER_NAME = (process.argv[3] || "Celeste").toLowerCase();

async function rest(qs) {
  const r = await fetch(`${URL}/rest/v1/${qs}`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`${qs}: ${r.status}`);
  return r.json();
}

// Look up the PB Vision video id for this game.
const games = await rest(
  `games?id=eq.${GAME_ID}&select=pbvision_video_id,session_index`,
);
if (!games[0]) {
  console.error("Game not found in DB.");
  process.exit(1);
}
const { pbvision_video_id: vid, session_index: sess } = games[0];

const gps = await rest(
  `game_players?game_id=eq.${GAME_ID}&select=player_index,team,kitchen_arrivals_summary,kitchen_arrival_pct,players(display_name)&order=player_index.asc`,
);
const me = gps.find((g) => g.players.display_name.toLowerCase().includes(PLAYER_NAME));
if (!me) {
  console.error(`No player matching "${PLAYER_NAME}".`);
  process.exit(1);
}

console.log(`\nGame ${GAME_ID}  (pbv ${vid}, session ${sess})`);
console.log(`Players:`);
for (const g of gps) {
  console.log(`  idx=${g.player_index} team=${g.team}  ${g.players.display_name}`);
}
console.log(`\nFocus: ${me.players.display_name} (idx=${me.player_index}, team=${me.team})`);
const ka = me.kitchen_arrival_pct?.serving?.oneself;
const kasum = me.kitchen_arrivals_summary;
console.log(
  `  serving.oneself = ${ka?.numerator}/${ka?.denominator} (${Math.round((ka?.numerator/ka?.denominator)*100)}%)  ·  ` +
  `summary.serving_side = ${Math.round((kasum?.serving_side ?? 0)*100)}%`,
);

// ── pull augmented insights from public PB Vision API ────────────
const url = `https://api-2o2klzx4pa-uc.a.run.app/video/${vid}/insights.json?sessionNum=${sess}&format=augmented`;
console.log(`\nFetching ${url}`);
const r = await fetch(url);
if (!r.ok) {
  console.error(`HTTP ${r.status}`);
  process.exit(1);
}
const aug = await r.json();
console.log(`Got ${aug.rallies?.length ?? 0} rallies, ${aug.player_data?.length ?? 0} players.`);

// ── classify each rally ─────────────────────────────────────────
const teamOf = new Map(gps.map((g) => [g.player_index, g.team]));

const fmtMs = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const servingRallies = []; // rallies where her team served
for (let i = 0; i < aug.rallies.length; i++) {
  const rally = aug.rallies[i];
  if (rally.scoring_info?.likely_bad) continue;
  const shot0 = rally.shots?.[0];
  if (!shot0 || shot0.player_id == null) continue;
  const serverTeam = teamOf.get(shot0.player_id);
  if (serverTeam !== me.team) continue;

  const myPlayerInRally = rally.players?.[me.player_index];
  if (!myPlayerInRally) continue;

  const arrivals = myPlayerInRally.kitchen_arrivals ?? [];
  const arrived = arrivals.length > 0;
  const hadOpportunity = !!myPlayerInRally.had_arrival_opportunity;

  servingRallies.push({
    rally_index: i,
    start_ms: rally.start_ms,
    end_ms: rally.end_ms,
    duration_ms: rally.end_ms - rally.start_ms,
    server_id: shot0.player_id,
    iServed: shot0.player_id === me.player_index,
    score: rally.scoring_info?.running_score,
    shot_count: rally.shots?.length ?? 0,
    arrived,
    hadOpportunity,
    sinceMs: arrivals[0]?.since_ms,
    ftMoved: arrivals[0]?.ft_moved,
  });
}

const arrived = servingRallies.filter((r) => r.arrived);
const noArrive = servingRallies.filter((r) => !r.arrived);
const noArriveOpportunity = noArrive.filter((r) => r.hadOpportunity);
const noArriveNoOpp = noArrive.filter((r) => !r.hadOpportunity);

console.log(`\n── On the serving team: ${servingRallies.length} rallies ──`);
console.log(`   reached kitchen:        ${arrived.length}`);
console.log(`   did NOT reach kitchen:  ${noArrive.length}`);
console.log(`     · had opportunity:    ${noArriveOpportunity.length}  ← coachable`);
console.log(`     · no opportunity:     ${noArriveNoOpp.length}  (rally too short etc)`);

console.log(`\n── Coachable misses (had opportunity, didn't arrive) ──`);
for (const r of noArriveOpportunity) {
  const score = r.score ? `${r.score[0]}-${r.score[1]}` : "?";
  const who = r.iServed ? "served" : "partner served";
  console.log(
    `  rally #${r.rally_index}  ${fmtMs(r.start_ms)}–${fmtMs(r.end_ms)}  score ${score}  ${who}  shots=${r.shot_count}  duration=${(r.duration_ms/1000).toFixed(1)}s`,
  );
}

console.log(`\n── Did not arrive but rally was too short to count ──`);
for (const r of noArriveNoOpp) {
  const score = r.score ? `${r.score[0]}-${r.score[1]}` : "?";
  console.log(`  rally #${r.rally_index}  ${fmtMs(r.start_ms)}  shots=${r.shot_count}  duration=${(r.duration_ms/1000).toFixed(1)}s`);
}

console.log(`\n── Arrived rallies (all ${arrived.length}) ──`);
for (const r of arrived) {
  const score = r.score ? `${r.score[0]}-${r.score[1]}` : "?";
  console.log(`  rally #${r.rally_index}  ${fmtMs(r.start_ms)}  arrived at ${(r.sinceMs/1000).toFixed(1)}s into rally  (moved x=${r.ftMoved?.x.toFixed(1)} y=${r.ftMoved?.y.toFixed(1)} ft)`);
}
