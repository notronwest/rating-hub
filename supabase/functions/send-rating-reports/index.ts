/**
 * send-rating-reports — Supabase Edge Function that emails a per-player
 * rating report recap for a given session.
 *
 * Input: { sessionId: UUID, playerIds?: UUID[], sentBy?: UUID }
 *   - sessionId: required. The session to summarize.
 *   - playerIds: optional whitelist. If omitted, emails every player in
 *     the session that has an email address on file.
 *   - sentBy: optional. The coach's user id, recorded in the log table.
 *
 * For each recipient the function:
 *   1. Inserts a `rating_report_emails` row with status='pending'.
 *   2. Builds an HTML email with the player's last-N-games (session
 *      scope) stats + tier-colored key metrics + a CTA to the full
 *      report.
 *   3. Hits Resend's REST API.
 *   4. Updates the row with the Resend message id + status='sent' (or
 *      records last_error + status='failed').
 *
 * Env:
 *   RESEND_API_KEY            — Resend API key, `re_...`
 *   WEBHOOK_SECRET            — Bearer token the browser supplies
 *   RATING_REPORT_FROM        — From address, default
 *                               "WMPC Ratings <ratings@whitemountainpickleball.com>"
 *   RATING_REPORT_BASE_URL    — Public base URL for the rating report
 *                               link. Default cloudflare prod URL.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const RESEND_URL = "https://api.resend.com/emails";
// Send from the Resend-verified subdomain (send.whitemountainpickleball.com)
// so we never touch the root-domain SPF/DKIM that Google Workspace relies
// on. Replies route to the root-domain address which IS a real Google
// Workspace inbox — see `reply_to` below.
const DEFAULT_FROM =
  "WMPC Ratings <ratings@send.whitemountainpickleball.com>";
const DEFAULT_REPLY_TO = "ratings@whitemountainpickleball.com";

Deno.serve(async (req) => {
  // CORS preflight — see send-rating-report-pdf for context.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || token !== secret) return json({ error: "unauthorized" }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY not set" }, 500);

  let payload: { sessionId?: string; playerIds?: string[]; sentBy?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const { sessionId, playerIds, sentBy } = payload;
  if (!sessionId) return json({ error: "sessionId required" }, 400);

  const FROM = Deno.env.get("RATING_REPORT_FROM") ?? DEFAULT_FROM;
  const REPLY_TO = Deno.env.get("RATING_REPORT_REPLY_TO") ?? DEFAULT_REPLY_TO;
  const BASE_URL =
    Deno.env.get("RATING_REPORT_BASE_URL") ??
    "https://ratings.whitemountainpickleball.com";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Gather session + games + players ────────────────────────────
  const { data: session } = await supabase
    .from("sessions")
    .select("id, label, played_date, org_id")
    .eq("id", sessionId)
    .single();
  if (!session) return json({ error: "session not found" }, 404);

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug")
    .eq("id", session.org_id)
    .single();
  if (!org) return json({ error: "org not found" }, 404);

  const { data: games } = await supabase
    .from("games")
    .select("id, session_name, played_at")
    .eq("session_id", sessionId);
  const gameIds = (games ?? []).map((g: any) => g.id);
  if (gameIds.length === 0)
    return json({ error: "session has no games" }, 400);

  const { data: gps } = await supabase
    .from("game_players")
    .select("*")
    .in("game_id", gameIds);
  const gpsList = (gps ?? []) as any[];

  // Whittle to the requested players (or all with emails).
  const sessionPlayerIds = Array.from(
    new Set(gpsList.map((gp) => gp.player_id as string)),
  );
  const targetIds =
    playerIds && playerIds.length > 0
      ? sessionPlayerIds.filter((id) => playerIds.includes(id))
      : sessionPlayerIds;

  const { data: players } = await supabase
    .from("players")
    .select("id, display_name, slug, email, avatar_url")
    .in("id", targetIds);
  const playerList = (players ?? []) as any[];

  const results: Array<{
    playerId: string;
    email: string | null;
    logId?: string;
    status: string;
    error?: string;
  }> = [];

  // Fetch the extra data we need to draw each player's email body.
  const { data: rallies } = await supabase
    .from("rallies")
    .select("id, game_id")
    .in("game_id", gameIds);
  const ralliesList = (rallies ?? []) as any[];
  // We don't actually need the shots here — the email uses aggregated
  // game_player fields only. Stats that need shot-level (e.g. 3rd-shot
  // in%) are computed client-side on the web report; the email stays
  // server-cheap.

  for (const p of playerList) {
    if (!p.email) {
      results.push({
        playerId: p.id,
        email: null,
        status: "skipped_no_email",
      });
      continue;
    }

    // Insert a log row first so a crash mid-send doesn't lose the fact
    // we tried.
    const { data: logRows, error: logErr } = await supabase
      .from("rating_report_emails")
      .insert({
        org_id: session.org_id,
        session_id: sessionId,
        player_id: p.id,
        email_to: p.email,
        sent_by: sentBy ?? null,
        status: "pending",
      })
      .select()
      .single();
    if (logErr || !logRows) {
      results.push({
        playerId: p.id,
        email: p.email,
        status: "failed",
        error: `log insert: ${logErr?.message ?? "unknown"}`,
      });
      continue;
    }
    const logId = logRows.id as string;

    // Build the HTML body.
    const playerGps = gpsList.filter((gp) => gp.player_id === p.id);
    const html = renderEmailHtml({
      player: p,
      session,
      orgSlug: org.slug,
      gamePlayers: playerGps,
      totalRallies: ralliesList.length,
      baseUrl: BASE_URL,
    });
    const subject = `Your WMPC rating report — ${session.label ?? "session"}`;

    const resendRes = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [p.email],
        reply_to: REPLY_TO,
        subject,
        html,
        tags: [
          { name: "kind", value: "rating_report" },
          { name: "session", value: String(sessionId) },
          { name: "player", value: String(p.id) },
          { name: "log", value: String(logId) },
        ],
      }),
    });
    if (!resendRes.ok) {
      const errText = await resendRes.text();
      await supabase
        .from("rating_report_emails")
        .update({
          status: "failed",
          last_error: `Resend ${resendRes.status}: ${errText.slice(0, 500)}`,
        })
        .eq("id", logId);
      results.push({
        playerId: p.id,
        email: p.email,
        logId,
        status: "failed",
        error: `Resend ${resendRes.status}`,
      });
      continue;
    }
    const resendBody = await resendRes.json();
    const messageId = resendBody?.id as string | undefined;

    await supabase
      .from("rating_report_emails")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        resend_message_id: messageId ?? null,
      })
      .eq("id", logId);

    results.push({
      playerId: p.id,
      email: p.email,
      logId,
      status: "sent",
    });
  }

  return json({ results }, 200);
});

// ─────────────────────────── HTML template ───────────────────────────

function renderEmailHtml(args: {
  player: any;
  session: any;
  orgSlug: string;
  gamePlayers: any[];
  totalRallies: number;
  baseUrl: string;
}): string {
  const { player, session, orgSlug, gamePlayers, baseUrl } = args;

  // Aggregate ratings + key %s — same math as the web report's KeyStats
  // block but computed inline (server-cheap, no shared module).
  const avg = (pick: (gp: any) => number | null): number | null => {
    const vals = gamePlayers
      .map(pick)
      .filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const overall = avg((gp) => gp.rating_overall);
  const serve = avg((gp) => gp.rating_serve);
  const ret = avg((gp) => gp.rating_return);
  const offense = avg((gp) => gp.rating_offense);
  const defense = avg((gp) => gp.rating_defense);

  const depthInPct = (d: any): number | null => {
    if (!d) return null;
    const t = (d.deep ?? 0) + (d.medium ?? 0) + (d.shallow ?? 0) + (d.net ?? 0) + (d.out ?? 0);
    if (t === 0) return null;
    return (((d.deep ?? 0) + (d.medium ?? 0) + (d.shallow ?? 0)) / t) * 100;
  };
  const depthDeepPct = (d: any): number | null => {
    if (!d) return null;
    const t = (d.deep ?? 0) + (d.medium ?? 0) + (d.shallow ?? 0) + (d.net ?? 0) + (d.out ?? 0);
    if (t === 0) return null;
    return ((d.deep ?? 0) / t) * 100;
  };
  const arrivalPct = (f: any): number | null => {
    if (!f || !f.denominator) return null;
    return (f.numerator / f.denominator) * 100;
  };
  const accuracyInPct = (a: any): number | null => {
    if (!a) return null;
    const t = (a.in ?? 0) + (a.out ?? 0) + (a.net ?? 0);
    if (t === 0) return null;
    return ((a.in ?? 0) / t) * 100;
  };

  const serveInPct = avgPct(gamePlayers.map((gp) => depthInPct(gp.serve_depth)));
  const serveDeepPct = avgPct(gamePlayers.map((gp) => depthDeepPct(gp.serve_depth)));
  const returnInPct = avgPct(gamePlayers.map((gp) => depthInPct(gp.return_depth)));
  const returnDeepPct = avgPct(gamePlayers.map((gp) => depthDeepPct(gp.return_depth)));
  const shotsInPct = avgPct(
    gamePlayers.map((gp) => accuracyInPct(gp.shot_accuracy)),
  );
  const kitchenServePct = avgPct(
    gamePlayers.map((gp) =>
      arrivalPct(gp.kitchen_arrival_pct?.serving?.oneself ?? null),
    ),
  );
  const kitchenReturnPct = avgPct(
    gamePlayers.map((gp) =>
      arrivalPct(gp.kitchen_arrival_pct?.returning?.oneself ?? null),
    ),
  );

  const reportUrl = `${baseUrl}/org/${orgSlug}/sessions/${session.id}/rating-report?playerId=${player.id}`;
  const sessionLabel = escapeHtml(session.label ?? "Your session");
  const dateStr = new Date(session.played_date).toLocaleDateString();
  const firstName = escapeHtml(player.display_name.split(" ")[0]);

  // Inline-style HTML — no external CSS. Tier colors mirror the web
  // report. Tested in Gmail + Apple Mail + Outlook web.
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${sessionLabel} — ${escapeHtml(player.display_name)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;">
    <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.04);">
        <!-- Header -->
        <div style="padding:24px 28px;border-bottom:3px solid #1a73e8;">
          <div style="font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase;font-weight:700;">WMPC rating report</div>
          <div style="display:flex;align-items:baseline;gap:14px;margin-top:6px;">
            <h1 style="margin:0;font-size:26px;font-weight:700;color:#222;">Hey ${firstName} 👋</h1>
          </div>
          <div style="font-size:13px;color:#555;margin-top:6px;">${sessionLabel} · ${dateStr} · ${gamePlayers.length} ${gamePlayers.length === 1 ? "game" : "games"}</div>
        </div>

        <!-- Overall rating headline -->
        <div style="padding:18px 28px;background:#eef3ff;display:flex;align-items:center;gap:16px;">
          <div style="flex:1;">
            <div style="font-size:12px;color:#555;font-weight:600;">Your overall rating this session</div>
            <div style="font-size:42px;font-weight:700;color:#1a73e8;line-height:1;margin-top:4px;">${fmtNum(overall)}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:#333;line-height:1.6;">
            <div><b>Serve</b> ${fmtNum(serve)}</div>
            <div><b>Return</b> ${fmtNum(ret)}</div>
            <div><b>Offense</b> ${fmtNum(offense)}</div>
            <div><b>Defense</b> ${fmtNum(defense)}</div>
          </div>
        </div>

        <!-- Key stats table -->
        <div style="padding:18px 28px;">
          <div style="font-size:11px;color:#1a73e8;letter-spacing:0.5px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Key stats</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 6px;">
            ${renderTierRow([
              { label: "Shots in", v: shotsInPct },
              { label: "Serves in", v: serveInPct },
              { label: "Serve deep", v: serveDeepPct },
            ])}
            ${renderTierRow([
              { label: "Returns in", v: returnInPct },
              { label: "Return deep", v: returnDeepPct },
              { label: "Kitchen on serve", v: kitchenServePct },
            ])}
            ${renderTierRow([
              { label: "Kitchen on return", v: kitchenReturnPct },
              { label: "", v: null, hidden: true },
              { label: "", v: null, hidden: true },
            ])}
          </table>

          <!-- Tier legend -->
          <div style="margin-top:14px;font-size:11px;color:#666;">
            <span style="background:#fdecea;color:#c62828;padding:2px 6px;border-radius:3px;font-weight:700;">Needs work</span> &lt; 60% &nbsp;·&nbsp;
            <span style="background:#fff3cd;color:#d97706;padding:2px 6px;border-radius:3px;font-weight:700;">OK</span> 60–70% &nbsp;·&nbsp;
            <span style="background:#e6f4ea;color:#1e7e34;padding:2px 6px;border-radius:3px;font-weight:700;">Good</span> 71–89% &nbsp;·&nbsp;
            <span style="background:#e7f1fa;color:#0b6ea8;padding:2px 6px;border-radius:3px;font-weight:700;">Great</span> 90–100%
          </div>
        </div>

        <!-- Auto bullets -->
        ${renderBullets(shotsInPct, serveInPct, serveDeepPct, returnInPct, returnDeepPct, kitchenServePct, kitchenReturnPct)}

        <!-- CTA -->
        <div style="padding:20px 28px 28px;text-align:center;">
          <a href="${reportUrl}" style="display:inline-block;padding:14px 28px;background:#1a73e8;color:#fff;text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;">
            📊 View your full report
          </a>
          <div style="font-size:11px;color:#888;margin-top:10px;">Includes per-game charts, trends, and a detailed breakdown.</div>
        </div>
      </div>

      <!-- Footer -->
      <div style="text-align:center;font-size:11px;color:#888;margin-top:18px;line-height:1.6;">
        Sent by White Mountain Pickleball Club · Reply to this email or write <a href="mailto:ratings@whitemountainpickleball.com" style="color:#888;">ratings@whitemountainpickleball.com</a>
      </div>
    </div>
  </body>
</html>`;
}

function renderTierRow(
  cells: Array<{ label: string; v: number | null; hidden?: boolean }>,
): string {
  return `<tr>${cells
    .map((c) => {
      if (c.hidden)
        return `<td width="33%" style="padding:0;border:none;"></td>`;
      const t = tierFor(c.v);
      const bg = t?.tint ?? "#fff";
      const fg = t?.color ?? "#222";
      const border = t ? `${t.color}55` : "#e2e2e2";
      return `<td width="33%" style="padding:10px 12px;background:${bg};border:1px solid ${border};border-radius:6px;">
        <div style="font-size:10px;text-transform:uppercase;color:#888;letter-spacing:0.5px;font-weight:700;">${escapeHtml(c.label)}</div>
        <div style="font-size:18px;font-weight:700;color:${fg};margin-top:2px;">
          ${fmtPct(c.v)}
          ${t ? `<span style="font-size:9px;background:${t.color};color:#fff;padding:1px 6px;border-radius:3px;margin-left:6px;letter-spacing:0.4px;vertical-align:middle;">${t.label.toUpperCase()}</span>` : ""}
        </div>
      </td>`;
    })
    .join("")}</tr>`;
}

function renderBullets(
  shotsIn: number | null,
  servesIn: number | null,
  serveDeep: number | null,
  returnsIn: number | null,
  returnDeep: number | null,
  kitchenServe: number | null,
  kitchenReturn: number | null,
): string {
  const tiered: Array<{ v: number | null; good: string; work: string }> = [
    {
      v: shotsIn,
      good: "Your overall shot-in rate is holding up well.",
      work: "Focus on shot selection — too many ended up out or in the net.",
    },
    {
      v: servesIn,
      good: "Solid serve-in rate.",
      work: "Work on serve consistency — more are missing than ideal.",
    },
    {
      v: serveDeep,
      good: "You're getting plenty of depth on the serve.",
      work: "Try to serve deeper more often to push opponents off the baseline.",
    },
    {
      v: returnsIn,
      good: "Solid return consistency.",
      work: "Return-in rate is low — focus on clearing the net with margin.",
    },
    {
      v: returnDeep,
      good: "You're hitting returns deep.",
      work: "Hit returns deeper — more of them are landing short than ideal.",
    },
    {
      v: kitchenServe,
      good: "Getting to the kitchen on serve.",
      work: "On serve, prioritize getting up to the kitchen line.",
    },
    {
      v: kitchenReturn,
      good: "Great kitchen arrival on return.",
      work: "Follow your return up to the kitchen line more consistently.",
    },
  ];

  const good: string[] = [];
  const work: string[] = [];
  for (const t of tiered) {
    if (t.v == null) continue;
    if (t.v >= 71) good.push(t.good);
    else if (t.v < 60) work.push(t.work);
  }

  if (good.length === 0 && work.length === 0) return "";

  return `<div style="padding:0 28px 8px;">
    ${
      good.length > 0
        ? `<div style="margin-bottom:12px;background:#e6f4ea;border-left:3px solid #1e7e34;padding:10px 14px;border-radius:4px;">
      <div style="font-size:11px;color:#1e7e34;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">What's working</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:#333;">
        ${good.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
      </ul>
    </div>`
        : ""
    }
    ${
      work.length > 0
        ? `<div style="background:#fdecea;border-left:3px solid #c62828;padding:10px 14px;border-radius:4px;">
      <div style="font-size:11px;color:#c62828;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Work on</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:#333;">
        ${work.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
      </ul>
    </div>`
        : ""
    }
  </div>`;
}

interface TierSpec {
  label: string;
  color: string;
  tint: string;
}
function tierFor(v: number | null): TierSpec | null {
  if (v == null) return null;
  if (v < 60) return { label: "Needs work", color: "#c62828", tint: "#fdecea" };
  if (v <= 70) return { label: "OK", color: "#d97706", tint: "#fff3cd" };
  if (v <= 89) return { label: "Good", color: "#1e7e34", tint: "#e6f4ea" };
  return { label: "Great", color: "#0b6ea8", tint: "#e7f1fa" };
}

// ─────────────────────────── tiny helpers ───────────────────────────

function avgPct(values: Array<number | null>): number | null {
  const ok = values.filter((v): v is number => v != null);
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function fmtNum(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
