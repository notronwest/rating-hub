/**
 * SendRatingReportPdfButton — reusable "email this page as a PDF to the
 * player" button.
 *
 * The button:
 *   1. Grabs the capture target (via CSS selector — passed in by the
 *      caller so it works on the player profile AND the standalone
 *      rating-report page).
 *   2. Clones it off-screen, stripping anything with `.prr-noprint`
 *      so toolbars / dev-only chrome don't end up in the PDF.
 *   3. Runs html2pdf.js to produce a letter-size PDF blob.
 *   4. Base64-encodes + POSTs to `send-rating-report-pdf`, which
 *      attaches it to a short Resend email.
 *
 * Dynamic-imports html2pdf so the library (~350KB) only loads when the
 * coach actually hits the button.
 */

import { useState } from "react";
import { sendRatingReportPdf } from "../../lib/coachApi";

interface Props {
  /** CSS selector for the DOM node to capture. We clone this node
   *  before handing it to html2canvas, so mutations are safe. */
  targetSelector: string;
  playerId: string;
  playerEmail: string | null;
  playerDisplayName: string;
  /** Optional — session sends fold into the session's delivery log.
   *  Rolling-window sends (player profile) pass undefined. */
  sessionId?: string;
  /** Used for the downloaded filename + email confirmation. Defaults
   *  to the player's slugified name + today's date. */
  filenameHint?: string;
  /** Style override for contexts where the default button look is
   *  wrong (e.g. a dark toolbar). */
  variant?: "primary" | "outline";
}

type Status = "idle" | "generating" | "sending" | "sent" | "error";

export default function SendRatingReportPdfButton({
  targetSelector,
  playerId,
  playerEmail,
  playerDisplayName,
  sessionId,
  filenameHint,
  variant = "outline",
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!playerEmail) return null; // no email → nothing to send

  async function doSend() {
    setConfirmOpen(false);
    setStatus("generating");
    setMsg(null);
    let holder: HTMLElement | null = null;
    try {
      const root = document.querySelector<HTMLElement>(targetSelector);
      if (!root)
        throw new Error(`Couldn't find "${targetSelector}" on the page.`);

      // Clone + strip `.prr-noprint` / `.ppd-noprint` nodes so the PDF
      // captures exactly the report content, no toolbars.
      const clone = root.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll<HTMLElement>(".prr-noprint, .ppd-noprint")
        .forEach((el) => el.remove());

      holder = document.createElement("div");
      holder.style.position = "fixed";
      holder.style.left = "-10000px";
      holder.style.top = "0";
      holder.style.width = `${root.offsetWidth}px`;
      holder.appendChild(clone);
      document.body.appendChild(holder);

      const filename = filenameHint ?? buildFilename(playerDisplayName);
      const html2pdfMod: { default: (...a: unknown[]) => any } = await import(
        // @ts-expect-error — html2pdf.js ships without TS types
        "html2pdf.js"
      );
      const html2pdf = html2pdfMod.default;
      // Charts render as a single SVG — we need html2pdf to treat each
      // one as atomic so the page break never slices through a donut.
      // `avoid` takes CSS selectors; the wrappers in PlayerDetailPage
      // set breakInside: avoid inline too, but specifying it here
      // again ensures html2pdf's own break logic (beyond native CSS)
      // respects the boundary.
      const blob: Blob = await html2pdf()
        .from(clone)
        .set({
          margin: 0.4,
          filename,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
          },
          jsPDF: {
            unit: "in",
            format: "letter",
            orientation: "portrait",
          },
          pagebreak: {
            mode: ["css", "legacy"],
            avoid: [
              "svg",
              // The whole overview block (Win rates + Play Style +
              // Shot Type) is short enough to fit on a page together.
              // Keeping it atomic prevents breaks between a chart's
              // heading and its donut.
              ".ppd-overview-grid",
              ".ppd-overview-grid > div",
              // Serve+Return speed pair — keep both side-by-side
              // histograms on one page. The grid is one-chart-tall
              // so it always fits; the old behavior was splitting
              // a single card's title from its chart body.
              ".ppd-speed-grid",
              ".speed-histogram-card",
              ".recharts-wrapper",
              ".recharts-surface",
            ],
          },
        })
        .outputPdf("blob");

      setStatus("sending");
      const pdfBase64 = await blobToBase64(blob);
      await sendRatingReportPdf({
        playerId,
        sessionId,
        pdfBase64,
        filename,
      });
      setStatus("sent");
      setMsg(`Sent to ${playerEmail}`);
      setTimeout(() => setStatus("idle"), 4000);
    } catch (e) {
      setStatus("error");
      setMsg((e as Error).message);
    } finally {
      if (holder && holder.parentNode) {
        holder.parentNode.removeChild(holder);
      }
    }
  }

  const disabled = status === "generating" || status === "sending";
  const label =
    status === "generating"
      ? "Rendering PDF…"
      : status === "sending"
      ? "Sending…"
      : status === "sent"
      ? "✓ Sent"
      : "📧 Send PDF to player";

  // Style palette shared with the other pill buttons used around the
  // report — outline (quiet) vs primary (emphatic).
  const style: React.CSSProperties =
    status === "sent"
      ? {
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          background: "#1e7e34",
          color: "#fff",
          border: "1px solid #1e7e34",
          borderRadius: 6,
          cursor: disabled ? "wait" : "pointer",
          fontFamily: "inherit",
        }
      : variant === "primary"
      ? {
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          background: "#1a73e8",
          color: "#fff",
          border: "1px solid #1a73e8",
          borderRadius: 6,
          cursor: disabled ? "wait" : "pointer",
          fontFamily: "inherit",
          opacity: disabled ? 0.8 : 1,
        }
      : {
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          background: "#fff",
          color: "#1a73e8",
          border: "1px solid #1a73e8",
          borderRadius: 6,
          cursor: disabled ? "wait" : "pointer",
          fontFamily: "inherit",
          opacity: disabled ? 0.8 : 1,
        };

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={disabled}
        title={`Email the current report as a PDF to ${playerEmail}`}
        style={style}
      >
        {label}
      </button>
      {status === "error" && msg && (
        <div
          style={{
            marginLeft: 8,
            padding: "4px 10px",
            background: "#f8d7da",
            color: "#721c24",
            border: "1px solid #f5c6cb",
            borderRadius: 4,
            fontSize: 11,
            maxWidth: 320,
          }}
        >
          {msg}
          <button
            onClick={() => setStatus("idle")}
            style={{
              marginLeft: 8,
              background: "transparent",
              border: "none",
              color: "#721c24",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            ×
          </button>
        </div>
      )}
      {confirmOpen && (
        <ConfirmModal
          email={playerEmail}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doSend}
        />
      )}
    </>
  );
}

function ConfirmModal({
  email,
  onCancel,
  onConfirm,
}: {
  email: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: 20,
          width: "min(420px, 92vw)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
          fontFamily: "inherit",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#222" }}>
          Send this report?
        </h3>
        <p style={{ margin: "10px 0 16px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
          The current page will be rendered to a PDF and emailed as an
          attachment to <b>{email}</b>. The delivery will show up in the
          rating-report delivery log.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              background: "#fff",
              color: "#333",
              border: "1px solid #ccc",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "#1a73e8",
              color: "#fff",
              border: "1px solid #1a73e8",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function buildFilename(playerName: string): string {
  const slug = playerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `wmpc-rating-${slug}-${date}.pdf`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.replace(/^data:[^;]+;base64,/, ""));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
