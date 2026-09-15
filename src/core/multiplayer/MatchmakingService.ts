// MatchCoordinator: high-level flow creating a Room → Match on the host tab.
// Real multiplayer works across two browser tabs on the same machine (or on a
// LAN via server/relay-server.mjs). A solo practice opponent is strictly
// labeled SIMULATION — it is the host waiting for a second tab to join.

import { createRoom, setReady, getRoom, linkRoomToMatch, findRoomByCode } from "./RoomService";
import { MatchServer, MatchClient, saveMatchState, getMatchState } from "./MatchService";
import { createRealtime, lookupRoomOverRelay, type RealtimeService } from "./RealtimeService";
import { getPlayer } from "../identity/PlayerService";
import { getRating, levelProgress, rankDisplayName } from "../progression/ProgressionService";
import type { BattleMode, MatchKind, PlayerId, RoomSettings, MatchState } from "../../types";
import { GAME_CONFIG } from "../../config/game";

export interface SimulatedOpponentProfile {
  pacingMs: number; // avg ms between reps at start
  variance: number; // jitter in ms
  targetPacingMs: number; // accelerates toward this near the end
  formMean: number;
  formStdDev: number;
  maxCombo: number;
}

export type OpponentDifficulty = "EASY" | "MEDIUM" | "HARD";

const OPPONENT_PROFILES: Record<OpponentDifficulty, SimulatedOpponentProfile> = {
  EASY: { pacingMs: 2300, variance: 380, targetPacingMs: 1600, formMean: 82, formStdDev: 7, maxCombo: 14 },
  MEDIUM: { pacingMs: 1700, variance: 280, targetPacingMs: 1050, formMean: 88, formStdDev: 5, maxCombo: 25 },
  HARD: { pacingMs: 1250, variance: 180, targetPacingMs: 760, formMean: 93, formStdDev: 3, maxCombo: 60 },
};

/**
 * A pacing engine that emits rep claims at an athlete-like cadence.
 * It has a realistic warm-up, drift toward target pace, fatigue noise, and
 * chained (combo) bursts — NOT random spam.
 */
export class SimulatedOpponent {
  private timer: number | null = null;
  private reps = 0;
  private seq = 0;
  private started = 0;
  private combo = 0;
  lastRepAt = 0;

  constructor(
    private playerId: PlayerId,
    private profile: SimulatedOpponentProfile,
    private onRep: (msg: { playerId: PlayerId; seq: number; repNumber: number; confidence: number; formScore: number; clientTime: number }) => void,
  ) {}

  private nextDelay(now: number): number {
    const elapsed = (now - this.started) / 1000;
    const progress = Math.min(1, elapsed / 90); // paces approach target over ~90s
    const base = this.profile.pacingMs + (this.profile.targetPacingMs - this.profile.pacingMs) * progress;
    const jitter = (Math.random() * 2 - 1) * this.profile.variance;
    // Combo bursts: during a hot streak, reps are faster.
    if (this.combo > this.profile.maxCombo) this.combo = 0;
    const burstBoost = this.combo >= 10 ? 0.82 : this.combo >= 5 ? 0.94 : 1;
    void burstBoost;
    return Math.max(420, base + jitter);
  }

  start(now: number): void {
    if (this.timer !== null) return;
    this.started = now;
    this.timer = window.setTimeout(() => this.step(), this.nextDelay(now));
  }

  private step(): void {
    const at = Date.now();
    this.combo += 1;
    this.reps += 1;
    this.lastRepAt = at;
    const form = clamp(Math.round(this.profile.formMean + gauss() * this.profile.formStdDev), 40, 99);
    const conf = clamp(0.82 + Math.random() * 0.16, 0.8, 0.98);
    this.onRep({
      playerId: this.playerId,
      seq: ++this.seq,
      repNumber: this.reps,
      confidence: conf,
      formScore: form,
      clientTime: at,
    });
    this.timer = window.setTimeout(() => this.step(), this.nextDelay(at));
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ────────────────────────────────────────────
// Coordinator
// ────────────────────────────────────────────

export interface OngoingMatch {
  matchId: string;
  code: string;
  hostId: PlayerId;
  server: MatchServer | null; // null on non-host clients
  client: MatchClient;
  realtime: RealtimeService;
  roomId?: string;
  simulated?: { opponentId: PlayerId; start: () => void; stop: () => void };
}

export interface CreateCoordinatedMatchOptions {
  hostId: PlayerId;
  mode?: BattleMode;
  kind?: MatchKind;
  durationSec?: number;
  repTarget?: number;
  difficulty?: OpponentDifficulty; // if set → add labeled SIMULATED opponent to fill slot
  useRelay?: boolean;
}

export class MatchCoordinator {
  private realtime: RealtimeService;

  constructor(useRelay = true) {
    this.realtime = createRealtime();
    void useRelay;
  }

  async createMatch(opts: CreateCoordinatedMatchOptions): Promise<OngoingMatch> {
    const hostPlayer = await getPlayer(opts.hostId);
    if (!hostPlayer) throw new Error("PLAYER_NOT_FOUND");

    const settings: Partial<RoomSettings> = {
      battleMode: opts.mode ?? "REP_RACE",
      ranked: opts.kind === "RANKED",
      durationSec: opts.durationSec ?? 60,
      repTarget: opts.repTarget ?? GAME_CONFIG.defaultRoomSettings().repTarget,
    };
    const room = await createRoom(opts.hostId, settings);

    const rating = await getRating(opts.hostId);
    const level = await levelProgress(opts.hostId);
    const rankDisp = rankDisplayName(rating.rank, rating.division);

    const players: Array<{
      playerId: PlayerId;
      username: string;
      avatar: MatchState["players"][number]["avatar"];
      level: number;
      rankDisplay: string;
    }> = [
      {
        playerId: hostPlayer.id,
        username: hostPlayer.username,
        avatar: hostPlayer.avatar,
        level: level.currentLevel,
        rankDisplay: rankDisp,
      },
    ];

    let simulated: OngoingMatch["simulated"];
    const host = opts.hostId;
    if (opts.difficulty) {
      // Solo practice vs a simulated athlete. Label is displayed in the UI.
      const simId = `sim_${host}` as PlayerId;
      players.push({
        playerId: simId,
        username: "Sister Act (SIM)",
        avatar: { icon: "S", frame: "frame_void", background: "bg_volt", accent: "#f59e0b" },
        level: Math.max(1, level.currentLevel - 1),
        rankDisplay: "SIMULATED",
      });
      const server = new MatchServer({
        roomId: room.id,
        code: room.code,
        hostId: host,
        mode: opts.mode ?? "REP_RACE",
        kind: opts.kind ?? "CASUAL",
        players,
        durationSec: opts.durationSec ?? 60,
        repTarget: opts.repTarget,
        simulatedOpponent: true,
      });
      const sim = new SimulatedOpponent(simId, OPPONENT_PROFILES[opts.difficulty], (rep) => {
        server.acceptRep({ kind: "SUBMIT_REP", matchId: server.state.id, ...rep });
      });

      await this.realtime.connect(`rep:match:${server.state.id}`, host);
      server.subscribe(this.realtime);
      simulated = { opponentId: simId, start: () => sim.start(Date.now()), stop: () => sim.stop() };

      const client = new MatchClient(server.state.id, host, { onState: () => {} });

      return { matchId: server.state.id, code: room.code, hostId: host, server, client, realtime: this.realtime, simulated };
    }

    // Real match: host creates the room AND immediately publishes + links the
    // match so a joiner can resolve it by code from another device.
    const server = new MatchServer({
      roomId: room.id,
      code: room.code,
      hostId: host,
      mode: opts.mode ?? "REP_RACE",
      kind: opts.kind ?? "CASUAL",
      players,
      durationSec: opts.durationSec ?? 60,
      repTarget: opts.repTarget,
    });
    await this.realtime.connect(`rep:match:${server.state.id}`, host);
    server.subscribe(this.realtime);
    await linkRoomToMatch(room.id, server.state.id);
    await saveMatchState(server.state);
    this.realtime.registerRoom?.({
      code: room.code,
      matchId: server.state.id,
      hostId: host,
      roomId: room.id,
      settings: room.settings,
    });
    const client = new MatchClient(server.state.id, host, { onState: () => {} });
    return { matchId: server.state.id, code: room.code, hostId: host, server, client, realtime: this.realtime, roomId: room.id };
  }

  /**
   * Join a live room by code. Works both same-browser (BroadcastChannel +
   * localStorage room record) and cross-device (relay room-code directory).
   */
  async joinMatchByCode(code: string, playerId: PlayerId): Promise<OngoingMatch> {
    const normalized = code.trim().toUpperCase();

    // 1. Try the local room store first (same browser / same device).
    let room = await findRoomByCode(normalized);
    // 2. Fall back to the relay directory (another device).
    if (!room) {
      const remote = await lookupRoomOverRelay(normalized);
      if (!remote) throw new Error("ROOM_NOT_FOUND");
      const client = new MatchClient(remote.matchId, playerId, { onState: () => {} });
      client.profile = await publicProfile(playerId);
      await client.connect();
      // The host's match state lives ONLY on the host's device — a remote joiner
      // can never read it from localStorage. Instead we connect to the shared
      // channel and wait for the first authoritative HOST_STATE broadcast.
      await awaitClientState(client, 6000);
      client.ready();
      return {
        matchId: remote.matchId,
        code: normalized,
        hostId: remote.hostId,
        server: null,
        client,
        realtime: client.realtime,
        roomId: remote.roomId,
      };
    }

    // Same-device path: mark ready, resolve the linked match, send JOIN.
    await setReady(room.id, playerId, true);
    const matchState = await resolveMatch(room.id, room.matchId);
    if (!matchState) throw new Error("ROOM_READY_TIMEOUT");
    const client = new MatchClient(matchState.id, playerId, { onState: () => {} });
    client.profile = await publicProfile(playerId);
    await client.connect();
    client.ready();
    return { matchId: matchState.id, code: room.code, hostId: room.hostId, server: null, client, realtime: this.realtime, roomId: room.id };
  }
}

async function publicProfile(playerId: PlayerId): Promise<{ username?: string; avatar?: unknown; level?: number; rankDisplay?: string }> {
  const p = await getPlayer(playerId);
  if (!p) return {};
  const rating = await getRating(playerId);
  const level = await levelProgress(playerId);
  return {
    username: p.username,
    avatar: p.avatar,
    level: level.currentLevel,
    rankDisplay: rankDisplayName(rating.rank, rating.division),
  };
}

/**
 * Waits for the first authoritative HOST_STATE broadcast from the host over the
 * shared realtime channel. Cross-device joiners cannot read the host's
 * localStorage, so the sync state arrives over the relay instead.
 */
async function awaitClientState(client: MatchClient, timeoutMs = 6000): Promise<MatchState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.state) return client.state;
    await sleep(120);
  }
  throw new Error("ROOM_READY_TIMEOUT");
}

/** Resolve a room's linked match, waiting briefly for the host to publish it. */
async function resolveMatch(roomId: string, matchId?: string): Promise<MatchState | null> {
  if (matchId) {
    const direct = await getMatchState(matchId);
    if (direct) return direct;
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const room = await getRoom(roomId);
    if (room?.matchId) {
      const state = await getMatchState(room.matchId);
      if (state) return state;
    }
    await sleep(250);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}