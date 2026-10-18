# Baymon API v2: request and response formats

The exact wire format of every endpoint and tool added or changed for v2: the bubble's reply drafts
and feedback, reminders, routines, commitments, attachments, history and the new settings. The app is
already built against these shapes. They're taken from its code (`src/lib/**`), so match them field
for field.

Why each feature exists, and how the server should behave (matching rules, prompts, storage), is in
[backend-v2.md](backend-v2.md). This file is the contract.

---

## 0. Conventions (unchanged, for reference)

- **Base:** `https://<service>/v1/…`
- **Auth:** `Authorization: Bearer <Supabase access token>` on every `/v1` route. The user is
  always taken from the token, never from the body.
- **JSON:** requests are `Content-Type: application/json` except `/v1/attachments`, which is multipart.
  Responses are JSON, or an empty body with **204**.
- **Errors:** always the existing envelope, with HTTP status from `STATUS_BY_CODE`:
  ```json
  {"error": {"code": "trigger_not_found", "message": "No such reminder."}}
  ```
  Validation errors stay `422 invalid_request` with `details` (already the case).
- **Times:**
  - The phone sends **local ISO 8601 with offset**: `2026-10-18T16:00:00+05:30`.
  - The server returns ISO 8601. Either `+00:00` or a local offset is fine; the app parses both.
  - "HH:MM" settings are 24-hour local time.
- **IDs:** opaque strings with a type prefix: `ndg_…`, `trg_…`, `rtn_…`, `att_…`. The app never
  parses them.
- **Unknown fields:** the server must ignore unknown request fields (Pydantic's default). The app
  ignores unknown response fields.
- **Missing features:** if a route doesn't exist yet, a plain **404** (or 405) is fine. The app
  shows "needs the backend update". Don't return 200 with an empty body instead.

### New error codes to add to `STATUS_BY_CODE`

| Code | HTTP | When |
|---|---|---|
| `trigger_not_found` | 404 | Deleting or using an unknown reminder |
| `routine_not_found` | 404 | Deleting or running an unknown routine |
| `attachment_not_found` | 404 | `/v1/chat` references an id that isn't the user's (or has expired) |
| `too_large` | 413 | Upload over 20 MB |
| `unsupported_file` | 415 | Optional: you may also accept anything as `kind: "file"` |
| `extraction_failed` | 502 | The vision model or PDF parser failed (the upload itself was fine) |
| `limit_reached` | 409 | 50 reminders or 30 routines already exist |

---

## 1. Nudges (the bubble)

### 1.1 `POST /v1/nudges/check` (request: new signal shapes)

The request model is unchanged: `{device_id?, timezone?, signals: Signal[] (max 50)}`, with
`Signal = {type, at?, data}`. The `data` shapes the phone now sends:

| `type` | `data` | Example |
|---|---|---|
| `notification` | `app`, `package`, `title?`, `text?`; `key` and `can_reply` only when it has an inline Reply | `{"app": "WhatsApp", "package": "com.whatsapp", "title": "Priya", "text": "Are you joining at 5?", "key": "0\|com.whatsapp\|1\|…", "can_reply": true}` |
| `calendar` | `change` (`new`, `changed`, `removed`), `title`, `start`, `end?`, `location?`, `all_day?` | `{"change": "changed", "title": "Team sync", "start": "2026-10-18T17:00:00+05:30", "end": "2026-10-18T17:30:00+05:30"}` |
| `battery` | `level` (0–100), `charging` | `{"level": 12, "charging": false}` |
| `location` (moved) | `label`, `area?`; `saved: true` if it's a saved place | `{"label": "Bengaluru Airport", "area": "Devanahalli, Bengaluru"}` |
| `location` (geofence) | `label` (the saved place's name), `event` (`enter` or `exit`), `saved: true` | `{"label": "Office", "event": "enter", "saved": true}` |
| `app_open` | `app`, `package`; only for apps a reminder waits for | `{"app": "Swiggy", "package": "in.swiggy.android"}` |
| `screen` | `app`, `text` (≤ 400 chars) | `{"app": "Swiggy", "text": "Order #1234 · Deliver to: Office"}` |
| `foreground` | `{}` | |

Full request example:

```json
{
  "device_id": "a3f1c2…",
  "timezone": "Asia/Kolkata",
  "signals": [
    {"type": "notification", "at": "2026-10-18T14:05:11+05:30",
     "data": {"app": "WhatsApp", "package": "com.whatsapp", "title": "Priya",
              "text": "Are you joining at 5?", "key": "0|com.whatsapp|1|xyz|10234", "can_reply": true}},
    {"type": "location", "at": "2026-10-18T14:06:00+05:30",
     "data": {"label": "Office", "event": "enter", "saved": true}},
    {"type": "foreground", "at": "2026-10-18T14:06:02+05:30", "data": {}}
  ]
}
```

### 1.2 `POST /v1/nudges/check` and `GET /v1/nudges` (response: `draft` added)

Both return `{"nudges": Nudge[]}`. `Nudge` gains one optional field:

```json
{
  "nudges": [
    {
      "id": "ndg_3f9a1c22b0e4",
      "kind": "reminder",
      "urgency": "normal",
      "text": "Priya asked if you're joining the 5pm sync.",
      "detail": "Priya just asked on WhatsApp whether you're joining **Team sync at 17:00**. You don't have a conflict.",
      "suggestions": ["Tell her I'll be there", "Ask to move it"],
      "created_at": "2026-10-18T08:35:12+00:00",
      "expires_at": "2026-10-18T11:35:12+00:00",
      "draft": {
        "text": "Yes, I'll be there at 5!",
        "to": "Priya",
        "app": "WhatsApp",
        "reply_key": "0|com.whatsapp|1|xyz|10234"
      }
    }
  ]
}
```

| Field | Type | Rules |
|---|---|---|
| `draft` | object or `null`, optional | Omit it or send `null` when there's no draft |
| `draft.text` | string, 1–1000 | The message to send, in the user's voice |
| `draft.to` | string or null | Shown as "Reply to Priya" |
| `draft.app` | string or null | |
| `draft.reply_key` | string or null | **Only** a `key` from a `notification` signal with `can_reply: true` that the server has in state. Otherwise null. With it, **Send** replies inline on the phone. |

`kind`, `urgency` and the rest are unchanged.

### 1.3 `POST /v1/nudges/{id}/feedback` (`reason` added)

Request:
```json
{"action": "dismissed", "reason": "not_useful"}
{"action": "dismissed", "reason": "wrong_time"}
{"action": "done", "reason": "draft_sent"}
{"action": "snoozed", "snooze_minutes": 60}
{"action": "opened"}
```

| Field | Type | Rules |
|---|---|---|
| `action` | `opened \| dismissed \| snoozed \| done` | Unchanged |
| `snooze_minutes` | int 5–1440 | Only with `snoozed` |
| `reason` | `not_useful \| wrong_time \| draft_sent`, optional | `not_useful` and `wrong_time` come with `dismissed`; `draft_sent` with `done` |

Response: **204**. Unknown id: **404** `nudge_not_found` (the app drops it and doesn't retry).

```python
class NudgeDraft(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    to: str | None = Field(None, max_length=80)
    app: str | None = Field(None, max_length=60)
    reply_key: str | None = Field(None, max_length=500)

class Nudge(BaseModel):
    ...                                    # existing fields
    draft: NudgeDraft | None = None

class NudgeFeedback(BaseModel):
    action: Literal["opened", "dismissed", "snoozed", "done"]
    snooze_minutes: int | None = Field(None, ge=5, le=1440)
    reason: Literal["not_useful", "wrong_time", "draft_sent"] | None = None
```

---

## 2. Settings

### 2.1 `GET /v1/settings`

```json
{
  "voice_model": "troy",
  "voices": [ … unchanged … ],
  "nudges": {
    "enabled": true,
    "quiet_start": "22:00",
    "quiet_end": "08:00",
    "morning_brief": "08:00",
    "evening_wrap": "21:00",
    "digest": true,
    "weekly_review": "18:00",
    "weekly_review_day": 7
  },
  "history": {"retention_days": 90}
}
```

The app relies on two things here:
- **`history` is present:** without it, the History setting shows "needs the backend update".
- **Every `nudges` key is present:** a key the app saved but doesn't get back is reported as
  "not supported yet".

### 2.2 `PATCH /v1/settings`

Only the fields sent change. In `nudges`, `null` turns a time off. Examples of what the app sends:

```json
{"nudges": {"digest": false}}
{"nudges": {"weekly_review": "19:30"}}
{"nudges": {"weekly_review": null}}
{"nudges": {"weekly_review_day": 6}}
{"nudges": {"quiet_start": "23:00", "quiet_end": "07:00"}}
{"history": {"retention_days": 30}}
{"history": {"retention_days": 0}}
```

Response: the full `Settings` object, as in §2.1.

| Field | Type | Default | Rules |
|---|---|---|---|
| `nudges.digest` | bool | `true` | Hold `low`-urgency nudges for the evening wrap |
| `nudges.weekly_review` | `"HH:MM"` or null | `"18:00"` | null = off |
| `nudges.weekly_review_day` | int 1–7 | `7` | ISO weekday: 1 = Monday, 7 = Sunday |
| `history.retention_days` | `0 \| 30 \| 90 \| 365` | `90` | 0 = keep nothing (and stop writing). Lowering it deletes older rows now. |

```python
class NudgeSettings(BaseModel):
    enabled: bool = True
    quiet_start: str | None = Field("22:00", pattern=HHMM)
    quiet_end: str | None = Field("08:00", pattern=HHMM)
    morning_brief: str | None = Field("08:00", pattern=HHMM)
    evening_wrap: str | None = Field("21:00", pattern=HHMM)
    digest: bool = True
    weekly_review: str | None = Field("18:00", pattern=HHMM)
    weekly_review_day: int = Field(7, ge=1, le=7)

class NudgeSettingsUpdate(BaseModel):     # every field optional; model_fields_set decides what changes
    enabled: bool | None = None
    quiet_start: str | None = Field(None, pattern=HHMM)
    quiet_end: str | None = Field(None, pattern=HHMM)
    morning_brief: str | None = Field(None, pattern=HHMM)
    evening_wrap: str | None = Field(None, pattern=HHMM)
    digest: bool | None = None
    weekly_review: str | None = Field(None, pattern=HHMM)
    weekly_review_day: int | None = Field(None, ge=1, le=7)

class HistorySettings(BaseModel):
    retention_days: Literal[0, 30, 90, 365] = 90

class Settings(BaseModel):
    voice_model: Voice | None
    voices: list[VoiceOption]
    nudges: NudgeSettings = Field(default_factory=NudgeSettings)
    history: HistorySettings = Field(default_factory=HistorySettings)

class SettingsUpdate(BaseModel):
    voice_model: Voice | None = None
    nudges: NudgeSettingsUpdate | None = None
    history: HistorySettings | None = None
```

---

## 3. Reminders ("remind me when…"): `/v1/triggers`

### 3.1 The `Trigger` object

```json
{
  "id": "trg_8c1e04a9f2d3",
  "when": {"type": "message", "from": "Priya", "app": "WhatsApp"},
  "say": "Ask Priya about the invoice.",
  "repeat": false,
  "routine_id": null,
  "created_at": "2026-10-18T08:40:00+00:00",
  "last_fired_at": null
}
```

`when` is exactly one of these four shapes. The app renders each one as a sentence, so the field
names matter:

| `when.type` | Fields | App shows |
|---|---|---|
| `place` | `place` (string), `on` (`arrive` or `leave`) | "When you get to Office" / "When you leave Office" |
| `message` | `from` (string), `app` (string or null) | "When Priya messages you on WhatsApp" |
| `app` | `app` (string) | "Next time you open Swiggy" (or "When you open…" if `repeat`) |
| `notification` | `app` (string or null), `contains` (string or null), at least one set | "When Slack mentions “deploy”" |

```json
{"type": "place", "place": "Office", "on": "arrive"}
{"type": "message", "from": "Priya", "app": null}
{"type": "app", "app": "Swiggy"}
{"type": "notification", "app": "Slack", "contains": "deploy"}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string | `trg_` + 12 hex |
| `say` | string 1–160 | The bubble text, to the user |
| `repeat` | bool | `false`: deleted after it fires once |
| `routine_id` | string or null | The bubble offers "Run {name}" when it fires |
| `created_at` | ISO | |
| `last_fired_at` | ISO or null | |

```python
class PlaceWhen(BaseModel):
    type: Literal["place"]
    place: str = Field(min_length=1, max_length=40)
    on: Literal["arrive", "leave"] = "arrive"

class MessageWhen(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type: Literal["message"]
    from_: str = Field(alias="from", min_length=1, max_length=80)
    app: str | None = Field(None, max_length=60)

class AppWhen(BaseModel):
    type: Literal["app"]
    app: str = Field(min_length=1, max_length=60)

class NotificationWhen(BaseModel):
    type: Literal["notification"]
    app: str | None = Field(None, max_length=60)
    contains: str | None = Field(None, max_length=80)

    @model_validator(mode="after")
    def _one_of(self):
        if not (self.app or self.contains):
            raise ValueError("notification triggers need app or contains")
        return self

When = Annotated[PlaceWhen | MessageWhen | AppWhen | NotificationWhen, Field(discriminator="type")]

class Trigger(BaseModel):
    id: str
    when: When
    say: str = Field(min_length=1, max_length=160)
    repeat: bool = False
    routine_id: str | None = None
    created_at: str
    last_fired_at: str | None = None

class TriggerList(BaseModel):
    items: list[Trigger]
```

> `from` is a Python keyword, hence the alias. FastAPI serialises response models by alias, so the
> JSON key stays `"from"`. Keep that, because the app reads `when.from`.

### 3.2 `GET /v1/triggers`

Response **200**: `{"items": Trigger[]}`, newest first, at most 50. An empty list is
`{"items": []}`, not a 404.

### 3.3 `DELETE /v1/triggers/{id}`

Response **204**. Unknown id: **404** `trigger_not_found`. The app deletes optimistically and
rolls back on any error.

(Reminders are created only by the model, through the `trigger_create` tool in §9, so there's no
POST endpoint.)

---

## 4. Routines: `/v1/routines`

### 4.1 The `Routine` object

```json
{
  "id": "rtn_51d0aa7c3e19",
  "name": "Leaving work",
  "steps": [
    "Text Home \"On my way\" on WhatsApp",
    "Open Google Maps with directions home",
    "Turn on Do Not Disturb"
  ],
  "created_at": "2026-10-18T09:00:00+00:00",
  "last_run_at": null
}
```

| Field | Type | Rules |
|---|---|---|
| `name` | string 1–40 | Unique per user, case-insensitive |
| `steps` | string[] 1–12, each 1–200 | Plain language. The app shows the first three joined by " · ". |
| `last_run_at` | ISO or null | Set by `routine_run` |

```python
class Routine(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=40)
    steps: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(min_length=1, max_length=12)
    created_at: str
    last_run_at: str | None = None

class RoutineList(BaseModel):
    items: list[Routine]
```

### 4.2 `GET /v1/routines`

**200** `{"items": Routine[]}`, sorted by name.

### 4.3 `DELETE /v1/routines/{id}`

**204**, or **404** `routine_not_found`. Triggers that point at a deleted routine get `routine_id: null`.

**Running:** the app's Run button sends a normal `/v1/chat` message,
`Run my “Leaving work” routine.`, and the model calls `routine_run` (§9). No endpoint is needed.

---

## 5. Commitments (memory with metadata)

### 5.1 `GET /v1/memory` (unchanged route, new metadata shape)

A commitment is a memory with `category: "task"` and this `metadata`:

```json
{
  "id": "4b0e…",
  "content": "User will send the report to Arjun by 6pm.",
  "category": "task",
  "created_at": "2026-10-18T09:10:00+00:00",
  "updated_at": null,
  "metadata": {
    "kind": "commitment",
    "status": "open",
    "due_at": "2026-10-18T18:00:00+05:30",
    "person": "Arjun",
    "source": "chat"
  }
}
```

| `metadata` field | Type | Rules |
|---|---|---|
| `kind` | `"commitment"` | Required; it's how the app finds them |
| `status` | `open \| done` | Missing counts as `open` |
| `due_at` | ISO with offset, or null | The app shows "Due today 18:00", "Due tomorrow…" or "Overdue" |
| `person` | string or null | |
| `source` | `chat \| screen \| notification` | |

### 5.2 `PATCH /v1/memory/{id}` (accepts `metadata`)

Request from the app's **Done** button:
```json
{"metadata": {"status": "done"}}
```
- This is a **shallow merge** into the existing `metadata`, not a replacement.
- Any one of `content`, `category` or `metadata` is enough; with none of them it's still
  `422 invalid_memory`.
- It sets `updated_at`.
- **Response: 200** with the full updated `Memory`.

```python
class MemoryUpdate(BaseModel):
    content: str | None = Field(None, min_length=1, max_length=services.MEMORY_MAX_CHARS)
    category: Category | None = None
    metadata: dict[str, Any] | None = None     # merged into the existing metadata
```

---

## 6. Attachments: `POST /v1/attachments`

Used by the share sheet (screenshots, photos, PDFs, files) and the `files_read` tool.

### Request: `multipart/form-data`

| Part | Required | Notes |
|---|---|---|
| `file` | yes | The bytes. The multipart filename is a cache name such as `1739871-receipt.jpg`, so prefer `name`. |
| `name` | no (the app always sends it) | The real file name, e.g. `receipt.jpg` |
| `mime` | no | e.g. `image/jpeg`, `application/pdf`. Fall back to the part's content type, then sniffing. |

The limit is **20 MB** (the app checks too). Larger files get 413 `too_large`.

### Response: **201**

```json
{
  "id": "att_9e2c7d10b4a6",
  "kind": "image",
  "name": "boarding-pass.jpg",
  "mime": "image/jpeg",
  "size": 482113,
  "text": "IndiGo · 6E 5123 · BLR → DEL\nSeat 14C · Boarding 18:05 · Gate 23\n\nA boarding pass for IndiGo flight 6E 5123 from Bengaluru to Delhi on 19 Oct, boarding 18:05 at gate 23, seat 14C.",
  "created_at": "2026-10-18T09:20:00+00:00"
}
```

| Field | Type | Rules |
|---|---|---|
| `kind` | `image \| pdf \| text \| file` | `file` = not readable; `text` is `""` |
| `text` | string, ≤ 40,000 | Images: a verbatim transcription, then a 1–3 sentence description. PDFs: the extracted text. Text files: the content. |
| `size` | int | Bytes received |

Errors:

| Status | Code | When |
|---|---|---|
| 413 | `too_large` | The file is over 20 MB |
| 415 | `unsupported_file` | Optional; you may accept anything as `kind: "file"` instead |
| 422 | `invalid_request` | The request has no `file` part |
| 502 | `extraction_failed` | Vision or PDF processing failed. Alternatively return 201 with `text: ""`. |

```python
class Attachment(BaseModel):
    id: str
    kind: Literal["image", "pdf", "text", "file"]
    name: str
    mime: str
    size: int
    text: str = ""
    created_at: str

@app.post("/v1/attachments", status_code=201)
async def upload_attachment(
    user: CurrentUser,
    file: UploadFile = File(...),
    name: str | None = Form(None),
    mime: str | None = Form(None),
) -> Attachment: ...
```

Storage: an `attachments` row (`id, user_id, kind, name, mime, size, text, created_at`), kept for
30 days. Don't keep the bytes after extraction.

---

## 7. Chat: `attachments` on `POST /v1/chat`

### Request (one new field)

```json
{
  "message": "Save the important details from this to memory.",
  "history": [ … ],
  "voice": false,
  "mode": "type",
  "tts_voice": "troy",
  "device_id": "a3f1c2…",
  "attachments": ["att_9e2c7d10b4a6"]
}
```

| Field | Type | Rules |
|---|---|---|
| `attachments` | string[], 0–5, optional | Omitted when empty. Each must belong to the user, or 404 `attachment_not_found`. |

```python
class ChatRequest(BaseModel):
    ...                                    # existing fields
    attachments: list[str] = Field(default_factory=list, max_length=5)
```

**What the model sees.** Append to this turn's user message only, never to `history`:

```
Save the important details from this to memory.

[Attached: boarding-pass.jpg (image)]
<<<
IndiGo · 6E 5123 · BLR → DEL …
>>>
```

The total is capped at 30,000 characters across attachments.

**History.** Later turns arrive with the app's own note on the user message:
`…\n\n[Attached: boarding-pass.jpg]`. The text isn't re-sent; a past attachment can be re-read by id
if you keep the mapping.

The response is unchanged (`ChatResponse`), and so is `/v1/chat/{turn_id}/results` (no attachments).

### Reply drafts in `text`

Replies may contain the `<draft>` UI tag. Its format is in `docs/agent-ui-format.md`:

```
<draft>
{"to": "Priya", "app": "WhatsApp", "text": "Yes, see you at 5!", "send": {"tool": "notification_reply", "args": {"key": "0|com.whatsapp|1|xyz|10234"}}}
</draft>
```

- `send.tool` must be one of `notification_reply` (args `key`), `sms_compose` (args `to`) or
  `email_compose` (args `to`, `subject`). The app inserts the text.
- After the user taps Send, the same message comes back in `history` as
  `<draft status="sent">…</draft>` (`status="opened"` for composers, which only open the
  composer).

---

## 8. History: `DELETE /v1/history`

No body. **204**. It deletes every `signal_history` row for the user. Settings are unchanged (use
`PATCH /v1/settings` `{"history": {"retention_days": 0}}` to stop collecting).

Reading history happens only through the model's `history_search` tool (§9).

---

## 9. Server-side tools (what the model calls; never sent to the phone)

These are given to the model as functions (`{"type": "function", "function": {...}}`). The server
runs them and the result goes back as a `tool` message.
- **Success** is any JSON object.
- **Failure** uses the same shape as phone results:
  `{"status": "failed", "error": {"code": "...", "message": "..."}}`.

### 9.1 `trigger_create`

```json
{
  "name": "trigger_create",
  "description": "Remind the user when something happens: they arrive at or leave a saved place, a person messages them, they open an app, or a notification mentions something. For reminders at a time, use reminder_set.",
  "parameters": {
    "type": "object",
    "properties": {
      "when": {
        "type": "object",
        "description": "One of: {\"type\":\"place\",\"place\":\"Office\",\"on\":\"arrive\"|\"leave\"} | {\"type\":\"message\",\"from\":\"Priya\",\"app\":\"WhatsApp\"?} | {\"type\":\"app\",\"app\":\"Swiggy\"} | {\"type\":\"notification\",\"app\":\"Slack\"?,\"contains\":\"deploy\"?}"
      },
      "say": {"type": "string", "description": "The reminder, one short sentence to the user, e.g. \"Ask Priya about the invoice.\""},
      "repeat": {"type": "boolean", "default": false, "description": "Every time, not just once."},
      "routine": {"type": "string", "description": "Name of a saved routine to offer when it fires."}
    },
    "required": ["when", "say"]
  }
}
```

Result:
```json
{"created": {"id": "trg_8c1e04a9f2d3", "when": {"type": "place", "place": "Office", "on": "arrive"}, "say": "Call the bank.", "repeat": false},
 "note": "Check location_places; if Office isn't saved, ask the user to save it when they're there."}
```
- The `note` is only for `place` triggers.
- Failures: `invalid_args` (bad `when`), `not_found` (unknown routine name), `limit_reached`.

### 9.2 `trigger_list` / `trigger_delete`

```json
{"name": "trigger_list", "parameters": {"type": "object", "properties": {}}}
{"name": "trigger_delete", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}
```
Results:
```json
{"triggers": [ Trigger, … ]}
{"deleted": "trg_8c1e04a9f2d3"}
```

### 9.3 `routine_save` / `routine_list` / `routine_delete` / `routine_run`

```json
{"name": "routine_save", "parameters": {"type": "object", "properties": {
  "name": {"type": "string"},
  "steps": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 12}},
  "required": ["name", "steps"]}}
{"name": "routine_list", "parameters": {"type": "object", "properties": {}}}
{"name": "routine_delete", "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}
{"name": "routine_run", "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}
```
Results:
```json
{"saved": Routine}
{"routines": [ Routine, … ]}
{"deleted": "Leaving work"}
{"run": "Leaving work", "steps": ["Text Home …", "Open Google Maps …", "Turn on Do Not Disturb"],
 "instruction": "Do these steps now with your phone tools, in order, then report briefly."}
```
- `routine_save` upserts by name, case-insensitive.
- Without a registered device, `routine_run` fails with `not_supported`: "Routines need the phone."
- Unknown name: `not_found`.

### 9.4 `history_search`

```json
{"name": "history_search",
 "description": "Search what the phone noticed earlier (notifications, messages, screens, places). Use for questions about the past: what someone said, when something happened.",
 "parameters": {"type": "object", "properties": {
   "query": {"type": "string", "description": "Words to find, e.g. \"report\"."},
   "person": {"type": "string", "description": "Sender or chat name, e.g. \"Arjun\"."},
   "app": {"type": "string"},
   "since": {"type": "string", "description": "ISO 8601."},
   "until": {"type": "string", "description": "ISO 8601."},
   "limit": {"type": "integer", "minimum": 1, "maximum": 30, "default": 15}}}}
```
Result, newest first, with `at` in the user's local time:
```json
{"results": [
  {"at": "2026-10-14T16:22:05+05:30", "type": "notification", "app": "Slack", "title": "Arjun",
   "text": "Can you send the Q3 report by Friday? Finance needs it."}
], "retention_days": 90}
```
With history off, the result is `{"results": [], "retention_days": 0, "note": "History is off in Settings."}`.

### 9.5 `web_read`

```json
{"name": "web_read",
 "description": "Read a web page (e.g. a link the user shared) and return its main text.",
 "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}
```
Result:
```json
{"url": "https://example.com/post", "title": "Post title", "text": "…main text, ≤ 30,000 chars…"}
```
Failures: `invalid_args` (not http(s), or a private address), `timeout`, `failed`.

---

## 10. Phone tools the backend will now see in results

These are registered by the phone in `POST /v1/devices` and executed on it. The backend only
passes them to the model, but here's what their `output` looks like in
`/v1/chat/{turn_id}/results`:

| Tool | Output |
|---|---|
| `screen_read` | Adds `previous_app` and `previous_package` when Baymon itself is on screen: `{"app": "Baymon", "package": "com.narensen.baymon", "elements": 14, "screen": "…", "previous_app": "Chrome", "previous_package": "com.android.chrome"}` |
| `screen_read_all` | `{"app": "Chrome", "package": "com.android.chrome", "pages": 6, "complete": true, "text": "…≤ 30,000 chars…"}` |
| `files_read` | `{"attachment_id": "att_…", "name": "receipt.jpg", "kind": "image", "text": "…"}`. It uses `POST /v1/attachments`, so the same id works in later turns. |
| `location_save_place` | `{"saved": "Office", "radius_m": 150}` |
| `location_places` | `{"places": [{"name": "Office", "radius_m": 150}, {"name": "Home", "radius_m": 150}]}` |
| `location_forget_place` | `{"forgotten": "Gym"}` (or failure `not_found`) |

Router groups: `screen_read_all` → `screen`, `files_read` → `files`, `location_*` → `web`.
No routing change is needed.

`POST /v1/devices` `capabilities` may now include `"overlay": true | false`. The type is still
`dict[str, bool]`, so nothing changes.

---

## 11. Checklist

- [ ] Add the error codes in §0 to `STATUS_BY_CODE`.
- [ ] `Nudge.draft`, `NudgeFeedback.reason` (§1)
- [ ] `NudgeSettings` fields and `Settings.history` in GET and PATCH (§2)
- [ ] `GET` and `DELETE /v1/triggers` with the `Trigger` model, including the `from` alias (§3)
- [ ] `GET` and `DELETE /v1/routines` (§4)
- [ ] `MemoryUpdate.metadata`, merged (§5)
- [ ] `POST /v1/attachments` (multipart), 201 (§6)
- [ ] `ChatRequest.attachments` (§7)
- [ ] `DELETE /v1/history` (§8)
- [ ] Server tools from §9 in both chat paths
- [ ] Tests that check the JSON field names above, especially `when.from`, `draft.reply_key`,
  `history.retention_days` and `items`.
