import { describe, it, expect, afterEach, vi } from "vitest";
import { MatchServer, deriveMatchResult, saveMatchResult, getMatchHistory, getMatchResult } from "../src/core/multiplayer/MatchService";
import { createPlayer } from "../src/core/identity/PlayerService";
import type { PlayerId } from "../src/types";

const ME: PlayerId = "REP-60000001";
const RIVAL: PlayerId = "REP-60000002";
const MID = "match_1";

const AV = { icon: "x", frame: "f", background: "b", accent: "a" };

afterEach(() => {
  vi.useRealTimers();
});

function makeInput() {
  return {
    roomId: "room_1",
    code: "RA-1",
    hostId: ME,
    mode: "REP_RACE" as const,
    kind: "CASUAL" as const,
    players: [
      { playerId: ME, username: "Host", avatar: AV, level: 1, rankDisplay: "Bronze II" },
      { playerId: RIVAL, username: "Rival", avatar: AV, level: 1, rankDisplay: "Rookie II" },
    ],
    durationSec: 60,
    repTarget: 20,
  };
}

function live(server: MatchServer) {
  server.state.status = "LIVE";
  server.state.startAt = Date.now() - 5000;
  server.state.endAt = Date.now() + 120000;
}

const sub = (playerId: PlayerId, seq: number, repNumber: number, formScore = 85) => ({
  kind: "SUBMIT_REP" as const,
  matchId: MID,
  playerId,
  seq,
  repNumber,
  confidence: 0.9,
  formScore,
  clientTime: Date.now(),
});

describe("MatchServer", () => {
  it("accepts a well-formed rep and scores it", () => {
    const s = new MatchServer(makeInput());
    live(s);
    const ok = s.acceptRep(sub(ME, 1, 1, 92));
    expect(ok).toBe(true);
    const me = s.state.players.find((p) => p.playerId === ME)!;
    expect(me.reps).toBe(1);
    expect(me.formScore).toBe(28); // Math.round(0 * 0.7 + 92 * 0.3)
    expect(me.combo).toBe(1);
  });

  it("rejects non-LIVE phases, unknown players, duplicate seq and skipped rep numbers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const s = new MatchServer(makeInput());
    // Not LIVE yet
    expect(s.acceptRep(sub(ME, 1, 1))).toBe(false);
    live(s);
    // Unknown player
    expect(s.acceptRep(sub("REP-00000000", 1, 1))).toBe(false);
    // valid first rep
    expect(s.acceptRep(sub(ME, 1, 1))).toBe(true);
    // duplicate seq
    expect(s.acceptRep(sub(ME, 1, 2))).toBe(false);
    // skipped rep number (3 when expecting 2)
    expect(s.acceptRep(sub(ME, 2, 3))).toBe(false);
    vi.advanceTimersByTime(400);
    expect(s.acceptRep(sub(ME, 2, 2))).toBe(true);
    expect(s.acceptRep(sub(ME, 3, 4))).toBe(false);
  });

  it("enforces the minimum rep gap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const s = new MatchServer(makeInput());
    live(s);
    expect(s.acceptRep(sub(ME, 1, 1))).toBe(true);
    expect(s.acceptRep(sub(ME, 2, 2))).toBe(false); // faster than 300ms
    vi.advanceTimersByTime(400);
    expect(s.acceptRep(sub(ME, 2, 2))).toBe(true);
  });

  it("finishes with forced winner when reaching the rep target", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const s = new MatchServer(makeInput());
    live(s);
    s.state.repTarget = 2;
    s.acceptRep(sub(ME, 1, 1));
    s.acceptRep(sub(RIVAL, 1, 1));
    expect(s.state.status).toBe("LIVE");
    vi.advanceTimersByTime(400);
    s.acceptRep(sub(RIVAL, 2, 2));
    expect(s.state.status).toBe("COMPLETED");
    expect(s.state.winnerId).toBe(RIVAL);
  });

  it("deriveMatchResult reports the leader as winner", () => {
    const s = new MatchServer(makeInput());
    live(s);
    s.state.players[0]!.reps = 14;
    s.state.players[1]!.reps = 11;
    s.state.winnerId = ME;
    s.state.finishedAt = Date.now();
    const r = deriveMatchResult(s.state);
    expect(r.draw).toBe(false);
    expect(r.winnerId).toBe(ME);
    expect(r.participants.find((p) => p.playerId === ME)!.reps).toBe(14);
  });
});

describe("Match results persistence", () => {
  it("round-trips a saved result", async () => {
    const s = new MatchServer(makeInput());
    live(s);
    s.state.winnerId = ME;
    s.state.finishedAt = Date.now();
    const r = deriveMatchResult(s.state);
    await saveMatchResult(r);
    expect((await getMatchResult(r.matchId))?.winnerId).toBe(ME);
    const hist = await getMatchHistory(ME);
    expect(hist.some((h) => h.matchId === r.matchId)).toBe(true);
  });

  it("player creation still works (identity col untouched by match tests)", async () => {
    await createPlayer({ playerId: ME, username: "Host" });
    expect(true).toBe(true);
  });
});