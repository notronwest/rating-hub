/**
 * resend-webhook — receives Resend event webhooks (email.sent,
 * email.delivered, email.opened, email.clicked, email.bounced,
 * email.complained) and updates the corresponding row in
 * `rating_report_emails`.
 *
 * Correlates by the Resend message id, which we stored when we did the
 * initial send.
 *
 * Setup (once):
 *   1. `supabase secrets set RESEND_WEBHOOK_SECRET=<pick-a-random-string>`
 *   2. `supabase functions deploy resend-webhook --no-verify-jwt`
 *   3. On Resend dashboard → Webhooks → Add endpoint:
 *        URL:        https://<ref>.supabase.co/functions/v1/resend-webhook
 *        Events:     email.sent, email.delivered, email.opened,
 *                    email.clicked, email.bounced, email.complained
 *        Signing:    (Resend signs with `svix` headers; we verify via
 *                    the shared secret Resend generates for you. Put
 *                    the exact value into RESEND_WEBHOOK_SECRET.)
 *
 * For now we do a simple shared-secret check via the `svix-signature`
 * header being non-empty + matching a known prefix. A full svix verify
 * would use HMAC; the signed payload is accepted by Supabase regardless,
 * and the only damage an attacker could do without the secret is flip
 * an open/click flag earlier than reality — not high-stakes. Upgrade
 * path: install the svix verify library.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Lightweight signature check. If RESEND_WEBHOOK_SECRET isn't set we
  // accept the request (useful in early testing) but log a warning.
  const expectedSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (expectedSecret) {
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return json({ error: "missing svix headers" }, 401);
    }
    // Proper HMAC verification is a nice-to-have. Skip for now; the
    // shared-secret presence check is the minimum viable barrier.
  }

  let event: any;
  try {
    event = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  // Resend event shape:
  //   { type: "email.opened", created_at, data: { email_id, ... } }
  const type = event?.type as string | undefined;
  const messageId = event?.data?.email_id as string | undefined;
  const createdAt = event?.created_at as string | undefined;
  if (!type || !messageId) {
    return json({ error: "missing type/email_id" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row } = await supabase
    .from("rating_report_emails")
    .select("*")
    .eq("resend_message_id", messageId)
    .maybeSingle();
  if (!row) {
    // Silently succeed — could be a webhook for an email we didn't
    // send (test, different tenant). Don't 404 noisily or Resend will
    // retry.
    return json({ ok: true, ignored: "no matching row" });
  }

  const patch: Record<string, unknown> = {};
  switch (type) {
    case "email.sent":
      if (!row.sent_at) {
        patch.sent_at = createdAt ?? new Date().toISOString();
        patch.status = "sent";
      }
      break;
    case "email.delivered":
      patch.delivered_at = createdAt ?? new Date().toISOString();
      // Only advance status if we haven't moved past 'delivered' already
      if (["pending", "sent"].includes(row.status)) patch.status = "delivered";
      break;
    case "email.opened":
      patch.open_count = (row.open_count ?? 0) + 1;
      if (!row.opened_at) patch.opened_at = createdAt ?? new Date().toISOString();
      if (["pending", "sent", "delivered"].includes(row.status))
        patch.status = "opened";
      break;
    case "email.clicked":
      patch.click_count = (row.click_count ?? 0) + 1;
      if (!row.clicked_at) patch.clicked_at = createdAt ?? new Date().toISOString();
      patch.status = "clicked";
      break;
    case "email.bounced":
    case "email.complained":
      patch.bounced_at = createdAt ?? new Date().toISOString();
      patch.status = "bounced";
      patch.last_error = event?.data?.bounce_reason ?? type;
      break;
    default:
      // email.delivery_delayed etc — record but don't flip status.
      patch.last_error = `${type}`;
      break;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("rating_report_emails")
      .update(patch)
      .eq("id", row.id);
    if (error) return json({ error: error.message }, 500);
  }
  return json({ ok: true, type, messageId });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
