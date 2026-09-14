import { describe, it, expect } from "vitest";
import { angleDeg, distance, midpoint, normalize, lineDeviation, clamp01, lerp } from "../src/core/cv/LandmarkMath";

describe("LandmarkMath", () => {
  it("computes right angles from 3 landmarks", () => {
    const a = { x: 0, y: 1 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angleDeg(a, b, c)).toBeCloseTo(90, 5);
  });

  it("computes a straight line as 180deg", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 2, y: 0 };
    expect(angleDeg(a, b, c)).toBeCloseTo(180, 5);
  });

  it("distance works in normalized space", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 5);
  });

  it("midpoint averages two points", () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 2, y: 4 })).toEqual({ x: 1, y: 2 });
  });

  it("normalize clamps into [0,1]", () => {
    expect(normalize(50, 0, 100)).toBeCloseTo(0.5, 5);
    expect(normalize(120, 0, 100)).toBe(1);
    expect(normalize(-40, 0, 100)).toBe(0);
    expect(normalize(5, 10, 0)).toBe(0.5); // inverted range → fallback
  });

  it("lineDeviation returns 0 for collinear points and grows off-line", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(lineDeviation(line[0], line[1], line[2])).toBeCloseTo(0, 5);
    const off = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0.5 }];
    expect(lineDeviation(off[0], off[1], off[2])).toBeGreaterThan(0);
  });

  it("clamp01 and lerp behave sanely", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});