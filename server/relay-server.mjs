// REP ARENA realtime relay — a tiny WebSocket hub.
// Purpose: enable real-time battles across DIFFERENT devices/browsers where
// BroadcastChannel (same-browser tabs) cannot reach. It is a dumb packet relay:
// it forwards JSON messages between sockets tagged with the same room id.
//
// Run:  npm run relay   (default http://localhost:8787)
// The client uses this when VITE_REALTIME_RELAY_URL is set and reachable.
//
// This is NOT a game server: match rules remain host-authoritative in the app.

import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.WS_PORT || 8787);
const rooms = new Map(); // roomId -> Set<WebSocket>

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("REP ARENA relay running\n");
});

const wss = new WebSocketServer({ server });

function roomOf(conn) {
  return conn.roomId;
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

server.listen(PORT, () => {
  console.log(`[relay] REP ARENA relay listening on ws://localhost:${PORT}`);
});