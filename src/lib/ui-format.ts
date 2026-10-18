/**
 * Parser for the agent's UI tags (spec: docs/agent-ui-format.md). A reply is Markdown with optional
 * block tags on their own lines, e.g. `<schedule>[…]</schedule>`. Anything malformed degrades to
 * Markdown, so a bad tag never hides content. Tags inside ``` code fences are left alone.
 */

export type Tone = 'info' | 'tip' | 'warning' | 'success';

export type TableData = { title?: string; columns: string[]; rows: string[][] };
export type Stat = { label: string; value: string; note?: string };
export type ScheduleItem = { time?: string; end?: string; title: string; note?: string };
export type Step = { title: string; detail?: string };
export type CheckItem = { text: string; done?: boolean };
export type CompareOption = { name: string; summary?: string; pros?: string[]; cons?: string[]; best?: boolean };
/** A message Baymon drafted for you to send (or edit first). Never sent without a tap. */
export type Draft = {
  text: string;
  to?: string;
  app?: string;
  /** How Send works without asking Baymon again: a phone tool and its arguments (the text is added). */
  send?: { tool: string; args: Record<string, unknown> };
};
export type DraftStatus = 'sent' | 'opened';

/** Tools a draft's Send may run directly, and the argument that carries the text. */
export const DRAFT_SEND_TOOLS: Record<string, string> = {
  notification_reply: 'text',
  sms_compose: 'body',
  email_compose: 'body',
};

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'callout'; tone: Tone; title?: string; body: string }
  | { kind: 'card'; title: string; subtitle?: string; meta?: string; body: string }
  | { kind: 'table'; data: TableData }
  | { kind: 'stats'; items: Stat[] }
  | { kind: 'schedule'; title?: string; items: ScheduleItem[] }
  | { kind: 'steps'; items: Step[] }
  | { kind: 'checklist'; title?: string; items: CheckItem[] }
  | { kind: 'compare'; options: CompareOption[] }
  | { kind: 'suggestions'; items: string[] }
  | { kind: 'draft'; index: number; draft: Draft; status?: DraftStatus };

export const TAGS = [
  'callout',
  'card',
  'table',
  'stats',
  'schedule',
  'steps',
  'checklist',
  'compare',
  'suggestions',
  'draft',
] as const;

const TAG = new RegExp(`^[ \\t]*<(${TAGS.join('|')})((?:\\s+[a-z]+="[^"]*")*)\\s*>([\\s\\S]*?)<\\/\\1>[ \\t]*$`, 'gm');
const FENCE = /^```[\s\S]*?^```[ \t]*$/gm;
const TONES: Tone[] = ['info', 'tip', 'warning', 'success'];

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const nonEmpty = (v: unknown) => str(v) || undefined;

function attrs(raw: string) {
  const out: Record<string, string> = {};
  for (const [, k, v] of raw.matchAll(/([a-z]+)="([^"]*)"/g)) out[k] = v.trim();
  return out;
}

/** JSON with the usual LLM slips tolerated: surrounding ```json fences and trailing commas. */
function json(body: string): unknown {
  const cleaned = body
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(cleaned);
}

const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function build(tag: string, a: Record<string, string>, body: string): Segment | null {
  switch (tag) {
    case 'callout':
      return {
        kind: 'callout',
        tone: TONES.includes(a.tone as Tone) ? (a.tone as Tone) : 'info',
        title: a.title || undefined,
        body: body.trim(),
      };
    case 'card':
      return { kind: 'card', title: a.title ?? '', subtitle: a.subtitle || undefined, meta: a.meta || undefined, body: body.trim() };
    case 'table': {
      const d = record(json(body));
      const columns = array(d.columns).map(str);
      const rows = array(d.rows).map((r) => array(r).map(str));
      return columns.length && rows.length ? { kind: 'table', data: { title: a.title || nonEmpty(d.title), columns, rows } } : null;
    }
    case 'stats': {
      const items = array(json(body))
        .map(record)
        .map((s) => ({ label: str(s.label), value: str(s.value), note: nonEmpty(s.note) }))
        .filter((s) => s.label && s.value);
      return items.length ? { kind: 'stats', items } : null;
    }
    case 'schedule': {
      const items = array(json(body))
        .map(record)
        .map((s) => ({ time: nonEmpty(s.time), end: nonEmpty(s.end), title: str(s.title), note: nonEmpty(s.note) }))
        .filter((s) => s.title);
      return items.length ? { kind: 'schedule', title: a.title || undefined, items } : null;
    }
    case 'steps': {
      const items = array(json(body))
        .map((s) => (typeof s === 'string' ? { title: s } : record(s)))
        .map((s) => ({ title: str(s.title), detail: nonEmpty(s.detail) }))
        .filter((s) => s.title);
      return items.length ? { kind: 'steps', items } : null;
    }
    case 'checklist': {
      const items = array(json(body))
        .map((s) => (typeof s === 'string' ? { text: s } : record(s)))
        .map((s) => ({ text: str(s.text), done: s.done === true }))
        .filter((s) => s.text);
      return items.length ? { kind: 'checklist', title: a.title || undefined, items } : null;
    }
    case 'compare': {
      const options = array(json(body))
        .map(record)
        .map((o) => ({
          name: str(o.name),
          summary: nonEmpty(o.summary),
          pros: array(o.pros).map(str).filter(Boolean),
          cons: array(o.cons).map(str).filter(Boolean),
          best: o.best === true,
        }))
        .filter((o) => o.name);
      return options.length ? { kind: 'compare', options } : null;
    }
    case 'suggestions': {
      const items = array(json(body)).map(str).filter(Boolean).slice(0, 4);
      return items.length ? { kind: 'suggestions', items } : null;
    }
    case 'draft': {
      const d = record(json(body));
      const text = str(d.text);
      if (!text) return null;
      const send = record(d.send);
      return {
        kind: 'draft',
        index: 0,
        draft: {
          text,
          to: nonEmpty(d.to),
          app: nonEmpty(d.app),
          ...(str(send.tool) && { send: { tool: str(send.tool), args: record(send.args) } }),
        },
        status: a.status === 'sent' || a.status === 'opened' ? a.status : undefined,
      };
    }
  }
  return null;
}

export function parseRich(text: string): Segment[] {
  // Mask code fences so tags inside code samples are never interpreted.
  const fences: string[] = [];
  const masked = text.replace(FENCE, (m) => `\u0000${fences.push(m) - 1}\u0000`);
  const unmask = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => fences[Number(i)]);

  const segments: Segment[] = [];
  const pushMarkdown = (s: string) => {
    const t = unmask(s).trim();
    if (t) segments.push({ kind: 'markdown', text: t });
  };

  let last = 0;
  for (const m of masked.matchAll(TAG)) {
    const at = m.index ?? 0;
    pushMarkdown(masked.slice(last, at));
    const [whole, tag, rawAttrs, body] = m;
    let segment: Segment | null = null;
    try {
      segment = build(tag, attrs(rawAttrs), unmask(body));
    } catch {
      segment = null;
    }
    // Drafts are numbered so a Send can point at the right one.
    if (segment?.kind === 'draft') segment.index = segments.filter((s) => s.kind === 'draft').length;
    // Malformed structured data: show the body as plain Markdown rather than dropping it.
    if (segment) segments.push(segment);
    else pushMarkdown(body);
    last = at + whole.length;
  }
  pushMarkdown(masked.slice(last));
  return segments;
}

/** Plain-language version of a tagged reply, for text-to-speech and captions. */
export function toPlainSpeech(text: string): string {
  return parseRich(text)
    .map((s) => {
      switch (s.kind) {
        case 'markdown':
          return s.text;
        case 'callout':
          return [s.title, s.body].filter(Boolean).join('. ');
        case 'card':
          return [s.title, s.subtitle, s.body].filter(Boolean).join('. ');
        case 'suggestions':
          return '';
        case 'draft':
          return `Here's a reply${s.draft.to ? ` to ${s.draft.to}` : ''}: ${s.draft.text}`;
        default:
          return 'The details are on screen.';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

/** The drafts in a reply, in order. */
export function draftsIn(text: string): Draft[] {
  return parseRich(text).flatMap((s) => (s.kind === 'draft' ? [s.draft] : []));
}

/** Rewrites the `index`-th draft tag (e.g. with the edited text, marked sent). */
export function replaceDraft(text: string, index: number, draft: Draft, status?: DraftStatus): string {
  const fences: string[] = [];
  const masked = text.replace(FENCE, (m) => `\u0000${fences.push(m) - 1}\u0000`);
  let n = -1;
  const replaced = masked.replace(TAG, (whole, tag: string) => {
    if (tag !== 'draft' || ++n !== index) return whole;
    return `<draft${status ? ` status="${status}"` : ''}>${JSON.stringify(draft)}</draft>`;
  });
  return replaced.replace(/\u0000(\d+)\u0000/g, (_, i) => fences[Number(i)]);
}

/** A draft as a tag, for messages the app writes itself (e.g. a tapped bubble with a reply ready). */
export function draftTag(draft: Draft) {
  return `<draft>${JSON.stringify(draft)}</draft>`;
}
