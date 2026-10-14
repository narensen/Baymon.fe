import { File, Paths } from 'expo-file-system';

/** Reply audio is written to the cache; only the most recent few files are kept. */
const KEEP = 8;
const written: File[] = [];
let counter = 0;

function track(file: File) {
  written.push(file);
  while (written.length > KEEP) {
    try {
      written.shift()?.delete();
    } catch {}
  }
  return file.uri;
}

function newFile() {
  const file = new File(Paths.cache, `baymon-reply-${Date.now()}-${counter++}.wav`);
  file.create({ overwrite: true });
  return file;
}

/** Turns base64 WAV from `/v1/chat` into a playable URI. */
export function audioUriFromBase64(base64: string) {
  const file = newFile();
  file.write(base64, { encoding: 'base64' });
  return track(file);
}

/** Turns a binary `/v1/speak` response into a playable URI. */
export async function audioUriFromResponse(response: Response) {
  const file = newFile();
  file.write(new Uint8Array(await response.arrayBuffer()));
  return track(file);
}

/**
 * Multipart part for a recording made by expo-audio. Expo's `fetch` (the global on native) uploads
 * expo-file-system `File`s, taking the filename and type from it; React Native's `{ uri, name, type }`
 * objects are not supported and throw before the request is sent.
 */
export async function recordingPart(uri: string) {
  return new File(uri) as unknown as Blob;
}
