/**
 * ConfirmModal — shared confirmation dialog used instead of `window.confirm`.
 *
 * Native `confirm()` is blocking, looks jarring against the rest of the UI,
 * can't carry rich copy / styling, and some browsers deprioritize it. Every
 * "are you sure" prompt in this app routes through this component. See
 * docs/DESIGN_PREFERENCES.md §"Destructive-action confirmations".
 *
 * Usage:
 *   const [show, setShow] = useState(false);
 *   ...
 *   <button onClick={() => setShow(true)}>Delete</button>
 *   {show && (
 *     <ConfirmModal
 *       title="Delete this sequence?"
 *       body="It'll be removed from the review queue."
 *       confirmLabel="Delete"
 *       onCancel={() => setShow(false)}
 *       onConfirm={async () => { await deleteIt(); setShow(false); }}
 *     />
 *   )}
 */

import { useEffect, type ReactNode } from "react";

interface Props {
  title: string;
  /** Body copy — can be a string or any JSX. */
  body?: ReactNode;
  /** Primary action button text. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Secondary button text. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action (red). Default true —
   *  most callers are delete/remove operations. */
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function ConfirmModal({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onCancel,
  onConfirm,
}: Props) {
  // Escape to cancel, Enter to confirm — same affordances as native confirm
  // plus the benefit of actually looking like our app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") void onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  const confirmColor = destructive ? "#c62828" : "#1a73e8";

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
        role="dialog"
        aria-modal="true"
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
          {title}
        </h3>
        {body && (
          <div
            style={{
              margin: "10px 0 16px 0",
              fontSize: 13,
              color: "#555",
              lineHeight: 1.5,
            }}
          >
            {body}
          </div>
        )}
        {!body && <div style={{ height: 8 }} />}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontFamily: "inherit",
              background: "#fff",
              color: "#333",
              border: "1px solid #ccc",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => void onConfirm()}
            autoFocus
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              background: confirmColor,
              color: "#fff",
              border: `1px solid ${confirmColor}`,
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
