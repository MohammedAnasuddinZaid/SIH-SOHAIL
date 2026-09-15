// Squat recognition engine: finite state machine mirroring the push-up engine,
// but driven by knee bend + torso control. A rep is only counted when the full
// descent→depth→ascent cycle completes with sufficient depth (knee flexion),
// torso control (no extreme forward lean) and knee stability (no kneecap drift
// past the toes line).

import { clamp01, normalize } from "./LandmarkMath";
import type { InvalidRepReason } from "../../types";

export type RepPhase = "UNKNOWN" | "TOP" | "DESCENDING" | "BOTTOM" | "ASCENDING";

export type EngineState =
  | "NO_POSE"
  | "READY"
  | "TOP"
  | "DESCENDING"
  | "BOTTOM"
  | "ASCENDING"
  | "PAUSED"
  | "LOST_TRACKING";

export interface SquatObservation {
  kneeAngle: number; // 180 = straight, smaller = deeper bend
  hipAngle: number; // torso-vs-thigh: small = leaning far forward
  kneeAligned: boolean; // knee stays over ankle line, not past the toes
  hipAligned: boolean; // hips don't drift back off the foot line
  trackingConfidence: number;
  reliable: boolean;
  timestamp: number;
}

export interface SquatEngineConfig {
  topAngle: number;
  bottomAngle: number;
  minHipAngle: number;
  minRepDuration: number;
  maxRepDuration: number;
  minDownDuration: number;
  minUpDuration: number;
  hipTolerance: number;
  confidenceThreshold: number;
  strictness: number; // 0..1 shifts thresholds toward strict
  directionDeadbandDeg?: number;
}

export type RepEngineEvent =
  | { type: "VALID_REP"; formScore: number; duration: number; depth: number; extension: number; alignment: number; confidence: number }
  | { type: "INVALID_REP"; reason: InvalidRepReason; confidence: number; formScore: number }
  | { type: "LOST_TRACKING" }
  | { type: "RESTORED" };

export interface RepEngineStatus {
  state: EngineState;
  phase: RepPhase;
  kneeAngle: number;
  minAngleThisRep: number;
  maxExtensionThisRep: number;
  maxAbsLean: number;
  downDuration: number;
  upDuration: number;
  totalDuration: number;
  inRep: boolean;
  averageConfidence: number;
}

interface EffectiveThresholds {
  topThreshold: number;
  bottomThreshold: number;
  hipTolerance: number;
}

const PHASE_MARGIN_DEG = 6;

export class SquatRepEngine {
  state: EngineState = "NO_POSE";
  phase: RepPhase = "UNKNOWN";

  private lastAngle = 180;
  private downStartedAt = 0;
  private bottomAt = 0;
  private upStartedAt = 0;
  private repStartedAt = 0;
  private minAngle = 180;
  private maxAngleSinceBottom = -1;
  private maxAbsLean = 0;
  private kneeDrifted = false;
  private confidences: number[] = [];
  private directionChanges = 0;
  private lastDir: "down" | "up" | null = null;
  private lostAt: number | null = null;
  private inRepFlag = false;
  private hipToleranceOverride: number | null = null;
  private topAngleOverride: number | null = null;

  constructor(private config: SquatEngineConfig) {}

  setHipTolerance(tolerance: number): void {
    this.hipToleranceOverride = tolerance;
  }

  /**
   * Locks the rep engine to the user's actual standing pose, measured during
   * calibration. Without this, a camera angle that reads the standing knee at
   * e.g. 160deg never reaches the fixed 168deg "TOP" threshold and no squat is
   * ever counted. Clamped so a bad/occluded read can't wreck validation.
   */
  calibrate(observedTopAngle: number): void {
    if (!Number.isFinite(observedTopAngle)) return;
    this.topAngleOverride = Math.max(90, Math.min(178, observedTopAngle));
  }

  get effective(): EffectiveThresholds {
    const s = this.config.strictness;
    const baseTol = this.hipToleranceOverride ?? this.config.hipTolerance;
    const baseTop = this.topAngleOverride ?? this.config.topAngle;
    return {
      topThreshold: baseTop - s * 4,
      bottomThreshold: this.config.bottomAngle + s * (12 - 8 * s),
      hipTolerance: baseTol * (1 + (1 - s) * 0.35),
    };
  }

  status(): RepEngineStatus {
    return {
      state: this.state,
      phase: this.phase,
      kneeAngle: this.lastAngle,
      minAngleThisRep: this.minAngle,
      maxExtensionThisRep: this.maxAngleSinceBottom > 0 ? this.maxAngleSinceBottom : 0,
      maxAbsLean: this.maxAbsLean,
      downDuration: this.bottomAt && this.downStartedAt ? this.bottomAt - this.downStartedAt : 0,
      upDuration: this.upStartedAt ? Date.now() - this.upStartedAt : 0,
      totalDuration: this.repStartedAt ? Date.now() - this.repStartedAt : 0,
      inRep: this.inRepFlag,
      averageConfidence: this.avgConfidence(),
    };
  }

  reset(): void {
    this.state = "NO_POSE";
    this.phase = "UNKNOWN";
    this.lastAngle = 180;
    this.downStartedAt = 0;
    this.bottomAt = 0;
    this.upStartedAt = 0;
    this.repStartedAt = 0;
    this.minAngle = 180;
    this.maxAngleSinceBottom = -1;
    this.maxAbsLean = 0;
    this.kneeDrifted = false;
    this.confidences = [];
    this.directionChanges = 0;
    this.lastDir = null;
    this.lostAt = null;
    this.inRepFlag = false;
  }

  process(obs: SquatObservation): RepEngineEvent[] {
    const events: RepEngineEvent[] = [];
    const t = obs.timestamp;
    const { topThreshold, bottomThreshold, hipTolerance } = this.effective;
    const cfg = this.config;

    // ── Tracking loss ──
    if (!obs.reliable || obs.trackingConfidence < cfg.confidenceThreshold) {
      if (this.state !== "LOST_TRACKING" && this.state !== "NO_POSE" && this.state !== "PAUSED") {
        this.lostAt = t;
        this.state = "LOST_TRACKING";
        this.phase = "UNKNOWN";
        events.push({ type: "LOST_TRACKING" });
      } else if (this.state === "NO_POSE") {
        this.state = "LOST_TRACKING";
      }
      this.lastAngle = obs.kneeAngle;
      return events;
    }

    // ── Recovery from tracking loss ──
    if (this.state === "LOST_TRACKING") {
      if (this.lostAt === null) this.lostAt = t;
      if (t - this.lostAt > 250) {
        const nearBottom = obs.kneeAngle <= bottomThreshold + 20;
        this.state = nearBottom ? "BOTTOM" : "TOP";
        this.phase = nearBottom ? "BOTTOM" : "TOP";
        this.inRepFlag = false;
        this.resetRepMetrics();
        events.push({ type: "RESTORED" });
      }
      this.lastAngle = obs.kneeAngle;
      return events;
    }

    if (this.state === "PAUSED") return events;

    // ── Phase classification with hysteresis ──
    const prevPhase = this.phase;
    if (obs.kneeAngle >= topThreshold - PHASE_MARGIN_DEG) {
      this.phase = "TOP";
    } else if (obs.kneeAngle <= bottomThreshold + PHASE_MARGIN_DEG) {
      this.phase = "BOTTOM";
    } else {
      this.phase = prevPhase === "BOTTOM" || prevPhase === "ASCENDING" ? "ASCENDING" : "DESCENDING";
    }

    // ── Direction change tracking (deadbanded) ──
    const angle = obs.kneeAngle;
    const deadband = this.config.directionDeadbandDeg ?? 2;
    if (Math.abs(angle - this.lastAngle) > deadband) {
      const dir: "down" | "up" = angle < this.lastAngle ? "down" : "up";
      if (this.lastDir !== null && dir !== this.lastDir) this.directionChanges += 1;
      this.lastDir = dir;
    }
    this.lastAngle = angle;

    // ── In-rep metric tracking ──
    if (this.inRepFlag) {
      this.confidences.push(obs.trackingConfidence);
      this.minAngle = Math.min(this.minAngle, angle);
      // Torso control: hipAngle small = chest collapsing toward knees.
      const lean = Math.abs(obs.hipAngle) < 90 ? 90 - obs.hipAngle : 0;
      this.maxAbsLean = Math.max(this.maxAbsLean, lean);
      if (obs.kneeAligned === false) this.kneeDrifted = true;
      if (this.phase === "ASCENDING" || this.phase === "TOP") {
        this.maxAngleSinceBottom = Math.max(this.maxAngleSinceBottom, angle);
      }
    }

    // ── State machine transitions ──
    switch (this.state) {
      case "NO_POSE":
      case "READY": {
        if (angle >= topThreshold - PHASE_MARGIN_DEG) {
          this.state = "TOP";
          this.phase = "TOP";
        } else {
          this.state = "READY";
        }
        break;
      }

      case "TOP": {
        // Start the descent as soon as the knee breaks below the midpoint.
        // Handles a fast frame-to-frame drop straight to BOTTOM too.
        if (angle <= midway(topThreshold, bottomThreshold)) {
          this.startRep(angle, t);
          this.state = "DESCENDING";
          if (this.phase === "BOTTOM") {
            this.bottomAt = t;
            this.state = "BOTTOM";
          }
        }
        break;
      }

      case "DESCENDING": {
        if (this.phase === "BOTTOM") {
          if (this.bottomAt === 0) this.bottomAt = t;
          if (t - this.downStartedAt >= cfg.minDownDuration || angle <= bottomThreshold) {
            this.state = "BOTTOM";
          }
        } else if (angle > topThreshold - PHASE_MARGIN_DEG) {
          this.state = "TOP";
          this.phase = "TOP";
          events.push(this.reject("INSUFFICIENT_DEPTH"));
          this.endRep();
        }
        break;
      }

      case "BOTTOM": {
        if (this.phase === "ASCENDING" && angle > bottomThreshold + PHASE_MARGIN_DEG) {
          this.upStartedAt = t;
          this.state = "ASCENDING";
        }
        break;
      }

      case "ASCENDING": {
        if (angle >= topThreshold - PHASE_MARGIN_DEG) {
          events.push(this.finalizeRep(t, { topThreshold, hipTolerance }));
          this.endRep();
          this.state = "TOP";
          this.phase = "TOP";
        } else if (angle <= bottomThreshold - 2) {
          this.state = "BOTTOM";
          this.phase = "BOTTOM";
        }
        break;
      }

      default:
        break;
    }

    return events;
  }

  pause(): void {
    if (this.state !== "PAUSED") {
      this.state = "PAUSED";
    }
  }

  resume(): void {
    if (this.state === "PAUSED") {
      this.state = this.inRepFlag ? "ASCENDING" : "TOP";
      this.phase = this.inRepFlag ? "ASCENDING" : "TOP";
    }
  }

  private startRep(angle: number, t: number): void {
    this.repStartedAt = t;
    this.downStartedAt = t;
    this.bottomAt = 0;
    this.upStartedAt = 0;
    this.minAngle = angle;
    this.maxAngleSinceBottom = -1;
    this.maxAbsLean = 0;
    this.kneeDrifted = false;
    this.confidences = [];
    this.directionChanges = 0;
    this.inRepFlag = true;
  }

  private endRep(): void {
    this.inRepFlag = false;
  }

  private resetRepMetrics(): void {
    this.minAngle = 180;
    this.maxAngleSinceBottom = -1;
    this.maxAbsLean = 0;
    this.kneeDrifted = false;
    this.confidences = [];
    this.directionChanges = 0;
  }

  private avgConfidence(): number {
    if (this.confidences.length === 0) return 0;
    return this.confidences.reduce((a, b) => a + b, 0) / this.confidences.length;
  }

  private reject(reason: InvalidRepReason): RepEngineEvent {
    return { type: "INVALID_REP", reason, confidence: this.avgConfidence(), formScore: 0 };
  }

  private finalizeRep(t: number, th: { topThreshold: number; hipTolerance: number }): RepEngineEvent {
    const cfg = this.config;
    const duration = t - this.repStartedAt || cfg.minRepDuration;
    const down = this.bottomAt && this.downStartedAt ? this.bottomAt - this.downStartedAt : 0;
    const up = this.upStartedAt ? t - this.upStartedAt : 0;
    const avgConf = this.avgConfidence();

    const reasons: InvalidRepReason[] = [];
    if (avgConf < cfg.confidenceThreshold - 0.05) reasons.push("LOW_CONFIDENCE");
    if (duration < cfg.minRepDuration || duration > cfg.maxRepDuration) reasons.push("UNSTABLE_POSE");
    if (down > 0 && down < cfg.minDownDuration) reasons.push("UNSTABLE_POSE");
    if (up > 0 && up < cfg.minUpDuration) reasons.push("UNSTABLE_POSE");
    if (this.minAngle > cfg.bottomAngle + 26) reasons.push("INSUFFICIENT_DEPTH");
    if (this.maxAngleSinceBottom > -1 && this.maxAngleSinceBottom < th.topThreshold - 26) reasons.push("INCOMPLETE_EXTENSION");
    if (this.maxAbsLean > 62) reasons.push("TORSO_LEAN");
    if (this.kneeDrifted) reasons.push("KNEE_DRIFT");
    if (this.directionChanges > 12) reasons.push("INCOMPLETE_MOVEMENT");

    const depth = clamp01(normalize(180 - this.minAngle, 0, 180 - cfg.bottomAngle));
    const extension = this.maxAngleSinceBottom > 0 ? clamp01(normalize(this.maxAngleSinceBottom, cfg.bottomAngle, th.topThreshold)) : 0;
    const alignment = this.kneeDrifted ? 0 : 1 - Math.min(1, this.maxAbsLean / 60);
    const confidence = clamp01(avgConf / 0.85);
    const smoothness = this.directionChanges <= 1 ? 1 : clamp01(2 / this.directionChanges);
    const formScore = Math.round(
      (Math.max(depth, alignment) * 0.3 + extension * 0.2 + alignment * 0.2 + confidence * 0.15 + smoothness * 0.15) * 100
    );

    if (reasons.length > 0) {
      return { type: "INVALID_REP", reason: reasons[0], confidence: avgConf, formScore };
    }
    return {
      type: "VALID_REP",
      formScore,
      duration,
      depth: Math.round(depth * 100),
      extension: Math.round(extension * 100),
      alignment: Math.round(alignment * 100),
      confidence: avgConf,
    };
  }
}

function midway(a: number, b: number): number {
  return (a + b) / 2;
}