import type { BattleMode, MatchKind, RoomType, RoomSettings } from "../types";

export const GAME_CONFIG = {
  defaultRoomSettings: (): RoomSettings => ({
    battleMode: "REP_RACE",
    playerLimit: 2,
    durationSec: 60,
    repTarget: 30,
    formStrictness: "NORMAL",
    ranked: false,
    allowSpectators: false,
    allowLateJoin: true,
    teamMode: false,
    privacy: "PRIVATE",
  }),
  roomCodeChars: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  roomCodeLength: 5,
  roomTtlMs: 1000 * 60 * 60 * 4, // 4h
  countdownMs: 5000,
  reconnectGraceMs: 15000,
  maxPlayers: 8,
  minPlayers: 2,
};

export const BATTLE_MODES: Array<{ id: BattleMode; label: string; description: string; available: boolean }> = [
  { id: "REP_RACE", label: "Push-Up Race", description: "Most validated reps in 60 seconds wins.", available: true },
  { id: "TIME_TRIAL", label: "Time Trial", description: "Fastest to the rep target wins.", available: true },
  { id: "FIRST_TO", label: "First to X", description: "First player to hit the rep target wins.", available: true },
  { id: "FFA", label: "Free For All", description: "Up to 8 players, all against all.", available: true },
  { id: "TEAM", label: "Team Battle", description: "Teams combine validated reps.", available: false },
  { id: "FORM_WARS", label: "Form Wars", description: "Score = reps × form quality.", available: false },
];

export const ROOM_TYPES: Array<{ id: RoomType; label: string; description: string }> = [
  { id: "PRIVATE", label: "Private", description: "Only players with the room code can join." },
  { id: "FRIENDS_ONLY", label: "Friends only", description: "Friends can join or invite." },
  { id: "PUBLIC", label: "Public", description: "Anyone can join or matchmake in." },
];

export const MATCH_KINDS: Array<{ id: MatchKind; label: string; description: string }> = [
  { id: "CASUAL", label: "Casual", description: "No rating impact. Experiment freely." },
  { id: "RANKED", label: "Ranked", description: "Affects your competitive rating." },
];

// Per-strictness thresholds applied by the rep validator (offsets in degrees of
// allowed deviation from the strictest target, plus alignment/confidence deltas).
export const FORM_STRICTNESS = {
  RELAXED: { depthOffsetDeg: 14, alignOffset: 0.1, confidenceOffset: 0.1 },
  NORMAL: { depthOffsetDeg: 8, alignOffset: 0.05, confidenceOffset: 0.05 },
  STRICT: { depthOffsetDeg: 4, alignOffset: 0.02, confidenceOffset: 0.02 },
} as const;