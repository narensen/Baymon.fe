import { BaymonAgent } from '@/modules/baymon-agent';
import { conversation } from '@/lib/conversation';
import { nudgeApi } from '@/lib/nudges/api';
import { ensureNudgeUser, nudgeStore } from '@/lib/nudges/store';
import { preferences } from '@/lib/preferences';
import { hasNativeAgent } from '@/lib/tools/native';

/** Answer by voice when the setting says so: always, or when headphones or car audio are connected. */
function wantsVoice() {
  const setting = preferences.get().bubbleVoice;
  if (setting !== 'headphones') return setting === 'always';
  if (!hasNativeAgent || !BaymonAgent) return false;
  try {
    return BaymonAgent.getAudioOutput() !== 'speaker';
  } catch {
    return false;
  }
}

/**
 * Opens a bubble: Baymon's message (with its drafted reply and quick replies) goes into the chat
 * and the server hears it was opened. Works from the in-app bubble, the floating bubble's deep link
 * and a notification tap, including a cold start. `voice` reads it out and listens; `edit` opens
 * the draft. Resolves false if the nudge can't be found.
 */
export async function openNudge(id: string, options: { voice?: boolean; edit?: boolean } = {}): Promise<boolean> {
  const userId = await ensureNudgeUser();
  if (!userId) return false;
  // Load the saved conversation first, so the message is added to it rather than replaced by it.
  conversation.hydrate(userId);

  let nudge = nudgeStore.get(id);
  if (!nudge) {
    const server = await nudgeApi.active().catch(() => []);
    nudgeStore.restore(server);
    nudge = nudgeStore.get(id);
  }
  if (!nudge) return false;

  const voice = options.voice ?? (!options.edit && wantsVoice());
  conversation.addNudge(nudge, { voice, edit: options.edit });
  nudgeStore.act(id, 'opened');
  return true;
}
