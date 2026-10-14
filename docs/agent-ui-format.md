# Agent reply format (rich UI tags)

The app renders agent replies as **Markdown plus a small set of UI tags**. Each tag becomes a native
component (timeline, checklist, comparison cards…) instead of text the model has to lay out itself.
Implementation: `src/lib/ui-format.ts` (parser) and `src/components/chat/rich/` (renderers).

Everything degrades safely: a malformed tag is shown as plain text, and tags inside ``` code fences
are never interpreted.

---

## Prompt section (paste into the system prompt for type mode)

````text
FORMATTING

Write replies in Markdown: short paragraphs, **bold** for key terms, `code` for identifiers,
fenced code blocks for code. Never draw tables with pipes or ASCII art.

When a reply contains structured information, use these UI tags instead of improvising layout.
Rules for every tag:
- The opening tag starts on its own line; the closing tag ends on its own line.
- Attribute values use double quotes and contain no double quotes.
- JSON bodies must be valid JSON: double-quoted keys and strings, no comments, no trailing commas.
- Text inside JSON may use inline Markdown (**bold**, `code`, [link](url)) but no newlines.
- Use a tag only when it genuinely helps. A one-line answer needs no tags.
- Never put tags inside code blocks, and never explain the tags to the user.

<callout tone="info|tip|warning|success" title="Optional short title">
Markdown body: one to three sentences.
</callout>
  Use for: the single most important caveat, warning, tip or confirmation. At most one per reply.

<card title="Required title" subtitle="Optional" meta="Optional small label">
Markdown body.
</card>
  Use for: one specific thing worth spotlighting (a place, a booking, a contact, a recommendation).

<table title="Optional">
{"columns": ["Name", "Price", "Rating"], "rows": [["Basic", "$5", "4.1"], ["Pro", "$12", "4.7"]]}
</table>
  Use for: genuinely tabular data. Keep cells short (a few words). Every row has one cell per column.
  The first column should identify the row. Prefer 2–3 columns; more is allowed but shown as cards.

<stats>
[{"label": "Sleep", "value": "7h 20m", "note": "+40 min vs. last week"}, {"label": "Steps", "value": "9,412"}]
</stats>
  Use for: 2–6 headline numbers. "value" is short (a number with unit); "note" is optional context.

<schedule title="Optional, e.g. Thursday">
[{"time": "09:00", "end": "11:30", "title": "Deep work", "note": "Baymon API"}, {"time": "12:00", "title": "Lunch"}]
</schedule>
  Use for: anything time-ordered (a day plan, an itinerary, deadlines). Use 24-hour "HH:MM" or a short
  label like "Mon". "end" and "note" are optional.

<steps>
[{"title": "Install the CLI", "detail": "Run `npm i -g eas-cli`."}, {"title": "Log in"}]
</steps>
  Use for: an ordered procedure the user will follow. Titles are imperative and short; "detail" optional.

<checklist title="Optional">
[{"text": "Book flights"}, {"text": "Renew passport", "done": true}]
</checklist>
  Use for: tasks or items the user will tick off. "done" defaults to false.

<compare>
[{"name": "Option A", "summary": "One line", "pros": ["Cheap"], "cons": ["Slow"], "best": true},
 {"name": "Option B", "pros": ["Fast"], "cons": ["Pricey"]}]
</compare>
  Use for: weighing 2–4 alternatives. Mark at most one option "best": true, only when you recommend it.
  Use this instead of a table for pros/cons.

<suggestions>
["Make it shorter", "Add these to my tasks"]
</suggestions>
  Use for: up to 3 likely follow-ups the user might tap to send, each 2–6 words, phrased as the
  user would say them. Optional; put it last in the reply. Never more than one per reply.

Typical shape: a one- or two-sentence answer in prose, then at most two tags, then optional suggestions.
````

---

## Examples

**Planning a day**

````text
Here's a realistic plan that protects your morning for deep work.

<schedule title="Thursday">
[{"time": "09:00", "end": "11:30", "title": "Deep work", "note": "Finish the `/v1/talk` endpoint"},
 {"time": "12:00", "end": "12:45", "title": "Lunch + walk"},
 {"time": "14:00", "end": "14:30", "title": "Review PRs"}]
</schedule>

<callout tone="tip">You have no meetings before 14:00, so the morning block is safe to keep.</callout>

<suggestions>["Move deep work later", "Add a gym session"]</suggestions>
````

**Choosing between options**

````text
For a solo side project, **Render** is the easier start; **Fly.io** wins once you need regions.

<compare>
[{"name": "Render", "summary": "Simplest deploys", "pros": ["Git push to deploy", "Free tier"], "cons": ["Cold starts on free tier"], "best": true},
 {"name": "Fly.io", "summary": "Global by default", "pros": ["Multi-region", "Fast cold starts"], "cons": ["More configuration"]}]
</compare>
````

---

## What the app does with each tag

| Tag | Rendered as | Fallback if malformed |
|---|---|---|
| `callout` | Tinted panel with tone icon | — (body is Markdown) |
| `card` | Surface card with title/subtitle | — (body is Markdown) |
| `table` | ≤ 3 columns: grid. More: one card per row | Body as text |
| `stats` | 2-column tiles | Body as text |
| `schedule` | Vertical timeline | Body as text |
| `steps` | Numbered, connected steps | Body as text |
| `checklist` | Tappable checkboxes (local only) | Body as text |
| `compare` | Horizontally scrolling option cards; `best` highlighted | Body as text |
| `suggestions` | Tap-to-send chips, on the latest reply only | Hidden |

Markdown pipe tables are still rendered (through the same table component), so older replies look
right, but the prompt should steer the model to `<table>`.

## Voice

Tags must never be read aloud. The app's own read-aloud path converts tagged replies to speech text
(data tags become "The details are on screen."). On the server, treat any reply containing a tag as
not directly speakable, so `decide_speech_text` summarizes it. In `_looks_speakable`, add `<` to the
line-start check:

```python
re.search(r"```|^\s*[|#>\-<]|https?://|`", text, re.MULTILINE)
```

In **talk mode**, tell the model not to use tags at all. Replies there are heard rather than seen.
See `docs/talk-endpoint.md`.
