import { api, ApiError, request } from '@/lib/api';
import { audioUriFromResponse, recordingPart } from '@/lib/audio-files';
import { deviceId } from '@/lib/device';
import type { Action, ActionResult } from '@/lib/tools';
import { toPlainSpeech } from '@/lib/ui-format';

/** Matches `Voice` in the API. */
export const VOICES = ['troy', 'austin', 'daniel', 'autumn', 'diana', 'hannah'] as const;
export type Voice = (typeof VOICES)[number];

export type ChatMode = 'type' | 'talk';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** Tool-loop fields on chat/talk responses (docs/agent-platform.md). */
export type ToolTurn = {
  turn_id?: string | null;
  /** Tool calls for this phone to run; results go to `continueTurn`. */
  actions?: Action[];
  awaiting_results?: boolean;
};

/** Mirrors `ChatResponse`. */
export type ChatReply = ToolTurn & {
  text: string;
  speech_text: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  mode: ChatMode | null;
  warnings: { code: string; message: string }[];
};

/** API limits: 40 history items, 8k chars per message, 4k chars per speak request. */
const HISTORY_LIMIT = 20;
export const MESSAGE_MAX_CHARS = 8_000;
const SPEAK_MAX_CHARS = 4_000;

export function chat(input: {
  message: string;
  history: ChatTurn[];
  voice: boolean;
  mode: ChatMode;
  ttsVoice: Voice;
}) {
  return api<ChatReply>('/v1/chat', {
    method: 'POST',
    // Generation + speech can take a while, especially when Groq rate limits trigger retries.
    timeoutMs: 120_000,
    body: {
      message: input.message.slice(0, MESSAGE_MAX_CHARS),
      history: input.history.slice(-HISTORY_LIMIT).map((t) => ({ ...t, content: t.content.slice(0, 20_000) })),
      voice: input.voice,
      mode: input.mode,
      tts_voice: input.ttsVoice,
      device_id: deviceId(),
    },
  });
}

/**
 * Sends tool results back so the model can continue the same turn. The response has the same shape
 * as `/v1/chat` (plus `caption` for voice turns) and may contain more actions.
 */
export function continueTurn(
  turnId: string,
  results: ActionResult[],
  input: { voice: boolean; mode: ChatMode; ttsVoice: Voice }
) {
  return api<ChatReply & { caption?: string | null }>(`/v1/chat/${encodeURIComponent(turnId)}/results`, {
    method: 'POST',
    timeoutMs: 120_000,
    body: { results, voice: input.voice, mode: input.mode, tts_voice: input.ttsVoice, device_id: deviceId() },
  });
}

/** Mirrors the proposed `TalkResponse` (docs/talk-endpoint.md). */
export type TalkReply = ToolTurn & {
  transcript: string;
  text: string;
  caption: string;
  audio_base64: string | null;
  audio_mime: string | null;
  mode: ChatMode | null;
  warnings: { code: string; message: string }[];
};

/** Flipped off on the first 404 so older servers aren't asked again. */
let talkEndpointAvailable = true;

/**
 * One voice turn. Uses `POST /v1/talk` (audio in → transcript, reply, caption, audio out) when the
 * server has it; otherwise falls back to `/v1/transcribe` + `/v1/chat`.
 * `onTranscript` fires as soon as the transcript is known on the fallback path.
 */
export async function talkTurn(input: {
  recordingUri: string;
  history: ChatTurn[];
  ttsVoice: Voice;
  onTranscript?: (text: string) => void;
}): Promise<TalkReply> {
  const history = input.history.slice(-HISTORY_LIMIT);
  if (talkEndpointAvailable) {
    const form = new FormData();
    form.append('file', await recordingPart(input.recordingUri));
    form.append('history', JSON.stringify(history));
    form.append('tts_voice', input.ttsVoice);
    form.append('device_id', deviceId());
    try {
      return await api<TalkReply>('/v1/talk', { method: 'POST', body: form, timeoutMs: 120_000 });
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 405))) throw e;
      talkEndpointAvailable = false;
    }
  }

  const lastReply = [...history].reverse().find((t) => t.role === 'assistant')?.content;
  const transcript = await transcribe(input.recordingUri, lastReply && toSpeakable(lastReply));
  input.onTranscript?.(transcript);
  const reply = await chat({ message: transcript, history, voice: true, mode: 'talk', ttsVoice: input.ttsVoice });
  return {
    transcript,
    text: reply.text,
    caption: reply.speech_text ?? toSpeakable(reply.text),
    audio_base64: reply.audio_base64,
    audio_mime: reply.audio_mime,
    mode: reply.mode,
    warnings: reply.warnings,
    turn_id: reply.turn_id,
    actions: reply.actions,
    awaiting_results: reply.awaiting_results,
  };
}

/** Speech to text. `prompt` gives Whisper context (e.g. the agent's last reply). */
export async function transcribe(recordingUri: string, prompt?: string) {
  const form = new FormData();
  form.append('file', await recordingPart(recordingUri));
  if (prompt) form.append('prompt', prompt.slice(-1000));
  const { text } = await api<{ text: string }>('/v1/transcribe', { method: 'POST', body: form, timeoutMs: 60_000 });
  return text;
}

/** Text to speech; returns a playable URI. */
export async function speak(text: string, voice: Voice) {
  const response = await request('/v1/speak', {
    method: 'POST',
    body: { text: toSpeakable(text).slice(0, SPEAK_MAX_CHARS), voice },
    timeoutMs: 90_000,
  });
  return audioUriFromResponse(response);
}

/** Plain spoken text: UI tags summarized, Markdown stripped, code blocks skipped. */
export function toSpeakable(markdown: string) {
  return toPlainSpeech(markdown)
    .replace(/```[\s\S]*?```/g, ' (code shown on screen) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}
