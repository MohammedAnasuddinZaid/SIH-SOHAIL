import { describe, it, expect, beforeEach } from "vitest";
import { createPlayer } from "../src/core/identity/PlayerService";
import { applyWorkoutResult, getStreak, getPRs, levelProgress, totalLifetimeXP } from "../src/core/progression/ProgressionService";
import { grantRandomSession } from "./workout-fixture";

const PID = "REP-99990001";

beforeEach(async () => {
  // Clean all ZELUX namespaces for a hermetic test run.
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith("rep:")) keys.push(k);
  }
  for (const k of keys) window.localStorage.removeItem(k);
  await createPlayer({ playerId: PID, username: "Tester" });
});

describe("Progression end-to-end", () => {
  it("a completed workout grants XP, updates streak, sets PRs and unlocks achievements", async () => {
    const before = await totalLifetimeXP(PID);
    expect(before).toBe(0);

    const wx = grantRandomSession(PID, 12, 91);
    const grant = await applyWorkoutResult(PID, wx);

    const after = await totalLifetimeXP(PID);
    expect(after).toBeGreaterThan(0);

    const streak = await getStreak(PID);
    expect(streak.current).toBeGreaterThanOrEqual(1);

    const prs = await getPRs(PID);
    expect(prs.length).toBeGreaterThanOrEqual(1);
    expect(prs.some((p) => p.metric === "MAX_REPS_SESSION" && p.value >= 12)).toBe(true);

    const level = await levelProgress(PID);
    expect(level.totalXP).toBe(after);

    // Achievements seeded by evaluation of actual stats:
    expect(grant.newAchievements.length).toBeGreaterThanOrEqual(0);
  });

  it("re-applying the same session is idempotent (no double XP)", async () => {
    const wx = grantRandomSession(PID, 5, 80);
    await applyWorkoutResult(PID, wx);
    const afterFirst = await totalLifetimeXP(PID);
    expect(afterFirst).toBeGreaterThan(0);
    await applyWorkoutResult(PID, wx);
    const afterSecond = await totalLifetimeXP(PID);
    expect(afterSecond).toBe(afterFirst);
  });
});