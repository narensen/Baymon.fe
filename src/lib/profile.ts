import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** Mirrors `public.users`. */
export type Profile = {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  created_on: string;
};

export type ProfileUpdate = Partial<Pick<Profile, 'username' | 'display_name' | 'role'>>;

/** Roles offered in Settings. `role` is free text in the schema, so extend this list as needed. */
export const ROLES = ['user', 'admin'] as const;

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): string | null {
  if (value.length < 3) return 'At least 3 characters';
  if (value.length > 24) return 'At most 24 characters';
  if (!USERNAME_PATTERN.test(value)) return 'Lowercase letters, numbers and _ only';
  return null;
}

const COLUMNS = 'user_id, username, display_name, role, created_on';

/**
 * Loads the signed-in user's row. If it doesn't exist yet (e.g. the signup trigger isn't installed),
 * it's created from the metadata captured at signup.
 */
export async function fetchOrCreateProfile(user: User): Promise<Profile> {
  const { data, error } = await supabase
    .from('users')
    .select(COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle<Profile>();
  if (error) throw error;
  if (data) return data;

  const meta = user.user_metadata ?? {};
  const fallbackName = user.email?.split('@')[0] ?? 'user';
  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert({
      user_id: user.id,
      username: normalizeUsername(meta.username ?? `${fallbackName}_${user.id.slice(0, 4)}`),
      display_name: meta.display_name ?? fallbackName,
    })
    .select(COLUMNS)
    .single<Profile>();
  if (insertError) throw insertError;
  return created;
}

export async function updateProfile(userId: string, patch: ProfileUpdate): Promise<Profile> {
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('user_id', userId)
    .select(COLUMNS)
    .single<Profile>();
  if (error) throw new Error(describeError(error));
  return data;
}

/**
 * Returns `null` when availability can't be determined (e.g. the RPC isn't deployed);
 * the unique constraint remains the source of truth.
 */
export async function isUsernameAvailable(username: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('username_available', { p_username: username });
  if (error) return null;
  return Boolean(data);
}

/** Turns Postgres/Auth errors into something a person can act on. */
export function describeError(error: { message?: string; code?: string }): string {
  const message = error.message ?? '';
  if (error.code === '23505' || /users_username_key|duplicate key/i.test(message)) {
    return 'That username is already taken';
  }
  if (/database error saving new user/i.test(message)) {
    return 'That username is already taken';
  }
  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect';
  if (/email not confirmed/i.test(message)) return 'Confirm your email before signing in';
  if (/user already registered/i.test(message)) return 'An account with this email already exists';
  if (/network request failed|fetch failed/i.test(message)) return 'No connection. Try again';
  return message || 'Something went wrong';
}
