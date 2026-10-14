import { supabase } from '@/lib/supabase';

/** Base URL of the Baymon API (FastAPI on Render), without a trailing slash. */
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

/** Render's free tier can take ~50s to wake, so allow a generous default. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Mirrors the API's `{"error": {"code", "message"}}` envelope. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0
  ) {
    super(message);
  }
}

/** Server messages meant for developers, reworded for people. Others are shown as the API sends them. */
const FRIENDLY: Record<string, string> = {
  // Memory rows reference public.users; signing in again recreates a missing row (see fetchOrCreateProfile).
  user_not_found: 'Your account isn’t fully set up. Sign out and sign in again.',
};

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON-serialised unless it's FormData (sent as multipart). */
  body?: unknown;
  timeoutMs?: number;
};

/** Authenticated request to `/v1/*`; throws `ApiError` for non-2xx. The user id comes from the token server-side. */
export async function request(path: string, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS }: Options = {}) {
  if (!API_URL) {
    throw new ApiError('EXPO_PUBLIC_API_URL is not set. Add it to .env.local.', 'config_missing');
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('You’re signed out. Sign in again.', 'unauthorized', 401);

  const isForm = body instanceof FormData;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && !isForm && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (e) {
    if (controller.signal.aborted) throw new ApiError('Baymon took too long to respond. Try again.', 'timeout');
    const message = e instanceof Error ? e.message : String(e);
    // Only genuine connectivity failures get the generic message; anything else (e.g. a body the
    // client can't encode) is a bug worth seeing as-is.
    if (/network|failed to fetch|connect|unreachable|internet|host|socket|timed? ?out/i.test(message)) {
      throw new ApiError('Can’t reach Baymon. Check your connection.', 'network');
    }
    throw new ApiError(`Couldn’t send the request: ${message}`, 'client');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError('Your session expired. Sign in again.', 'unauthorized', 401);
    }
    const error = (await response.json().catch(() => null))?.error;
    throw new ApiError(
      FRIENDLY[error?.code] ?? error?.message ?? `Request failed (${response.status})`,
      error?.code ?? 'http_error',
      response.status
    );
  }
  return response;
}

/** `request` + JSON body (undefined for 204). */
export async function api<T>(path: string, options?: Options): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
