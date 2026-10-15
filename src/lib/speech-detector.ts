/**
 * End-of-speech detection from microphone level readings (dBFS).
 *
 * Readings are average power on iOS/web but the *peak* since the last read on Android, so fixed
 * thresholds don't work across devices. Instead the detector learns the room:
 * - Noise floor = a low percentile of recent non-speech readings, so a single spike doesn't move it.
 * - The speech margin grows with how much that noise fluctuates (a TV needs more than a fan).
 * - Speech must be sustained to start, and bursts too short to be words (a cough, a door, a
 *   keyboard clack) are discarded instead of ending the turn.
 */

/** Learn the room before judging anything. */
const CALIBRATION_MS = 500;
/** Rolling window of non-speech readings that defines the noise floor. */
const NOISE_WINDOW_MS = 3_000;
/** Speech margin above the floor: base + spread × factor, clamped. */
const MARGIN_MIN_DB = 9;
const MARGIN_MAX_DB = 20;
const MARGIN_SPREAD_FACTOR = 1.5;
/** Loudness must last this long to count as speech starting. */
const ONSET_MS = 150;
/** An utterance with less loud time than this was noise: forget it and keep listening. */
const MIN_SPEECH_MS = 300;
/** Quiet again below floor + half the margin, or well below how loud the speaker was. */
const QUIET_BELOW_PEAK_DB = 18;
/** Visual level spans this many dB above the noise floor. */
const LEVEL_RANGE_DB = 30;
/** End of utterance: this much continuous quiet after speech. */
export const END_SILENCE_MS = 1_000;
/** Give up listening if nobody speaks. */
const NO_SPEECH_TIMEOUT_MS = 12_000;
const MAX_UTTERANCE_MS = 60_000;

export type DetectorEvent = 'listening' | 'speaking' | 'ended' | 'no-speech';

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

export function createSpeechDetector(startedAt: number) {
  let smooth: number | null = null;
  let lastAt = startedAt;
  const noise: { t: number; db: number }[] = [];
  let floor = -60;
  let margin = MARGIN_MIN_DB;

  let loudRunMs = 0; // current run above the start threshold
  let speechMs = 0; // total loud time in this utterance
  let heardSpeechAt = 0;
  let lastLoudAt = 0;
  let peak = -Infinity;
  let level = 0;

  function learnNoise(now: number, db: number) {
    noise.push({ t: now, db });
    while (noise.length && now - noise[0].t > NOISE_WINDOW_MS) noise.shift();
    const sorted = noise.map((n) => n.db).sort((a, b) => a - b);
    floor = percentile(sorted, 0.2);
    const spread = percentile(sorted, 0.8) - floor;
    margin = Math.min(MARGIN_MAX_DB, Math.max(MARGIN_MIN_DB, spread * MARGIN_SPREAD_FACTOR + 6));
  }

  function forgetUtterance() {
    heardSpeechAt = 0;
    speechMs = 0;
    peak = -Infinity;
  }

  return {
    /** 0..1 loudness above the noise floor, for visuals. */
    get level() {
      return level;
    },
    push(db: number | undefined, now: number): DetectorEvent {
      const dt = Math.max(0, now - lastAt);
      lastAt = now;
      if (now - startedAt > MAX_UTTERANCE_MS) return heardSpeechAt ? 'ended' : 'no-speech';

      // -160 / missing means "no reading" (Android reports it when nothing changed), not silence.
      if (typeof db === 'number' && Number.isFinite(db) && db > -100) {
        smooth = smooth === null ? db : smooth + (db - smooth) * 0.45;
        level = Math.min(1, Math.max(0, (smooth - floor) / LEVEL_RANGE_DB));

        if (now - startedAt < CALIBRATION_MS) {
          learnNoise(now, smooth);
          return 'listening';
        }

        const loud = smooth > floor + margin;
        if (loud) {
          loudRunMs += dt;
          if (loudRunMs >= ONSET_MS) {
            heardSpeechAt ||= now;
            speechMs += dt;
            peak = Math.max(peak, smooth);
          }
        } else {
          loudRunMs = 0;
          // Only quiet-ish readings teach the noise floor; speech must never raise it.
          if (!heardSpeechAt || smooth < floor + margin / 2) learnNoise(now, smooth);
        }

        const quiet = smooth < Math.max(floor + margin / 2, peak - QUIET_BELOW_PEAK_DB);
        if (!quiet) lastLoudAt = now;
      }

      if (heardSpeechAt && now - lastLoudAt > END_SILENCE_MS) {
        // Too little speech to be words: it was a noise burst. Keep listening.
        if (speechMs < MIN_SPEECH_MS) {
          forgetUtterance();
          return 'listening';
        }
        return 'ended';
      }
      if (!heardSpeechAt && now - startedAt > NO_SPEECH_TIMEOUT_MS) return 'no-speech';
      return heardSpeechAt ? 'speaking' : 'listening';
    },
  };
}
