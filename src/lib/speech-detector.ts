/**
 * End-of-speech detection from microphone level readings (dBFS).
 *
 * Readings are average power on iOS/web but the *peak* since the last read on Android, so fixed
 * thresholds don't work across devices. Instead this tracks the room's noise floor (falls fast,
 * rises slowly) and judges speech relative to it and to how loud this speaker actually was.
 */

/** Ignore the first moments while the mic settles and the noise floor is learned. */
const CALIBRATION_MS = 350;
/** Speech starts this far above the noise floor… */
const START_MARGIN_DB = 12;
/** …and counts as quiet again below the floor + this, or well below how loud the speaker was. */
const QUIET_MARGIN_DB = 6;
const QUIET_BELOW_PEAK_DB = 18;
/** Visual level spans this many dB above the noise floor. */
const LEVEL_RANGE_DB = 30;
/** End of utterance: this much continuous quiet after speech. */
export const END_SILENCE_MS = 1_000;
/** Give up listening if nobody speaks. */
const NO_SPEECH_TIMEOUT_MS = 12_000;
const MAX_UTTERANCE_MS = 60_000;

export type DetectorEvent = 'listening' | 'speaking' | 'ended' | 'no-speech';

export function createSpeechDetector(startedAt: number) {
  let smooth: number | null = null;
  let floor: number | null = null;
  let peak = -Infinity;
  let heardSpeechAt = 0;
  let lastLoudAt = 0;
  let level = 0;

  return {
    /** 0..1 loudness above the noise floor, for visuals. */
    get level() {
      return level;
    },
    push(db: number | undefined, now: number): DetectorEvent {
      if (now - startedAt > MAX_UTTERANCE_MS) return heardSpeechAt ? 'ended' : 'no-speech';
      // -160 / missing means "no reading" (Android reports it when nothing changed), not silence.
      if (typeof db === 'number' && Number.isFinite(db) && db > -100) {
        smooth = smooth === null ? db : smooth + (db - smooth) * 0.45;
        floor = floor === null ? smooth : floor + (smooth - floor) * (smooth < floor ? 0.3 : 0.01);
        level = Math.min(1, Math.max(0, (smooth - floor) / LEVEL_RANGE_DB));

        if (now - startedAt >= CALIBRATION_MS) {
          if (smooth > floor + START_MARGIN_DB) {
            heardSpeechAt ||= now;
            peak = Math.max(peak, smooth);
          }
          const quiet = smooth < Math.max(floor + QUIET_MARGIN_DB, peak - QUIET_BELOW_PEAK_DB);
          if (!quiet) lastLoudAt = now;
        }
      }
      if (heardSpeechAt && now - lastLoudAt > END_SILENCE_MS) return 'ended';
      if (!heardSpeechAt && now - startedAt > NO_SPEECH_TIMEOUT_MS) return 'no-speech';
      return heardSpeechAt ? 'speaking' : 'listening';
    },
  };
}
