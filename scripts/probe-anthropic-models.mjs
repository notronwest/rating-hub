#!/usr/bin/env node
/**
 * Lists the Claude models available to your Anthropic API key. Pick a
 * Haiku-tier model from the output and set it on the edge function:
 *
 *   supabase secrets set THEMES_MODEL=<id from this list>
 *
 * Takes the key from the ANTHROPIC_API_KEY env var — that key never leaves
 * your shell; this script just calls api.anthropic.com/v1/models.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/probe-anthropic-models.mjs
 */
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error(
    "Set ANTHROPIC_API_KEY in your shell first:\n" +
      "  ANTHROPIC_API_KEY=sk-ant-... node scripts/probe-anthropic-models.mjs",
  );
  process.exit(1);
}

const res = await fetch("https://api.anthropic.com/v1/models", {
  headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01" },
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { data } = await res.json();
if (!Array.isArray(data) || data.length === 0) {
  console.log("No models returned.");
  process.exit(0);
}

console.log(`\nModels available to this key (${data.length}):\n`);
// Sort: haiku first (cheapest), then sonnet, then opus, newest first.
const tier = (id) =>
  id.includes("haiku") ? 0 : id.includes("sonnet") ? 1 : id.includes("opus") ? 2 : 3;
data.sort((a, b) => {
  if (tier(a.id) !== tier(b.id)) return tier(a.id) - tier(b.id);
  return b.id.localeCompare(a.id);
});
const pad = Math.max(...data.map((m) => m.id.length));
for (const m of data) {
  const line = `  ${m.id.padEnd(pad)}   ${m.display_name ?? ""}`;
  const isHaiku = m.id.includes("haiku");
  console.log(isHaiku ? `\x1b[32m${line}\x1b[0m` : line);
}

const firstHaiku = data.find((m) => m.id.includes("haiku"));
if (firstHaiku) {
  console.log(
    `\n\x1b[1mRecommended for generate-themes (cheap):\x1b[0m ${firstHaiku.id}\n` +
      `Set it on the edge function:\n` +
      `  supabase secrets set THEMES_MODEL=${firstHaiku.id}\n`,
  );
} else {
  console.log(
    "\nNo Haiku available to this key. Sonnet works but costs ~10× more per call.",
  );
}
