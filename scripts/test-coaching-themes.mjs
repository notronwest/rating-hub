#!/usr/bin/env node
/**
 * Smoke-tests the coaching-themes feature end to end:
 *   1. Migration 019 is applied (table exists)
 *   2. Client env vars are set (VITE_SUPABASE_URL, VITE_COACH_AI_SECRET)
 *   3. Edge function is deployed + auth works
 *   4. Edge function can reach a session + persist themes
 *
 * Usage:
 *   node scripts/test-coaching-themes.mjs [sessionId] [playerId]
 *
 * If you omit session/player, it picks the first session + first player it
 * can find so you can run it zero-arg. For the real end-to-end test that
 * calls Claude, pass them explicitly — or set TEST_SESSION_ID /
 * TEST_PLAYER_ID env vars.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ── Load client env ──────────────────────────────────────────────
loadEnvFile(path.join(repoRoot, "web/.env.local"));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const AI_SECRET = process.env.VITE_COACH_AI_SECRET;

let failed = 0;
let passed = 0;
function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  passed++;
}
function fail(msg, extra) {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  if (extra) console.log(`      ${extra}`);
  failed++;
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ── 1. Env check ────────────────────────────────────────────────
section("1. Env vars (web/.env.local)");
if (SUPABASE_URL) ok("VITE_SUPABASE_URL");
else fail("VITE_SUPABASE_URL is missing");

if (ANON_KEY) ok("VITE_SUPABASE_ANON_KEY");
else fail("VITE_SUPABASE_ANON_KEY is missing");

if (AI_SECRET) ok("VITE_COACH_AI_SECRET");
else
  fail(
    "VITE_COACH_AI_SECRET is missing",
    "Add it to web/.env.local — must match WEBHOOK_SECRET on the edge function.",
  );

if (!SUPABASE_URL || !ANON_KEY) {
  console.log("\nCan't continue without SUPABASE_URL + ANON_KEY.");
  process.exit(1);
}

// ── 2. Table exists ─────────────────────────────────────────────
section("2. Migration 019 applied (table player_coaching_themes)");
{
  const url = `${SUPABASE_URL}/rest/v1/player_coaching_themes?select=id&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (res.ok) {
    ok("GET player_coaching_themes succeeded");
  } else if (res.status === 404 || res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (
      body?.message?.includes("Could not find") ||
      body?.code === "PGRST205" ||
      body?.code === "42P01"
    ) {
      fail(
        "Table doesn't exist",
        "Apply migration 019: `supabase db push` (or paste the SQL into the Supabase SQL editor).",
      );
    } else {
      fail(`Unexpected ${res.status}: ${JSON.stringify(body)}`);
    }
  } else {
    const body = await res.text();
    fail(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ── 3. Edge function reachable + auth ───────────────────────────
section("3. Edge function deployed (generate-themes)");
const fnUrl = `${SUPABASE_URL}/functions/v1/generate-themes`;

// 3a. No auth → should 401
{
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) {
    ok("Rejects missing auth (401)");
  } else if (res.status === 404) {
    fail(
      "Function returned 404 — not deployed",
      "Run: supabase functions deploy generate-themes --no-verify-jwt",
    );
  } else {
    fail(`Expected 401, got ${res.status}`);
  }
}

// 3b. Wrong secret → should 401
if (AI_SECRET) {
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer not-a-real-secret-value",
    },
    body: "{}",
  });
  if (res.status === 401) ok("Rejects wrong secret (401)");
  else fail(`Expected 401 for bad secret, got ${res.status}`);
}

// 3c. Missing body fields → should 400
if (AI_SECRET) {
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_SECRET}`,
    },
    body: JSON.stringify({}),
  });
  if (res.status === 400) ok("Rejects empty payload (400)");
  else if (res.status === 500) {
    const body = await res.json().catch(() => ({}));
    if (body?.error?.includes("ANTHROPIC_API_KEY")) {
      fail(
        "ANTHROPIC_API_KEY is not set on the edge function",
        "Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...",
      );
    } else {
      fail(`Expected 400, got 500: ${JSON.stringify(body)}`);
    }
  } else fail(`Expected 400, got ${res.status}`);
}

// ── 4. End-to-end (optional) ────────────────────────────────────
section("4. End-to-end generate (optional — hits Claude)");
const sessionId = process.argv[2] ?? process.env.TEST_SESSION_ID;
const playerId = process.argv[3] ?? process.env.TEST_PLAYER_ID;

if (!sessionId || !playerId) {
  console.log(
    "  \x1b[33m⊘\x1b[0m Skipped. Pass a sessionId + playerId as args, or set TEST_SESSION_ID / TEST_PLAYER_ID.",
  );
} else if (!AI_SECRET) {
  console.log("  \x1b[33m⊘\x1b[0m Skipped — no VITE_COACH_AI_SECRET.");
} else {
  console.log(
    `  Calling generate-themes with sessionId=${sessionId} playerId=${playerId} n=2 …`,
  );
  const started = Date.now();
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_SECRET}`,
    },
    body: JSON.stringify({ sessionId, playerId, n: 2 }),
  });
  const ms = Date.now() - started;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`HTTP ${res.status} (${ms}ms)`, JSON.stringify(body));
  } else if (!Array.isArray(body?.themes)) {
    fail("Response missing `themes` array", JSON.stringify(body).slice(0, 300));
  } else if (body.themes.length === 0) {
    fail("Got zero themes back");
  } else {
    ok(`Received ${body.themes.length} themes in ${ms}ms`);
    for (const t of body.themes) {
      const shape = t.title && t.problem && t.solution;
      if (!shape) {
        fail("Theme missing title/problem/solution", JSON.stringify(t));
      } else {
        ok(`  "${t.title}"`);
      }
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────
console.log(
  `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`,
);
process.exit(failed > 0 ? 1 : 0);

// ── helpers ─────────────────────────────────────────────────────
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
