// ZelusX realtime relay - a tiny WebSocket hub.
// Purpose: enable real-time battles across DIFFERENT devices/browsers where
// BroadcastChannel (same-browser tabs) cannot reach. It is a dumb packet relay:
// it forwards JSON messages between sockets tagged with the same room id.
//
// Run:  npm run relay   (listens on 0.0.0.0:8787 so phones on the LAN can join)
// The client uses this when VITE_REALTIME_RELAY_URL is set and reachable.
//
// This is NOT a game server: match rules remain host-authoritative in the app.

import { createServer } from "node:http";
import os from "node:os";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.WS_PORT || 8787);
const rooms = new Map(); // roomId -> Set<WebSocket>
// Room-code directory so a phone can join a room hosted on another device even
// though the two never share localStorage. The host registers {code -> matchId}
// and the relay answers ROOM_LOOKUP directly.
const roomCodes = new Map(); // code -> { matchId, hostId, roomId, settings, at }
const ROOM_CODE_TTL = 1000 * 60 * 60 * 4;

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ZelusX relay running\n");
});

const wss = new WebSocketServer({ server });

function roomOf(conn) {
  return conn.roomId;
}

function pruneCodes() {
  const now = Date.now();
  for (const [code, rec] of roomCodes) {
    if (now - (rec.at ?? 0) > ROOM_CODE_TTL) roomCodes.delete(code);
  }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (raw) => {
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
        settings: msg.settings,
        at: Date.now(),
      });
      pruneCodes();
      return;
    }

    if (msg.kind === "ROOM_LOOKUP" && msg.code) {
      const code = String(msg.code).toUpperCase();
      const rec = roomCodes.get(code);
      if (rec && Date.now() - rec.at <= ROOM_CODE_TTL) {
        ws.send(JSON.stringify({ kind: "ROOM_FOUND", code, matchId: rec.matchId, hostId: rec.hostId, roomId: rec.roomId, settings: rec.settings }));
      } else {
        ws.send(JSON.stringify({ kind: "ROOM_NOT_FOUND", code }));
      }
      return;
    }

    if (msg.kind === "JOIN" && msg.matchId) {
      ws.roomId = msg.matchId;
      if (!rooms.has(msg.matchId)) rooms.set(msg.matchId, new Set());
      rooms.get(msg.matchId).add(ws);
      return;
    }
    const rid = roomOf(ws);
    if (!rid) return;
    const peers = rooms.get(rid);
    if (!peers) return;
    for (const peer of peers) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        peer.send(raw.toString());
      }
    }
  });
  ws.on("close", () => {
    const rid = roomOf(ws);
    if (!rid) return;
    const peers = rooms.get(rid);
    if (!peers) return;
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(rid);
  });
});

// heartbeat to clean idle connections
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

server.listen(PORT, "0.0.0.0", () => {
  const nets = os.networkInterfaces();
  const addrs: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`[relay] ZelusX relay listening on ws://0.0.0.0:${PORT}`);
  console.log(
    `[relay] LAN reachable at: ${addrs.map((a) => `ws://${a}:${PORT}`).join(", ") || "(no LAN IPv4 found)"}`,
  );
  console.log(
    `[relay] Point phones at the host via VITE_REALTIME_RELAY_URL (or auto-discovery when the app is served from the same host).`,
  );
});