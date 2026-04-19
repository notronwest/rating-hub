import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export type OrgRole = "coach" | "admin" | "viewer";

export interface UserOrgRole {
  org_id: string;
  role: OrgRole;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  roles: UserOrgRole[];
  loading: boolean;
  signInWithMagicLink: (email: string, redirectTo?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<UserOrgRole[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchRoles(userId: string): Promise<UserOrgRole[]> {
    const { data, error } = await supabase
      .from("user_org_roles")
      .select("org_id, role")
      .eq("user_id", userId);
    if (error) {
      console.warn("Failed to fetch roles:", error.message);
      return [];
    }
    return data ?? [];
  }

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
        if (data.session?.user) {
          // Defer DB query to avoid deadlocking Supabase's session lock
          void fetchRoles(data.session.user.id).then((r) => {
            if (!cancelled) setRoles(r);
          });
        }
      })
      .catch((e) => {
        console.error("[auth] getSession failed:", e);
        if (!cancelled) setLoading(false);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, sess) => {
      // CRITICAL: no await / no db queries inside this callback.
      // Supabase-js holds an internal lock during this callback; any
      // query that calls getSession() internally will deadlock.
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        // Defer the DB query — breaks out of the callback's lock
        setTimeout(() => {
          if (cancelled) return;
          void fetchRoles(sess.user.id).then((r) => {
            if (!cancelled) setRoles(r);
          });
        }, 0);
      } else {
        setRoles([]);
      }
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function signInWithMagicLink(email: string, redirectTo?: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    return { error: error as Error | null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, session, roles, loading, signInWithMagicLink, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
