// RealtimeService: pluggable transport for real-time state sync.
// Default: BroadcastChannel + localStorage (two browser tabs can already play
// against each other on the same machine). An optional WebSocket relay server
// (server/relay-server.mjs) enables cross-device play on a LAN/internet.
//
// HybridRealtime uses BOTH at once: same-browser tabs sync instantly over
// BroadcastChannel, while phones/other devices reach each other through the
// relay. Duplicate messages are harmless (state is idempotent, rep seq numbers
// reject replays), so sending on both is safe and gives the best of both worlds.

export interface RoomRegistration {
  code: string;
  matchId: string;
  hostId: string;
  roomId: string;
  settings: unknown;
}

export type RealtimeMessage =
  | { kind: "JOIN"; matchId: string; playerId: string; username?: string; avatar?: unknown; level?: number; rankDisplay?: string }
  | { kind: "LEAVE"; matchId: string; playerId: string }
  | { kind: "READY"; matchId: string; playerId: string }
  | { kind: "SUBMIT_REP"; matchId: string; playerId: string; seq: number; repNumber: number; confidence: number; formScore: number; clientTime: number }
  | { kind: "HOST_STATE"; matchId: string; state: unknown; at: number }
  | { kind: "SYNC_REQUEST"; matchId: string; playerId: string }
  | { kind: "PRESENCE"; playerId: string; state: string }
  | { kind: "ROOM_REGISTER"; code: string; matchId: string; hostId: string; roomId: string; settings: unknown; at: number }
  | { kind: "ROOM_LOOKUP"; code: string; from: string }
  | { kind: "ROOM_FOUND"; code: string; matchId: string; hostId: string; roomId: string; settings: unknown }
  | { kind: "ROOM_NOT_FOUND"; code: string };

export interface RealtimeHandler {
  onMessage(msg: RealtimeMessage): void;
  onOpen?(): void;
  onClose?(): void;
}

export interface RealtimeService {
  connect(channel: string, playerId: string): Promise<void>;
  send(msg: RealtimeMessage): void;
  disconnect(): void;
  isConnected(): boolean;
  setHandler(h: RealtimeHandler): void;
  /** Only implemented by socket transports. */
  registerRoom?(room: RoomRegistration): void;
}

// ────────────────────────────────────────────
// BroadcastChannel (same-browser cross-tab)
// ────────────────────────────────────────────

export class BroadcastRealtime implements RealtimeService {
  private bc: BroadcastChannel | null = null;
  private connected = false;
  private handler: RealtimeHandler | null = null;

  async connect(channel: string, _playerId: string): Promise<void> {
    try {
      this.bc = new BroadcastChannel(channel);
    } catch {
      throw new Error("BROADCAST_UNSUPPORTED");
    }
    this.bc.onmessage = (ev: MessageEvent<RealtimeMessage>) => {
      this.handler?.onMessage(ev.data);
    };
    this.connected = true;
  }

  send(msg: RealtimeMessage): void {
    this.bc?.postMessage(msg);
  }

  disconnect(): void {
    this.bc?.close();
    this.bc = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setHandler(h: RealtimeHandler): void {
    this.handler = h;
  }
}

// ────────────────────────────────────────────
// WebSocket relay (cross-device)
// ────────────────────────────────────────────

export class SocketRealtime implements RealtimeService {
  private ws: WebSocket | null = null;
  private channel = "";
  private playerId = "";
  private connected = false;
  private handler: RealtimeHandler | null = null;
  private url: string;
  private reconnectTimer: number | null = null;
  private opening: Promise<void> | null = null;
  private lastRoom: RoomRegistration | null = null;

  constructor(url: string) {
    this.url = url;
  }

  async connect(channel: string, playerId: string): Promise<void> {
    this.channel = channel;
    this.playerId = playerId;
    await this.openOnce();
  }

  private openOnce(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.connected) return Promise.resolve();
    if (this.opening) return this.opening;
    const attempt = new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        const timer = window.setTimeout(() => reject(new Error("WS_TIMEOUT")), 4000);
        ws.onopen = () => {
          window.clearTimeout(timer);
          this.connected = true;
          this.announce();
          resolve();
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as RealtimeMessage;
            this.handler?.onMessage(msg);
          } catch {
            /* ignore malformed */
          }
        };
        ws.onclose = () => {
          window.clearTimeout(timer);
          this.connected = false;
          this.handler?.onClose?.();
          this.scheduleReconnect();
        };
        ws.onerror = () => {
          window.clearTimeout(timer);
          this.connected = false;
          reject(new Error("WS_ERROR"));
        };
      } catch {
        reject(new Error("WS_INIT_ERROR"));
      }
    }).finally(() => {
      this.opening = null;
    });
    this.opening = attempt;
    return attempt;
  }

  /** Re-send channel membership + room registration after an (re)connect. */
  private announce(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.send({ kind: "JOIN", matchId: this.channel, playerId: this.playerId });
    if (this.lastRoom) this.registerRoom(this.lastRoom);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || !this.url) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openOnce().catch(() => this.scheduleReconnect());
    }, 2000);
  }

  send(msg: RealtimeMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  registerRoom(room: RoomRegistration): void {
    this.lastRoom = room;
    this.send({ kind: "ROOM_REGISTER", ...room, at: Date.now() });
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setHandler(h: RealtimeHandler): void {
    this.handler = h;
  }
}

// ────────────────────────────────────────────
// Hybrid: BroadcastChannel + relay simultaneously
// ────────────────────────────────────────────

export class HybridRealtime implements RealtimeService {
  private broadcast = new BroadcastRealtime();
  private socket: SocketRealtime | null = null;

  constructor(useSocket = true) {
    if (useSocket) this.socket = connectRelay();
  }

  async connect(channel: string, playerId: string): Promise<void> {
    try {
      await this.broadcast.connect(channel, playerId);
    } catch {
      /* broadcast unsupported */
    }
    if (this.socket) {
      try {
        await this.socket.connect(channel, playerId);
      } catch {
        // relay unreachable → degrade to same-browser only
        this.socket.disconnect();
        this.socket = null;
      }
    }
  }

  send(msg: RealtimeMessage): void {
    this.broadcast.send(msg);
    this.socket?.send(msg);
  }

  disconnect(): void {
    this.broadcast.disconnect();
    this.socket?.disconnect();
  }

  isConnected(): boolean {
    return this.broadcast.isConnected() || Boolean(this.socket?.isConnected());
  }

  setHandler(h: RealtimeHandler): void {
    this.broadcast.setHandler(h);
    this.socket?.setHandler(h);
  }

  registerRoom(room: RoomRegistration): void {
    this.socket?.registerRoom(room);
  }
}

// ────────────────────────────────────────────
// Factory + remote room-code lookup
// ────────────────────────────────────────────

export function relayUrl(): string {
  const explicit = (import.meta.env.VITE_REALTIME_RELAY_URL as string | undefined)?.trim();
  if (explicit) return explicit;
  try {
    // Auto-discover: if the app is served from https://host, the relay is probed
    // at wss://host:8787 — zero config for phone/desktop cross-device battles.
    const h = window.location.hostname;
    if (h && h !== "localhost" && h !== "127.0.0.1") {
      const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
      return `${wsProto}://${h}:8787`;
    }
  } catch {
    /* ignore */
  }
  return "ws://localhost:8787";
}

export function createRealtime(): RealtimeService {
  return new HybridRealtime(true);
}

export function connectRelay(): SocketRealtime | null {
  const url = relayUrl();
  if (!url || typeof WebSocket === "undefined") return null;
  return new SocketRealtime(url);
}

export interface RemoteRoom {
  matchId: string;
  hostId: string;
  roomId: string;
  settings: unknown;
}

/**
 * Ask the relay for a room registered under a code (cross-device join).
 * Resolves null when the relay is unreachable or the code is unknown/expired.
 */
export function lookupRoomOverRelay(code: string, timeoutMs = 2500): Promise<RemoteRoom | null> {
  return new Promise((resolve) => {
    const socket = connectRelay();
    if (!socket) {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (value: RemoteRoom | null) => {
      if (done) return;
      done = true;
      socket.disconnect();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    socket.setHandler({
      onMessage: (msg) => {
        if (msg.kind === "ROOM_FOUND" && msg.code === code) {
          window.clearTimeout(timer);
          finish({ matchId: msg.matchId, hostId: msg.hostId, roomId: msg.roomId, settings: msg.settings });
        } else if (msg.kind === "ROOM_NOT_FOUND" && msg.code === code) {
          window.clearTimeout(timer);
          finish(null);
        }
      },
      onClose: () => finish(null),
    });
    socket
      .connect("rep:lobby", "lookup")
      .then(() => socket.send({ kind: "ROOM_LOOKUP", code, from: "lookup" }))
      .catch(() => finish(null));
  });
}