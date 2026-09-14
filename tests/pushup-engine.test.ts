import { describe, it, expect } from "vitest";
import { PushUpRepEngine, strictnessFactor, type RepEngineConfig, type RepObservation } from "../src/core/cv/PushUpRepEngine";

const cfg: RepEngineConfig = {
  topAngle: 162,
  bottomAngle: 88,
  minRepDuration: 380,
  maxRepDuration: 4000,
  minDownDuration: 250,
  minUpDuration: 180,
  hipTolerance: 0.08,
  confidenceThreshold: 0.8,
  strictness: 0.4,
};

const ok = (angle: number, t: number, hip = 0, conf = 0.95): RepObservation => ({
  elbowAngle: angle,
  hipDeviation: hip,
  hipAligned: Math.abs(hip) < 0.08,
  trackingConfidence: conf,
  reliable: true,
  timestamp: t,
});

/**
 * Feed a full, clean push-up: TOP → DESCEND → BOTTOM (held) → ASCEND → TOP.
 * Timestamps step 90ms so down/up durations satisfy temporal validation.
 * Returns collected events (with reason for INVALID).
 */
function cleanRep(engine: PushUpRepEngine, start = 1000, hip = 0): Array<{ type: string; reason?: string }> {
  const evs: Array<{ type: string; reason?: string }> = [];
  const feed = (angle: number, t: number) => {
    for (const e of engine.process(ok(angle, t, hip))) evs.push(e as { type: string; reason?: string });
  };
  feed(165, start + 0);
  feed(150, start + 90);
  feed(135, start + 180);
  feed(120, start + 270);
  feed(110, start + 360);
  feed(100, start + 450);
  feed(92, start + 540);
  feed(85, start + 630);
  feed(85, start + 720);
  feed(95, start + 810);
  feed(105, start + 900);
  feed(125, start + 990);
  feed(145, start + 1080);
  feed(163, start + 1170);
  return evs;
}

describe("PushUpRepEngine", () => {
  it("counts one validated rep for a clean TOP→BOTTOM→TOP movement", () => {
    const engine = new PushUpRepEngine(cfg);
    const events = cleanRep(engine);
    expect(events.filter((e) => e.type === "VALID_REP")).toHaveLength(1);
  });

  it("does not count bailed (insufficient depth) attempts", () => {
    const engine = new PushUpRepEngine(cfg);
    const evs: Array<{ type: string }> = [];
    const feed = (angle: number, t: number) => {
      for (const e of engine.process(ok(angle, t))) evs.push(e);
    };
    feed(165, 1000);
    feed(150, 1050);
    feed(135, 1100);
    feed(120, 1150); // crosses midway → starts rep
    feed(135, 1200); // reversals but never reaches bottom
    feed(160, 1250); // back to top → INSUFFICIENT_DEPTH
    expect(evs.filter((e) => e.type === "VALID_REP")).toHaveLength(0);
    expect(evs.some((e) => e.type === "INVALID_REP")).toBe(true);
  });

  it("rejects a rep with sagging hips (HIP_SAG)", () => {
    const engine = new PushUpRepEngine(cfg);
    // device hip deviation 0.3 (>> tolerance) through the whole chain
    const evs = cleanRep(engine, 2000, 0.3);
    const invalid = evs.find((e) => e.type === "INVALID_REP");
    expect(invalid).toBeTruthy();
    expect(invalid?.reason).toBe("HIP_SAG");
  });

  it("emits LOST_TRACKING when landmarks vanish and RESTORED after recovery", () => {
    const engine = new PushUpRepEngine(cfg);
    const evs: Array<{ type: string }> = [];
    for (const e of engine.process({ ...ok(165, 500), timestamp: 500 })) evs.push(e);
    for (const e of engine.process({ ...ok(165, 520), timestamp: 520 })) evs.push(e);
    for (const e of engine.process({ elbowAngle: 165, hipDeviation: 0, hipAligned: true, trackingConfidence: 0.3, reliable: false, timestamp: 540 })) evs.push(e);
    expect(evs).toContainEqual(expect.objectContaining({ type: "LOST_TRACKING" }));
    // recovery after 250ms+ with a top position
    for (const e of engine.process(ok(165, 900))) evs.push(e);
    expect(evs.some((e) => e.type === "RESTORED")).toBe(true);
  });

  it("respects pause/resume and does not count while paused", () => {
    const engine = new PushUpRepEngine(cfg);
    engine.pause();
    const before = engine.status().state;
    expect(before).toBe("PAUSED");
    const evs = cleanRep(engine, 3000);
    expect(evs.filter((e) => e.type === "VALID_REP")).toHaveLength(0);
    engine.resume();
    const s = engine.status();
    expect(s.state).not.toBe("PAUSED");
  });

  it("strictnessFactor maps labels monotonically", () => {
    const relaxed = strictnessFactor("RELAXED");
    const normal = strictnessFactor("NORMAL");
    const strict = strictnessFactor("STRICT");
    expect(relaxed).toBeLessThan(normal);
    expect(normal).toBeLessThan(strict);
  });

  it("requires full sequence: starting mid-rep yields no rep", () => {
    const engine = new PushUpRepEngine(cfg);
    const evs: Array<{ type: string }> = [];
    // always deep down, never at top → no start
    for (let t = 0; t < 1000; t += 50) {
      for (const e of engine.process(ok(80, t))) evs.push(e);
    }
    expect(evs.filter((e) => e.type === "VALID_REP")).toHaveLength(0);
  });
});