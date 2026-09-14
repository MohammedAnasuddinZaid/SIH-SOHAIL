import { describe, it, expect } from "vitest";
import { ComboEngine } from "../src/core/game/ComboEngine";

describe("ComboEngine", () => {
  it("counts valid reps and tracks best combo", () => {
    const c = new ComboEngine();
    c.onValid();
    c.onValid();
    c.onValid();
    expect(c.snapshot().combo).toBe(3);
    expect(c.snapshot().bestCombo).toBe(3);
    expect(c.snapshot().totalValid).toBe(3);
  });

  it("resets combo on invalid rep but keeps best", () => {
    const c = new ComboEngine();
    c.onValid();
    c.onValid();
    c.onInvalid();
    expect(c.snapshot().combo).toBe(0);
    expect(c.snapshot().bestCombo).toBe(2);
    expect(c.snapshot().totalInvalid).toBe(1);
  });

  it("reset() clears counters", () => {
    const c = new ComboEngine();
    c.onValid();
    c.reset();
    expect(c.snapshot()).toMatchObject({ combo: 0, bestCombo: 0, totalValid: 0, totalInvalid: 0 });
  });
});