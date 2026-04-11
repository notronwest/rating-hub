import fs from "node:fs";
import path from "node:path";
import admin from "firebase-admin";

const ORG_ID = process.env.ORG_ID || "wmppc";
const SERVICE_ACCOUNT_PATH =
  process.env.SERVICE_ACCOUNT_PATH || "../serviceAccountKey.json";
const INPUT_PATH = process.env.INPUT_PATH; // required

if (!INPUT_PATH) {
  console.error(
    "Missing INPUT_PATH. Example: INPUT_PATH=./insights.json node import-pbvision-json.mjs"
  );
  process.exit(1);
}

const serviceAccount = JSON.parse(
  fs.readFileSync(path.resolve(SERVICE_ACCOUNT_PATH), "utf8")
);

admin.initializeApp({
  projectId: wmpcmemberhub,
});

const db = admin.firestore();

const raw = fs.readFileSync(path.resolve(INPUT_PATH), "utf8");
const json = JSON.parse(raw);

/**
 * You’ll adapt this once we inspect your JSON shape.
 * For MVP, we try a few common patterns:
 * - json.players (array)
 * - json.data.players (array)
 * - json (array) as players
 */
const players =
  json?.players || json?.data?.players || (Array.isArray(json) ? json : null);

if (!players || !Array.isArray(players)) {
  console.error(
    "Could not find a players array in the JSON. We need the JSON shape."
  );
  console.error("Top-level keys:", Object.keys(json || {}));
  process.exit(1);
}

let upserts = 0;

for (const p of players) {
  // Try common fields; we’ll finalize after we look at your exact file.
  const playerId = String(p.playerId || p.id || p.slug || p.name || "");
  const displayName = String(
    p.displayName || p.name || `${p.firstName || ""} ${p.lastName || ""}`.trim()
  );

  if (!playerId || !displayName) continue;

  const docId = `${ORG_ID}_${playerId}`;
  await db.collection("orgPlayers").doc(docId).set(
    {
      orgId: ORG_ID,
      playerId,
      displayName,
      pbvisionStats: p, // store raw snapshot for now
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      isPublic: true,
    },
    { merge: true }
  );

  upserts += 1;
}

console.log(`Done. Upserted ${upserts} orgPlayers for orgId=${ORG_ID}`);
