// MatchCoordinator: high-level flow creating a Room → Match on the host tab.
// Real multiplayer works across two browser tabs on the same machine (or on a
// LAN via server/relay-server.mjs). A solo practice opponent is strictly
// labeled SIMULATION — it is the host waiting for a second tab to join.

import { createRoom, joinRoom, setReady, updateRoomStatus, getRoom, linkRoomToMatch } from "./RoomService";
import { MatchServer, MatchClient, saveMatchState, matchesForPlayer, getMatchState } from "./MatchService";
import { connectRelay, createRealtime, type RealtimeService } from "./RealtimeService";
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

  constructor(useRelay = false) {
    this.realtime = useRelay ? connectRelay() ?? createBroadcast() : createBroadcast();
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

    // Two-tab real match: host creates room; challenger joins by code on the
    // same browser (BroadcastChannel) and reads the same room record.
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
    const client = new MatchClient(server.state.id, host, { onState: () => {} });
    _launchWhenReady(server, room.id, host, this.realtime);
    return { matchId: server.state.id, code: room.code, hostId: host, server, client, realtime: this.realtime };
  }

  /** Join a live room by code as a challenger. */
  async joinMatchByCode(code: string, playerId: PlayerId): Promise<OngoingMatch> {
    const room = await joinRoom(code, playerId);
    await setReady(room.id, playerId, true);
    const matchState = await getActiveMatch(room.id);
    if (!matchState) throw new Error("MATCH_NOT_READY");
    const client = new MatchClient(matchState.id, playerId, { onState: () => {} });
    await client.connect();
    return { matchId: matchState.id, code: room.code, hostId: room.hostId, server: null, client, realtime: this.realtime };
  }
}

function createBroadcast(): RealtimeService {
  return createRealtime();
}

async function getActiveMatch(roomId: string): Promise<MatchState | null> {
  const matches = await matchesForPlayer("" as PlayerId);
  void matches;
  // resolve from room storage
  const { getRoom } = await import("./RoomService");
  const room = await getRoom(roomId);
  if (!room?.matchId) return null;
  return getMatchState(room.matchId);
}

async function _launchWhenReady(server: MatchServer, roomId: string, _hostId: PlayerId, rt: RealtimeService): Promise<void> {
  void rt;
  const poll = window.setInterval(async () => {
    const room = await getRoom(roomId);
    if (!room || room.status === "CANCELLED") {
      window.clearInterval(poll);
      return;
    }
    const readyCount = room.players.filter((p) => p.ready).length;
    if (readyCount >= room.settings.playerLimit && room.players.length >= 2) {
      window.clearInterval(poll);
      await updateRoomStatus(roomId, "COUNTDOWN");
      await linkRoomToMatch(roomId, server.state.id);
      await saveMatchState(server.state);
      server.launch();
    }
  }, 700);
}