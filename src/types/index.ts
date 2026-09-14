// Shared domain types for the entire platform.
// The CV engine, game engine, progression and UI all speak these types.

// ────────────────────────────────────────────
// Identity
// ────────────────────────────────────────────

export type PlayerId = string; // permanent public ID, e.g. REP-00018427
export type Uuid = string; // internal id

export interface AuthenticationRecord {
  id: Uuid;
  email: string;
  passwordHash: string;
  salt: string;
  playerId: PlayerId;
  createdAt: number;
  provider?: "password" | "google";
  googleId?: string;
}

export interface SessionRecord {
  token: string;
  playerId: PlayerId;
  createdAt: number;
  expiresAt: number;
}

export interface OtpRecord {
  email: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
}

// ────────────────────────────────────────────
// Player
// ────────────────────────────────────────────

export interface AvatarSpec {
  icon: string; // emoji glyph rendered behind a frame
  frame: string; // frame token id
  background: string; // gradient token id
  accent: string;
}

export interface Player {
  id: Uuid;
  playerId: PlayerId;
  username: string;
  email?: string;
  avatar: AvatarSpec;
  createdAt: number;
  title?: string;
  featuredTrophyIds: string[];
  privacy: PlayerPrivacy;
}

export type ProfileVisibility = "PUBLIC" | "FRIENDS" | "PRIVATE";
export type ActivityVisibility = "ON" | "FRIENDS" | "OFF";

export interface PlayerPrivacy {
  profile: ProfileVisibility;
  allowFriendRequests: boolean;
  allowChallenges: boolean;
  showBattleHistory: boolean;
  showAchievements: boolean;
  showTrophies: boolean;
  showLeaderboardPosition: boolean;
  showRegionalRanking: boolean;
  showOnlineStatus: boolean;
  showCurrentActivity: boolean;
  shareAchievementsInFeed: ActivityVisibility;
  allowGhostChallenges: boolean;
  ghostAccess: "ALL" | "FRIENDS" | "NOBODY";
}

// ────────────────────────────────────────────
// Progression
// ────────────────────────────────────────────

export type XPEventType =
  | "WORKOUT_COMPLETED"
  | "VALID_REP"
  | "FORM_MILESTONE"
  | "PERSONAL_RECORD"
  | "BATTLE_WIN"
  | "BATTLE_DRAW"
  | "BATTLE_PARTICIPATION"
  | "QUEST_COMPLETED"
  | "ACHIEVEMENT_UNLOCKED"
  | "STREAK_MILESTONE"
  | "SEASON_MILESTONE"
  | "FIRST_WORKOUT"
  | "FIRST_BATTLE"
  | "DAILY_GOAL"
  | "WEEKLY_GOAL"
  | "FIRST_FRIEND"
  | "FIRST_FRIEND_BATTLE"
  | "LEVEL_UP_BONUS";

export interface XPTransaction {
  id: Uuid;
  playerId: PlayerId;
  eventType: XPEventType;
  sourceId?: string;
  amount: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface LevelProgress {
  currentLevel: number;
  currentXP: number;
  totalXP: number;
  xpIntoLevel: number;
  xpRequiredForNextLevel: number;
  progressPercent: number;
}

// ────────────────────────────────────────────
// Ranks / divisions
// ────────────────────────────────────────────

export type RankName =
  | "ROOKIE"
  | "BRONZE"
  | "SILVER"
  | "GOLD"
  | "PLATINUM"
  | "DIAMOND"
  | "MASTER"
  | "GRANDMASTER"
  | "CHAMPION"
  | "LEGEND";

export interface RankDefinition {
  rank: RankName;
  minRating: number;
  colorToken: string;
  icon: string;
}

export interface CompetitiveRating {
  playerId: PlayerId;
  rating: number;
  rank: RankName;
  division: number; // 1..3 (I is highest)
  wins: number;
  losses: number;
  draws: number;
  matchesPlayed: number;
  placementMatches: number;
  placementDone: boolean;
  bestRating: number;
}

export interface RankHistoryEntry {
  playerId: PlayerId;
  prevRating: number;
  newRating: number;
  prevRank: RankName;
  newRank?: RankName;
  prevDivision: number;
  newDivision?: number;
  kind: "PROMOTION" | "DEMOTION" | "CHANGE" | "PLACEMENT";
  matchId?: string;
  createdAt: number;
}

// ────────────────────────────────────────────
// Leaderboards
// ────────────────────────────────────────────

export type LeaderboardPeriod = "DAILY" | "WEEKLY" | "MONTHLY" | "ALL_TIME";
export type LeaderboardScope = "GLOBAL" | "FRIENDS" | "REGIONAL";

export interface LeaderboardEntry {
  playerId: PlayerId;
  username: string;
  avatar: AvatarSpec;
  level: number;
  competitiveRank: RankName;
  division: number;
  score: number;
  reps: number;
  formAccuracy: number;
}

export interface LeaderboardRow extends LeaderboardEntry {
  rank: number;
  isYou: boolean;
}

export interface LeaderboardSnapshot {
  id: Uuid;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  periodStart: number;
  periodEnd: number;
  playerId: PlayerId;
  rank: number;
  score: number;
  createdAt: number;
}

// ────────────────────────────────────────────
// Workouts / reps / CV
// ────────────────────────────────────────────

export type WorkoutMode =
  | "FREE_TRAINING"
  | "TIME_TRIAL"
  | "REP_TARGET"
  | "FORM_TRAINING"
  | "ENDURANCE"
  | "SPEED_MODE"
  | "GHOST_MODE"
  | "PRACTICE";

export type RepValidity = "VALID" | "INVALID";

export type InvalidRepReason =
  | "INSUFFICIENT_DEPTH"
  | "INCOMPLETE_EXTENSION"
  | "HIP_SAG"
  | "HIP_PIKE"
  | "LOW_CONFIDENCE"
  | "LOST_TRACKING"
  | "INCOMPLETE_MOVEMENT"
  | "UNSTABLE_POSE"
  | "UNRECOGNIZED_MOVEMENT";

export interface RepEvent {
  type: "VALID_REP" | "INVALID_REP";
  timestamp: number;
  repNumber: number;
  formScore: number;
  confidence: number;
  duration?: number;
  depthScore?: number;
  alignmentScore?: number;
  extensionScore?: number;
  reason?: InvalidRepReason;
}

export interface RepTimelineEntry {
  repNumber: number;
  timestamp: number;
  duration: number;
  formScore: number;
  validity: RepValidity;
  reason?: InvalidRepReason;
  confidence: number;
}

export interface WorkoutResult {
  sessionId: Uuid;
  playerId: PlayerId;
  mode: WorkoutMode;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  validReps: number;
  invalidReps: number;
  formAccuracy: number;
  averageFormScore: number;
  bestFormScore: number;
  averageRepDuration: number;
  fastestRep: number;
  slowestRep: number;
  bestCombo: number;
  repTimeline: RepTimelineEntry[];
  invalidReasonCounts: Partial<Record<InvalidRepReason, number>>;
  confidenceSummary: number;
  xpEarned: number;
  isPersonalRecord: boolean;
  prevPersonalBest?: number;
}

// ────────────────────────────────────────────
// Multiplayer
// ────────────────────────────────────────────

export type RoomStatus = "WAITING" | "COUNTDOWN" | "LIVE" | "FINISHED" | "CANCELLED";
export type MatchStatus =
  | "CREATED"
  | "WAITING_FOR_PLAYERS"
  | "LOBBY"
  | "READY_CHECK"
  | "COUNTDOWN"
  | "LIVE"
  | "PAUSED"
  | "FINISHING"
  | "COMPLETED"
  | "CANCELLED"
  | "DISCONNECTED"
  | "EXPIRED";

export type RoomType = "PRIVATE" | "FRIENDS_ONLY" | "PUBLIC";
export type BattleMode = "REP_RACE" | "TIME_TRIAL" | "FIRST_TO" | "TEAM" | "FFA" | "FORM_WARS";
export type MatchKind = "CASUAL" | "RANKED";

export interface RoomSettings {
  battleMode: BattleMode;
  playerLimit: number;
  durationSec: number;
  repTarget: number;
  formStrictness: "RELAXED" | "NORMAL" | "STRICT";
  ranked: boolean;
  allowSpectators: boolean;
  allowLateJoin: boolean;
  teamMode: boolean;
  teams?: number;
  privacy: RoomType;
}

export interface RoomPlayer {
  playerId: PlayerId;
  username: string;
  avatar: AvatarSpec;
  level: number;
  rankDisplay: string;
  ready: boolean;
  host: boolean;
  joinedAt: number;
  connected: boolean;
}

export interface Room {
  id: Uuid;
  code: string;
  hostId: PlayerId;
  players: RoomPlayer[];
  settings: RoomSettings;
  status: RoomStatus;
  matchId?: Uuid;
  createdAt: number;
  expiresAt: number;
}

export interface MatchPlayerState {
  playerId: PlayerId;
  username: string;
  avatar: AvatarSpec;
  level: number;
  rankDisplay: string;
  reps: number;
  combo: number;
  formScore: number;
  connected: boolean;
  ready: boolean;
  lastRepAt: number;
  lastRepSeq: number;
}

export interface MatchState {
  id: Uuid;
  roomId?: Uuid;
  code?: string;
  status: MatchStatus;
  mode: BattleMode;
  kind: MatchKind;
  players: MatchPlayerState[];
  startAt: number;
  endAt: number;
  durationSec: number;
  repTarget?: number;
  winnerId?: PlayerId;
  finalScores?: Record<PlayerId, number>;
  createdAt: number;
  finishedAt?: number;
}

export interface RepSyncEvent {
  matchId: Uuid;
  playerId: PlayerId;
  sequenceNumber: number;
  timestamp: number;
  repNumber: number;
  confidence: number;
  formScore: number;
}

export interface MatchEventLogEntry {
  id: Uuid;
  matchId: Uuid;
  type:
    | "PLAYER_JOINED"
    | "PLAYER_READY"
    | "MATCH_STARTED"
    | "REP_ACCEPTED"
    | "REP_REJECTED"
    | "PLAYER_OVERTAKEN"
    | "PLAYER_DISCONNECTED"
    | "PLAYER_RECONNECTED"
    | "MATCH_FINISHED"
    | "ROOM_CREATED"
    | "ROOM_CLOSED"
    | "HOST_TRANSFERRED";
  playerId?: PlayerId;
  payload?: Record<string, unknown>;
  createdAt: number;
}

export interface MatchResult {
  matchId: Uuid;
  mode: BattleMode;
  kind: MatchKind;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  participants: Array<{
    playerId: PlayerId;
    username: string;
    reps: number;
    formScore: number;
    bestCombo: number;
    ratingChange: number;
  }>;
  winnerId?: PlayerId;
  draw: boolean;
  ratingChanges: Record<PlayerId, number>;
  xpRewards: Record<PlayerId, number>;
}

// ────────────────────────────────────────────
// Friend / social
// ────────────────────────────────────────────

export type FriendshipState = "NONE" | "OUTGOING_PENDING" | "INCOMING_PENDING" | "FRIENDS" | "BLOCKED";

export interface FriendRecord {
  id: Uuid;
  playerId: PlayerId; // primary
  friendId: PlayerId;
  createdAt: number;
}

export type FriendRequestStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "BLOCKED";

export interface FriendRequest {
  id: Uuid;
  senderId: PlayerId;
  recipientId: PlayerId;
  status: FriendRequestStatus;
  createdAt: number;
  respondedAt?: number;
}

export type ChallengeStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "COMPLETED";

export interface Challenge {
  id: Uuid;
  challengerId: PlayerId;
  opponentId: PlayerId;
  battleMode: BattleMode;
  ranked: boolean;
  repTarget?: number;
  durationSec?: number;
  status: ChallengeStatus;
  createdAt: number;
  expiresAt: number;
  matchId?: Uuid;
}

/** Minimal public identity used for reverse lookups (player-id ⇄ username). */
export interface PublicPlayerLookup {
  playerId: PlayerId;
  username: string;
}

/** A player surfaced by social search, enriched for the UI. */
export interface PlayerSearchHit {
  playerId: PlayerId;
  username: string;
  level: number;
  rankDisplay: string;
  avatar: AvatarSpec;
}

export interface BlockRecord {
  id: Uuid;
  blockerId: PlayerId;
  blockedId: PlayerId;
  createdAt: number;
}

export type PresenceState = "ONLINE" | "IDLE" | "IN_LOBBY" | "IN_MATCH" | "OFFLINE";

export interface PresenceRecord {
  playerId: PlayerId;
  state: PresenceState;
  activity?: string;
  updatedAt: number;
}

// ────────────────────────────────────────────
// Notifications
// ────────────────────────────────────────────

export type NotificationType =
  | "FRIEND_REQUEST"
  | "FRIEND_ACCEPTED"
  | "CHALLENGE"
  | "CHALLENGE_ACCEPTED"
  | "BATTLE_RESULT"
  | "ACHIEVEMENT"
  | "TROPHY"
  | "RANK_CHANGE"
  | "LEVEL_UP"
  | "LEADERBOARD"
  | "SEASON"
  | "QUEST_COMPLETE"
  | "PERSONAL_RECORD"
  | "ROOM_INVITE"
  | "SYSTEM";

export interface AppNotification {
  id: Uuid;
  playerId: PlayerId;
  type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  readAt?: number;
  createdAt: number;
}

// ────────────────────────────────────────────
// Achievements / trophies / quests
// ────────────────────────────────────────────

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: "BEGINNER" | "TRAINING" | "COMPETITION" | "FORM" | "CONSISTENCY" | "SOCIAL" | "LEADERBOARD" | "SEASON" | "EXPLORATION" | "MASTERY";
  requirement: Requirement;
  rewardXP: number;
  secret?: boolean;
  icon: string;
}

export type Requirement =
  | { type: "TOTAL_REPS"; value: number }
  | { type: "WORKOUTS"; value: number }
  | { type: "BATTLE_WINS"; value: number }
  | { type: "BATTLES"; value: number }
  | { type: "STREAK"; value: number }
  | { type: "FORM_AVG"; value: number }
  | { type: "PRS"; value: number }
  | { type: "FRIENDS"; value: number }
  | { type: "LEVEL"; value: number }
  | { type: "RATING"; value: number }
  | { type: "TROPHIES"; value: number }
  | { type: "PERFECT_FORM_SESSION"; value: number };

export interface UserAchievement {
  achievementId: string;
  unlockedAt: number;
  sourceId?: string;
}

export interface TrophyDefinition {
  id: string;
  name: string;
  description: string;
  rarity: "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
  icon: string;
  requirement?: Requirement;
}

export interface UserTrophy {
  trophyId: string;
  earnedAt: number;
  sourceId?: string;
}

export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  category: "DAILY" | "WEEKLY" | "SEASON";
  requirement: Requirement;
  rewardXP: number;
}

export interface QuestAssignment {
  id: string;
  title: string;
  questId: string;
  playerId: PlayerId;
  category: QuestDefinition["category"];
  progress: number;
  target: number;
  completed: boolean;
  completedAt?: number;
  periodStart: number;
  periodEnd: number;
}

// ────────────────────────────────────────────
// Streaks / PRs
// ────────────────────────────────────────────

export interface StreakRecord {
  playerId: PlayerId;
  current: number;
  best: number;
  lastActiveDay: string | null; // YYYY-MM-DD (UTC), null when never active
  activeDaysThisWeek: number;
  updatedAt: number;
}

export type PersonalRecordMetric =
  | "MAX_REPS_SESSION"
  | "MAX_REPS_MINUTE"
  | "BEST_FORM"
  | "FASTEST_SET"
  | "LONGEST_COMBO"
  | "BATTLE_WINS"
  | "BEST_RATING"
  | "BEST_LEADERBOARD";

export interface PersonalRecord {
  id: Uuid;
  playerId: PlayerId;
  metric: PersonalRecordMetric;
  value: number;
  previousValue?: number;
  achievedAt: number;
  sourceId?: string;
}

// ────────────────────────────────────────────
// Seasons / leagues
// ────────────────────────────────────────────

export type SeasonStatus = "UPCOMING" | "ACTIVE" | "ENDING" | "COMPLETED";

export interface Season {
  id: string;
  name: string;
  startAt: number;
  endAt: number;
  status: SeasonStatus;
  theme: string;
  rewards: string[];
}

export interface SeasonProgress {
  seasonId: string;
  playerId: PlayerId;
  seasonXP: number;
  seasonScore: number;
  rank: number;
  createdAt: number;
  updatedAt: number;
}

// ────────────────────────────────────────────
// Settings / global state
// ────────────────────────────────────────────

export interface UserSettings {
  theme: "DARK" | "LIGHT";
  reducedMotion: boolean;
  soundEnabled: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  showLandmarks: boolean;
  mirrorPreview: boolean;
  cameraId?: string;
  feedbackIntensity: "LOW" | "MEDIUM" | "HIGH";
  debugMode: boolean;
  showOnlineStatus: boolean;
  showCurrentActivity: boolean;
  notificationPrefs: Record<string, boolean>;
  coachPersonality: CoachPersonalityId;
  coachApiEndpoint?: string;
  coachApiKey?: string;
}

export type CoachPersonalityId = "SUPPORTIVE" | "DRILL_SERGEANT" | "SCIENTIST";

export interface AICoachMessage {
  id: Uuid;
  role: "user" | "assistant";
  content: string;
  personality?: CoachPersonalityId;
  createdAt: number;
  meta?: Record<string, unknown>;
}

// ────────────────────────────────────────────
// Social activity / feed
// ────────────────────────────────────────────

export type SocialActivityType =
  | "LEVEL_UP"
  | "ACHIEVEMENT_UNLOCKED"
  | "TROPHY_EARNED"
  | "PERSONAL_RECORD"
  | "RANK_PROMOTION"
  | "SEASON_RESULT"
  | "LEADERBOARD_RESULT"
  | "BATTLE_WIN";

export interface SocialActivity {
  id: Uuid;
  playerId: PlayerId;
  type: SocialActivityType;
  title: string;
  body: string;
  createdAt: number;
  reactions: Record<string, string[]>;
  muted: boolean;
}

export interface ProgressionEvent {
  id: Uuid;
  playerId: PlayerId;
  type:
    | "LEVEL_UP"
    | "RANK_PROMOTION"
    | "RANK_DEMOTION"
    | "ACHIEVEMENT"
    | "TROPHY"
    | "QUEST"
    | "PERSONAL_RECORD"
    | "LEADERBOARD_MOVEMENT"
    | "STREAK"
    | "SEASON"
    | "WORKOUT_COMPLETED";
  title: string;
  body: string;
  createdAt: number;
  amount?: number;
  metadata?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}