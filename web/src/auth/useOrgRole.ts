import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth, type OrgRole } from "./AuthProvider";

/**
 * Returns the user's role for the given org slug.
 * Resolves the org slug → org UUID, then matches against cached user_org_roles.
 * Returns null if no session, still loading, or no role in that org.
 */
export function useOrgRole(orgSlug: string | undefined): OrgRole | null {
  const { roles, user, loading } = useAuth();
  const [orgUuid, setOrgUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!orgSlug) {
      setOrgUuid(null);
      return;
    }
    supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .maybeSingle()
      .then(({ data }) => setOrgUuid(data?.id ?? null));
  }, [orgSlug]);

  if (loading || !user || !orgUuid) return null;

  const match = roles.find((r) => r.org_id === orgUuid);
  return match?.role ?? null;
}

/** True if the user has coach or admin role for the given org slug. */
export function useIsCoach(orgSlug: string | undefined): boolean {
  const role = useOrgRole(orgSlug);
  return role === "coach" || role === "admin";
}
