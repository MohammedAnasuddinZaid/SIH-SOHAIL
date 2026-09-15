// ZELUX companion server (pure Node + ws, no framework).
//
//   npm run server          -> http://localhost:8787
//   npm run server:dev      -> with --watch for hacking
//   npm run relay           -> same server (relay is built in)
//
// What one process provides (single port, single domain):
//   * WebSocket relay for cross-device battles (room-code directory + packet
//     forwarding between phones/desktops that never share localStorage).
//   * Player directory: a public "hall of fame" so players can find each other
//     by username, player code (ZX-....) or phone number. Only public profile
//     fields are stored (playerId, username, level, rank display, avatar,
//     optional phone). Nothing else.
//   * Coarse IP region: derived ONLY from standard HTTP reverse-proxy headers
//     (x-country-code / cf-ipcountry). No geo database, no IP logging, no
//     address storage. If no proxy header is present the client sees "unknown".
//   * Serves the built PWA from ./dist when present (SPA fallback included),
//     so one process can host the app, its relay and its directory.
//
// The app is fully functional without this server (offline-first). Every
// endpoint is CORS-open so a local Vite dev server can talk to it.
//
// Deploy anywhere Node runs (Railway/Render/Fly/Dokku) and point the client at
// it with VITE_REALTIME_RELAY_URL (or serve the app from here for zero config).

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "players.json");
const DIST = path.join(__dirname, "..", "dist");

const COUNTRY_NAMES = {
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  AE: "United Arab Emirates",
  AU: "Australia",
  CA: "Canada",
  DE: "Germany",
  FR: "France",
  JP: "Japan",
  SG: "Singapore",
  BR: "Brazil",
  ZA: "South Africa",
  NG: "Nigeria",
  SA: "Saudi Arabia",
  MY: "Malaysia",
  PK: "Pakistan",
  BD: "Bangladesh",
  LK: "Sri Lanka",
  NP: "Nepal",
  ID: "Indonesia",
  PH: "Philippines",
  RU: "Russia",
  KR: "South Korea",
  MX: "Mexico",
  IT: "Italy",
  ES: "Spain",
  TR: "Turkey",
};

// ---------------------------------------------------------------------------
// Directory registry (persisted to a JSON file)
// ---------------------------------------------------------------------------

let registry = new Map();
let dirty = false;

function loadRegistry() {
  registry = new Map();
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw)) registry.set(k, v);
      }
    }
  } catch {
    registry = new Map();
  }
}

let flushTimer = null;
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushRegistry();
  }, 500);
}

function flushRegistry() {
  flushTimer = null;
  if (!dirty) return;
  dirty = false;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(registry), null, 2), "utf8");
  } catch {
    /* persistence is best-effort; the directory stays memory-only */
  }
}

function sanitizePlayer(body) {
  if (!body || typeof body !== "object") return null;
  const playerId = typeof body.playerId === "string" ? body.playerId.trim().toUpperCase() : "";
  // Accept branded codes: ZX-XXXX-XXXX (ZELUX) or legacy REP-XXXX-XXXX.
  if (!/^[A-Z0-9]{2,3}-[A-Z0-9]{4,12}(?:-[A-Z0-9]{4})?$/i.test(playerId)) return null;
  const username =
    typeof body.username === "string"
      ? body.username.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24)
      : "";
  if (!username) return null;
  const level = Math.min(999, Math.max(1, Number(body.level) || 1));
  const rankDisplay = typeof body.rankDisplay === "string" ? body.rankDisplay.slice(0, 40) : "Rookie III";
  const phone =
    typeof body.phone === "string"
      ? body.phone.replace(/[^\d+]/g, "").slice(0, 15)
      : "";
  const av = body.avatar && typeof body.avatar === "object" ? body.avatar : {};
  const avatar = {
    icon: typeof av.icon === "string" ? av.icon.slice(0, 4) : "R",
    frame: typeof av.frame === "string" ? av.frame.slice(0, 32) : "frame_1",
    background: typeof av.background === "string" ? av.background.slice(0, 32) : "bg_1",
    accent: /^#?[0-9a-f]{3,8}$/i.test(String(av.accent)) ? String(av.accent) : "#ff7a1a",
  };
  return { playerId, username, level, rankDisplay, avatar, phone };
}

function collectBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req, res, urlPath) {
  if (!fs.existsSync(DIST) || urlPath.startsWith("/api/")) return false;
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.join(DIST, rel);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end("forbidden");
    return true;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }
  // SPA fallback: every unknown non-api path renders index.html. This is the
  // same behaviour vercel.json gives the static deploy, so /workout, /battle,
  // deep links and refreshes never 404.
  const fallback = path.join(DIST, "index.html");
  if (fs.existsSync(fallback)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    fs.createReadStream(fallback).pipe(res);
    return true;
  }
  return false;
}

function countryFromHeaders(headers) {
  const code = (headers["x-country-code"] ?? headers["cf-ipcountry"] ?? "").toString().trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return { code, name: COUNTRY_NAMES[code] ?? null };
}

// ---------------------------------------------------------------------------
// WebSocket relay (cross-device battles + room-code directory)
// ---------------------------------------------------------------------------

const rooms = new Map(); // matchId -> Set<WebSocket>
const roomCodes = new Map(); // code -> { matchId, hostId, roomId, settings, at }
const ROOM_CODE_TTL = 1000 * 60 * 60 * 4;

function pruneCodes() {
  const now = Date.now();
  for (const [code, rec] of roomCodes) {
    if (now - (rec.at ?? 0) > ROOM_CODE_TTL) roomCodes.delete(code);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (p === "/api/meta" && req.method === "GET") {
    json(res, 200, { name: "ZELUX", version: "2.1.0", directory: true, relay: true, region: "coarse-header-only" });
    return;
  }

  if (p === "/api/health" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      uptime: Math.round(process.uptime()),
      players: registry.size,
      relayRooms: rooms.size,
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",
    });
    return;
  }

  if (p === "/api/ip/region" && req.method === "GET") {
    const c = countryFromHeaders(req.headers);
    if (!c) {
      json(res, 200, { known: false, source: "no-proxy-header" });
      return;
    }
    json(res, 200, {
      known: true,
      countryCode: c.code,
      country: c.name ?? "Unknown",
      city: null,
      source: "cdn-header",
    });
    return;
  }

  if (p === "/api/directory/register" && req.method === "POST") {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      json(res, 400, { ok: false, error: "invalid body" });
      return;
    }
    const p2 = sanitizePlayer(body);
    if (!p2) {
      json(res, 400, { ok: false, error: "invalid player payload" });
      return;
    }
    // Only a handful of public fields are kept. The IP address touches the
    // stack once for the request and is never logged or persisted.
    registry.set(p2.playerId, { ...p2, updatedAt: Number(body.ts) || Date.now() });
    scheduleFlush();
    json(res, 200, { ok: true, playerId: p2.playerId });
    return;
  }

  if (p === "/api/directory/search" && req.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || 8));
    let list = [...registry.values()];
    if (q.length >= 2) {
      const lower = q.toLowerCase();
      const digits = q.replace(/[^\d]/g, "");
      // Match username, player code OR phone digits.
      list = list
        .filter(
          (pl) =>
            pl.username.toLowerCase().includes(lower) ||
            pl.playerId.toLowerCase().includes(lower) ||
            (pl.phone && digits.length >= 7 && pl.phone.replace(/[^\d]/g, "").includes(digits)),
        )
        .sort((a, b) => {
          const aExact = a.username.toLowerCase().startsWith(lower) ? 0 : 1;
          const bExact = b.username.toLowerCase().startsWith(lower) ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
    }
    json(res, 200, {
      players: list.slice(0, limit).map(({ phone, ...pub }) => pub),
      total: registry.size,
    });
    return;
  }

  if (p.startsWith("/api/directory/player/") && req.method === "GET") {
    const pid = decodeURIComponent(p.slice("/api/directory/player/".length)).toUpperCase();
    const player = registry.get(pid);
    if (!player) {
      json(res, 404, { ok: false, error: "player not found" });
      return;
    }
    const { phone, ...pub } = player;
    json(res, 200, { ok: true, player: pub });
    return;
  }

  if (serveStatic(req, res, p)) return;

  json(res, 404, { ok: false, error: "not found" });
});

// --- WebSocket relay on the SAME port (server/app.mjs) ---

const wss = new WebSocketServer({ server });

function roomOf(ws) {
  return ws.roomId ?? null;
}

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.kind === "ROOM_REGISTER" && msg.code) {
      roomCodes.set(String(msg.code).toUpperCase(), {
        matchId: msg.matchId,
        hostId: msg.hostId,
        roomId: msg.roomId,
        settings: msg.settings ?? null,
        at: Date.now(),
      });
      pruneCodes();
      return;
    }

    if (msg.kind === "ROOM_LOOKUP" && msg.code) {
      const code = String(msg.code).toUpperCase();
      const rec = roomCodes.get(code);
      if (rec && Date.now() - rec.at <= ROOM_CODE_TTL) {
        socket.send(
          JSON.stringify({
            kind: "ROOM_FOUND",
            code,
            matchId: rec.matchId,
            hostId: rec.hostId,
            roomId: rec.roomId,
            settings: rec.settings,
          }),
        );
      } else {
        socket.send(JSON.stringify({ kind: "ROOM_NOT_FOUND", code }));
      }
      return;
    }

    if (msg.kind === "JOIN" && msg.matchId) {
      socket.roomId = msg.matchId;
      if (!rooms.has(msg.matchId)) rooms.set(msg.matchId, new Set());
      rooms.get(msg.matchId).add(socket);
      return;
    }

    const rid = roomOf(socket);
    if (!rid) return;
    const peers = rooms.get(rid);
    if (!peers) return;
    for (const peer of peers) {
      if (peer !== socket && peer.readyState === WebSocket.OPEN) {
        peer.send(raw.toString());
      }
    }
  });
  socket.on("close", () => {
    const rid = roomOf(socket);
    if (!rid) return;
    const peers = rooms.get(rid);
    if (!peers) return;
    peers.delete(socket);
    if (peers.size === 0) rooms.delete(rid);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on("close", () => clearInterval(heartbeat));

process.on("exit", () => flushRegistry());
process.on("SIGINT", () => {
  flushRegistry();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flushRegistry();
  process.exit(0);
});

loadRegistry();
server.listen(PORT, HOST, () => {
  console.log(`ZELUX server on http://${HOST}:${PORT}`);
  console.log(`Directory file: ${DATA_FILE}`);
  console.log(`Static build: ${fs.existsSync(DIST) ? DIST : "none (run npm run build first)"}`);
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  for (const a of addrs) {
    console.log(`  LAN:    ws://${a}:${PORT}  http://${a}:${PORT}`);
  }
  if (process.env.PORT) {
    console.log(`  Relay/WS and directory API are on the same origin http://${HOST}:${PORT}`);
  }
});