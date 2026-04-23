#!/usr/bin/env node
/**
 * Smoke-tests the rating-report email pipeline:
 *   1. Migration 020 is applied (rating_report_emails table exists)
 *   2. VITE_COACH_AI_SECRET is set and matches the edge function secret
 *   3. send-rating-reports is deployed and enforces auth
 *   4. Optional: end-to-end send to a real session, inspecting the log
 *      row that the function inserts.
 *
 * Usage:
 *   # Config-only
 *   node scripts/test-rating-report-email.mjs
 *
 *   # Full send — DO THIS WITH CARE, it actually emails players
 *   node scripts/test-rating-report-email.mjs <sessionId>
 *   # With specific recipients only
 *   node scripts/test-rating-report-email.mjs <sessionId> <playerId1,playerId2>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
loadEnvFile(path.join(repoRoot, "web/.env.local"));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const AI_SECRET = process.env.VITE_COACH_AI_SECRET;

let failed = 0;
let passed = 0;
const ok = (m) => {
  console.log(`  \x1b[32m✓\x1b[0m ${m}`);
  passed++;
};
const fail = (m, extra) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (extra) console.log(`      ${extra}`);
  failed++;
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ── 1. Env ──────────────────────────────────────────────────
section("1. Env vars (web/.env.local)");
SUPABASE_URL ? ok("VITE_SUPABASE_URL") : fail("VITE_SUPABASE_URL missing");
ANON_KEY ? ok("VITE_SUPABASE_ANON_KEY") : fail("VITE_SUPABASE_ANON_KEY missing");
AI_SECRET
  ? ok("VITE_COACH_AI_SECRET (shared with edge-function WEBHOOK_SECRET)")
  : fail("VITE_COACH_AI_SECRET missing");

if (!SUPABASE_URL || !ANON_KEY) {
  console.log("\nCan't continue without SUPABASE_URL + ANON_KEY.");
  process.exit(1);
}

// ── 2. Table exists ─────────────────────────────────────────
section("2. Migration 020 applied (rating_report_emails)");
{
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rating_report_emails?select=id&limit=1`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
  );
  if (res.ok) ok("GET rating_report_emails succeeded");
  else {
    const body = await res.json().catch(() => ({}));
    if (
      body?.code === "PGRST205" ||
      body?.code === "42P01" ||
      body?.message?.includes("Could not find")
    ) {
      fail(
        "Table doesn't exist",
        "Apply migration 020: `supabase db push` (or paste the SQL into the Supabase SQL editor).",
      );
    } else fail(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
}

// ── 3. Edge function deployed + auth enforced ───────────────
section("3. Edge function deployed (send-rating-reports)");
const fnUrl = `${SUPABASE_URL}/functions/v1/send-rating-reports`;

{
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) ok("Rejects missing auth (401)");
  else if (res.status === 404)
    fail(
      "Function returned 404 — not deployed",
      "Run: supabase functions deploy send-rating-reports --no-verify-jwt",
    );
  else fail(`Expected 401, got ${res.status}`);
}

if (AI_SECRET) {
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer wrong",
    },
    body: "{}",
  });
  if (res.status === 401) ok("Rejects wrong secret (401)");
  else fail(`Expected 401 for bad secret, got ${res.status}`);
}

if (AI_SECRET) {
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_SECRET}`,
    },
    body: "{}",
  });
  if (res.status === 400) ok("Rejects empty payload (400)");
  else if (res.status === 500) {
    const body = await res.json().catch(() => ({}));
    if (body?.error?.includes("RESEND_API_KEY")) {
      fail(
        "RESEND_API_KEY is not set on the edge function",
        "Run: supabase secrets set RESEND_API_KEY=re_...",
      );
    } else fail(`Expected 400, got 500: ${JSON.stringify(body)}`);
  } else fail(`Expected 400, got ${res.status}`);
}

// ── 4. End-to-end (optional, REAL EMAIL) ────────────────────
section("4. End-to-end send (optional — actually emails recipients)");
const sessionId = process.argv[2];
const playerIdsArg = process.argv[3];
if (!sessionId) {
  console.log(
    "  \x1b[33m⊘\x1b[0m Skipped. Pass a sessionId to send for real.",
  );
} else if (!AI_SECRET) {
  console.log("  \x1b[33m⊘\x1b[0m Skipped — no VITE_COACH_AI_SECRET.");
} else {
  const playerIds = playerIdsArg ? playerIdsArg.split(",") : undefined;
  console.log(
    `  \x1b[33m⚠\x1b[0m About to send real emails for session ${sessionId}${
      playerIds ? ` to players ${playerIds.join(", ")}` : " to every player with an email on file"
    }…`,
  );
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_SECRET}`,
    },
    body: JSON.stringify({ sessionId, playerIds }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`HTTP ${res.status}`, JSON.stringify(body).slice(0, 400));
  } else if (!Array.isArray(body?.results)) {
    fail("Response missing `results` array", JSON.stringify(body));
  } else if (body.results.length === 0) {
    fail("Got zero results — session may have no players with emails");
  } else {
    const sent = body.results.filter((r) => r.status === "sent");
    const skipped = body.results.filter((r) => r.status.startsWith("skipped"));
    const failedSends = body.results.filter(
      (r) => r.status === "failed",
    );
    ok(
      `${sent.length} sent · ${skipped.length} skipped · ${failedSends.length} failed`,
    );
    for (const r of body.results) {
      const line = `  ${r.playerId.slice(0, 8)}  ${r.email ?? "(no email)"}  → ${r.status}`;
      if (r.status === "sent") ok(line);
      else if (r.status === "failed") fail(line, r.error);
      else console.log(`      ${line}`);
    }
  }
}

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
