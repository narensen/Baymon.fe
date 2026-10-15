<div align="center">

# ● Baymon

**A personal AI companion you can type to, or just talk to.**

Matte black. Off-white type. Physics-based motion. One agent that remembers you.

`Expo SDK 57` · `React Native 0.86` · `Reanimated 4` · `Supabase` · `FastAPI + Groq`

</div>

---

## What it does

| | |
|---|---|
| **Talk, hands-free** | Speak; Baymon notices when you've stopped, answers out loud and listens again. Tap the orb to interrupt. |
| **Type, with rich replies** | Replies render as native components: timelines, checklists, comparisons, stats and tap-to-send follow-ups. |
| **Dictate** | The mic in the message box turns speech into editable text. |
| **Memory you control** | See, edit, recategorize and delete everything the agent remembers about you. |
| **Six voices** | Pick one in Settings and hear a preview first. |
| **Operates your phone** | 40 tools: it reads any app's screen and taps, types and scrolls, plus files, alarms, reminders, calendar, contacts, calls, maps and settings. |

### The orb is the agent

It follows your voice while listening, spins while thinking, pulses while speaking and breathes while
idle. Every frame runs on the UI thread, so the screen never re-renders to animate it.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill it in (below)
npx expo start                  # scan the QR code with Expo Go
```

### `.env.local`

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
EXPO_PUBLIC_API_URL=https://<your-service>.onrender.com
```

> [!CAUTION]
> Use the **publishable** key only. `EXPO_PUBLIC_*` values are bundled into the app, and a
> `sb_secret_…` key bypasses row-level security for anyone who extracts it.

### Database

Run [`supabase/migrations/20261014000000_users_profile.sql`](supabase/migrations/20261014000000_users_profile.sql)
once in the Supabase SQL editor. It adds:
- a trigger that creates the `public.users` row at signup;
- row-level security so each user only sees their own row;
- `username_available()` for the live username check.

### Backend

The app talks to the Baymon API (FastAPI on Render). All `/v1` routes take the Supabase access token
as `Authorization: Bearer …`.

| Endpoint | Used for |
|---|---|
| `POST /v1/chat` | Typed messages; spoken replies when `voice: true` |
| `POST /v1/talk` | One-request voice turns ([spec](docs/talk-endpoint.md)). The app falls back to transcribe + chat on 404. |
| `POST /v1/transcribe` | Dictation |
| `POST /v1/speak` | Read-aloud and voice previews |
| `GET · POST · PATCH · DELETE /v1/memory` | The Memory screen |

---

## Agent reply format

Replies are Markdown plus nine UI tags, each rendered as a native component:

```text
<schedule title="Thursday">
[{"time": "09:00", "end": "11:30", "title": "Deep work"}, {"time": "12:00", "title": "Lunch"}]
</schedule>
```

`callout` · `card` · `table` · `stats` · `schedule` · `steps` · `checklist` · `compare` · `suggestions`

A malformed tag falls back to plain text, so nothing is ever lost. The full spec, with a section you
can paste straight into the system prompt, is in [`docs/agent-ui-format.md`](docs/agent-ui-format.md).

---

## Project map

```
src/
├─ app/                      Expo Router screens
│  ├─ (auth)/                sign-in, sign-up
│  └─ (app)/
│     ├─ (drawer)/           home (chat), memory, settings
│     └─ memory/[id].tsx     memory editor sheet
├─ components/
│  ├─ chat/                  type view, talk view, composer, voice orb
│  │  └─ rich/               UI-tag renderers (table, schedule, compare…)
│  └─ ui/                    button, text field, switch, segmented control
├─ hooks/use-voice.ts        recording, playback, live mic level
├─ lib/
│  ├─ api.ts                 authenticated client + error envelope
│  ├─ agent.ts               chat / talk / transcribe / speak
│  ├─ conversation.ts        chat store, saved per user
│  ├─ memory.ts              memory store with optimistic updates
│  ├─ speech-detector.ts     adaptive end-of-speech detection
│  ├─ tools/                 the phone tool catalog + runner (sent to the backend)
│  ├─ device.ts              device registration
│  └─ ui-format.ts           UI-tag parser
└─ providers/auth-provider.tsx
modules/baymon-agent/        native Android module: screen control, apps, files, notifications
docs/                        backend + prompt specs
```

---

## How it's built

- **Auth:** `Stack.Protected` guards route groups on the Supabase session. The splash screen stays
  up until the session is known, so deep links land on the right screen.
- **Motion:** every interaction uses spring physics on the UI thread and can be interrupted mid-motion.
  The sidebar, menu icon and page scaling follow your finger frame by frame.
- **Voice:** mono 16 kHz AAC recordings for small uploads. End-of-speech detection learns each
  room's noise floor, because Android reports peak loudness and iOS reports average.
- **Keyboard:** a frame-synced spacer measured from the screen edge, correct under Android
  edge-to-edge, and it works in Expo Go.
- **State:** small external stores (`useSyncExternalStore`) with optimistic writes and rollback.
  The React Compiler handles memoization.

---

## Scripts

```bash
npx expo start          # dev server
npx expo lint           # lint
npx tsc --noEmit        # typecheck
npx expo-doctor         # dependency health
npx eas-cli@latest build --profile development   # dev build
```

Chat, voice and memory run in **Expo Go**. Operating the phone (screen control, apps, file
search, notifications, alarms) needs the **development build**, because it uses Baymon's own
Android module (`modules/baymon-agent`). See [`docs/agent-platform.md`](docs/agent-platform.md).
