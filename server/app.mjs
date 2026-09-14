// RepRush optional companion server (pure Node, zero dependencies).
//
//   npm run server          -> http://localhost:8787
//   npm run server:dev      -> with --watch for hacking
//
// What it provides:
//   * Player directory: a public "hall of fame" so players can find each other
//     by username or player code. Only public profile fields are stored
//     (playerId, username, level, rank display, avatar). Nothing else.
//   * Coarse IP region: derived ONLY from standard HTTP reverse-proxy headers
//     (x-country-code / cf-ipcountry). No geo database, no IP logging, no
//     address storage. If no proxy header is present the client sees "unknown".
//   * Serves the built PWA from ./dist when present, so one process can host
//     the app and its directory.
//
// The app is fully functional without this server (offline-first). Every
// endpoint is CORS-open so a local Vite dev server can talk to it.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
  if (!/^REP-[A-Z0-9]{4,12}$/i.test(playerId)) return null;
  const username =
    typeof body.username === "string"
      ? body.username.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24)
      : "";
  if (!username) return null;
  const level = Math.min(999, Math.max(1, Number(body.level) || 1));
  const rankDisplay = typeof body.rankDisplay === "string" ? body.rankDisplay.slice(0, 40) : "Rookie III";
  const av = body.avatar && typeof body.avatar === "object" ? body.avatar : {};
  const avatar = {
    icon: typeof av.icon === "string" ? av.icon.slice(0, 4) : "R",
    frame: typeof av.frame === "string" ? av.frame.slice(0, 32) : "frame_1",
    background: typeof av.background === "string" ? av.background.slice(0, 32) : "bg_1",
    accent: /^#?[0-9a-f]{3,8}$/i.test(String(av.accent)) ? String(av.accent) : "#ff7a1a",
  };
  return { playerId, username, level, rankDisplay, avatar };
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
  if (!path.extname(rel)) {
    const fallback = path.join(DIST, "index.html");
    if (fs.existsSync(fallback)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      fs.createReadStream(fallback).pipe(res);
      return true;
    }
  }
  return false;
}

function countryFromHeaders(headers) {
  const code = (headers["x-country-code"] ?? headers["cf-ipcountry"] ?? "").toString().trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return { code, name: COUNTRY_NAMES[code] ?? null };
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
    json(res, 200, { name: "RepRush", version: "1.1.0", directory: true, region: "coarse-header-only" });
    return;
  }

  if (p === "/api/health" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      uptime: Math.round(process.uptime()),
      players: registry.size,
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
      list = list
        .filter((pl) => pl.username.toLowerCase().includes(lower) || pl.playerId.toLowerCase().includes(lower))
        .sort((a, b) => {
          const aExact = a.username.toLowerCase().startsWith(lower) ? 0 : 1;
          const bExact = b.username.toLowerCase().startsWith(lower) ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        });
    }
    json(res, 200, { players: list.slice(0, limit), total: registry.size });
    return;
  }

  if (p.startsWith("/api/directory/player/") && req.method === "GET") {
    const pid = decodeURIComponent(p.slice("/api/directory/player/".length));
    const player = registry.get(pid);
    if (!player) {
      json(res, 404, { ok: false, error: "player not found" });
      return;
    }
    json(res, 200, { ok: true, player });
    return;
  }

  if (serveStatic(req, res, p)) return;

  json(res, 404, { ok: false, error: "not found" });
});

process.on("exit", () => flushRegistry());
process.on("SIGINT", () => {
  flushRegistry();
  process.exit(0);
});

loadRegistry();
server.listen(PORT, HOST, () => {
  console.log(`RepRush server on http://${HOST}:${PORT}`);
  console.log(`Directory file: ${DATA_FILE}`);
  console.log(`Static build: ${fs.existsSync(DIST) ? DIST : "none (run npm run build first)"}`);
});