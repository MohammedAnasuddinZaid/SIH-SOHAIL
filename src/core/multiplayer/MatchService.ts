// MatchService: the authoritative match engine + client facade.
// The room HOST runs the authoritative MatchServer; everyone else mirrors the
// broadcast HOST_STATE. Rep events are validated (membership, LIVE status,
// sequence monotonicity, plausible timing) before scores update.

import { store, createId } from "../storage/StorageService";
import { createRealtime, type RealtimeMessage, type RealtimeService } from "./RealtimeService";
import type {
  MatchState,
  BattleMode,
  MatchKind,
  PlayerId,
  MatchPlayerState,
  MatchEventLogEntry,
  MatchResult,
} from "../../types";
import { GAME_CONFIG } from "../../config/game";

const matchCol = store<MatchState[]>("rep:matches");
const eventLogCol = store<MatchEventLogEntry[]>("rep:match-events");
const resultCol = store<MatchResult[]>("rep:match-results");

export interface CreateMatchInput {
  roomId: string;
  code: string;
  hostId: PlayerId;
  mode: BattleMode;
  kind: MatchKind;
  players: Array<{ playerId: PlayerId; username: string; avatar: MatchPlayerState["avatar"]; level: number; rankDisplay: string }>;
  durationSec: number;
  repTarget?: number;
  simulatedOpponent?: boolean;
}

const MIN_REP_GAP = 300; // ms; reject absurdly fast rep claims

export class MatchServer {
  state: MatchState;
  private tickTimer: number | null = null;
  private broadcastTimer: number | null = null;
  private rt: RealtimeService | null = null;
  private lastEventId = 0;

  constructor(input: CreateMatchInput) {
    this.state = {
      id: createId("match"),
      roomId: input.roomId,
      code: input.code,
      status: "LOBBY",
      mode: input.mode,
      kind: input.kind,
      players: input.players.map((p) => ({
        playerId: p.playerId,
        username: p.username,
        avatar: p.avatar,
        level: p.level,
        rankDisplay: p.rankDisplay,
        reps: 0,
        combo: 0,
        formScore: 0,
        connected: true,
        ready: false,
        lastRepAt: 0,
        lastRepSeq: 0,
      })),
      startAt: 0,
      endAt: 0,
      durationSec: input.durationSec,
      repTarget: input.repTarget,
      createdAt: Date.now(),
    };
    void input.simulatedOpponent;
    this.log("MATCH_STARTED");
  }

  subscribe(rt: RealtimeService): void {
    this.rt = rt;
    rt.setHandler({
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => {
        for (const p of this.state.players) p.connected = false;
      },
    });
    // Broadcast authoritative state at ~2Hz while active so peers stay in sync.
    this.broadcastTimer = window.setInterval(() => {
      if (this.state.status !== "COMPLETED" && this.state.status !== "CANCELLED" && this.state.status !== "FINISHING") {
        this.broadcastState();
      }
    }, 500);
  }

  private broadcastState(): void {
    this.rt?.send({ kind: "HOST_STATE", matchId: this.state.id, state: this.snapshot(), at: Date.now() });
  }

  private onMessage(msg: RealtimeMessage): void {
    switch (msg.kind) {
      case "JOIN":
        this.playerJoined(msg.playerId);
        break;
      case "READY":
        this.playerReady(msg.playerId);
        break;
      case "LEAVE": {
        const p = this.player(msg.playerId);
        if (p) p.connected = false;
        this.log("PLAYER_DISCONNECTED", msg.playerId);
        break;
      }
      case "SUBMIT_REP":
        this.acceptRep(msg);
        break;
      case "SYNC_REQUEST":
        this.broadcastState();
        break;
      default:
        break;
    }
  }

  private player(id: PlayerId): MatchPlayerState | undefined {
    return this.state.players.find((p) => p.playerId === id);
  }

  private playerJoined(id: PlayerId): void {
    const p = this.player(id);
    if (p) p.connected = true;
  }

  playerReady(id: PlayerId): void {
    const p = this.player(id);
    if (p) p.ready = true;
  }

  /** Server-side validation of a rep claim. */
  acceptRep(msg: Extract<RealtimeMessage, { kind: "SUBMIT_REP" }>): boolean {
    const p = this.player(msg.playerId);
    if (!p) return false;
    if (this.state.status !== "LIVE") return false;
    if (msg.seq <= p.lastRepSeq) return false; // duplicate / out-of-order
    if (msg.repNumber !== p.reps + 1) return false; // sequence mismatch
    const now = Date.now();
    if (now < this.state.startAt - 2000 || now > this.state.endAt + 2000) return false;
    if (p.lastRepAt > 0 && now - p.lastRepAt < MIN_REP_GAP) return false; // implausible rate
    p.lastRepSeq = msg.seq;
    p.lastRepAt = now;
    p.reps += 1;
    p.formScore = Math.round(p.formScore * 0.7 + (msg.formScore || 80) * 0.3);
    if (msg.formScore >= 95) p.combo += 1;
    else if (msg.formScore < 60) p.combo = 0;
    else p.combo += 1;
    p.combo = p.combo > 0 ? p.combo : 1;
    this.log("REP_ACCEPTED", msg.playerId, { repNumber: msg.repNumber, seq: msg.seq });
    this.checkEndConditions();
    return true;
  }

  private checkEndConditions(): void {
    if (this.state.status !== "LIVE") return;
    if (this.state.repTarget) {
      const leader = [...this.state.players].sort((a, b) => a.reps - b.reps)[this.state.players.length - 1];
      if (leader && leader.reps >= this.state.repTarget) {
        this.finish(leader.playerId);
      }
    }
  }

  /** Host calls this to launch the LIVE phase with a synchronized start. */
  launch(now = Date.now()): void {
    if (this.state.status === "LOBBY") {
      this.state.status = "COUNTDOWN";
      this.state.startAt = now + GAME_CONFIG.countdownMs;
      this.state.endAt = this.state.startAt + this.state.durationSec * 1000;
      this.log("MATCH_STARTED", undefined, { startAt: this.state.startAt });
    }
    this.startTick();
  }

  /** Host timer: flips COUNTDOWN→LIVE and LIVE→COMPLETED. */
  private startTick(): void {
    if (this.tickTimer) return;
    this.tickTimer = window.setInterval(() => {
      const now = Date.now();
      if (this.state.status === "COUNTDOWN" && now >= this.state.startAt) {
        this.state.status = "LIVE";
        this.log("MATCH_STARTED");
      }
      if (this.state.status === "LIVE" && now >= this.state.endAt) {
        this.finish();
      }
    }, 250);
  }

  finish(forcedWinnerId?: PlayerId): void {
    if (this.state.status === "COMPLETED" || this.state.status === "CANCELLED") return;
    this.state.status = "FINISHING";
    const sorted = [...this.state.players].sort((a, b) => b.reps - a.reps);
    const best = sorted[0]?.reps ?? 0;
    const winners = sorted.filter((p) => p.reps === best && best > 0);
    const winnerId =
      forcedWinnerId ??
      (winners.length === 1 && best > 0 ? winners[0].playerId : undefined);
    this.state.status = "COMPLETED";
    this.state.finishedAt = Date.now();
    this.state.winnerId = winnerId;
    this.state.finalScores = Object.fromEntries(this.state.players.map((p) => [p.playerId, p.reps]));
    this.log("MATCH_FINISHED", undefined, { winnerId });
    if (this.tickTimer) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.broadcastTimer) {
      window.clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.broadcastState();
  }

  snapshot(): MatchState {
    return this.state;
  }

  private log(type: MatchEventLogEntry["type"], playerId?: PlayerId, payload?: Record<string, unknown>): void {
    const entry: MatchEventLogEntry = {
      id: `ev_${this.lastEventId++}_${createId("m")}`,
      matchId: this.state.id,
      type,
      playerId,
      payload,
      createdAt: Date.now(),
    };
    void eventLogCol.get(`all:${this.state.id}`).then((all) => {
      const next = [...(all ?? [])].filter((e) => e.createdAt > Date.now() - 60_000).concat(entry);
      return eventLogCol.put(`all:${this.state.id}`, next.slice(-300));
    });
  }
}

// ────────────────────────────────────────────
// Client facade (non-authoritative side)
// ────────────────────────────────────────────

export interface MatchClientListeners {
  onState(state: MatchState): void;
  onRepRejected?(info: { reason: string }): void;
  onMessage?(msg: RealtimeMessage): void;
}

export class MatchClient {
  private rt: RealtimeService;
  private matchId: string;
  private playerId: PlayerId;
  private listeners: MatchClientListeners;
  private seq = 0;
  state: MatchState | null = null;

  constructor(matchId: string, playerId: PlayerId, listeners: MatchClientListeners) {
    this.matchId = matchId;
    this.playerId = playerId;
    this.listeners = listeners;
    this.rt = createRealtime();
    this.rt.setHandler({
      onMessage: (msg) => this.onMessage(msg),
    });
  }

  async connect(): Promise<void> {
    await this.rt.connect(`rep:match:${this.matchId}`, this.playerId);
    this.send({ kind: "JOIN", matchId: this.matchId, playerId: this.playerId });
  }

  private onMessage(msg: RealtimeMessage): void {
    this.listeners.onMessage?.(msg);
    if (msg.kind === "HOST_STATE" && msg.matchId === this.matchId) {
      this.state = msg.state as MatchState;
      this.listeners.onState(this.state);
    }
  }

  ready(): void {
    this.send({ kind: "READY", matchId: this.matchId, playerId: this.playerId });
  }

  /** Submit one validated local rep. Returns the next sequence number. */
  submitRep(rep: { repNumber: number; confidence: number; formScore: number; clientTime: number }): number {
    const seq = ++this.seq;
    this.send({
      kind: "SUBMIT_REP",
      matchId: this.matchId,
      playerId: this.playerId,
      seq,
      repNumber: rep.repNumber,
      confidence: rep.confidence,
      formScore: rep.formScore,
      clientTime: rep.clientTime,
    });
    return seq;
  }

  disconnect(): void {
    this.send({ kind: "LEAVE", matchId: this.matchId, playerId: this.playerId });
    this.rt.disconnect();
  }

  private send(msg: RealtimeMessage): void {
    this.rt.send(msg);
  }

  isHost(hostId: PlayerId): boolean {
    return hostId === this.playerId;
  }
}

// ────────────────────────────────────────────
// Persistence & results
// ────────────────────────────────────────────

export async function saveMatchState(match: MatchState): Promise<void> {
  const all = (await matchCol.get("all")) ?? [];
  const idx = all.findIndex((m) => m.id === match.id);
  if (idx >= 0) all[idx] = match;
  else all.unshift(match);
  await matchCol.put("all", all.slice(0, 100));
}

export async function getMatchState(matchId: string): Promise<MatchState | null> {
  const all = (await matchCol.get("all")) ?? [];
  return all.find((m) => m.id === matchId) ?? null;
}

export async function saveMatchResult(result: MatchResult): Promise<void> {
  const all = (await resultCol.get("all")) ?? [];
  const idx = all.findIndex((r) => r.matchId === result.matchId);
  if (idx >= 0) all[idx] = result;
  else all.unshift(result);
  await resultCol.put("all", all.slice(0, 100));
}

export async function getMatchResult(matchId: string): Promise<MatchResult | null> {
  const all = (await resultCol.get("all")) ?? [];
  return all.find((r) => r.matchId === matchId) ?? null;
}

export async function getMatchHistory(playerId: PlayerId): Promise<MatchResult[]> {
  const all = (await resultCol.get("all")) ?? [];
  return all
    .filter((r) => r.participants.some((p) => p.playerId === playerId))
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 50);
}

export async function matchesForPlayer(playerId: PlayerId): Promise<MatchState[]> {
  const all = (await matchCol.get("all")) ?? [];
  return all.filter((m) => m.players.some((p) => p.playerId === playerId));
}

/** Build a MatchResult from a completed MatchState (host side). */
export function deriveMatchResult(match: MatchState): MatchResult {
  const draw = match.winnerId === undefined;
  return {
    matchId: match.id,
    mode: match.mode,
    kind: match.kind,
    startedAt: match.startAt,
    endedAt: match.finishedAt ?? Date.now(),
    durationSec: match.durationSec,
    participants: match.players.map((p) => ({
      playerId: p.playerId,
      username: p.username,
      reps: p.reps,
      formScore: p.formScore,
      bestCombo: p.combo,
      ratingChange: 0,
    })),
    winnerId: match.winnerId,
    draw,
    ratingChanges: {},
    xpRewards: {},
  };
}

export { GAME_CONFIG };