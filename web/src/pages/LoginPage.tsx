import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function LoginPage() {
  const { signInWithMagicLink, user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already signed in
  if (user) {
    setTimeout(() => navigate(next, { replace: true }), 0);
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const redirect = `${window.location.origin}${next}`;
    const { error: err } = await signInWithMagicLink(email.trim(), redirect);
    setSubmitting(false);
    if (err) {
      setError(err.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div
      style={{
        fontFamily: "system-ui",
        maxWidth: 380,
        margin: "80px auto",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Rating Hub</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>Sign in with a magic link</p>

      {sent ? (
        <div
          style={{
            padding: "20px 16px",
            background: "#f0f4ff",
            border: "1px solid #d4dff7",
            borderRadius: 10,
            fontSize: 14,
            color: "#333",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>✉️</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Check your inbox</div>
          <div style={{ color: "#666", fontSize: 13 }}>
            We sent a sign-in link to <strong>{email}</strong>.
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            style={{
              padding: "10px 12px",
              fontSize: 14,
              borderRadius: 8,
              border: "1px solid #ddd",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={submitting || !email}
            style={{
              padding: "10px 14px",
              fontSize: 14,
              fontWeight: 600,
              background: submitting || !email ? "#9ab8e8" : "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: submitting || !email ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Sending…" : "Send magic link"}
          </button>
          {error && (
            <div style={{ color: "crimson", fontSize: 13, marginTop: 4 }}>{error}</div>
          )}
        </form>
      )}
    </div>
  );
}
