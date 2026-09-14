import { describe, it, expect } from "vitest";
import { LandmarkSmoother, MedianFilter, OneEuroFilter } from "../src/core/cv/LandmarkSmoother";

function frameAt(x: number, y: number) {
  const pts: Array<{ x: number; y: number; z: number; visibility: number }> = [];
  for (let i = 0; i < 33; i++) pts.push({ x, y, z: 0, visibility: 0.9 });
  return pts;
}

describe("LandmarkSmoother", () => {
  it("returns a full 33-landmark frame and stabilises over time", () => {
    const s = new LandmarkSmoother(0.55);
    const a = s.smooth(frameAt(0.4, 0.4), 1000);
    expect(a).toHaveLength(33);
    const b = s.smooth(frameAt(0.6, 0.4), 1020);
    // EMA: 0.4 + (0.6-0.4)*0.55 = 0.51
    expect(b[0].x).toBeCloseTo(0.51, 5);
  });

  it("holds the smoothed value when a landmark jumps beyond the clamp distance", () => {
    const s = new LandmarkSmoother(0.55);
    s.smooth(frameAt(0.4, 0.4), 1000);
    const c = s.smooth(frameAt(0.9, 0.4), 1020);
    // 0.5 normalized jump > clamp 0.3 → single-frame spike veto
    expect(c[0].x).toBeCloseTo(0.4, 5);
  });

  it("resets to raw on reset()", () => {
    const s = new LandmarkSmoother(0.3);
    s.smooth(frameAt(0.1, 0.1), 1000);
    s.reset();
    const c = s.smooth(frameAt(0.9, 0.9), 2000);
    expect(c[0].x).toBeCloseTo(0.9, 5);
  });
});

describe("MedianFilter", () => {
  it("filters a spike with a small window", () => {
    const m = new MedianFilter(3);
    m.push(1);
    m.push(1);
    m.push(1);
    const spike = m.push(100);
    expect(spike).toBeLessThanOrEqual(1);
  });
});

describe("OneEuroFilter", () => {
  it("returns finite smoothed values", () => {
    const f = new OneEuroFilter(1, 0.01, 1);
    const out = [0, 10, 20, 30].map((v, i) => f.filter(v, i));
    expect(out).toHaveLength(4);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});