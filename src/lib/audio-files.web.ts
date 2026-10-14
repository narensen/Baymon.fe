/** Web: browsers play data/blob URLs directly. */
export function audioUriFromBase64(base64: string) {
  return `data:audio/wav;base64,${base64}`;
}

let lastObjectUrl: string | null = null;

export async function audioUriFromResponse(response: Response) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = URL.createObjectURL(await response.blob());
  return lastObjectUrl;
}

/** expo-audio records to a blob: URL on web. */
export async function recordingPart(uri: string) {
  const blob = await (await fetch(uri)).blob();
  return new File([blob], 'speech.webm', { type: blob.type || 'audio/webm' });
}
