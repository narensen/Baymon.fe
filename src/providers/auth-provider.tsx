import type { Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';

import {
  describeError,
  fetchOrCreateProfile,
  normalizeUsername,
  updateProfile,
  type Profile,
  type ProfileUpdate,
} from '@/lib/profile';
import { supabase } from '@/lib/supabase';

type SignUpInput = {
  email: string;
  password: string;
  username: string;
  displayName: string;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  /** True until the persisted session has been read. */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves `needsConfirmation: true` when the project requires email confirmation. */
  signUp: (input: SignUpInput) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  saveProfile: (patch: ProfileUpdate) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider />');
  return value;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  // Tagged with its owner so a stale profile is never shown after switching accounts.
  const [loaded, setLoaded] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const user = session?.user;
  const profile = user && loaded?.user_id === user.id ? loaded : null;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchOrCreateProfile(user)
      .then((next) => !cancelled && setLoaded(next))
      .catch((error) => console.warn('Failed to load profile:', describeError(error)));
    return () => {
      cancelled = true;
    };
    // Re-run only when the signed-in user changes, not on every token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value: AuthContextValue = {
    session,
    profile,
    isLoading,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(describeError(error));
    },
    async signUp({ email, password, username, displayName }) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // Read by the `handle_new_user` trigger (and by the client fallback) to create the profile row.
        options: {
          data: { username: normalizeUsername(username), display_name: displayName.trim() },
        },
      });
      if (error) throw new Error(describeError(error));
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(describeError(error));
    },
    async saveProfile(patch) {
      if (!user) return;
      setLoaded(await updateProfile(user.id, patch));
    },
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}
