import { BaymonAgent } from '@/modules/baymon-agent';
import { ToolError, type ToolErrorCode } from '@/lib/tools/types';

/** Whether this build includes Baymon's Android module (the development build does; Expo Go doesn't). */
export const hasNativeAgent = process.env.EXPO_OS === 'android' && BaymonAgent !== null;

export function agent() {
  if (!hasNativeAgent || !BaymonAgent) {
    throw new ToolError(
      'This needs the Baymon development build on Android (screen control isn’t available in Expo Go).',
      'not_supported'
    );
  }
  return BaymonAgent;
}

/** Native exceptions carry codes derived from their Kotlin class names. */
const NATIVE_CODES: Record<string, ToolErrorCode> = {
  ERR_SCREEN_ACCESS_OFF: 'permission_missing',
  ERR_NOTIFICATION_ACCESS_OFF: 'permission_missing',
  ERR_ALL_FILES_ACCESS_OFF: 'permission_missing',
  ERR_ELEMENT_NOT_FOUND: 'not_found',
  ERR_APP_NOT_FOUND: 'app_not_installed',
  ERR_NO_HANDLER: 'not_supported',
  ERR_ACTION_FAILED: 'failed',
};

export function toToolError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  const code = (e as { code?: string } | null)?.code;
  const message = e instanceof Error ? e.message : String(e);
  return new ToolError(message, (code && NATIVE_CODES[code]) || 'failed');
}
