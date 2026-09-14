// CoachContextBuilder: turns REAL, verified player state into a structured,
// interlinked context object consumed by both the local reasoning engine and
// the optional model harness. Nothing here is invented.

import { playerOverview, getPRs, getEvents } from "../progression/ProgressionService";
import { getPlayer } from "../identity/PlayerService";
import type { CoachPersonalityId, PlayerId, PersonalRecord, ProgressionEvent } from "../../types";

export interface RecentSession {
  at: number;
  reps: number;
  form: number;
}

export interface CoachContext {
  playerId: PlayerId;
  username: string;
  personality: CoachPersonalityId;
  overview: Awaited<ReturnType<typeof playerOverview>>;
  prs: PersonalRecord[];
  recentEvents: ProgressionEvent[];
  recentSessions: RecentSession[];
  lastWorkoutDaysAgo: number | null;
  daysThisWeek: number;
  missedDays: number;
  formTrend: "IMPROVING" | "STABLE" | "DECLINING" | "NO_DATA";
  volumeTrend: "CONSISTENT" | "SURGING" | "DROPPING" | "NEW";
  battleWinRate: number | null;
  builtAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildCoachContext(playerId: PlayerId, personality: CoachPersonalityId): Promise<CoachContext> {
  const [overview, prs, events, player] = await Promise.all([
    playerOverview(playerId),
    getPRs(playerId),
    getEvents(playerId),
    getPlayer(playerId),
  ]);

  const recentSessions: RecentSession[] = events
    .filter((e) => e.type === "WORKOUT_COMPLETED")
    .slice(0, 20)
    .map((e) => ({
      at: e.createdAt,
      reps: Number(e.metadata?.validReps ?? 0),
      form: Number(e.metadata?.formAccuracy ?? 0),
    }));

  const last = recentSessions[0];
  const lastWorkoutDaysAgo = last ? Math.max(0, Math.floor((Date.now() - last.at) / DAY_MS)) : null;

  // Days active this UTC week (from streak record).
  const streak = overview.streak;
  const daysThisWeek = Math.max(streak.current, recentSessions.length > 0 ? 1 : 0);

  // Form trend from up to 5 sessions.
  const sample = recentSessions.slice(0, 5);
  let formTrend: CoachContext["formTrend"] = "NO_DATA";
  if (sample.length >= 2) {
    const firstHalf = avg(sample.slice(Math.ceil(sample.length / 2)).map((s) => s.form));
    const secondHalf = avg(sample.slice(0, Math.floor(sample.length / 2)).map((s) => s.form));
    if (sample[0].at <= Date.now() - 14 * DAY_MS) {
      formTrend = "STABLE";
    } else if (secondHalf >= firstHalf + 3) formTrend = "IMPROVING";
    else if (secondHalf <= firstHalf - 3) formTrend = "DECLINING";
    else formTrend = "STABLE";
  }

  const total = overview.wins + overview.losses;
  const battleWinRate = total > 0 ? overview.wins / total : null;

  return {
    playerId,
    username: player?.username ?? playerId,
    personality,
    overview,
    prs,
    recentEvents: events.slice(0, 40),
    recentSessions,
    lastWorkoutDaysAgo,
    daysThisWeek,
    missedDays: Math.max(0, 7 - daysThisWeek),
    formTrend,
    volumeTrend: lastWorkoutDaysAgo === null ? "NEW" : daysThisWeek >= 4 ? "SURGING" : daysThisWeek >= 2 ? "CONSISTENT" : "DROPPING",
    battleWinRate,
    builtAt: Date.now(),
  };
}

function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Renders the context as a compact markdown block for the LLM harness. */
export function serializeCoachContext(ctx: CoachContext): string {
  const o = ctx.overview;
  const lines = [
    `PLAYER: ${ctx.username} (${ctx.playerId})`,
    `LEVEL: ${o.level.currentLevel}  XP: ${o.level.currentXP}/${o.level.xpRequiredForNextLevel}  RANK: ${o.rankDisplay}`,
    `RATING: ${o.rating.rating} (W${o.wins}/L${o.losses})  STREAK: ${o.streak.current}d (best ${o.streak.best})`,
    `TOTAL: ${o.totalReps} reps / ${o.totalWorkouts} workouts / ${o.totalBattles} battles`,
    `TODAY: ${o.todayReps} reps, ${o.todayWorkouts} workouts`,
    `BEST SESSION: ${o.bestSessionReps} reps @ ${o.bestFormAvg} form`,
    `PRs: ${ctx.prs.map((p) => `${p.metric}=${p.value}`).join(", ") || "none yet"}`,
    `FORM TREND: ${ctx.formTrend}  VOLUME TREND: ${ctx.volumeTrend}`,
    `LAST WORKOUT: ${ctx.lastWorkoutDaysAgo === null ? "never" : `${ctx.lastWorkoutDaysAgo} day(s) ago`}`,
    `DAYS ACTIVE THIS WEEK: ${ctx.daysThisWeek}`,
    `BATTLE WIN RATE: ${ctx.battleWinRate === null ? "none" : `${Math.round(ctx.battleWinRate * 100)}%`}`,
    `QUESTS: ${o.quests.map((q) => `${q.title} ${q.progress}/${q.target}`).join("; ")}`,
    `ACHIEVEMENTS UNLOCKED: ${o.achievementsCount}  TROPHIES: ${o.trophiesCount}`,
    ...ctx.recentSessions.slice(0, 5).map((s, i) => `SESSION-${i + 1}: ${Math.round((Date.now() - s.at) / DAY_MS)}d ago, ${s.reps} reps, form ${s.form}`),
  ];
  return lines.join("\n");
}