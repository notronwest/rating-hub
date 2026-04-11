import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabase";

type Org = { id: string; slug: string; name: string };

export default function OrgPickerPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("organizations")
      .select("id, slug, name")
      .order("name")
      .then(({ data }) => {
        setOrgs(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div
      style={{
        fontFamily: "system-ui",
        maxWidth: 480,
        margin: "80px auto",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        Rating Hub
      </h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
        Choose your organization
      </p>

      {loading ? (
        <p>Loading…</p>
      ) : orgs.length === 0 ? (
        <p style={{ color: "#999" }}>No organizations found.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {orgs.map((org) => (
            <Link
              key={org.slug}
              to={`/org/${org.slug}/players`}
              style={{
                display: "block",
                padding: "16px 20px",
                border: "1px solid #ddd",
                borderRadius: 10,
                textDecoration: "none",
                color: "#333",
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              {org.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
