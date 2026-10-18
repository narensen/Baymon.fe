import { conversation } from '@/lib/conversation';
import { openNudge } from '@/lib/nudges/open';

/** "baymon://nudge/x?voice=1" (or "/nudge/x?voice=1") → ["nudge", "x"] and the query. */
function parse(path: string) {
  const rest = path.replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/^\/+/, '');
  const [route, query = ''] = rest.split('#')[0].split('?');
  const parts = route.split('/').filter((p) => p && p !== '--').map(decodeURIComponent);
  const params = new Map(
    query
      .split('&')
      .filter(Boolean)
      .map((kv) => {
        const [k, v = ''] = kv.split('=');
        return [decodeURIComponent(k), decodeURIComponent(v)] as const;
      })
  );
  return { parts, params };
}

/**
 * Links Baymon opens itself, handled before any screen mounts. All of them land on the chat:
 * - baymon://nudge/<id>: the floating bubble (`?voice=1` from its mic, `?edit=1` from Edit);
 * - baymon://talk: the Quick Settings tile, the widget and the wake word (talk mode, listening).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const { parts, params } = parse(path);
    if (parts[0] === 'talk') {
      conversation.startTalk();
      return '/';
    }
    if (parts[0] === 'nudge' && parts[1]) {
      void openNudge(parts[1], {
        ...(params.get('voice') === '1' && { voice: true }),
        ...(params.get('edit') === '1' && { edit: true }),
      });
      return '/';
    }
    return path;
  } catch {
    return path;
  }
}
