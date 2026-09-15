# ZELUX

Turn every push-up and squat into a competition.

ZELUX is a privacy-first, offline-capable fitness competition platform that
counts push-ups and squats from your webcam in real time, then turns that
evidence into a full progression game: XP, levels, ranks, streaks, personal
records, quests, achievements, live head-to-head battles, friends, and a
personal AI fitness coach.

## Highlights

- **No login, no OTP** — every device is its own identity. The app mints a
  random device id on first launch and derives a unique, memorable
  `ZX-XXXX-XXXX` code (confusion-safe alphabet, no `0/O/1/I/L`). Friends type
  that code (or your phone number) to find you; you can start a fresh identity
  any time from "Your code" in Settings. No accounts, no passwords, works fully
  offline.
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
  plus a built-in WebSocket relay (`server/app.mjs`) so two devices in a room
  can race in real time. The relay is a dumb packet forwarder — match rules stay
  host-authoritative.
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
- **PWA** — installable, with a service worker and offline-first storage. The
  service worker falls back to the cached app shell for every route, and
  `vercel.json` rewrites clean URLs to `index.html`, so deep links and refreshes
  on `/workout`, `/battle`, etc. never 404.
- **Optional public directory** — run the tiny zero-dependency
  `server/app.mjs` and players can opt in to a shared "hall of fame" so others
  can find them by username, player code or phone number. Only public profile
  fields are stored; the server never logs IPs or camera data.

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
| `VITE_DIRECTORY_URL` | Optional ZELUX directory server base URL (defaults to same-origin) |

`.env` is git-ignored — never commit secrets. In-app, the Settings page lets
players configure their own coach endpoint/API key, stored locally.

### Scripts

```bash
npm run dev          # dev server
npm run build        # typecheck + production build to dist/
npm run typecheck    # tsc -b --noEmit
npm test             # run the vitest suite
npm run lint         # alias for typecheck
npm run relay        # unified server (relay + directory + static) on :8787
npm run server       # same unified server
npm run server:dev   # unified server with --watch
npm run icons        # regenerate public/icons/{icon-192,icon-512}.png + icon.svg
```

### Deploying

The frontend is a static SPA (Vite). `vercel.json` rewrites all non-`/api`
routes to `index.html` so client-side routes survive refreshes — this is
required for `BrowserRouter` on Vercel/Netlify.

For multiplayer across phones/desktops and the optional directory, deploy the
built app from `server/app.mjs` anywhere Node runs (Railway, Render, Fly,
Dokku, a VPS). One process serves the app, the WebSocket relay and the
directory API on a single port/origin:

```bash
npm run build
PORT=8787 npm run server     # then serve behind your domain/HTTPS
```

Point the client at it with `VITE_REALTIME_RELAY_URL=https://your.domain` (a
bare host is fine — `wss://` is added automatically). When the app is served
from the very same host, the relay URL auto-detects to same-origin and no env
is needed. The client gracefully degrades to same-browser tab sync when the
relay is unreachable.

### Running locally

```bash
npm run dev                          # app on http://localhost:5173
npm run server                       # relay + directory on http://localhost:8787
# .env: VITE_REALTIME_RELAY_URL="ws://localhost:8787"
```

## Rep counting reliability

The core engine (`src/core/cv/PushUpRepEngine.ts` / `SquatRepEngine.ts`) is an
explicit finite state machine over joint angles with temporal validation:

- A rep must pass through `TOP → DESCENDING → BOTTOM → ASCENDING → TOP`.
- Thresholds (depth, extension, hip alignment, confidence, minimum/maximum
  duration) come from `src/config/cv.ts` and are tightened by the chosen
  strictness. **Relaxed is the default** so every honest rep counts; strict is
  still available for form purists.
- Per-session camera calibration measures the user's actual extended top pose,
  so camera angle never blocks reps from completing.
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
  app.mjs            unified zero-dependency server: WebSocket relay +
                     directory API + coarse region + serves ./dist (SPA fallback)
  relay-server.mjs   legacy alias — imports app.mjs
scripts/
  gen-icons.mjs      regenerates the PWA icons
public/              PWA assets (manifest, service worker, icons)
vercel.json          static SPA rewrite so client-side routes never 404
tests/               vitest suite
```

## Safety & privacy notes

- Camera frames are processed fully in the browser; no raw video is uploaded.
- The AI coach never invents statistics and never diagnoses medical
  conditions — if you report pain it advises rest and a professional.
- Tough-love mode roasts laziness with humor, never cruelty or humiliation.