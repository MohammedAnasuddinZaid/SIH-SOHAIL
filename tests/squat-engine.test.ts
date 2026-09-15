import { describe, it, expect } from "vitest";
import { SquatRepEngine, type SquatEngineConfig, type SquatObservation } from "../src/core/cv/SquatRepEngine";

const cfg: SquatEngineConfig = {
  topAngle: 168,
  bottomAngle: 95,
  minHipAngle: 55,
  minRepDuration: 380,
  maxRepDuration: 4000,
  minDownDuration: 250,
  minUpDuration: 180,
  hipTolerance: 0.34,
  confidenceThreshold: 0.8,
  strictness: 0.4,
};

const ok = (knee: number, t: number, hip = 90, kneeAligned = true, conf = 0.95): SquatObservation => ({
  kneeAngle: knee,
  hipAngle: hip,
  kneeAligned,
  hipAligned: true,
  trackingConfidence: conf,
  reliable: true,
  timestamp: t,
});

/** Feed a full clean squat: STAND → DESCEND → BOTTOM (held) → ASCEND → STAND. */
function cleanRep(engine: SquatRepEngine, start = 1000, hip = 90, kneeAligned = true): Array<{ type: string; reason?: string }> {
  const evs: Array<{ type: string; reason?: string }> = [];
  const feed = (knee: number, t: number) => {
    for (const e of engine.process(ok(knee, t, hip, kneeAligned))) evs.push(e as { type: string; reason?: string });
  };
  feed(170, start + 0);
  feed(155, start + 90);
  feed(140, start + 180);
  feed(130, start + 270); // crosses midway → rep starts
  feed(125, start + 360);
  feed(110, start + 450);
  feed(98, start + 540); // hits bottom phase
  feed(90, start + 630);
  feed(90, start + 720);
  feed(100, start + 810);
  feed(115, start + 900); // begins ascent
  feed(135, start + 990);
  feed(155, start + 1080);
  feed(172, start + 1170);
  return evs;
}

describe("SquatRepEngine", () => {
  it("counts one validated rep for a clean full-depth squat and reports knee angle in status", () => {
    const engine = new SquatRepEngine(cfg);
    const events = cleanRep(engine);
    expect(events.filter((e) => e.type === "VALID_REP")).toHaveLength(1);
    expect(engine.status().kneeAngle).toBeGreaterThan(160);
  });

  it("does not count shallow (bailed) squats", () => {
    const engine = new SquatRepEngine(cfg);
    const evs: Array<{ type: string; reason?: string }> = [];
    const feed = (knee: number, t: number) => {
      for (const e of engine.process(ok(knee, t))) evs.push(e);
    };
    feed(170, 1000);
    feed(150, 1050);
    feed(130, 1100); // crosses midway → starts rep
    feed(145, 1150); // depth short of 95
    feed(168, 1200); // back to stand → INSUFFICIENT_DEPTH
    expect(evs.filter((e) => e.type === "VALID_REP")).toHaveLength(0);
    expect(evs.some((e) => e.type === "INVALID_REP")).toBe(true);
    expect(evs.find((e) => e.type === "INVALID_REP")?.reason).toBe("INSUFFICIENT_DEPTH");
  });

  it("rejects a rep with knees drifting past the toes (KNEE_DRIFT)", () => {
    const engine = new SquatRepEngine(cfg);
    const evs = cleanRep(engine, 2000, 90, false);
    const invalid = evs.find((e) => e.type === "INVALID_REP");
    expect(invalid).toBeTruthy();
    expect(invalid?.reason).toBe("KNEE_DRIFT");
  });

  it("rejects a rep with a collapsing torso (TORSO_LEAN)", () => {
    const engine = new SquatRepEngine(cfg);
    // hip angle 20 → 70° chest lean, past the relaxed 62° tolerance
    const evs = cleanRep(engine, 3000, 20);
    const invalid = evs.find((e) => e.type === "INVALID_REP");
    expect(invalid).toBeTruthy();
    expect(invalid?.reason).toBe("TORSO_LEAN");
  });

  it("requires the full STAND→BOTTOM→STAND sequence", () => {
    const engine = new SquatRepEngine(cfg);
    const evs: Array<{ type: string }> = [];
    for (let t = 0; t < 1500; t += 50) {
      for (const e of engine.process(ok(80, t))) evs.push(e);
    }
    expect(evs.filter((e) => e.type === "VALID_REP")).toHaveLength(0);
  });

  it("emits LOST_TRACKING when landmarks vanish and RESTORED after recovery", () => {
    const engine = new SquatRepEngine(cfg);
    const evs: Array<{ type: string }> = [];
    for (const e of engine.process(ok(170, 1000))) evs.push(e);
    for (const e of engine.process(ok(170, 1020))) evs.push(e);
    for (const e of engine.process({ ...ok(170, 1040), trackingConfidence: 0.3, reliable: false })) evs.push(e);
    expect(evs).toContainEqual(expect.objectContaining({ type: "LOST_TRACKING" }));
    for (const e of engine.process(ok(170, 1400))) evs.push(e);
    expect(evs.some((e) => e.type === "RESTORED")).toBe(true);
  });
});

describe("SquatRepEngine calibration", () => {
  it("never reaches TOP when the standing pose sits below the fixed threshold", () => {
    const engine = new SquatRepEngine(cfg);
    // Standing knee reads 160°, the fixed 168° top needs >= 162° to go TOP.
    engine.process(ok(160, 1000));
    engine.process(ok(160, 1030));
    expect(engine.status().state).toBe("READY");
  });

  it("binds TOP to the observed standing pose after calibrate()", () => {
    const engine = new SquatRepEngine(cfg);
    engine.calibrate(160);
    engine.process(ok(160, 1000));
    engine.process(ok(160, 1030));
    expect(engine.status().state).toBe("TOP");
  });

  it("still counts a full rep after calibrating to a realistic standing angle", () => {
    const engine = new SquatRepEngine({ ...cfg, minDownDuration: 120 });
    engine.calibrate(160);
    const evs = cleanRep(engine, 2000);
    expect(evs.filter((e) => e.type === "VALID_REP")).toHaveLength(1);
  });

  it("ignores non-finite calibration input", () => {
    const engine = new SquatRepEngine(cfg);
    engine.calibrate(Number.NaN);
    engine.process(ok(170, 1000));
    engine.process(ok(170, 1030));
    expect(engine.status().state).toBe("TOP");
  });

  it("clamps calibration into a sane working range", () => {
    const engine = new SquatRepEngine(cfg);
    engine.calibrate(40);
    expect(engine.effective.topThreshold).toBeCloseTo(90 - cfg.strictness * 4, 5);
    engine.calibrate(999);
    expect(engine.effective.topThreshold).toBeCloseTo(178 - cfg.strictness * 4, 5);
  });
});