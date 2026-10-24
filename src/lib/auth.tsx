import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Staff } from '../types';

interface AuthCtx {
  session: Session | null;
  user: User | null;
  staff: Staff | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

async function fetchStaff(authUserId: string): Promise<Staff | null> {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) console.error('[auth] fetchStaff error:', error.message);
  return data ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // undefined = auth state not yet known; null = signed out; User = signed in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  // ── 1. Sync auth state only — no async DB work inside the callback ──────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s ?? null);
      setUser(s?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        console.log('[auth] onAuthStateChange:', _event, newSession?.user?.id ?? 'none');
        setSession(newSession ?? null);
        setUser(newSession?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── 2. Fetch staff row whenever user changes (outside auth lock) ─────────
  useEffect(() => {
    if (user === undefined) return; // still waiting for initial auth check

    if (!user) {
      setStaff(null);
      setLoading(false);
      return;
    }

    // user is set — load their staff profile
    fetchStaff(user.id).then(row => {
      console.log('[auth] staff set:', row);
      setStaff(row);
      setLoading(false);
    });
  }, [user]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, user: user ?? null, staff, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
