import { useState } from "react";
import { importJson, detectFormat } from "../lib/importPbVision";

function errorToMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// Sort priority: compact first (creates games), then stats/insights (enrich)
const FORMAT_ORDER = { compact: 0, stats: 1, augmented_insights: 2 };

export function ImportPbVisionJson({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [importing, setImporting] = useState(false);

  function log(msg: string) {
    setStatus((s) => (s ? `${s}\n${msg}` : msg));
  }

  async function onFilesSelected(files: File[]) {
    setError("");
    setStatus("");
    if (files.length === 0) return;

    setImporting(true);
    try {
      log(`Reading ${files.length} file(s)…`);

      // Parse all files first so we can sort by format
      const parsed: { file: File; json: unknown; format: string }[] = [];
      for (const f of files) {
        const text = await f.text();
        const json = JSON.parse(text);
        const format = detectFormat(json);
        parsed.push({ file: f, json, format });
      }

      // Sort: compact first, then stats, then augmented insights
      parsed.sort(
        (a, b) =>
          (FORMAT_ORDER[a.format as keyof typeof FORMAT_ORDER] ?? 9) -
          (FORMAT_ORDER[b.format as keyof typeof FORMAT_ORDER] ?? 9),
      );

      const formatCounts = parsed.reduce(
        (acc, p) => {
          acc[p.format] = (acc[p.format] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      log(
        `Detected: ${Object.entries(formatCounts)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ")}. Processing compact first…\n`,
      );

      let totalGames = 0;
      let totalPlayers = 0;
      let totalRallies = 0;

      for (const { file, json } of parsed) {
        log(`Importing ${file.name}…`);
        const result = await importJson(orgId, json, file.name, log, dryRun);
        totalGames += result.gamesCreated;
        totalPlayers += result.playersProcessed;
        totalRallies += result.ralliesCreated;
      }

      log(
        `\nAll done. Games: ${totalGames}, Players: ${totalPlayers}, Rallies: ${totalRallies}`,
      );
    } catch (e: unknown) {
      console.error(e);
      setError(errorToMessage(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <h3>Import PB Vision JSON</h3>
      <p style={{ fontSize: 13, color: "#666", margin: "4px 0 8px" }}>
        Supports compact, stats, and augmented insights formats. Auto-detected
        and sorted (compact processed first).
      </p>

      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => setDryRun(e.target.checked)}
        />
        Dry run (parse only, don't write)
      </label>

      <div style={{ marginTop: 12 }}>
        <input
          type="file"
          accept="application/json,.json"
          multiple
          disabled={importing}
          onChange={(e) => onFilesSelected(Array.from(e.target.files ?? []))}
        />
      </div>

      {importing && (
        <div style={{ marginTop: 8, color: "#666" }}>Importing…</div>
      )}

      {status ? (
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 13 }}>
          {status}
        </pre>
      ) : null}

      {error ? (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <b>Error:</b> {error}
        </div>
      ) : null}
    </div>
  );
}
