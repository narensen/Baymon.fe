import { File } from 'expo-file-system';

import { api, ApiError } from '@/lib/api';

/** Mirrors `Attachment` in the API (`POST /v1/attachments`). */
export type Attachment = {
  id: string;
  kind: 'image' | 'pdf' | 'text' | 'file';
  name: string;
  mime: string;
  size: number;
  /** What the server read from it: the text of a PDF or document, or a description and transcription of an image. */
  text?: string | null;
  created_at?: string;
};

/** Shown on the user's message in the chat. */
export type AttachmentRef = Pick<Attachment, 'id' | 'kind' | 'name' | 'mime'> & {
  /** Local copy, for image thumbnails. */
  uri?: string;
};

/** The API's limit. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function attachmentKind(mime?: string | null, name?: string): Attachment['kind'] {
  if (mime?.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || name?.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (mime?.startsWith('text/')) return 'text';
  return 'file';
}

/**
 * Uploads a local file (file:// uri) so Baymon can read it. The server returns what it extracted,
 * which goes to the model with the next message (`attachments` on `/v1/chat`).
 */
export async function uploadAttachment(file: { uri: string; name: string; mime?: string | null }): Promise<Attachment> {
  const local = new File(file.uri);
  if (!local.exists) throw new ApiError('That file is no longer available. Share it again.', 'not_found');
  if ((local.size ?? 0) > MAX_ATTACHMENT_BYTES) throw new ApiError('That file is too big (max 20 MB).', 'too_large');
  const form = new FormData();
  // Expo's fetch uploads expo-file-system Files (see audio-files.ts).
  form.append('file', local as unknown as Blob);
  form.append('name', file.name);
  if (file.mime) form.append('mime', file.mime);
  try {
    return await api<Attachment>('/v1/attachments', { method: 'POST', body: form, timeoutMs: 120_000 });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
      throw new ApiError('Your Baymon server can’t read files yet. It needs the attachments update.', 'not_supported', e.status);
    }
    throw e;
  }
}
