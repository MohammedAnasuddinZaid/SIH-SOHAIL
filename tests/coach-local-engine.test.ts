import { describe, it, expect } from "vitest";
import { assess, closingLine, reactToUserText } from "../src/core/coach/CoachLocalEngine";
import { buildCoachContext, serializeCoachContext } from "../src/core/coach/CoachContextBuilder";
import type { CoachContext } from "../src/core/coach/CoachContextBuilder";

function ctx(overrides: Partial<CoachContext> = {}): CoachContext {
  const base: CoachContext = {
    playerId: "REP-00010001",
    username: "Tester",
    personality: "SUPPORTIVE",
    overview: {
      playerId: "REP-00010001",
      level: { currentLevel: 1, currentXP: 0, totalXP: 0, xpIntoLevel: 0, xpRequiredForNextLevel: 100, progressPercent: 0 },
      rating: {
        playerId: "REP-00010001",
        rating: 1000,
        rank: "ROOKIE",
        division: 2,
        wins: 0,
        losses: 0,
        draws: 0,
        matchesPlayed: 0,
        placementMatches: 5,
        placementDone: false,
        bestRating: 1000,
      },
      rankDisplay: "Rookie III",
      streak: {
        playerId: "REP-00010001",
        current: 0,
        best: 0,
        lastActiveDay: null,
        activeDaysThisWeek: 0,
        updatedAt: Date.now(),
      },
      totalReps: 0, totalWorkouts: 0, totalBattles: 0, wins: 0, losses: 0,
      bestSessionReps: 0, bestFormAvg: 0, todayReps: 0, todayWorkouts: 0,
      achievementsCount: 0, trophiesCount: 0, quests: [],
      leaderboard: { rows: [], you: null },
      events: [],
    },
    prs: [],
    recentEvents: [],
    recentSessions: [],
    lastWorkoutDaysAgo: null,
    daysThisWeek: 0,
    missedDays: 7,
    formTrend: "NO_DATA",
    volumeTrend: "NEW",
    battleWinRate: null,
    builtAt: Date.now(),
  };
  return { ...base, ...overrides };
}

describe("CoachLocalEngine", () => {
  it("welcomes a brand new player with a first-session plan", () => {
    const a = assess(ctx());
    expect(a.coherent).toBe(true);
    expect(a.nextSession?.sets).toBeGreaterThan(0);
    expect(a.gaps.some((g) => g.toLowerCase().includes("recorded"))).toBe(true);
  });

  it("flags technique focus when form is declining", () => {
    const a = assess(
      ctx({
        formTrend: "DECLINING",
        overview: {
          ...ctx().overview,
          totalWorkouts: 12,
          totalReps: 240,
          todayWorkouts: 1,
          todayReps: 20,
          strength: 0,
        } as unknown as CoachContext["overview"],
        recentSessions: [{ at: Date.now() - 86400000, reps: 20, form: 70 }],
        lastWorkoutDaysAgo: 1,
        daysThisWeek: 4,
      }),
    );
    expect(a.focus).toBe("TECHNIQUE");
  });

  it("prescribes gentle volume the day after a session (wantRest)", () => {
    const a = assess(
      ctx({
        overview: {
          ...ctx().overview,
          totalWorkouts: 8,
          totalReps: 160,
          todayWorkouts: 1,
          todayReps: 20,
        },
        recentSessions: [{ at: Date.now() - 86400000, reps: 20, form: 88 }],
        lastWorkoutDaysAgo: 1,
        daysThisWeek: 4,
        formTrend: "STABLE",
        volumeTrend: "CONSISTENT",
      }),
    );
    expect(a.wantRest).toBe(true);
  });

  it("closing line and persona reactions exist for all personalities", () => {
    for (const p of ["SUPPORTIVE", "DRILL_SERGEANT", "SCIENTIST"] as const) {
      expect(closingLine(p, "TECHNIQUE").length).toBeGreaterThan(0);
    }
    expect(reactToUserText("DRILL_SERGEANT", "I'm in pain today").length).toBeGreaterThan(0);
  });
});

describe("CoachContextBuilder", () => {
  it("serializes a real-looking context to a readable block", () => {
    const c = ctx();
    const block = serializeCoachContext(c);
    expect(block).toContain("PLAYER:");
    expect(block).toContain("LEVEL:");
  });

  it("builds real context for a player", async () => {
    const c = await buildCoachContext("REP-00010001", "SUPPORTIVE");
    expect(c.playerId).toBe("REP-00010001");
    expect(typeof c.builtAt).toBe("number");
  });
});