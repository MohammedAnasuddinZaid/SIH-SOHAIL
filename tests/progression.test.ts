import { describe, it, expect } from "vitest";
import {
  getLevelFromXP,
  getXPRequiredForLevel,
  getProgress,
  getRankFromRating,
  rankDisplayName,
  RANKS,
} from "../src/config/progression";
import { utcDayKey, weekStartUTC, monthStartUTC } from "../src/core/progression/ProgressionService";

describe("XP / level curve", () => {
  it("starts at level 1 with 0 XP", () => {
    expect(getLevelFromXP(0)).toBe(1);
  });

  it("monotonically increases levels with XP", () => {
    const prev = [0, 50, 100, 250, 499, 700, 1700, 5000, 100000].map(getLevelFromXP);
    for (let i = 1; i < prev.length; i++) {
      expect(prev[i]).toBeGreaterThanOrEqual(prev[i - 1]);
    }
  });

  it("requires 100 XP for level 2 and 250 for level 3", () => {
    expect(getXPRequiredForLevel(2)).toBe(100);
    expect(getXPRequiredForLevel(3)).toBe(150);
  });

  it("progress reports sane values", () => {
    const p = getProgress(1, 50);
    expect(p.xpIntoLevel).toBe(50);
    expect(p.xpRequiredForNextLevel).toBe(100);
    expect(p.progressPercent).toBe(50);
  });
});

describe("Ranks", () => {
  it("maps rating to ranks in order", () => {
    expect(getRankFromRating(0).rank).toBe("ROOKIE");
    expect(getRankFromRating(250).rank).toBe("BRONZE");
    expect(getRankFromRating(2500).rank).toBe("LEGEND");
  });

  it("renders readable rank names", () => {
    expect(rankDisplayName("ROOKIE", 1)).toBe("Rookie III");
    expect(rankDisplayName("LEGEND", 2)).toBe("Legend");
    expect(RANKS[0]).toBe("ROOKIE");
  });
});

describe("UTC bucket keys", () => {
  it("bounds day, week and month buckets within 24h / 7d", () => {
    const ts = Date.UTC(2026, 1, 19, 14, 30, 0);
    const ws = weekStartUTC(ts);
    expect(new Date(ws).getUTCDay()).toBe(1); // Monday
    expect(ws <= ts).toBe(true);
    const day = utcDayKey(ts);
    expect(day).toBe("2026-02-19");
    const ms = monthStartUTC(ts);
    expect(new Date(ms).getUTCDate()).toBe(1);
    expect(new Date(ms).getUTCMonth()).toBe(1);
  });
});