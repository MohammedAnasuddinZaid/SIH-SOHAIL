// RealtimeService: pluggable transport for real-time state sync.
// Default: BroadcastChannel + localStorage (two browser tabs can already play
// against each other on the same machine). An optional WebSocket relay server
// (server/relay-server.mjs) enables cross-device play on a LAN/internet.

export type RealtimeMessage =
  | { kind: "JOIN"; matchId: string; playerId: string }
  | { kind: "LEAVE"; matchId: string; playerId: string }
  | { kind: "READY"; matchId: string; playerId: string }
  | { kind: "SUBMIT_REP"; matchId: string; playerId: string; seq: number; repNumber: number; confidence: number; formScore: number; clientTime: number }
  | { kind: "HOST_STATE"; matchId: string; state: unknown; at: number }
  | { kind: "SYNC_REQUEST"; matchId: string; playerId: string }
  | { kind: "PRESENCE"; playerId: string; state: string };

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

  constructor(url: string) {
    this.url = url;
  }

  async connect(channel: string, playerId: string): Promise<void> {
    this.channel = channel;
    this.playerId = playerId;
    await this.openOnce();
  }

  private openOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.onopen = () => {
          this.connected = true;
          ws.send(JSON.stringify({ kind: "JOIN", matchId: this.channel, playerId: this.playerId }));
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
          this.connected = false;
          this.handler?.onClose?.();
          this.scheduleReconnect();
        };
        ws.onerror = () => {
          this.connected = false;
          reject(new Error("WS_ERROR"));
        };
      } catch {
        reject(new Error("WS_INIT_ERROR"));
      }
    });
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

export function createRealtime(): RealtimeService {
  const relayUrl = (import.meta.env.VITE_REALTIME_RELAY_URL as string | undefined) ?? "ws://localhost:8787";
  if (relayUrl && typeof WebSocket !== "undefined") {
    try {
      // We attempt BroadcastChannel first (works offline), WS is used when
      // explicit wiring opts into it via connectRelay.
      void relayUrl;
    } catch {
      /* noop */
    }
  }
  return new BroadcastRealtime();
}

export function connectRelay(): SocketRealtime | null {
  const relayUrl = (import.meta.env.VITE_REALTIME_RELAY_URL as string | undefined) ?? "ws://localhost:8787";
  if (!relayUrl) return null;
  return new SocketRealtime(relayUrl);
}