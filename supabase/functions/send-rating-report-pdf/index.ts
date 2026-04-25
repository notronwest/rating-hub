/**
 * send-rating-report-pdf — emails a single player their rating report
 * as a PDF attachment. The client generates the PDF from the rendered
 * report DOM (html2pdf.js) and base64-encodes it; we attach it to a
 * short HTML email via Resend.
 *
 * Why client-side PDF instead of server-side: Supabase edge functions
 * don't ship with a headless browser, and a third-party render service
 * adds a dependency + billing. The browser already lays out the report
 * perfectly under @media print; we just need to capture it.
 *
 * Input:
 *   { sessionId?: UUID,   // null for rolling-window (player profile) sends
 *     playerId:  UUID,
 *     pdfBase64: string,
 *     filename?: string,
 *     sentBy?:   UUID }
 *
 * Logs to the same `rating_report_emails` table as send-rating-reports
 * so the Session Detail page's delivery log shows both kinds of sends.
 *
 * Env:
 *   RESEND_API_KEY
 *   WEBHOOK_SECRET
 *   RATING_REPORT_FROM      (default: same as send-rating-reports)
 *   RATING_REPORT_REPLY_TO  (default: ratings@whitemountainpickleball.com)
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM =
  "WMPC Ratings <ratings@send.whitemountainpickleball.com>";
const DEFAULT_REPLY_TO = "ratings@whitemountainpickleball.com";
// Guardrail — Resend rejects attachments > 40MB base64. A typical
// rating report PDF is < 500KB; anything > 5MB is almost certainly a
// client-side generation bug producing huge embedded images.
const MAX_PDF_BYTES = 5 * 1024 * 1024;

Deno.serve(async (req) => {
  // CORS preflight — browsers send OPTIONS before the POST when the
  // call crosses origin or carries custom headers (Authorization,
  // Content-Type: application/json). Return 204 with the allowed
  // methods/headers so the real request can proceed.
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

  let body: {
    sessionId?: string;
    playerId?: string;
    pdfBase64?: string;
    filename?: string;
    sentBy?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const { sessionId, playerId, pdfBase64, filename, sentBy } = body;
  if (!playerId || !pdfBase64) {
    return json(
      { error: "playerId and pdfBase64 are required" },
      400,
    );
  }

  // Rough size check on the base64 string — actual bytes are ~3/4 of
  // the string length, but bailing on the raw length is fine as a cap.
  if (pdfBase64.length * 0.75 > MAX_PDF_BYTES) {
    return json(
      {
        error: `PDF attachment too large (> ${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB). Something is probably wrong client-side.`,
      },
      413,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Gather just enough context for the email subject + first-name
  // greeting. All the substance lives in the attached PDF.
  const { data: player } = await supabase
    .from("players")
    .select("id, display_name, email, org_id")
    .eq("id", playerId)
    .single();
  if (!player) return json({ error: "player not found" }, 404);
  if (!player.email)
    return json({ error: "player has no email on file" }, 400);

  // Session context is optional — rolling "last N games" reports sent
  // from the player profile page don't belong to a single session.
  let session: {
    id: string;
    label: string | null;
    played_date: string | null;
    org_id: string;
  } | null = null;
  if (sessionId) {
    const { data } = await supabase
      .from("sessions")
      .select("id, label, played_date, org_id")
      .eq("id", sessionId)
      .single();
    if (!data) return json({ error: "session not found" }, 404);
    session = data as typeof session;
  }
  const orgId = session?.org_id ?? (player.org_id as string);

  const FROM = Deno.env.get("RATING_REPORT_FROM") ?? DEFAULT_FROM;
  const REPLY_TO =
    Deno.env.get("RATING_REPORT_REPLY_TO") ?? DEFAULT_REPLY_TO;

  // Log row first so a crash mid-send is visible.
  const { data: logRow, error: logErr } = await supabase
    .from("rating_report_emails")
    .insert({
      org_id: orgId,
      session_id: sessionId ?? null,
      player_id: playerId,
      email_to: player.email,
      sent_by: sentBy ?? null,
      status: "pending",
    })
    .select()
    .single();
  if (logErr || !logRow) {
    return json(
      { error: `log insert: ${logErr?.message ?? "unknown"}` },
      500,
    );
  }
  const logId = logRow.id as string;

  const firstName = escapeHtml(player.display_name.split(" ")[0]);
  const sessionLabel = session ? escapeHtml(session.label ?? "your session") : null;
  const dateStr = session?.played_date
    ? new Date(session.played_date).toLocaleDateString()
    : new Date().toLocaleDateString();
  // Session-scoped sends call out the session; rolling-window sends
  // just say "your latest rating report".
  const subject = session
    ? `Your WMPC rating report — ${session.label ?? "session"}`
    : "Your WMPC rating report";
  const bodyLead = sessionLabel
    ? `Your rating report from <b>${sessionLabel}</b> on ${dateStr} is attached.`
    : `Your latest rating report is attached (generated ${dateStr}).`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:10px;padding:26px;box-shadow:0 2px 10px rgba(0,0,0,0.04);">
      <div style="font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase;font-weight:700;">WMPC rating report</div>
      <h1 style="margin:6px 0 14px;font-size:22px;font-weight:700;color:#222;">Hey ${firstName} 👋</h1>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333;">
        ${bodyLead}
        Open the PDF to see your ratings, tier-coded key stats, what's
        working, and what to work on.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:#555;">
        Questions? Just reply to this email and it'll reach the club.
      </p>
    </div>
    <div style="text-align:center;font-size:11px;color:#888;margin-top:16px;line-height:1.6;">
      Sent by White Mountain Pickleball Club · <a href="mailto:${REPLY_TO}" style="color:#888;">${REPLY_TO}</a>
    </div>
  </div>
</body></html>`;

  const safeFilename =
    (filename && /^[A-Za-z0-9 ._-]+\.pdf$/.test(filename) ? filename : null) ??
    buildDefaultFilename(
      player.display_name,
      session?.played_date ?? new Date().toISOString().slice(0, 10),
    );

  const resendRes = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [player.email],
      reply_to: REPLY_TO,
      subject,
      html,
      attachments: [
        {
          filename: safeFilename,
          content: pdfBase64,
          // Resend supports base64 strings on `content` directly when
          // you pass `contentType`. The string must be the raw base64
          // payload (no data-url prefix).
          contentType: "application/pdf",
        },
      ],
      tags: [
        { name: "kind", value: "rating_report_pdf" },
        ...(sessionId
          ? [{ name: "session", value: String(sessionId) }]
          : [{ name: "scope", value: "rolling" }]),
        { name: "player", value: String(playerId) },
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
    return json(
      {
        status: "failed",
        error: `Resend ${resendRes.status}: ${errText.slice(0, 300)}`,
      },
      502,
    );
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

  return json(
    { status: "sent", logId, messageId, email: player.email },
    200,
  );
});

function buildDefaultFilename(playerName: string, date: string): string {
  const slug = playerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `wmpc-rating-${slug}-${date}.pdf`;
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
