# RepRush

Turn every push-up and squat into a competition.

RepRush is a privacy-first, offline-capable fitness competition platform that
counts push-ups and squats from your webcam in real time, then turns that
evidence into a full progression game: XP, levels, ranks, streaks, personal
records, quests, achievements, live head-to-head battles, friends, and a
personal AI fitness coach.

## Highlights

- **No login, no OTP** — every device is its own identity. The app mints a
  random device id on first launch and derives a unique, memorable
  `REP-XXXX-XXXX` code (confusion-safe alphabet, no `0/O/1/I/L`). Friends type
  that code to find you; you can start a fresh identity any time from "Your
  code" in Settings. No accounts, no passwords, works fully offline.
- **Computer vision rep counting** — MediaPipe (on-device) pose landmarks drive
  a state machine that only counts a rep when the full movement completes with
  sufficient depth, extension, alignment and confidence. Push-ups AND squats
  are supported (squat form is judged on knee depth, knee-over-toe alignment
  and torso angle). Every rep gets a `VALID`, `INVALID` or (in ambiguous cases)
  rejected outcome — nothing is fabricated. All camera processing stays on
  device; raw video never leaves the browser.
- **Server-authoritative progression** — Reps are counted locally, but XP,
  levels, ranks, PRs, quests, leaderboards and battle results are validated
  rules-side before they can inflate your score. Anti-cheat is probabilistic,
  not accusatory.
- **Multiplayer battles** — Same-browser cross-tab sync via `BroadcastChannel`
  with an optional tiny WebSocket relay (`server/relay-server.mjs`) so two
  devices in a room can race in real time. The relay is a dumb packet
  forwarder — match rules stay host-authoritative.
- **AI fitness coach** — a "harness loop" that reads your real verified
  performance records (sessions, form, streaks, PRs, quests, battles) and
  chooses the next best coaching action. Three personalities:
  - **Coach Nova** — kind, motivating, exact.
  - **Sergeant Rex** — tough love, blunt but never cruel; drops the act the
    moment you mention pain.
  - **Dr. Atlas** — data-forward performance scientist.
  The coach runs fully offline with its built-in engine, or you can point it at
  any OpenAI-compatible `/chat/completions` endpoint in Settings. It is a
  technique tool, not a medical device.
- **PWA** — installable, with a service worker and offline-first storage.
- **Optional public directory** — run the tiny zero-dependency
  `server/app.mjs` and players can opt in to a shared "hall of fame" so others
  can find them by username or player code. Only public profile fields are
  stored; the server never logs IPs or camera data.

## Stack

- React 18 + TypeScript + Vite
- zustand (state), react-router (routing)
- @mediapipe/tasks-vision (on-device pose detection)
- `three` (lazy-loaded decorative arena background)
- `ws` for the optional realtime relay server
- Vitest + jsdom for tests

## Getting started

```bash
npm install
npm run dev          # start the dev server on http://localhost:5173
```

### Environment

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Purpose |
| --- | --- |
| `VITE_APP_NAME` / `VITE_APP_TAGLINE` | Public branding at build time |
| `VITE_REALTIME_RELAY_URL` | Optional WebSocket relay URL for cross-device battles |
| `VITE_AI_COACH_ENDPOINT` | Optional OpenAI-compatible endpoint for the AI coach |
| `VITE_DIRECTORY_URL` | Optional RepRush directory server base URL (defaults to same-origin) |

`.env` is git-ignored — never commit secrets. In-app, the Settings page lets
players configure their own coach endpoint/API key, stored locally.

### Scripts

```bash
npm run dev          # dev server
npm run build        # typecheck + production build to dist/
npm run typecheck    # tsc -b --noEmit
npm test             # run the vitest suite
npm run lint         # alias for typecheck
npm run relay        # run the realtime relay server on ws://localhost:8787
npm run server       # run the optional directory server on http://localhost:8787
npm run server:dev   # directory server with --watch
npm run icons        # regenerate public/icons/{icon-192,icon-512}.png + icon.svg
```

### Multiplayer relay

For battles across separate devices/browsers:

```bash
npm run relay                       # relay on ws://localhost:8787
# or cross-origin:
WS_PORT=8787 npm run relay          # any port
```

The client automatically falls back to same-browser tab sync when the relay is
unreachable.

## Rep counting reliability

The core engine (`src/core/cv/PushUpRepEngine.ts`) is an explicit finite state
machine over elbow-angle phases with temporal validation:

- A rep must pass through `TOP → DESCENDING → BOTTOM → ASCENDING → TOP`.
- Thresholds (depth, extension, hip alignment, confidence, minimum/maximum
  duration) come from `src/config/cv.ts` and are tightened by the chosen
  strictness and per-session camera calibration.
- Reason-level invalidation reports why a rep failed
  (`INSUFFICIENT_DEPTH`, `HIP_SAG`, `INCOMPLETE_MOVEMENT`, …), and the workout
  timeline stores every rep with its evidence.

## Tests

```bash
npm test
```

The suite covers angle math, the push-up engine, smoothing/EMA + spike veto,
the combo engine, progression/Xp rules, the local coach reasoning engine, match
service, and a full workout-session integration.

## Project layout

```
src/
  core/              domain logic (cv, co progression, coach, multiplayer,
                     social, auth, identity, storage)
  config/            thresholds + feature config (cv, aiCoach, xp, etc.)
  pages/             routed UI (Dashboard, Workout, Battle, Leaderboard,
                     Coach, Social, Profile, Settings, Auth)
  components/        shared UI primitives
  stores/            zustand stores (auth, toast, …)
server/
  relay-server.mjs   realtime WebSocket relay for cross-device battles
  app.mjs            optional zero-dependency directory server (public search
                     + coarse region via CDN headers, serves ./dist too)
scripts/
  gen-icons.mjs      regenerates the PWA icons
public/              PWA assets (manifest, service worker, icons)
tests/               vitest suite
```

## Safety & privacy notes

- Camera frames are processed fully in the browser; no raw video is uploaded.
- The AI coach never invents statistics and never diagnoses medical
  conditions — if you report pain it advises rest and a professional.
- Tough-love mode roasts laziness with humor, never cruelty or humiliation.