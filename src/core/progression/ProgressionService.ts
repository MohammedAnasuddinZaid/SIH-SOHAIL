// Progression engine. All XP, levels, ranks, streaks, personal records,
// achievements, quests and leaderboard aggregation live here - built with
// server-style semantics (idempotency keys, source validation) so a real
// backend can adopt the same rules later.

import { store, createId } from "../storage/StorageService";
import type {
  XPTransaction,
  XPEventType,
  PlayerId,
  WorkoutResult,
  PersonalRecord,
  PersonalRecordMetric,
  StreakRecord,
  UserAchievement,
  UserTrophy,
  QuestAssignment,
  LeaderboardEntry,
  LeaderboardPeriod,
  LevelProgress,
  CompetitiveRating,
  ProgressionEvent,
  MatchResult,
  RankName,
  LeaderboardScope,
  LeaderboardRow,
  Player,
} from "../../types";
import {
  XPConfig,
  getLevelFromXP,
  getProgress,
  getRankFromRating,
  rankDisplayName,
  RATING_CONFIG,
  RANKS,
  STREAK_MILESTONES,
  LEADERBOARD_CONFIG,
  ACHIEVEMENTS,
  TROPHIES,
  QUEST_TEMPLATES,
} from "../../config/progression";

export { rankDisplayName } from "../../config/progression";

// ────────────────────────────────────────────
// Collections
// ────────────────────────────────────────────

const statsCol = store<Record<string, number>>("rep:stats");
const xpCol = store<XPTransaction[]>("rep:xptx");
const streakCol = store<StreakRecord>("rep:streak");
const prCol = store<PersonalRecord[]>("rep:prs");
const achCol = store<UserAchievement[]>("rep:achievements");
const trophyCol = store<UserTrophy[]>("rep:trophies");
const questCol = store<QuestAssignment[]>("rep:quests");
const ratingCol = store<CompetitiveRating>("rep:rating");
const eventCol = store<ProgressionEvent[]>("rep:prog-events");
const rankHistCol = store<Array<Record<string, unknown>>>("rep:rank-hist");

interface LeaderboardSnapshot {
  playerId: PlayerId;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  rank: number;
  score: number;
  at: number;
}

const snapCol = store<LeaderboardSnapshot[]>("rep:snapshots");

const now = () => Date.now();
function playerKey(playerId: PlayerId, sub: string): string {
  return `${playerId}:${sub}`;
}

// ────────────────────────────────────────────
// Daily stats
// ────────────────────────────────────────────

export function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function weekStartUTC(ts = Date.now()): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - diff);
  return d.getTime();
}

export function monthStartUTC(ts = Date.now()): number {
  const d = new Date(ts);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

async function readStats(playerId: PlayerId): Promise<Record<string, number>> {
  return (await statsCol.get(playerKey(playerId, "stats"))) ?? {};
}

async function writeStats(playerId: PlayerId, s: Record<string, number>): Promise<void> {
  await statsCol.put(playerKey(playerId, "stats"), s);
}

// Convenience stat helpers (period-scoped)
async function bumpStat(playerId: PlayerId, key: string, by = 1): Promise<number> {
  const s = await readStats(playerId);
  const cur = s[key] ?? 0;
  s[key] = cur + by;
  // prune very old daily keys
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 45;
  const cutoffKey = new Date(cutoff).toISOString().slice(0, 10);
  for (const k of Object.keys(s)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k < cutoffKey) delete s[k];
  }
  await writeStats(playerId, s);
  return cur + by;
}

function readStat(stats: Record<string, number>, key: string): number {
  return stats[key] ?? 0;
}

// ────────────────────────────────────────────
// XP economy
// ────────────────────────────────────────────

export async function xpTransactions(playerId: PlayerId): Promise<XPTransaction[]> {
  return (await xpCol.get(playerKey(playerId, "all"))) ?? [];
}

export async function totalLifetimeXP(playerId: PlayerId): Promise<number> {
  const tx = await xpTransactions(playerId);
  return tx.reduce((a, t) => a + t.amount, 0);
}

export async function hasProcessedSource(playerId: PlayerId, eventType: XPEventType, sourceId: string): Promise<boolean> {
  const tx = await xpTransactions(playerId);
  return tx.some((t) => t.eventType === eventType && t.sourceId === sourceId);
}

async function awardXP(
  playerId: PlayerId,
  eventType: XPEventType,
  amount: number,
  sourceId?: string,
  metadata: Record<string, unknown> = {}
): Promise<XPTransaction | null> {
  if (amount <= 0) return null;
  if (sourceId && (await hasProcessedSource(playerId, eventType, sourceId))) return null;
  const tx: XPTransaction = {
    id: createId("xp"),
    playerId,
    eventType,
    sourceId,
    amount,
    metadata,
    createdAt: now(),
  };
  const all = await xpTransactions(playerId);
  all.push(tx);
  await xpCol.put(playerKey(playerId, "all"), all);
  await bumpStat(playerId, "lifetimeXP", amount);
  return tx;
}

export async function levelProgress(playerId: PlayerId): Promise<LevelProgress> {
  const totalXP = await totalLifetimeXP(playerId);
  const level = getLevelFromXP(totalXP);
  const { xpIntoLevel, xpRequiredForNextLevel, progressPercent } = getProgress(level, totalXP);
  return {
    currentLevel: level,
    currentXP: totalXP,
    totalXP,
    xpIntoLevel,
    xpRequiredForNextLevel,
    progressPercent,
  };
}

export async function grantXP(playerId: PlayerId, eventType: XPEventType, amount: number, sourceId?: string, metadata: Record<string, unknown> = {}): Promise<XPTransaction | null> {
  return awardXP(playerId, eventType, amount, sourceId, metadata);
}

// ────────────────────────────────────────────
// Level-up detection
// ────────────────────────────────────────────

export interface LevelUpInfo {
  prevLevel: number;
  newLevel: number;
  tx: XPTransaction;
}

export async function detectLevelUps(playerId: PlayerId, beforeXP: number): Promise<LevelUpInfo[]> {
  const tx = await xpTransactions(playerId);
  const totalXP = tx.reduce((a, t) => a + t.amount, 0);
  const before = getLevelFromXP(beforeXP);
  const after = getLevelFromXP(totalXP);
  if (after <= before) return [];
  const out: LevelUpInfo[] = [];
  for (let l = before + 1; l <= after; l++) {
    out.push({
      prevLevel: l - 1,
      newLevel: l,
      tx: tx[tx.length - 1],
    });
  }
  if (after > before) {
    // level-up bonus
    await awardXP(playerId, "LEVEL_UP_BONUS", XPConfig.levelUpBonusXP * (after - before), `levelup_${before}_${after}`);
    for (let l = before + 1; l <= after; l++) {
      await pushEvent(playerId, {
        type: "LEVEL_UP",
        title: "LEVEL UP!",
        body: `You reached Level ${l}.`,
        payload: { level: l },
      });
    }
  }
  return out;
}

// ────────────────────────────────────────────
// Rank / rating
// ────────────────────────────────────────────

export async function getRating(playerId: PlayerId): Promise<CompetitiveRating> {
  const existing = await ratingCol.get(playerKey(playerId, "rating"));
  if (existing) return existing;
  const fresh: CompetitiveRating = {
    playerId,
    rating: RATING_CONFIG.initialRating,
    rank: "ROOKIE",
    division: 3,
    wins: 0,
    losses: 0,
    draws: 0,
    matchesPlayed: 0,
    placementMatches: 0,
    placementDone: false,
    bestRating: RATING_CONFIG.initialRating,
  };
  await ratingCol.put(playerKey(playerId, "rating"), fresh);
  return fresh;
}

export interface RatingChangeResult {
  rating: CompetitiveRating;
  change: number;
  promotion?: { rank: RankName; division: number; label: string };
  demotion?: { rank: RankName; division: number; label: string };
}

export async function applyMatchResultToRating(playerId: PlayerId, result: "WIN" | "LOSS" | "DRAW", matchId: string): Promise<RatingChangeResult> {
  const prev = await getRating(playerId);
  const antes = { ...prev };
  const k = RATING_CONFIG.kFactor;
  const expected = RATING_CONFIG.initialRating;
  let change = 0;
  if (result === "WIN") {
    change = Math.round(k * 0.6 + Math.max(0, 10 - prev.rating / 200));
    prev.wins += 1;
  } else if (result === "LOSS") {
    change = -Math.round(k * 0.45 + Math.max(0, prev.rating / 250 - 3));
    prev.losses += 1;
  } else {
    prev.draws += 1;
  }
  // demotion protection
  const curDef = RANKS.findIndex((r) => r === prev.rank);
  if (curDef > 0 && prev.rating + change < RANK_RATING_FLOOR(prev.rank)) {
    const floor = RANK_RATING_FLOOR(prev.rank);
    change = Math.max(change, floor - prev.rating);
  }
  prev.matchesPlayed += 1;
  if (!prev.placementDone) {
    prev.placementMatches += 1;
    if (prev.placementMatches >= RATING_CONFIG.placementMatches) prev.placementDone = true;
  }
  const { rank, division } = getRankFromRating(prev.rating + change);
  const newRating = Math.max(0, prev.rating + change);
  prev.rating = newRating;
  prev.rank = rank;
  prev.division = division;
  prev.bestRating = Math.max(prev.bestRating, newRating);
  await ratingCol.put(playerKey(playerId, "rating"), prev);

  // history + events
  const promotion =
    prev.rank !== antes.rank || (prev.rank === antes.rank && prev.division < antes.division)
      ? { rank: prev.rank, division: prev.division, label: rankDisplayName(prev.rank, prev.division) }
      : undefined;
  const demotion =
    prev.rank !== antes.rank && prev.rank < antes.rank
      ? { rank: prev.rank, division: prev.division, label: rankDisplayName(prev.rank, prev.division) }
      : undefined;
  if (promotion) {
    await pushEvent(playerId, {
      type: prev.rank > antes.rank ? "RANK_PROMOTION" : "RANK_PROMOTION",
      title: prev.rank > antes.rank ? "RANK PROMOTION!" : "DIVISION UP!",
      body: `${antes.rank} → ${rankDisplayName(prev.rank, prev.division)}`,
      payload: { prev: antes.rank, next: prev.rank, division: prev.division },
    });
  } else if (demotion) {
    await pushEvent(playerId, {
      type: "RANK_DEMOTION",
      title: "RANK DEMOTED",
      body: `${antes.rank} → ${rankDisplayName(prev.rank, prev.division)}. Every legend has rough matches.`,
      payload: { prev: antes.rank, next: prev.rank },
    });
  }
  const hist = (await rankHistCol.get(playerKey(playerId, "history"))) ?? [];
  hist.push({ playerId, matchId, from: antes.rating, to: newRating, at: now() });
  await rankHistCol.put(playerKey(playerId, "history"), hist.slice(-200));

  void expected;
  return { rating: prev, change, promotion, demotion };
}

function RANK_RATING_FLOOR(rank: RankName): number {
  const idx = RANKS.findIndex((r) => r === rank);
  return idx > 0 ? (RANKS_TO_MIN as unknown as ArrayLike<number>)[idx] - RATING_CONFIG.demotionProtectionRating : 0;
}

const RANKS_TO_MIN: Record<RankName, number> = {
  ROOKIE: 0,
  BRONZE: 200,
  SILVER: 400,
  GOLD: 650,
  PLATINUM: 900,
  DIAMOND: 1150,
  MASTER: 1400,
  GRANDMASTER: 1700,
  CHAMPION: 2000,
  LEGEND: 2300,
};

// ────────────────────────────────────────────
// Streaks
// ────────────────────────────────────────────

export async function getStreak(playerId: PlayerId): Promise<StreakRecord> {
  const existing = await streakCol.get(playerKey(playerId, "current"));
  if (existing) return existing;
  const fresh: StreakRecord = {
    playerId,
    current: 0,
    best: 0,
    lastActiveDay: "",
    activeDaysThisWeek: 0,
    updatedAt: 0,
  };
  await streakCol.put(playerKey(playerId, "current"), fresh);
  return fresh;
}

export async function registerActivity(playerId: PlayerId, ts = Date.now()): Promise<StreakRecord> {
  const s = await getStreak(playerId);
  const today = utcDayKey(ts);
  const yesterday = utcDayKey(ts - 86400000);
  if (s.lastActiveDay === today) {
    s.activeDaysThisWeek = await countActiveDaysThisWeek(playerId, ts);
    s.updatedAt = ts;
    await streakCol.put(playerKey(playerId, "current"), s);
    return s;
  }
  if (s.lastActiveDay === yesterday) {
    s.current += 1;
  } else if (s.lastActiveDay && s.lastActiveDay !== yesterday) {
    s.current = 1; // streak broken by a gap
  } else {
    s.current = 1;
  }
  if (s.current > s.best) s.best = s.current;
  s.lastActiveDay = today;
  s.activeDaysThisWeek = await countActiveDaysThisWeek(playerId, ts);
  s.updatedAt = ts;
  await streakCol.put(playerKey(playerId, "current"), s);
  await bumpStat(playerId, "currentStreak", 0); // keep it present
  await bumpStat(playerId, "bestStreak", 0);
  // milestone XP
  if (STREAK_MILESTONES.includes(s.current)) {
    await awardXP(playerId, "STREAK_MILESTONE", 100 + s.current * 5, `streak_${s.current}`);
    await pushEvent(playerId, {
      type: "STREAK",
      title: `${s.current} DAY STREAK!`,
      body: `Consistency milestone reached. ${s.current} straight active days.`,
      payload: { streak: s.current },
    });
  }
  const base = await readStats(playerId);
  base["currentStreak"] = s.current;
  base["bestStreak"] = s.best;
  await writeStats(playerId, base);
  return s;
}

async function countActiveDaysThisWeek(playerId: PlayerId, ts: number): Promise<number> {
  const start = weekStartUTC(ts);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) days.push(utcDayKey(start + i * 86400000));
  const stats = await readStats(playerId);
  return days.filter((d) => (stats[`day_${d}`] ?? 0) > 0).length;
}

// ────────────────────────────────────────────
// Personal records
// ────────────────────────────────────────────

export async function getPRs(playerId: PlayerId): Promise<PersonalRecord[]> {
  return (await prCol.get(playerKey(playerId, "all"))) ?? [];
}

export async function setPR(
  playerId: PlayerId,
  metric: PersonalRecordMetric,
  value: number,
  sourceId?: string,
  extra: { prev?: number; metadata?: Record<string, unknown> } = {}
): Promise<PersonalRecord | null> {
  const all = await getPRs(playerId);
  const existing = all.find((p) => p.metric === metric);
  if (!existing || value > existing.value) {
    const pr: PersonalRecord = {
      id: createId("pr"),
      playerId,
      metric,
      value,
      previousValue: existing?.value ?? extra.prev,
      achievedAt: now(),
      sourceId,
    };
    if (existing) {
      const idx = all.findIndex((p) => p.metric === metric);
      all[idx] = pr;
    } else {
      all.push(pr);
    }
    await prCol.put(playerKey(playerId, "all"), all);
    await awardXP(playerId, "PERSONAL_RECORD", XPConfig.personalRecordXP, sourceId ? `pr_${sourceId}_${metric}` : undefined);
    await pushEvent(playerId, {
      type: "PERSONAL_RECORD",
      title: "NEW PERSONAL RECORD!",
      body: `${metricLabel(metric)}: ${value}${existing ? ` (previous ${existing.value})` : ""}`,
      payload: { metric, value, previous: existing?.value },
    });
    await bumpStat(playerId, "prs", 1);
    await socialActivity(playerId, "PERSONAL_RECORD", `Set a new personal record`, `${metricLabel(metric)}: ${value}`);
    return pr;
  }
  return null;
}

export function metricLabel(metric: PersonalRecordMetric): string {
  const labels: Record<PersonalRecordMetric, string> = {
    MAX_REPS_SESSION: "Most reps in a session",
    MAX_REPS_MINUTE: "Most reps in a minute",
    BEST_FORM: "Best form score",
    FASTEST_SET: "Fastest set",
    LONGEST_COMBO: "Longest combo",
    BATTLE_WINS: "Battle wins",
    BEST_RATING: "Highest rating",
    BEST_LEADERBOARD: "Best leaderboard position",
  };
  return labels[metric];
}

// ────────────────────────────────────────────
// Achievements
// ────────────────────────────────────────────

export async function getUserAchievements(playerId: PlayerId): Promise<UserAchievement[]> {
  return (await achCol.get(playerKey(playerId, "all"))) ?? [];
}

export async function getUserTrophies(playerId: PlayerId): Promise<UserTrophy[]> {
  return (await trophyCol.get(playerKey(playerId, "all"))) ?? [];
}

export interface UnlockResult {
  unlocked: UserAchievement[];
  trophies: UserTrophy[];
}

async function evaluateAchievements(playerId: PlayerId): Promise<UnlockResult> {
  const unlockedNow: UserAchievement[] = [];
  const trophiesNow: UserTrophy[] = [];
  const have = await getUserAchievements(playerId);
  const haveIds = new Set(have.map((a) => a.achievementId));
  const tHave = await getUserTrophies(playerId);
  const tHaveIds = new Set(tHave.map((t) => t.trophyId));

  for (const def of ACHIEVEMENTS as unknown as typeof ACHIEVEMENTS) {
    if (haveIds.has(def.id)) continue;
    const ok = await requirementMet(playerId, def.requirement as never);
    if (ok) {
      unlockedNow.push({ achievementId: def.id, unlockedAt: now() });
      await awardXP(playerId, "ACHIEVEMENT_UNLOCKED", def.rewardXP, `ach_${def.id}`);
      await pushEvent(playerId, {
        type: "ACHIEVEMENT",
        title: "ACHIEVEMENT UNLOCKED",
        body: `"${def.name}" - ${def.description}`,
        payload: { achievementId: def.id },
      });
      await socialActivity(playerId, "ACHIEVEMENT_UNLOCKED", "Unlocked an achievement", def.name);
    }
  }
  for (const def of TROPHIES as unknown as typeof TROPHIES) {
    if (tHaveIds.has(def.id)) continue;
    const ok = await requirementMet(playerId, def.requirement as never);
    if (ok) {
      trophiesNow.push({ trophyId: def.id, earnedAt: now() });
      await pushEvent(playerId, {
        type: "TROPHY",
        title: "NEW TROPHY",
        body: `${def.name} (${def.rarity})`,
        payload: { trophyId: def.id },
      });
      await socialActivity(playerId, "TROPHY_EARNED", "Earned a trophy", def.name);
    }
  }
  if (unlockedNow.length > 0) {
    await achCol.put(playerKey(playerId, "all"), [...have, ...unlockedNow]);
  }
  if (trophiesNow.length > 0) {
    await trophyCol.put(playerKey(playerId, "all"), [...tHave, ...trophiesNow]);
  }
  return { unlocked: unlockedNow, trophies: trophiesNow };
}

async function requirementMet(playerId: PlayerId, req: { type: string; value: number }): Promise<boolean> {
  const stats = await readStats(playerId);
  const rating = await getRating(playerId);
  switch (req.type) {
    case "TOTAL_REPS":
      return readStat(stats, "totalReps") >= req.value;
    case "WORKOUTS":
      return readStat(stats, "totalWorkouts") >= req.value;
    case "BATTLE_WINS":
      return rating.wins >= req.value;
    case "BATTLES":
      return readStat(stats, "totalBattles") >= req.value;
    case "STREAK":
      return (await getStreak(playerId)).best >= req.value;
    case "FORM_AVG": {
      const best = readStat(stats, "bestFormAvg");
      return best >= req.value;
    }
    case "PERFECT_FORM_SESSION":
      return readStat(stats, "perfectSessions") >= req.value;
    case "PRS":
      return readStat(stats, "prs") >= req.value;
    case "FRIENDS": {
      const { getFriendCount } = await import("../social/FriendService");
      return (await getFriendCount(playerId)) >= req.value;
    }
    case "LEVEL":
      return (await levelProgress(playerId)).currentLevel >= req.value;
    case "RATING":
      return rating.rating >= req.value;
    case "TROPHIES":
      return (await getUserTrophies(playerId)).length >= req.value;
    default:
      return false;
  }
}

// ────────────────────────────────────────────
// Quests
// ────────────────────────────────────────────

function questKey(playerId: PlayerId, category: "DAILY" | "WEEKLY"): string {
  return `${playerId}:${category}`;
}

export async function getQuests(playerId: PlayerId, category: "DAILY" | "WEEKLY"): Promise<QuestAssignment[]> {
  const existing = await questCol.get(questKey(playerId, category));
  if (existing && existing.length > 0 && existing[0].periodEnd > Date.now()) return existing;
  const periodStart = category === "DAILY" ? startOfUTCDay() : weekStartUTC();
  const periodEnd = category === "DAILY" ? startOfUTCDay() + 86400000 : weekStartUTC() + 7 * 86400000;
  const assignments: QuestAssignment[] = [];
  for (const tpl of QUEST_TEMPLATES[category]) {
    const target = tpl.requirement.value;
    assignments.push({
      id: `${playerId}_${tpl.id}`,
      title: tpl.title,
      questId: tpl.id,
      playerId,
      category,
      progress: 0,
      target,
      completed: false,
      periodStart,
      periodEnd,
    });
  }
  await questCol.put(questKey(playerId, category), assignments);
  return assignments;
}

function startOfUTCDay(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

async function saveQuest(assignments: QuestAssignment[], playerId: PlayerId, category: "DAILY" | "WEEKLY"): Promise<void> {
  await questCol.put(questKey(playerId, category), assignments);
}

export async function progressQuest(
  playerId: PlayerId,
  category: "DAILY" | "WEEKLY" | "SEASON",
  type: string,
  amount = 1
): Promise<QuestAssignment[]> {
  if (category === "SEASON") return [];
  let quests = await getQuests(playerId, category);
  const changed: QuestAssignment[] = [];
  for (const q of quests) {
    const tpl = QUEST_TEMPLATES[category].find((t) => t.id === q.questId);
    if (tpl && tpl.requirement.type === type && !q.completed) {
      q.progress = Math.min(q.target, q.progress + amount);
      if (q.progress >= q.target) {
        q.completed = true;
        q.completedAt = Date.now();
        changed.push(q);
        await awardXP(playerId, "QUEST_COMPLETED", tpl.rewardXP, `quest_${q.questId}_${q.periodStart}`);
        await pushEvent(playerId, {
          type: "QUEST",
          title: "QUEST COMPLETE",
          body: `"${tpl.title}" finished. +${tpl.rewardXP} XP.`,
          payload: { questId: q.questId },
        });
      }
    }
  }
  await saveQuest(quests, playerId, category);
  return changed;
}

// ────────────────────────────────────────────
// Leaderboard aggregation
// ────────────────────────────────────────────

export function periodRange(period: LeaderboardPeriod, ts = Date.now()): [number, number] {
  if (period === "DAILY") {
    const start = startOfUTCDay();
    return [start, start + 86400000];
  }
  if (period === "WEEKLY") {
    const start = weekStartUTC(ts);
    return [start, start + 7 * 86400000];
  }
  if (period === "MONTHLY") {
    const start = monthStartUTC(ts);
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return [start, d.getTime()];
  }
  return [0, Infinity];
}

export function periodKey(period: LeaderboardPeriod, ts = Date.now()): string {
  const [start] = periodRange(period, ts);
  if (period === "MONTHLY") {
    const d = new Date(start);
    return `M_${d.getUTCFullYear()}_${d.getUTCMonth() + 1}`;
  }
  if (period === "WEEKLY") {
    const d = new Date(start);
    return `W_${d.toISOString().slice(0, 10)}`;
  }
  return `${period}_${utcDayKey(start)}`;
}

interface LeaderboardScoreRow {
  playerId: PlayerId;
  score: number;
  reps: number;
  formAccuracy: number;
}

const lbCol = store<Record<string, LeaderboardScoreRow>>("rep:leaderboard");
const lbMetaCol = store<Record<string, unknown>>("rep:lb-meta");

export async function addLeaderboardScore(
  playerId: PlayerId,
  period: LeaderboardPeriod,
  score: number,
  meta: { reps: number; formAccuracy: number }
): Promise<void> {
  const od = new ScoreAccumulator(playerId, period);
  await od.add(score, meta);
}

class ScoreAccumulator {
  constructor(private playerId: PlayerId, private period: LeaderboardPeriod) {}
  async add(score: number, meta: { reps: number; formAccuracy: number }) {
    const key = periodKey(this.period);
    const map = (await lbCol.get(key)) ?? {};
    const prev = map[this.playerId];
    map[this.playerId] = {
      playerId: this.playerId,
      score: (prev?.score ?? 0) + score,
      reps: (prev?.reps ?? 0) + meta.reps,
      formAccuracy: prev?.formAccuracy ? (prev.formAccuracy + (meta.formAccuracy ?? 0)) / 2 : meta.formAccuracy ?? 0,
    };
    await lbCol.put(key, map);
    await lbMetaCol.put(key, { updatedAt: Date.now() });
  }
}

// Public leaderboard view (top + current user window)
export async function getLeaderboard(
  period: LeaderboardPeriod,
  _scope: LeaderboardScope,
  playerId: PlayerId,
  opts: { top?: number; margin?: number } = {}
): Promise<{ rows: LeaderboardRow[]; you: LeaderboardRow | null }> {
  const top = opts.top ?? LEADERBOARD_CONFIG.topN;
  const margin = opts.margin ?? LEADERBOARD_CONFIG.ownMargin;
  const key = periodKey(period);
  const map = (await lbCol.get(key)) ?? {};
  const playerCol = store<Player>("rep:player");
  const entries = Object.values(map).sort((a, b) => b.score - a.score);
  const enriched: LeaderboardEntry[] = [];
  for (const e of entries) {
    const p = await playerCol.get(e.playerId);
    const rating = await getRating(e.playerId);
    enriched.push({
      playerId: e.playerId,
      username: p?.username ?? e.playerId,
      avatar: p?.avatar ?? { icon: "R", frame: "frame_1", background: "bg_1", accent: "#ff7a1a" },
      level: (await levelProgress(e.playerId)).currentLevel,
      competitiveRank: rating.rank,
      division: rating.division,
      score: e.score,
      reps: e.reps,
      formAccuracy: e.formAccuracy,
    });
  }
  const youIndex = enriched.findIndex((e) => e.playerId === playerId);
  const rows: LeaderboardRow[] = [];
  if (youIndex > top) {
    const start = Math.max(0, youIndex - margin);
    const end = Math.min(enriched.length, youIndex + margin);
    for (let i = start; i < end; i++) {
      rows.push({ ...enriched[i], rank: i + 1, isYou: i === youIndex });
    }
  } else {
    const n = Math.min(enriched.length, top);
    for (let i = 0; i < n; i++) {
      rows.push({ ...enriched[i], rank: i + 1, isYou: i === youIndex });
    }
  }
  const youRow = youIndex >= 0 ? { ...enriched[youIndex], rank: youIndex + 1, isYou: true } : null;
  return { rows, you: youRow };
}

// ────────────────────────────────────────────
// Progression events + social activity
// ────────────────────────────────────────────

export async function pushEvent(playerId: PlayerId, ev: Omit<ProgressionEvent, "id" | "playerId" | "createdAt">): Promise<void> {
  const all = await eventCol.get(playerKey(playerId, "events"));
  const list = all ?? [];
  list.push({ id: createId("ev"), playerId, createdAt: now(), ...ev } as ProgressionEvent);
  await eventCol.put(playerKey(playerId, "events"), list.slice(-100));
}

export async function getEvents(playerId: PlayerId): Promise<ProgressionEvent[]> {
  return (await eventCol.get(playerKey(playerId, "events"))) ?? [];
}

async function socialActivity(playerId: PlayerId, type: "PERSONAL_RECORD" | "ACHIEVEMENT_UNLOCKED" | "TROPHY_EARNED" | "RANK_PROMOTION" | "BATTLE_WIN" | "SEASON_RESULT" | "LEVEL_UP" | "LEADERBOARD_RESULT", title: string, body: string): Promise<void> {
  const { publishActivity } = await import("../social/SocialService");
  await publishActivity(playerId, type, title, body);
}

// ────────────────────────────────────────────
// Workout processing (the big transactional path)
// ────────────────────────────────────────────

export interface WorkoutGrant {
  xpTransactions: XPTransaction[];
  levelUps: Array<{ prevLevel: number; newLevel: number }>;
  newAchievements: UserAchievement[];
  newTrophies: UserTrophy[];
  newPRs: PersonalRecord[];
  questsCompleted: QuestAssignment[];
  streak: StreakRecord;
}

export async function applyWorkoutResult(playerId: PlayerId, w: WorkoutResult): Promise<WorkoutGrant> {
  if (w.validReps <= 0) {
    // still counts as participation but no rep XP
  }
  const beforeXP = await totalLifetimeXP(playerId);
  const xpAdded: XPTransaction[] = [];

  const repXP = w.validReps * XPConfig.validRepXP;
  const completionXP = XPConfig.workoutCompletionXP;
  const isFirstWorkout = (await readStats(playerId))["totalWorkouts"] === undefined || (await readStats(playerId))["totalWorkouts"] === 0;

  const tx1 = await awardXP(playerId, "VALID_REP", repXP, `wr_${w.sessionId}_reps`);
  const tx2 = await awardXP(playerId, "WORKOUT_COMPLETED", completionXP, `wr_${w.sessionId}`);
  if (tx1) xpAdded.push(tx1);
  if (tx2) xpAdded.push(tx2);
  if (isFirstWorkout) {
    const t = await awardXP(playerId, "FIRST_WORKOUT", XPConfig.firstWorkoutXP, "first_workout");
    if (t) xpAdded.push(t);
  }
  if (w.formAccuracy >= 90) {
    const t = await awardXP(playerId, "FORM_MILESTONE", XPConfig.formMilestoneXP, `wr_${w.sessionId}_form`);
    if (t) xpAdded.push(t);
  }

  await bumpStat(playerId, "totalReps", w.validReps);
  await bumpStat(playerId, "totalWorkouts", 1);
  await bumpStat(playerId, "totalInvalidReps", w.invalidReps);
  await bumpStat(playerId, `day_${utcDayKey()}`, 1);
  await bumpStat(playerId, `reps_${utcDayKey()}`, w.validReps);
  await bumpStat(playerId, "dailyRepsTotal", 0);
  if (w.validReps > ((await readStats(playerId))["bestSessionReps"] ?? 0)) {
    await bumpStat(playerId, "bestSessionReps", w.validReps);
  }
  if (w.averageFormScore > ((await readStats(playerId))["bestFormAvg"] ?? 0)) {
    await bumpStat(playerId, "bestFormAvg", w.averageFormScore);
  }
  if (w.invalidReps === 0 && w.validReps >= 15) {
    await bumpStat(playerId, "perfectSessions", 1);
  }

  const streak = await registerActivity(playerId);

  // PRs
  const newPRs: PersonalRecord[] = [];
  const sessionPR = await setPR(playerId, "MAX_REPS_SESSION", w.validReps, w.sessionId);
  if (sessionPR) newPRs.push(sessionPR);
  const formPR = await setPR(playerId, "BEST_FORM", Math.round(w.averageFormScore), w.sessionId);
  if (formPR) newPRs.push(formPR);
  if (w.bestCombo > 0) {
    const comboPR = await setPR(playerId, "LONGEST_COMBO", w.bestCombo, w.sessionId);
    if (comboPR) newPRs.push(comboPR);
  }

  // quests
  const questsCompleted = [...(await progressQuest(playerId, "DAILY", "WORKOUTS", 1)), ...(await progressQuest(playerId, "WEEKLY", "WORKOUTS", 1))];
  await progressQuest(playerId, "DAILY", "TOTAL_REPS", w.validReps);
  await progressQuest(playerId, "WEEKLY", "TOTAL_REPS", w.validReps);
  await progressQuest(playerId, "DAILY", "FORM_AVG", w.averageFormScore >= 90 ? 1 : 0);
  await progressQuest(playerId, "WEEKLY", "FORM_AVG", w.averageFormScore >= 90 ? 1 : 0);

  // leaderboards
  await addLeaderboardScore(playerId, "DAILY", w.validReps, { reps: w.validReps, formAccuracy: w.averageFormScore });
  await addLeaderboardScore(playerId, "WEEKLY", w.validReps, { reps: w.validReps, formAccuracy: w.averageFormScore });
  await addLeaderboardScore(playerId, "MONTHLY", w.validReps, { reps: w.validReps, formAccuracy: w.averageFormScore });
  await addLeaderboardScore(playerId, "ALL_TIME", w.validReps, { reps: w.validReps, formAccuracy: w.averageFormScore });

  // level + achievements (after stat bumps)
  const levelUps = await detectLevelUps(playerId, beforeXP);
  const unlocks = await evaluateAchievements(playerId);

  // snapshot today's leaderboard position
  const lb = await getLeaderboard("DAILY", "GLOBAL", playerId);
  if (lb.you) {
    await snapshotLeaderboard(playerId, "DAILY", "GLOBAL", lb.you.rank, lb.you.score);
  }

  // my daily rank movement - compare with previous snapshot
  await pushDailyMovement(playerId);

  return {
    xpTransactions: xpAdded,
    levelUps: levelUps.map((l) => ({ prevLevel: l.prevLevel, newLevel: l.newLevel })),
    newAchievements: unlocks.unlocked,
    newTrophies: unlocks.trophies,
    newPRs,
    questsCompleted,
    streak,
  };
}

async function snapshotLeaderboard(playerId: PlayerId, period: LeaderboardPeriod, scope: LeaderboardScope, rank: number, score: number): Promise<void> {
  const snap = (await snapCol.get(playerKey(playerId, "snapshots"))) ?? [];
  snap.push({ playerId, period, scope, rank, score, at: now() });
  await snapCol.put(playerKey(playerId, "snapshots"), snap.slice(-100));
}

async function pushDailyMovement(playerId: PlayerId): Promise<void> {
  const snaps = (await snapCol.get(playerKey(playerId, "snapshots"))) ?? [];
  if (snaps.length < 2) return;
  const [prev, cur] = snaps.slice(-2);
  const delta = (prev.rank ?? 0) - (cur.rank ?? 0);
  if (delta !== 0) {
    await pushEvent(playerId, {
      type: "LEADERBOARD_MOVEMENT",
      title: delta > 0 ? "Leaderboard climb!" : "Leaderboard shift",
      body: `${delta > 0 ? `▲ ${delta} positions` : `▼ ${Math.abs(delta)} positions`} in today's arena.`,
      payload: { delta },
    });
  }
}

// ────────────────────────────────────────────
// Battle processing
// ────────────────────────────────────────────

export interface BattleGrant {
  rating?: RatingChangeResult;
  xpTransactions: XPTransaction[];
  levelUps: Array<{ prevLevel: number; newLevel: number }>;
  newAchievements: UserAchievement[];
  newTrophies: UserTrophy[];
  newPRs: PersonalRecord[];
  questsCompleted: QuestAssignment[];
}

export async function applyMatchResult(playerId: PlayerId, m: MatchResult): Promise<BattleGrant> {
  const me = m.participants.find((p) => p.playerId === playerId);
  const won = m.winnerId === playerId;
  const lost = m.winnerId !== undefined && m.winnerId !== playerId && !m.draw;
  const result: "WIN" | "LOSS" | "DRAW" = won ? "WIN" : lost ? "LOSS" : "DRAW";
  const isFirstBattle = ((await readStats(playerId))["totalBattles"] ?? 0) === 0;
  const beforeXP = await totalLifetimeXP(playerId);

  const xpAdded: XPTransaction[] = [];
  await bumpStat(playerId, "totalBattles", 1);
  if (won) await bumpStat(playerId, "battleWins", 1);
  if (lost) await bumpStat(playerId, "battleLosses", 1);
  if (m.draw) await bumpStat(playerId, "battleDraws", 1);

  const tx1 = await awardXP(playerId, "BATTLE_PARTICIPATION", XPConfig.battleParticipationXP, `bm_${m.matchId}`);
  const tx2 = won ? await awardXP(playerId, "BATTLE_WIN", XPConfig.battleWinXP, `bm_${m.matchId}`) : m.draw ? await awardXP(playerId, "BATTLE_DRAW", XPConfig.battleDrawXP, `bm_${m.matchId}`) : null;
  if (tx1) xpAdded.push(tx1);
  if (tx2) xpAdded.push(tx2);
  if (isFirstBattle) {
    const t = await awardXP(playerId, "FIRST_BATTLE", XPConfig.firstBattleXP, "first_battle");
    if (t) xpAdded.push(t);
  }
  const myReps = me?.reps ?? 0;
  const tx3 = await awardXP(playerId, "VALID_REP", myReps * XPConfig.validRepXP, `bm_${m.matchId}_reps`);
  if (tx3) xpAdded.push(tx3);
  await bumpStat(playerId, "totalReps", myReps);

  let rating: RatingChangeResult | undefined;
  if (m.kind === "RANKED") {
    rating = await applyMatchResultToRating(playerId, result, m.matchId);
  }

  // PRs
  const newPRs: PersonalRecord[] = [];
  const repsPR = await setPR(playerId, "MAX_REPS_SESSION", myReps, m.matchId);
  if (repsPR) newPRs.push(repsPR);
  if (me && me.bestCombo > 0) {
    const comboPR = await setPR(playerId, "LONGEST_COMBO", me.bestCombo, m.matchId);
    if (comboPR) newPRs.push(comboPR);
  }
  if (rating) {
    const ratingPR = await setPR(playerId, "BEST_RATING", rating.rating.rating, m.matchId);
    if (ratingPR) newPRs.push(ratingPR);
  }
  if (won) {
    const winPR = await setPR(playerId, "BATTLE_WINS", (await getRating(playerId)).wins, m.matchId);
    if (winPR) newPRs.push(winPR);
    await socialActivity(playerId, "BATTLE_WIN", "Won a battle", `${myReps} verified reps`);
  }

  const questsCompleted = [
    ...(await progressQuest(playerId, "DAILY", "BATTLES", 1)),
    ...(await progressQuest(playerId, "WEEKLY", "BATTLES", 1)),
    ...(won ? await progressQuest(playerId, "DAILY", "BATTLE_WINS", 1) : []),
    ...(won ? await progressQuest(playerId, "WEEKLY", "BATTLE_WINS", 1) : []),
  ];
  await progressQuest(playerId, "DAILY", "TOTAL_REPS", myReps);
  await progressQuest(playerId, "WEEKLY", "TOTAL_REPS", myReps);

  await addLeaderboardScore(playerId, "DAILY", myReps, { reps: myReps, formAccuracy: me?.formScore ?? 0 });
  await addLeaderboardScore(playerId, "WEEKLY", myReps, { reps: myReps, formAccuracy: me?.formScore ?? 0 });
  await addLeaderboardScore(playerId, "MONTHLY", myReps, { reps: myReps, formAccuracy: me?.formScore ?? 0 });
  await addLeaderboardScore(playerId, "ALL_TIME", myReps, { reps: myReps, formAccuracy: me?.formScore ?? 0 });

  const levelUps = await detectLevelUps(playerId, beforeXP);
  const unlocks = await evaluateAchievements(playerId);

  return {
    rating,
    xpTransactions: xpAdded,
    levelUps: levelUps.map((l) => ({ prevLevel: l.prevLevel, newLevel: l.newLevel })),
    newAchievements: unlocks.unlocked,
    newTrophies: unlocks.trophies,
    newPRs,
    questsCompleted,
  };
}

// ────────────────────────────────────────────
// Aggregated player view for UI
// ────────────────────────────────────────────

export async function playerOverview(playerId: PlayerId) {
  const level = await levelProgress(playerId);
  const rating = await getRating(playerId);
  const streak = await getStreak(playerId);
  const stats = await readStats(playerId);
  const today = utcDayKey();
  const todayReps = stats[`reps_${today}`] ?? 0;
  const todayWorkouts = stats[`day_${today}`] ?? 0;
  const achievements = await getUserAchievements(playerId);
  const trophies = await getUserTrophies(playerId);
  const quests = await getQuests(playerId, "DAILY");
  const lbToday = await getLeaderboard("DAILY", "GLOBAL", playerId, { top: 5 });
  return {
    playerId,
    level,
    rating,
    rankDisplay: rankDisplayName(rating.rank, rating.division),
    streak,
    totalReps: stats["totalReps"] ?? 0,
    totalWorkouts: stats["totalWorkouts"] ?? 0,
    totalBattles: stats["totalBattles"] ?? 0,
    wins: rating.wins,
    losses: rating.losses,
    bestSessionReps: stats["bestSessionReps"] ?? 0,
    bestFormAvg: stats["bestFormAvg"] ?? 0,
    todayReps,
    todayWorkouts,
    achievementsCount: achievements.length,
    trophiesCount: trophies.length,
    quests,
    leaderboard: lbToday,
    events: await getEvents(playerId),
  };
}

// Test/seed helpers
export function debugResetALL(): void {
  // no-op safety: clearing is handled at the UI layer
}