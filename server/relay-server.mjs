// The WebSocket relay is now built into server/app.mjs (same port, same origin
// as the directory API and the static app). This file exists so the old
// `npm run relay` command still works: it just boots the unified server.
// Run `npm run server` (or `npm run relay`) once — one port, everything.
//
//   WS_PORT / PORT => listening port (default 8787)
//   HOST           => bind address (default 0.0.0.0)

import "./app.mjs";