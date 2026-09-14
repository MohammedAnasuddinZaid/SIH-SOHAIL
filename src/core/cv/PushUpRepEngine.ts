// Push-up recognition engine: explicit finite state machine + temporal
// validation. A rep is only counted if the FULL movement completes in the
// correct order with sufficient depth, extension, alignment and confidence.

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

export interface RepObservation {
  elbowAngle: number;
  hipDeviation: number;
  hipAligned: boolean;
  trackingConfidence: number;
  reliable: boolean; // required landmarks visible & confident enough
  timestamp: number;
}

export interface RepEngineConfig {
  topAngle: number;
  bottomAngle: number;
  minRepDuration: number;
  maxRepDuration: number;
  minDownDuration: number;
  minUpDuration: number;
  hipTolerance: number;
  confidenceThreshold: number;
  strictness: number; // 0..1 shifts thresholds toward strict
  /** Degrees of elbow-angle movement required to register a direction change. */
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
  elbowAngle: number;
  minAngleThisRep: number;
  maxExtensionThisRep: number;
  maxAbsHipDev: number;
  hipSign: "SAG" | "PIKE" | "FLAT";
  downDuration: number;
  upDuration: number;
  totalDuration: number;
  inRep: boolean;
  averageConfidence: number;
}

export interface EffectiveThresholds {
  topThreshold: number;
  bottomThreshold: number;
  hipTolerance: number;
}

const PHASE_MARGIN_DEG = 6;

export class PushUpRepEngine {
  state: EngineState = "NO_POSE";
  phase: RepPhase = "UNKNOWN";

  private lastAngle = 180;
  private downStartedAt = 0;
  private bottomAt = 0;
  private upStartedAt = 0;
  private repStartedAt = 0;
  private minAngle = 180;
  private maxAngleSinceBottom = -1;
  private maxAbsHipDev = 0;
  private hipSign: "SAG" | "PIKE" | "FLAT" = "FLAT";
  private confidences: number[] = [];
  private directionChanges = 0;
  private lastDir: "down" | "up" | null = null;
  private lostAt: number | null = null;
  private inRepFlag = false;
  private hipToleranceOverride: number | null = null;
  private topAngleOverride: number | null = null;

  constructor(private config: RepEngineConfig) {}

  setHipTolerance(tolerance: number): void {
    this.hipToleranceOverride = tolerance;
  }

  /**
   * Locks the engine to the user's actual extended top pose, measured during
   * calibration. A camera angle that reads full arm extension below the fixed
   * value (e.g. 155deg vs 162deg) blocks the engine from ever re-entering TOP,
   * so reps never finalize. Clamped for safety.
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
      bottomThreshold: this.config.bottomAngle + s * (14 - 10 * s),
      hipTolerance: baseTol * (1 + (1 - s) * 0.35),
    };
  }

  status(): RepEngineStatus {
    return {
      state: this.state,
      phase: this.phase,
      elbowAngle: this.lastAngle,
      minAngleThisRep: this.minAngle,
      maxExtensionThisRep: this.maxAngleSinceBottom > 0 ? this.maxAngleSinceBottom : 0,
      maxAbsHipDev: this.maxAbsHipDev,
      hipSign: this.hipSign,
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
    this.maxAbsHipDev = 0;
    this.hipSign = "FLAT";
    this.confidences = [];
    this.directionChanges = 0;
    this.lastDir = null;
    this.lostAt = null;
    this.inRepFlag = false;
  }

  process(obs: RepObservation): RepEngineEvent[] {
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
      this.lastAngle = obs.elbowAngle;
      return events;
    }

    // ── Recovery from tracking loss ──
    if (this.state === "LOST_TRACKING") {
      if (this.lostAt === null) this.lostAt = t;
      if (t - this.lostAt > 250) {
        const nearBottom = obs.elbowAngle <= bottomThreshold + 20;
        this.state = nearBottom ? "BOTTOM" : "TOP";
        this.phase = nearBottom ? "BOTTOM" : "TOP";
        this.inRepFlag = false;
        this.resetRepMetrics();
        events.push({ type: "RESTORED" });
      }
      this.lastAngle = obs.elbowAngle;
      return events;
    }

    if (this.state === "PAUSED") return events;

    // ── Phase classification with hysteresis ──
    const prevPhase = this.phase;
    if (obs.elbowAngle >= topThreshold - PHASE_MARGIN_DEG) {
      this.phase = "TOP";
    } else if (obs.elbowAngle <= bottomThreshold + PHASE_MARGIN_DEG) {
      this.phase = "BOTTOM";
    } else {
      this.phase = prevPhase === "BOTTOM" || prevPhase === "ASCENDING" ? "ASCENDING" : "DESCENDING";
    }

    // ── Direction change tracking ──
    // Deadband: ignore sub-degree jitter so a noisy elbow angle doesn't register
    // as constant direction reversals (which reads as "INCOMPLETE_MOVEMENT").
    const angle = obs.elbowAngle;
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
      this.maxAbsHipDev = Math.max(this.maxAbsHipDev, Math.abs(obs.hipDeviation));
      const hipSignNow: "SAG" | "PIKE" | "FLAT" =
        obs.hipDeviation > hipTolerance ? "SAG" : obs.hipDeviation < -hipTolerance ? "PIKE" : "FLAT";
      if (hipSignNow !== "FLAT") this.hipSign = hipSignNow;
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
        if (this.phase === "DESCENDING" && angle <= midway(topThreshold, bottomThreshold)) {
          this.state = "DESCENDING";
          this.startRep(angle, t);
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
          // bailed before depth
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
    this.maxAbsHipDev = 0;
    this.hipSign = "FLAT";
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
    this.maxAbsHipDev = 0;
    this.hipSign = "FLAT";
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
    if (avgConf < cfg.confidenceThreshold - 0.15) reasons.push("LOW_CONFIDENCE");
    if (duration < cfg.minRepDuration || duration > cfg.maxRepDuration) reasons.push("UNSTABLE_POSE");
    if (down > 0 && down < cfg.minDownDuration) reasons.push("UNSTABLE_POSE");
    if (up > 0 && up < cfg.minUpDuration) reasons.push("UNSTABLE_POSE");
    if (this.minAngle > cfg.bottomAngle + 12) reasons.push("INSUFFICIENT_DEPTH");
    if (this.maxAngleSinceBottom > -1 && this.maxAngleSinceBottom < th.topThreshold - 14) reasons.push("INCOMPLETE_EXTENSION");
    if (this.maxAbsHipDev > th.hipTolerance * 1.6) reasons.push(this.hipSign === "PIKE" ? "HIP_PIKE" : "HIP_SAG");
    if (this.directionChanges > 6) reasons.push("INCOMPLETE_MOVEMENT");

    const depth = clamp01(normalize(180 - this.minAngle, 0, 180 - cfg.bottomAngle));
    const extension = this.maxAngleSinceBottom > 0 ? clamp01(normalize(this.maxAngleSinceBottom, cfg.bottomAngle, th.topThreshold)) : 0;
    const alignment = this.maxAbsHipDev <= th.hipTolerance ? 1 : clamp01(1 - (this.maxAbsHipDev - th.hipTolerance) / (th.hipTolerance * 1.5));
    const confidence = clamp01(avgConf / 0.85);
    const smoothness = this.directionChanges <= 1 ? 1 : clamp01(2 / this.directionChanges);
    const formScore = Math.round(
      (depth * 0.3 + extension * 0.2 + alignment * 0.2 + confidence * 0.15 + smoothness * 0.15) * 100
    );

    if (reasons.length > 0) {
      const reason = reasons[0];
      return { type: "INVALID_REP", reason, confidence: avgConf, formScore };
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

export function strictnessFactor(label: "RELAXED" | "NORMAL" | "STRICT"): number {
  return label === "RELAXED" ? 0 : label === "STRICT" ? 1 : 0.4;
}