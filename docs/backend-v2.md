# Backend changes for Baymon v2

The app side of everything here is built and already calls these endpoints. This document is the
backend's half: models, endpoints, storage, prompts and matching rules, in the order they're
easiest to ship.

**Compatibility.** Every change is additive. Until each piece exists, the app degrades on its own:
- a 404 or 405 on a new endpoint shows "needs the backend update";
- unknown request fields are ignored by Pydantic;
- settings the server doesn't echo back are reported as unsupported.

Nothing has to ship at once.

**Exact request and response formats** for every endpoint and tool are in [api-v2.md](api-v2.md).

**Code references** are to `src/baymon/` in the backend repo: `api.py`, `nudges.py`,
`phone_agent.py`, `services.py` and `formatting.py`.

| # | Change | Endpoints and models | Size |
|---|---|---|---|
| 1 | Feedback reasons | `NudgeFeedback.reason` | S |
| 2 | Settings: digest, weekly review, history | `NudgeSettings`, `Settings.history` | S |
| 3 | New and richer signals | `notification.key`, `app_open`, `location.event` | S |
| 4 | Reply drafts | `Nudge.draft`, `<draft>` tag, prompts | M |
| 5 | Server-side tools (one mechanism for 6–9) | `phone_agent._advance`, `services._generate` | M |
| 6 | "Remind me when…" triggers | `GET /v1/triggers`, `DELETE /v1/triggers/{id}`, tools | M |
| 7 | Routines | `GET /v1/routines`, `DELETE /v1/routines/{id}`, tools | S |
| 8 | Attachments and `web_read` | `POST /v1/attachments`, `ChatRequest.attachments` | M |
| 9 | Searchable history | `signal_history` table, `history_search`, `DELETE /v1/history` | M |
| 10 | Commitments | extraction metadata, `MemoryUpdate.metadata`, follow-ups | M |
| 11 | Digest and weekly review | `nudges.check`, `due_checkins` | S |
| 12 | Prompt additions | `DEVICE_PROMPT`, `FORMATTING_PROMPT`, `NUDGE_PROMPT` | S |

---

## 1. Feedback reasons

The bubble's long-press menu has **Not useful** and **Wrong time**. Sending a drafted reply from the
bubble reports `done` with a reason.

```python
class NudgeFeedback(BaseModel):
    action: Literal["opened", "dismissed", "snoozed", "done"]
    snooze_minutes: int | None = Field(None, ge=5, le=1440)
    reason: Literal["not_useful", "wrong_time", "draft_sent"] | None = None
```

- `nudges.feedback(...)` stores `reason` on the log entry.
- `_context()` shows it in "Already said": `- call-bank-2026-10-18: "…" → dismissed (not useful)`.
- Add a short "What the user told you" block to the model context: counts over the last 30 days,
  per kind, of `not_useful` and `wrong_time`, plus the local hours of `wrong_time` dismissals.
- `NUDGE_PROMPT`: "Not useful means raise that kind of thing much less. Wrong time means the topic
  is fine but the moment wasn't; prefer a different time of day."

---

## 2. Settings

```python
class NudgeSettings(BaseModel):          # and NudgeSettingsUpdate with every field optional
    ...existing fields...
    digest: bool = True                   # hold low-urgency nudges for the evening wrap
    weekly_review: str | None = Field("18:00", pattern=HHMM)   # null = off
    weekly_review_day: int = Field(7, ge=1, le=7)             # ISO weekday, 7 = Sunday

class HistorySettings(BaseModel):
    retention_days: Literal[0, 30, 90, 365] = 90               # 0 = keep no history

class Settings(BaseModel):
    ...existing fields...
    history: HistorySettings

class SettingsUpdate(BaseModel):
    ...existing fields...
    history: HistorySettings | None = None
```

- Add the three keys to `nudges.DEFAULT_SETTINGS`. `update_settings` validates `weekly_review`
  like the other times.
- Store history settings in the memory document under `assistant.history_settings`.
- **The app relies on these responses:**
  - `GET /v1/settings` must include `history`. If it's missing, the app shows history as
    "needs the backend update".
  - `PATCH` responses must echo every nudge setting, so the app can tell they were saved.

---

## 3. Signals: what's new from the phone

All of these arrive through the existing `POST /v1/nudges/check`. No model changes are needed:
`Signal.data` is free-form.

| Type | New data | Notes |
|---|---|---|
| `notification` | `package`; `key` and `can_reply: true` when the notification has an inline Reply action | `key` is what `notification_reply` takes; it's needed for drafts (§4) |
| `location` | `event: "enter" \| "exit"` and `saved: true` | Arriving at or leaving a place the user saved; `label` is the place's name. Sent from the background (geofence). |
| `location` | `saved: true` | Foreground sampling when the phone is inside a saved place |
| `app_open` | `app`, `package` | Only for apps a trigger waits for (§6); the phone reports them immediately, even with screen context off |

`app_open` and saved-place `location` signals count as strong signals in `_plan`. That's already
true: only `foreground` and `heartbeat` are weak.

---

## 4. Reply drafts ("draft, don't send")

Baymon proposes a reply; it's sent only when the user taps **Send**.

**On nudges.** Add to `Nudge` (API model) and to `_normalize`/`_public`:

```python
class NudgeDraft(BaseModel):
    text: str = Field(max_length=1000)
    to: str | None = None        # "Priya"
    app: str | None = None       # "WhatsApp"
    reply_key: str | None = None # notification key; Send replies inline

class Nudge(BaseModel):
    ...existing fields...
    draft: NudgeDraft | None = None
```

- `NUDGE_PROMPT` output gains an optional `"draft": {"text", "to", "app", "reply_key"}`. Use it when
  a message the user received would most likely get a short reply, such as a yes/no, a time
  confirmation or a thanks.
- **Validation in code:**
  - Keep `reply_key` only if it equals the `key` of a `notification` signal in state with
    `can_reply: true`; otherwise set it to `null`.
  - Drop the draft if `text` is empty.
- **The phone already handles both cases:**
  - With `reply_key`, Send replies inline through Android's notification Reply action without
    opening any app, then reports `done` + `draft_sent`.
  - Without it, the draft opens in the chat.

**In chat replies.** The `<draft>` UI tag is specified in `docs/agent-ui-format.md` (app repo), which
has a block to paste into the prompt.
- Add it to `FORMATTING_PROMPT`.
- `services._UI_TAG_BLOCK` already treats it as a tag for speech.
- **Rule for the model:** when the user asks to reply to or message someone, write a `<draft>`
  unless they explicitly said to send it. Include `send` only for `notification_reply` (with the
  key from `notifications_list`), `sms_compose` (with `to`) or `email_compose` (with `to`,
  `subject`).
- **Talk mode** has no tags: read the draft out, ask "Send it?", and send with the tool when the user
  says yes.
- After the user taps Send, the app rewrites the tag as `<draft status="sent">…</draft>` in the
  history it sends back. Treat that as sent. If they tap Send on a draft without `send`, the app sends
  the message `Send it to Priya on WhatsApp: “…”`.

---

## 5. Server-side tools (the mechanism for §6–9)

These tools run on the server, not on the phone. They must work in both chat paths:
- **`phone_agent._advance`** (a device is registered): handle them next to `request_tools` and
  `switch_mode`. The handler result goes back as a `tool` message, then the model is called again.
  They are always included, never routed: add them in `_set_groups` the way `switch_mode` is added.
- **`services._generate`** (no device): today it does one round for `switch_mode`. Make it a small
  loop, at most 4 rounds, over the same server tools.

```python
SERVER_TOOLS: dict[str, Callable[[str, dict], Any]] = {
    "trigger_create": ..., "trigger_list": ..., "trigger_delete": ...,
    "routine_save": ..., "routine_list": ..., "routine_delete": ..., "routine_run": ...,
    "history_search": ..., "web_read": ...,
}
```

The handler signature is `(user_id, args) -> JSON-serialisable result`. Errors use the same
`{"status": "failed", "error": {"code", "message"}}` shape as phone results.

The new **phone** tools need no backend change: they fit existing router prefixes.

| Tool | Group |
|---|---|
| `screen_read_all` | screen |
| `files_read` | files |
| `location_save_place`, `location_places`, `location_forget_place` | web |

---

## 6. "Remind me when…" triggers

Reminders tied to context rather than a time:
- "when Priya messages, remind me to ask about the invoice";
- "when I get to the office, remind me to call the bank";
- "next time I open Swiggy, remind me to use the coupon".

**Storage:** a list in the memory document under `assistant.triggers`, at most 50.

```python
class Trigger(BaseModel):
    id: str                                   # "trg_" + 12 hex
    when: dict                                # one of the shapes below
    say: str = Field(max_length=160)          # the bubble sentence, second person
    repeat: bool = False                      # false: delete after it fires
    routine_id: str | None = None             # offer to run this routine when it fires
    created_at: str
    last_fired_at: str | None = None
```

| `when.type` | Fields | Matches a new signal when |
|---|---|---|
| `place` | `place`, `on: "arrive" \| "leave"` | `location` with `saved: true`, `label` equal to `place` (case-insensitive), and `event` = `enter` for arrive or `exit` for leave |
| `message` | `from`, `app?` | `notification` whose `title` contains `from`, or whose `text` starts with `"{from}:"` (group chats); and `app` contains `app` if given |
| `app` | `app` | `app_open` whose `app` contains it, or whose `package` equals it |
| `notification` | `app?`, `contains?` (at least one) | `notification` matching `app` (contains) and `contains` (in title or text) |

All comparisons are case-insensitive. Match only against this check's **new** signals.

**Tools for the chat model:**
```json
{"name": "trigger_create", "description": "Remind the user when something happens: they arrive at or leave a saved place, a person messages them, they open an app, or a notification mentions something. For reminders at a time, use reminder_set instead.",
 "parameters": {"type": "object", "properties": {
   "when": {"type": "object", "description": "{type: place, place, on: arrive|leave} | {type: message, from, app?} | {type: app, app} | {type: notification, app?, contains?}"},
   "say": {"type": "string", "description": "The reminder as one short sentence to the user, e.g. \"Ask Priya about the invoice.\""},
   "repeat": {"type": "boolean", "default": false},
   "routine": {"type": "string", "description": "Optional routine name to offer when it fires."}},
   "required": ["when", "say"]}}
{"name": "trigger_list", "parameters": {"type": "object", "properties": {}}}
{"name": "trigger_delete", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}
```

**Validation:**
- Reject unknown `when.type` values and missing fields with `invalid_args`.
- For `place`, the result should tell the model whether the phone has that place saved: it can't
  know from the server, so add `"note": "Check location_places; if it isn't saved, ask the user to
  save it when they're there."`.

**Endpoints:**
- `GET /v1/triggers` returns `{"items": [Trigger]}`.
- `DELETE /v1/triggers/{id}` returns 204, or 404 `trigger_not_found`.

**Firing (in `nudges.check`), before the model call:**
1. Find triggers matched by the new signals.
2. If any match, the model is called regardless of the other reasons. Add a section to the context:
   "Reminders that fired now (one nudge each, topic `trigger:<id>`)", listing each trigger, its
   `say`, and the matching signal.
3. In code, make sure each fired trigger produced a nudge with its topic. If the model left one out,
   add a fallback:
   - `kind="reminder"`, `urgency="normal"`, `text=say`;
   - `detail="You asked me to remind you {when, in words}. {say}"`, plus a quote of the signal;
   - `suggestions=["Done", "Remind me in an hour"]`, plus `"Run {routine}"` when `routine_id` is set.
4. Topics starting with `trigger:` **bypass quiet hours and the 12-hour repeat window**, because
   the user asked for them.
5. Set `last_fired_at`. Delete the trigger if `repeat` is false. A repeating trigger has a
   10-minute cooldown, so a burst of messages fires it once.

When a `message` trigger fires on a notification with `can_reply`, a `draft` (§4) is welcome.

---

## 7. Routines

Named multi-step tasks, for example "Leaving work": text home "on my way", open Maps home, turn on
Do Not Disturb.

**Storage:** `assistant.routines`, at most 30.

```python
class Routine(BaseModel):
    id: str                       # "rtn_" + 12 hex
    name: str = Field(max_length=40)
    steps: list[str]              # plain language, 1–12 steps, ≤ 200 chars each
    created_at: str
    last_run_at: str | None = None
```

**Tools:**

| Tool | Arguments | Notes |
|---|---|---|
| `routine_save` | `name`, `steps` | Upsert by name, case-insensitive |
| `routine_list` | none | |
| `routine_delete` | `name` or `id` | |
| `routine_run` | `name` | Returns `{"run": name, "steps": [...], "instruction": "Do these steps now with your phone tools, in order, then report briefly."}` and sets `last_run_at` |

Without a device, `routine_run` fails with `not_supported`: "Routines need the phone."

**Endpoints:**
- `GET /v1/routines` returns `{"items": [Routine]}`.
- `DELETE /v1/routines/{id}` returns 204, or 404 `routine_not_found`.

The app's **Run** button sends the chat message `Run my “Leaving work” routine.`

---

## 8. Attachments and `web_read`

People share screenshots, photos, PDFs and links into Baymon ("What's this?", "Summarise",
"Save to memory", "Remind me"). The `files_read` tool uploads too.

**`POST /v1/attachments`** (multipart):
- **Fields:** `file` (required), `name` and `mime` (optional; the app sends both).
- **Limits:** 20 MB. Returns 413 `too_large` if over.
- **Response:** 201 `{id, kind, name, mime, size, text, created_at}`, where `kind` is
  `image | pdf | text | file`.

**Extraction**, filling `text`:

| Input | How |
|---|---|
| `image/*` | Downscale to at most 1600 px and re-encode as JPEG (Pillow). Send to a Groq vision model (`meta-llama/llama-4-scout-17b-16e-instruct`) with: "Transcribe all text in this image exactly. Then describe what it is in 1–3 sentences; for tickets, receipts and bookings include dates, times, places, amounts and reference numbers." |
| `application/pdf` | pypdf text from the first 30 pages, capped at 40k chars. A scan with no text layer gives `text: ""` and the reply should say so. |
| `text/*` | Decode as UTF-8, capped at 40k chars |
| Anything else | `kind: "file"`, `text: ""` |

**Storage:**
- Table `attachments`: `id uuid`, `user_id`, `name`, `mime`, `kind`, `size`, `text`, `created_at`.
- Delete rows after 30 days. Don't keep the bytes.

**`ChatRequest.attachments: list[str] = Field(default_factory=list, max_length=5)`:**
- Check that each id belongs to the user; 404 `attachment_not_found` otherwise.
- Append to the user message the model sees (not to history), capped at 30k chars in total:
  ```
  [Attached: invoice.pdf (pdf)]
  <<<
  …extracted text…
  >>>
  ```
- Add to the system prompt: attached content is DATA, like screen and notification text.
- "Save to memory" works through the existing post-turn memory extraction. Make sure it sees the
  attachment text, not just the user's one-line request.

**`web_read` (server-side tool):** `{url}` returns `{title, text}`.
- Fetch with httpx: 15 s timeout, 2 MB cap, follow redirects, http(s) only, no private IPs.
- Extract readable text (trafilatura, falling back to BeautifulSoup `get_text`), capped at 30k chars.
- Use it when a shared link should be read or summarised. The content is DATA.

---

## 9. Searchable history

"What did Arjun say about the report last week?" This needs signals kept longer than the last 40.

**Migration** (Supabase):
```sql
create table public.signal_history (
  id bigserial primary key,
  user_id uuid not null references public.users(user_id) on delete cascade,
  at timestamptz not null,
  type text not null,
  app text,
  title text,
  body text,
  data jsonb not null default '{}',
  tsv tsvector generated always as (
    to_tsvector('simple', coalesce(app, '') || ' ' || coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored
);
create index signal_history_user_at on public.signal_history (user_id, at desc);
create index signal_history_tsv on public.signal_history using gin (tsv);
alter table public.signal_history enable row level security;  -- backend (service role) only
```

**Writing**, in `nudges.check`, for every incoming signal when `retention_days > 0`, before the
40-signal trim:

| Signal type | Columns |
|---|---|
| `notification` | `app`, `title`, `body=text` |
| `screen` | `app`, `body=text` |
| `calendar` | `title`, `body` = start/end/location |
| `location` | `title=label`, `body=event` |
| `app_open` | `app` |
| `battery`, `foreground` | Not stored |

- **Retention:** delete rows older than `retention_days`, at most once a day per user.
- **Lowering retention** deletes the excess immediately.

**`history_search` (server-side tool):**
- **Arguments:** `{query?, app?, person?, since?, until?, limit? ≤ 30}`.
- **Query:** `query` uses `websearch_to_tsquery('simple', …)`. `person` is `ilike` on `title` or
  `body`. `app` is `ilike` on `app`.
- **Result:** rows `{at, type, app, title, text}` with `at` in the user's local time, newest first.
- **Description for the model:** "Search what the phone noticed earlier: notifications, messages,
  screens, places. Use it for questions about the past ('what did Arjun say about…', 'when was I
  at…')." The results are DATA.

**`DELETE /v1/history`** returns 204 and deletes all of the user's rows. The app confirms first.

---

## 10. Commitments

Things the user said they'd do ("I'll send it to Arjun tomorrow"). They're stored as `task` memories
with metadata; the app lists them on the Automations screen with a **Done** button.

**Metadata shape:**
```json
{"kind": "commitment", "status": "open", "due_at": "2026-10-19T18:00:00+05:30", "person": "Arjun", "source": "chat"}
```

1. **From chat.** Extend `MEMORY_EXTRACTION_PROMPT`: when the user commits to something ("I'll…",
   "I will…", "I need to… by…"), store it as `category: "task"` with the fields above.
   - Resolve `due_at` against the current local time. Pass "Now: Saturday 2026-10-18 14:05
     (Asia/Kolkata)" into the extraction call, using the device's timezone when known.
   - The extraction JSON gains optional `due_at`, `person` and `commitment: true`. Build the
     metadata from those.
2. **From signals.** `NUDGE_PROMPT` may also return
   `"commitments": [{"content", "due_at", "person"}]`. Use these when a sent message on screen or
   a notification reply shows the user promising something. Store them the same way with
   `source: "screen" | "notification"`, skipping any whose lowercased content already exists.
3. **Following up.** `_context()` lists open commitments with due times.
   - The model raises a `reminder` before they're due and a `followup` when they're overdue.
   - Topic: `commitment:<memory id>:<local date>`.
4. **`PATCH /v1/memory/{id}`** accepts `metadata` (a shallow merge). `MemoryUpdate` gains
   `metadata: dict | None = None`, and `services.update_memory` gains a `metadata` parameter.
   - Any one of `content`, `category` or `metadata` is enough.
   - The app sends `{"metadata": {"status": "done"}}`. On an older server that request fails with
     "Nothing to update", and the app deletes the memory instead.

---

## 11. Digest and weekly review

**Digest** (`settings.digest`, default true, only when `evening_wrap` is set):
- A `low`-urgency nudge isn't returned. It's logged with status `held`.
- When the evening wrap is due, the context lists "Held for the wrap-up". The wrap mentions what
  still matters, and held entries become `digested`.
- Held entries older than 24 hours are dropped.

**Weekly review** (`weekly_review` time on `weekly_review_day`):
- `due_checkins` adds "weekly review" when today's ISO weekday matches, the local time is at or past
  the setting, and `checkins["weekly_review"]` isn't this ISO week (`"2026-W42"`).
- **Context:**
  - the last 7 days of `activity`;
  - commitments completed (status `done`, updated in the window) and still open or overdue;
  - triggers that fired;
  - from history: the most frequent apps and people over the week.
- **Output:** one `checkin` nudge: a warm 3–5 sentence review, with a `<checklist>` of open items
  in `detail`.

---

## 12. Prompt additions

Add to `DEVICE_PROMPT`, or the system prompt when tools exist:

```text
"Summarise this" or "what does this say" while the user is in Baymon: screen_read shows
previous_app; call screen_read_all with app set to it. For a shared link, use web_read.

Messages to other people: write them as a <draft> (in talk mode, read it out and ask
"Send it?") unless the user explicitly told you to send it.

Reminders tied to context (a place, a person messaging, opening an app) use trigger_create;
reminders at a time use reminder_set. For places, check location_places, and ask the user to
save the place (location_save_place) when they're there if it isn't saved.

Routines: routine_save when the user describes a named sequence; routine_run when they ask to
run one, then do its steps with your phone tools.

Questions about the past (what someone said, when something happened): history_search.
```

The DATA rule already in `DEVICE_PROMPT` now also covers attachments, `web_read` pages and history
results.

---

## Tests to add

- **Feedback:** `reason` is stored and shown in the context. An unknown reason gives 422.
- **Settings:**
  - the new keys round-trip and `null` turns them off;
  - `weekly_review_day` outside 1–7 gives 422;
  - `history` round-trips.
- **Drafts:**
  - `reply_key` is kept only when it matches a `can_reply` notification signal;
  - an empty draft is dropped;
  - `draft` is returned by `/v1/nudges/check` and `/v1/nudges`.
- **Triggers:**
  - each `when.type` matches and doesn't match as specified;
  - quiet hours and the repeat window are bypassed;
  - a once trigger is deleted after firing;
  - the repeat cooldown applies;
  - the fallback nudge appears when the model omits one;
  - `GET` and `DELETE` work, with 404 for an unknown id.
- **Routines:** save upserts by name; run returns the steps and sets `last_run_at`; run without a
  device fails with `not_supported`.
- **Server tools:** each works in both `_advance` and `_generate`, including several rounds.
- **Attachments:**
  - image, PDF and text extraction (mock the vision call);
  - the size limit;
  - the ownership check on chat;
  - the injected text is capped.
- **`web_read`:** private IPs are refused; size and time limits hold.
- **History:**
  - insert mapping for each signal type;
  - `retention_days=0` writes nothing;
  - search filters;
  - `DELETE /v1/history`.
- **Commitments:**
  - extraction produces the metadata;
  - PATCH with only metadata works;
  - overdue commitments appear in the nudge context.
- **Digest and weekly review:**
  - low-urgency nudges are held and then released in the wrap;
  - the weekly review is due once per ISO week.
