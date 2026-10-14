# `POST /v1/talk`: one request per voice turn

The app's hands-free mode currently needs two requests per turn (`/v1/transcribe`, then `/v1/chat`
with `voice: true`). This endpoint does the whole turn in one request. That saves a full upload/response
round trip, which is often 0.5–2 s on mobile networks and more on a cold Render instance. It also
returns a **caption** that is guaranteed short, so nothing under the orb is ever cut off.

The app already calls this endpoint and falls back to the two-request flow on a 404, so it can be
deployed at any time. Client code: `talkTurn` in `src/lib/agent.ts`.

## Request

`multipart/form-data`, authenticated like every `/v1` route (`Authorization: Bearer <token>`).

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | file | yes | The recording: `.m4a` (AAC, 16 kHz mono) on iOS/Android, `.webm` on web. ≤ 25 MB. |
| `history` | string | no | JSON array of `{"role": "user" \| "assistant", "content": str}`, same as `ChatRequest.history`. The app sends at most 20. |
| `tts_voice` | string | no | One of `Voice`. Defaults to the server default. |

The client doesn't send a Whisper `prompt`: build it server-side from the last assistant message in
`history` (its spoken form if you can, last ~1000 characters).

## Response `200`

```json
{
  "transcript": "What should I focus on today?",
  "text": "Full reply exactly as it should appear in the chat history.",
  "caption": "Start with the API work this morning, then review PRs after lunch.",
  "audio_base64": "UklGR…",
  "audio_mime": "audio/wav",
  "mode": null,
  "warnings": []
}
```

| Field | Rules |
|---|---|
| `transcript` | What Whisper heard. Becomes the user's message in the conversation. |
| `text` | The agent's full reply. Stored in history and shown if the user switches to typing. Plain conversational prose (talk mode uses no UI tags). |
| `caption` | **Exactly the words spoken** in `audio_base64`. Plain text: no Markdown, no tags, no URLs, no code. **At most 2 sentences and 40 words.** If `text` already fits, `caption` = `text` with formatting stripped. Otherwise a first-person spoken summary that points to the screen for details. |
| `audio_base64` | WAV of `caption`, or `null` if speech failed (then add a warning). |
| `mode` | `"type"` if the user asked to switch to typing (`switch_mode` tool), else `null`. |
| `warnings` | Non-fatal problems, same shape as `/v1/chat`, e.g. TTS failed but text is fine. |

Hard-limit `caption` server-side rather than trusting the model. After generating it, if it's over
40 words, cut it at the last sentence boundary within the limit, or at 40 words with an ellipsis.

## Errors

Same envelope and status codes as the rest of the API. The client relies on these codes:

| Code | Status | Client behaviour |
|---|---|---|
| `transcription_empty` | 422 | Shows "Didn't catch that" and immediately listens again. |
| `audio_empty` | 422 | Same as above. |
| `audio_too_large` | 413 | Shows the message, stops listening. |
| `groq_rate_limit` | 429 | Shows the message (it already includes when to retry). |
| anything else | – | Shows `message` and returns to "Tap to talk". |

If transcription succeeds but generation fails, return the error. The client doesn't add a
half-finished turn to the conversation.

## Reference flow (maps to existing `services.py`)

```python
@app.post("/v1/talk")
def talk(
    user: CurrentUser,
    background: BackgroundTasks,
    file: Annotated[UploadFile, File()],
    history: Annotated[str | None, Form()] = None,
    tts_voice: Annotated[Voice | None, Form()] = None,
) -> TalkResponse:
    data = file.file.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise ServiceError("Audio file is too large (max 25 MB).", "audio_too_large")
    turns = _parse_history(history)                       # validate like ChatMessage, cap at 40
    transcript = services.listen(data, file.filename or "audio.m4a", prompt=_whisper_prompt(turns))

    context = {"history": turns, "mode": "talk", **({"voice": tts_voice} if tts_voice else {})}
    result = services.run_turn(user.id, transcript, context, voice_mode=False, remember=False)

    caption = services.make_caption(result.text, max_words=40)   # new: see below
    audio, warnings = None, [ErrorInfo(code=e.code, message=e.message) for e in result.errors]
    try:
        audio = services.generate_audio(caption, context)
    except ServiceError as exc:
        warnings.append(ErrorInfo(code=exc.code, message=exc.message))

    background.add_task(_remember_turn, user.id, transcript, result.text, "voice")
    return TalkResponse(
        transcript=transcript,
        text=result.text,
        caption=caption,
        audio_base64=base64.b64encode(audio).decode() if audio else None,
        audio_mime="audio/wav" if audio else None,
        mode=result.mode if result.mode == "type" else None,
        warnings=warnings,
    )
```

`make_caption` is `decide_speech_text` with a word budget:
- If the stripped text is speakable and ≤ 40 words, return it.
- Otherwise run `SPEECH_DECISION_PROMPT` with "The spoken version must be at most 2 sentences and 40 words" added.
- Then enforce the limit in code as described above.

## Talk-mode prompt additions

Append to `MODE_PROMPTS["talk"]`:

```text
Reply in plain spoken English: no Markdown, no lists, no UI tags, no URLs, no code.
Keep it to one or two sentences unless the user explicitly asks for more detail.
```
