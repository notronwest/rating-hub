#!/usr/bin/env node
/**
 * prune-placeholder-players.mjs
 *
 * When the pbvision-webhook fires before a pb.vision video has been tagged,
 * it creates generic player rows named "Player 1", "Player 2", etc. Once the
 * real names are tagged and the webhook re-fires, game_players gets rewritten
 * with the real player UUIDs — but the placeholder player rows stay behind.
 *
 * This script finds those orphaned placeholder rows and deletes them.
 * A row is considered a placeholder if ALL of:
 *   - display_name matches ^Player \d+$
 *   - slug matches ^player-\d+$
 *   - not referenced by any game_players row
 *   - not referenced by any player_rating_snapshots row
 *
 * Usage:
 *   # Preview what would be deleted (default):
 *   node scripts/prune-placeholder-players.mjs
 *
 *   # Actually delete:
 *   node scripts/prune-placeholder-players.mjs --apply
 *
 * Env vars (same as sync-pbvision.mjs):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (needed — deletes bypass RLS)
 *   ORG_ID                     (slug; default "wmppc")
 */

let createClient;
try {
  ({ createClient } = await import("@supabase/supabase-js"));
} catch {
  // Fall back to the copy bundled with the web app (same pattern as sync-pbvision.mjs)
  ({ createClient } = await import(
    "../web/node_modules/@supabase/supabase-js/dist/index.mjs"
  ));
}

const APPLY = process.argv.includes("--apply");
const ORG_SLUG = process.env.ORG_ID || "wmppc";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const PLACEHOLDER_NAME_RE = /^Player \d+$/;
const PLACEHOLDER_SLUG_RE = /^player-\d+$/;

async function main() {
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .single();
  if (orgErr || !org) {
    console.error(`Org "${ORG_SLUG}" not found: ${orgErr?.message}`);
    process.exit(1);
  }

  const { data: candidates, error: cErr } = await supabase
    .from("players")
    .select("id, display_name, slug")
    .eq("org_id", org.id)
    .like("slug", "player-%");
  if (cErr) {
    console.error(`Failed to list players: ${cErr.message}`);
    process.exit(1);
  }

  const placeholders = (candidates ?? []).filter(
    (p) => PLACEHOLDER_NAME_RE.test(p.display_name) && PLACEHOLDER_SLUG_RE.test(p.slug),
  );
  if (placeholders.length === 0) {
    console.log("No placeholder players found. Nothing to do.");
    return;
  }

  const toDelete = [];
  for (const p of placeholders) {
    const { data: gpRows } = await supabase
      .from("game_players")
      .select("game_id, games(pbvision_video_id, session_id, session_index)")
      .eq("player_id", p.id);
    const { count: rsCount } = await supabase
      .from("player_rating_snapshots")
      .select("game_id", { count: "exact", head: true })
      .eq("player_id", p.id);
    const gpCount = gpRows?.length ?? 0;
    const refs = gpCount + (rsCount ?? 0);
    if (refs === 0) {
      toDelete.push(p);
    } else {
      console.log(
        `  skip "${p.display_name}" (${p.id}) — referenced by ${gpCount} game_players, ${rsCount} rating snapshots`,
      );
      const vids = new Set();
      for (const r of gpRows ?? []) {
        const g = r.games;
        if (g?.pbvision_video_id) vids.add(g.pbvision_video_id);
      }
      if (vids.size > 0) {
        console.log(`     re-sync these pb.vision videos to replace: ${[...vids].join(", ")}`);
      }
    }
  }

  console.log(
    `\nFound ${placeholders.length} placeholder candidate(s); ${toDelete.length} are unreferenced.`,
  );

  if (toDelete.length === 0) return;

  if (!APPLY) {
    console.log("\nDry run (pass --apply to delete):");
    for (const p of toDelete) {
      console.log(`  would delete: ${p.display_name} (${p.id})`);
    }
    return;
  }

  const ids = toDelete.map((p) => p.id);
  const { error: delErr } = await supabase.from("players").delete().in("id", ids);
  if (delErr) {
    console.error(`Delete failed: ${delErr.message}`);
    process.exit(1);
  }
  console.log(`Deleted ${ids.length} placeholder player(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
