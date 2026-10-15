import { useSyncExternalStore } from 'react';

import { chat, continueTurn, talkTurn, toSpeakable, type ChatMode, type ChatTurn, type ToolTurn, type Voice } from '@/lib/agent';
import { audioUriFromBase64 } from '@/lib/audio-files';
import { preferences } from '@/lib/preferences';
import { readJSON, writeJSON } from '@/lib/storage';
import { describeAction, runAction, type ActionResult } from '@/lib/tools';

/** One tool call Baymon made on the phone, as shown in the chat. */
export type Step = {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  error?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** User messages only: in flight or failed. */
  status?: 'pending' | 'error';
  error?: string;
  /** Spoken in talk mode rather than typed. */
  viaVoice?: boolean;
  /** Assistant only: what was spoken, and a playable URI for it (not persisted). */
  speech?: string | null;
  /** Assistant only, voice turns: short plain text shown under the orb (= what was spoken). */
  caption?: string;
  audioUri?: string;
  /** Non-fatal issues reported by the API (e.g. audio failed). */
  warnings?: string[];
  /** Created in this session (plays its entrance animation). Not persisted. */
  isNew?: boolean;
  /** Assistant only: what Baymon did on the phone to produce this reply. */
  steps?: Step[];
};

type State = {
  messages: ChatMessage[];
  mode: ChatMode;
  /** Waiting on the agent. */
  thinking: boolean;
  /** Tool calls of the turn in progress, live. */
  working: Step[] | null;
};

/** Persist only the tail; the API never looks further back than 20 turns anyway. */
const PERSIST_LIMIT = 80;
/** Tool rounds per turn. Operating an app takes many small steps (read, tap, read, type…). */
const MAX_ROUNDS = 25;

let state: State = { messages: [], mode: 'type', thinking: false, working: null };
let storageKey: string | null = null;
/** Bumped on clear/reset so late replies from an old conversation are dropped. */
let generation = 0;
const listeners = new Set<() => void>();

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function setState(next: Partial<State>, persist = true) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  if (persist && storageKey) {
    writeJSON(storageKey, {
      mode: state.mode,
      messages: state.messages
        .filter((m) => m.status !== 'pending')
        .slice(-PERSIST_LIMIT)
        .map(({ audioUri: _audio, isNew: _new, ...m }) => m),
    });
  }
}

function update(id: string, patch: Partial<ChatMessage>) {
  setState({ messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

type LoopOptions = { voice: boolean; mode: ChatMode; ttsVoice: Voice };

/** What chat, talk and continue responses have in common. */
type TurnReply = ToolTurn & {
  text: string;
  speech_text?: string | null;
  caption?: string | null;
  audio_base64?: string | null;
  mode?: ChatMode | null;
  warnings?: { code: string; message: string }[];
};

/**
 * Runs the tool loop for a turn: execute the reply's actions on the phone, send the results back,
 * repeat until the model is done. Returns the final reply (with the last non-empty text) and the
 * steps taken, or null if the turn was cancelled.
 */
async function settle(first: TurnReply, startedIn: number, options: LoopOptions) {
  let reply: TurnReply = first;
  let text = first.text;
  const steps: Step[] = [];
  for (let round = 0; reply.actions?.length && reply.turn_id && round < MAX_ROUNDS; round++) {
    const results: ActionResult[] = [];
    for (const action of reply.actions) {
      if (startedIn !== generation) return null;
      const index = steps.push({ id: action.id, tool: action.tool, label: describeAction(action), status: 'running' }) - 1;
      setState({ working: [...steps] }, false);
      const result = await runAction(action);
      steps[index] = {
        ...steps[index],
        status: result.status === 'done' ? 'done' : 'failed',
        error: result.error?.message,
      };
      setState({ working: [...steps] }, false);
      results.push(result);
    }
    if (startedIn !== generation) return null;
    reply = await continueTurn(reply.turn_id, results, options);
    if (reply.text?.trim()) text = reply.text;
  }
  return { reply: { ...reply, text }, steps };
}

/** Completed turns, formatted for the API's `history`. */
function history(): ChatTurn[] {
  return state.messages
    .filter((m) => !m.status && m.content)
    .map((m) => ({ role: m.role, content: m.content }));
}

export const conversation = {
  /** Load the signed-in user's saved conversation. */
  hydrate(userId: string) {
    const key = `baymon.chat.${userId}`;
    if (storageKey === key) return;
    storageKey = key;
    generation++;
    const saved = readJSON<{ mode?: ChatMode; messages?: ChatMessage[] }>(key);
    setState(
      {
        messages: (saved?.messages ?? []).map((m) => (m.status === 'pending' ? { ...m, status: 'error' as const } : m)),
        mode: saved?.mode === 'talk' ? 'talk' : 'type',
        thinking: false,
        working: null,
      },
      false
    );
  },

  getMode: () => state.mode,

  setMode(mode: ChatMode) {
    if (state.mode !== mode) setState({ mode });
  },

  /**
   * Send a message. Resolves with the agent's reply message, or `null` if it failed or the
   * conversation was cleared meanwhile. A mode switch requested by the agent is applied here.
   */
  async send(text: string, { viaVoice = false } = {}): Promise<ChatMessage | null> {
    const content = text.trim();
    if (!content) return null;
    const startedIn = generation;
    const prior = history();
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content,
      createdAt: Date.now(),
      status: 'pending',
      viaVoice,
      isNew: true,
    };
    setState({ messages: [...state.messages, userMessage], thinking: true });

    const { voice: ttsVoice, speakReplies } = preferences.get();
    const wantsAudio = viaVoice || state.mode === 'talk' || speakReplies;
    const mode = state.mode;
    try {
      const first = await chat({ message: content, history: prior, voice: wantsAudio, mode, ttsVoice });
      if (startedIn !== generation) return null;
      const settled = await settle(first, startedIn, { voice: wantsAudio, mode, ttsVoice });
      if (!settled) return null;
      const { reply, steps } = settled;
      const assistant: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: reply.text,
        createdAt: Date.now(),
        isNew: true,
        speech: reply.speech_text,
        audioUri: reply.audio_base64 ? audioUriFromBase64(reply.audio_base64) : undefined,
        warnings: reply.warnings?.length ? reply.warnings.map((w) => w.message) : undefined,
        steps: steps.length ? steps : undefined,
      };
      setState({
        messages: [...state.messages.map((m) => (m.id === userMessage.id ? { ...m, status: undefined } : m)), assistant],
        thinking: false,
        working: null,
        ...((reply.mode ?? first.mode) && { mode: reply.mode ?? first.mode ?? mode }),
      });
      return assistant;
    } catch (e) {
      if (startedIn !== generation) return null;
      update(userMessage.id, { status: 'error', error: e instanceof Error ? e.message : 'Couldn’t send' });
      setState({ thinking: false, working: null });
      throw e;
    }
  },

  /**
   * One hands-free voice turn from a recording. Both messages are added once the reply arrives
   * (the transcript isn't known before then on the single-request path).
   */
  async sendVoice(recordingUri: string, { onTranscript }: { onTranscript?: (text: string) => void } = {}) {
    const startedIn = generation;
    const ttsVoice = preferences.get().voice;
    setState({ thinking: true });
    try {
      const first = await talkTurn({ recordingUri, history: history(), ttsVoice, onTranscript });
      if (startedIn !== generation) return null;
      onTranscript?.(first.transcript);
      const settled = await settle(first, startedIn, { voice: true, mode: 'talk', ttsVoice });
      if (!settled) return null;
      const { reply, steps } = settled;
      // After tool rounds the final words come from the last reply; otherwise from /v1/talk itself.
      const caption = steps.length ? (reply.caption ?? reply.speech_text ?? toSpeakable(reply.text)) : first.caption;
      const audio = steps.length ? reply.audio_base64 : first.audio_base64;
      const now = Date.now();
      const user: ChatMessage = { id: newId(), role: 'user', content: first.transcript, createdAt: now, viaVoice: true, isNew: true };
      const assistant: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: reply.text,
        createdAt: now + 1,
        isNew: true,
        speech: caption,
        caption,
        audioUri: audio ? audioUriFromBase64(audio) : undefined,
        warnings: reply.warnings?.length ? reply.warnings.map((w) => w.message) : undefined,
        steps: steps.length ? steps : undefined,
      };
      const mode = reply.mode ?? first.mode;
      setState({
        messages: [...state.messages, user, assistant],
        thinking: false,
        working: null,
        ...(mode && { mode }),
      });
      return assistant;
    } catch (e) {
      if (startedIn === generation) setState({ thinking: false, working: null });
      throw e;
    }
  },

  /** Resend a failed message. */
  retry(id: string) {
    const failed = state.messages.find((m) => m.id === id);
    if (!failed || failed.status !== 'error') return;
    setState({ messages: state.messages.filter((m) => m.id !== id) });
    return conversation.send(failed.content, { viaVoice: failed.viaVoice }).catch(() => null);
  },

  attachAudio(id: string, audioUri: string) {
    update(id, { audioUri });
  },

  /**
   * Stop the turn in progress (e.g. Baymon is operating an app and you want it to stop). Steps
   * already taken stay on record in a short "Stopped" reply.
   */
  cancel() {
    if (!state.thinking) return;
    generation++;
    const steps = state.working;
    const settled = state.messages.map((m) => (m.status === 'pending' ? { ...m, status: undefined } : m));
    const stopped: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: 'Stopped.',
      createdAt: Date.now(),
      isNew: true,
      steps: steps?.length ? steps.map((s) => (s.status === 'running' ? { ...s, status: 'failed', error: 'Stopped' } : s)) : undefined,
    };
    setState({ messages: [...settled, stopped], thinking: false, working: null });
  },

  /** Start a fresh conversation. */
  clear() {
    generation++;
    setState({ messages: [], thinking: false, working: null });
  },

  /** Forget everything in memory (on sign-out). Saved history stays on device for the same user. */
  reset() {
    generation++;
    storageKey = null;
    state = { messages: [], mode: 'type', thinking: false, working: null };
    listeners.forEach((l) => l());
  },
};

export function useConversation() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}
