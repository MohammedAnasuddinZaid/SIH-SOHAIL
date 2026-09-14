import { describe, it, expect } from "vitest";
import { assess, closingLine, reactToUserText, detectIntent, composeCoachReply } from "../src/core/coach/CoachLocalEngine";
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

describe("conversational coach intents", () => {
  const a = assess(ctx());

  it("detects the right intent for small talk", () => {
    expect(detectIntent("hi coach")).toBe("GREETING");
    expect(detectIntent("how am I doing today?")).toBe("HOW_AM_I");
    expect(detectIntent("what should I train?")).toBe("TRAINING_PLAN");
    expect(detectIntent("my knee hurts a bit")).toBe("PAIN");
    expect(detectIntent("thanks!")).toBe("THANKS");
    expect(detectIntent("see you later")).toBe("FAREWELL");
  });

  it("detects health, wellbeing and lifestyle intents", () => {
    expect(detectIntent("hi doctor")).toBe("WELLNESS");
    expect(detectIntent("should I see a doctor?")).toBe("WELLNESS");
    expect(detectIntent("how are you today?")).toBe("HOW_ARE_YOU");
    expect(detectIntent("analyze my form")).toBe("BODY_ANALYSIS");
    expect(detectIntent("how can I improve my push ups?")).toBe("IMPROVE");
    expect(detectIntent("can I get better at squats?")).toBe("IMPROVE");
    expect(detectIntent("what stretches for a warm up?")).toBe("EXERCISE_SUGGEST");
    expect(detectIntent("should I take a rest day?")).toBe("RECOVERY");
    expect(detectIntent("do I need to rest today?")).toBe("RECOVERY");
    expect(detectIntent("what should I eat for energy?")).toBe("NUTRITION");
    expect(detectIntent("i need motivation")).toBe("MOTIVATION");
    expect(detectIntent("beat my record today")).toBe("PERSONAL_RECORD");
    expect(detectIntent("banana pancakes recipe")).toBe("DEFAULT");
  });

  it("a greeting followed by content routes to the content intent", () => {
    expect(detectIntent("hi how am i doing")).toBe("HOW_AM_I");
    expect(detectIntent("hey, should I see a doctor?")).toBe("WELLNESS");
  });

  it("keeps a greeting short instead of dumping the full numbers block", () => {
    const reply = composeCoachReply(ctx(), a, "SUPPORTIVE", "hi", "Tester");
    expect(reply.length).toBeLessThan(400);
    expect(reply).not.toContain("Next session");
  });

  it("answers 'how am I doing' with the progress check", () => {
    const reply = composeCoachReply(ctx(), a, "SUPPORTIVE", "how am i doing", "Tester");
    expect(reply.toLowerCase()).toContain("check-in");
  });

  it("treats pain reports as a stop order, not a numbers dump", () => {
    const reply = composeCoachReply(ctx(), a, "DRILL_SERGEANT", "my lower back hurts", "Tester");
    expect(reply.toLowerCase()).toContain("stop");
  });

  it("answers plan requests with a concrete next session", () => {
    const shown = assess(ctx({ overview: { ...ctx().overview, totalWorkouts: 8, totalReps: 160 } as unknown as CoachContext["overview"] }));
    const reply = composeCoachReply(ctx({ overview: { ...ctx().overview, totalWorkouts: 8, totalReps: 160 } as unknown as CoachContext["overview"] }), shown, "SCIENTIST", "what should I train?", "Tester");
    expect(reply).toContain("sets");
  });

  it("points to a real professional when the user asks about a doctor", () => {
    const reply = composeCoachReply(ctx(), a, "SUPPORTIVE", "should I see a doctor?", "Tester");
    expect(reply.toLowerCase()).toContain("not a doctor");
    expect(reply.toLowerCase()).toContain("professional");
  });

  it("explains what the camera measures without diagnosing", () => {
    const reply = composeCoachReply(ctx(), a, "SCIENTIST", "can you analyze my body?", "Tester");
    expect(reply.toLowerCase()).toContain("joint angles");
    expect(reply.toLowerCase()).toContain("medical screening");
  });

  it("improvement advice stays concrete and safe", () => {
    const reply = composeCoachReply(ctx(), a, "SUPPORTIVE", "how can I improve?", "Tester");
    expect(reply.toLowerCase()).toContain("improve");
  });

  it("suggests a replenishment plan for rest requests", () => {
    const reply = composeCoachReply(ctx(), a, "SUPPORTIVE", "should I rest today?", "Tester");
    expect(reply.toLowerCase()).toContain("recovery");
  });

  it("the default fallback offers clear next steps", () => {
    const reply = composeCoachReply(ctx(), a, "SUPPORTIVE", "banana pancakes recipe", "Tester");
    expect(reply).toContain("how am I doing?");
  });

  it("never emits an em dash in any reply direction", () => {
    const messages = ["hi", "how am I doing?", "what should I train?", "should I see a doctor?", "my shoulder hurts", "how can I improve?", "i need motivation", "what stretches for a warm up?", "banana pancakes recipe", "thanks"];
    for (const msg of messages) {
      const reply = composeCoachReply(ctx(), a, "SUPPORTIVE", msg, "Tester");
      expect(reply).not.toContain("\u2014");
      expect(reply).not.toContain("👋");
    }
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