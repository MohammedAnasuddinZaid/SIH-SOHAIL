// WorkoutSessionManager: orchestrates the full workout pipeline:
// camera → pose detection → smoothing → geometry → rep engine → combo →
// feedback → timeline → downloadable result. UI-agnostic: it emits typed events.

import { CameraService, CameraError, type CameraErrorCode } from "./CameraService";
import { PoseDetectionService } from "./PoseDetectionService";
import { LandmarkSmoother, MedianFilter } from "./LandmarkSmoother";
import { analyzeGeometry, type BodySide, type GeometryObservation } from "./BodyGeometry";
import { PushUpRepEngine, strictnessFactor, type RepEngineEvent, type RepEngineStatus as PushUpStatus } from "./PushUpRepEngine";
import { SquatRepEngine, type RepEngineStatus as SquatStatus } from "./SquatRepEngine";
import { FeedbackManager, FEEDBACK_LIBRARY, type FeedbackMessage } from "./FeedbackManager";
import { ComboEngine, type ComboSnapshot } from "../game/ComboEngine";
import { cvConfig } from "../../config/cv";
import { createId } from "../storage/StorageService";
import type {
  PlayerId,
  WorkoutMode,
  WorkoutResult,
  RepEvent,
  RepTimelineEntry,
  InvalidRepReason,
  ExerciseType,
} from "../../types";

export type WorkoutSessionState =
  | "CREATED"
  | "CALIBRATING"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "FINISHED"
  | "CANCELLED"
  | "ERROR";

export type SessionRuntimeEvent =
  | { type: "POSE_DETECTED"; confidence: number }
  | { type: "POSE_LOST" }
  | { type: "CALIBRATION_STARTED" }
  | { type: "CALIBRATION_PROGRESS"; progress: number }
  | { type: "CALIBRATION_COMPLETE"; profile: CalibrationProfile }
  | { type: "CAMERA_READY" }
  | { type: "VALID_REP"; rep: RepEvent; combo: ComboSnapshot }
  | { type: "INVALID_REP"; rep: RepEvent; combo: ComboSnapshot }
  | { type: "FORM_WARNING"; code: string; message?: string }
  | { type: "SESSION_PAUSED" }
  | { type: "SESSION_RESUMED" }
  | { type: "CAMERA_ERROR"; code: CameraErrorCode }
  | { type: "SESSION_COMPLETE"; result: WorkoutResult }
  | { type: "STATUS"; status: PushUpStatus | SquatStatus; geometry: GeometryObservation };

export interface CalibrationProfile {
  observedTopAngle: number;
  observedBottomAngle: number;
  hipTolerance: number;
  orientationScore: number;
  stability: number;
  bodyScale: number;
}

export interface SessionPulse {
  state: WorkoutSessionState;
  validReps: number;
  invalidReps: number;
  combo: number;
  bestCombo: number;
  formAccuracy: number;
  elapsedMs: number;
  width?: number;
  height?: number;
  status?: PushUpStatus | SquatStatus;
  geometry?: GeometryObservation;
}

export interface WorkoutSessionOptions {
  playerId: PlayerId;
  videoElement: HTMLVideoElement;
  cameraService: CameraService;
  poseService: PoseDetectionService;
  mode: WorkoutMode;
  strictness?: "RELAXED" | "NORMAL" | "STRICT";
  durationSec?: number;
  repTarget?: number;
  mirror?: boolean;
  exercise?: ExerciseType;
}

export type EngineKind = "PUSH_UP" | "SQUAT";

export class WorkoutSessionManager {
  private opts: WorkoutSessionOptions;
  private engine: PushUpRepEngine | SquatRepEngine = null as unknown as PushUpRepEngine;
  private get exercise(): EngineKind {
    return this.opts.exercise ?? "PUSH_UP";
  }
  private smoother = new LandmarkSmoother(cvConfig.smoothingFactor);
  private feedback = new FeedbackManager(cvConfig.feedbackCooldownMs);
  private combo = new ComboEngine();
  /** Filters the raw elbow angle so a single noisy frame can't flip a phase. */
  private angleFilter = new MedianFilter(3);
  /**
   * The body side chosen at the start of the session — locked so visibility
   * noise never makes the engine swap between the left/right arm mid-rep.
   */
  private preferredSide: BodySide | null = null;
  private state: WorkoutSessionState = "CREATED";
  private raf = 0;
  private startedAt = 0;
  private endedAt = 0;
  private sessionId = createId("ws");
  private timeline: RepTimelineEntry[] = [];
  private invalidReasons: Partial<Record<InvalidRepReason, number>> = {};
  private profile: CalibrationProfile | null = null;
  private calibrationSamples: number[] = [];
  private lastInferenceMs = 0;
  private width = 0;
  private height = 0;
  private repCount = 0;
  private invalidCount = 0;
  private formScores: number[] = [];
  private repDurations: number[] = [];
  private totalConfidence = 0;
  private confidenceSamples = 0;
  private disposed = false;

  onEvent: (e: SessionRuntimeEvent) => void = () => {};
  onPulse: (p: SessionPulse) => void = () => {};

  constructor(opts: WorkoutSessionOptions) {
    this.opts = opts;
    const strict = strictnessFactor(opts.strictness ?? "NORMAL");
    this.engine =
      this.exercise === "SQUAT"
        ? new SquatRepEngine({
            topAngle: cvConfig.squat.topKneeAngle,
            bottomAngle: cvConfig.squat.bottomKneeAngle,
            minHipAngle: cvConfig.squat.minHipAngle,
            minRepDuration: cvConfig.minRepDuration,
            maxRepDuration: cvConfig.maxRepDuration,
            minDownDuration: cvConfig.minDownDuration,
            minUpDuration: cvConfig.minUpDuration,
            hipTolerance: cvConfig.squat.hipDriftTolerance,
            confidenceThreshold: cvConfig.repEngineConfidenceThreshold,
            strictness: strict,
          })
        : new PushUpRepEngine({
            topAngle: cvConfig.topElbowAngle,
            bottomAngle: cvConfig.bottomElbowAngle,
            minRepDuration: cvConfig.minRepDuration,
            maxRepDuration: cvConfig.maxRepDuration,
            minDownDuration: cvConfig.minDownDuration,
            minUpDuration: cvConfig.minUpDuration,
            hipTolerance: cvConfig.hipAlignmentTolerance,
            confidenceThreshold: cvConfig.repEngineConfidenceThreshold,
            strictness: strict,
          });
  }

  getState(): WorkoutSessionState {
    return this.state;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getRepCount(): number {
    return this.repCount;
  }

  getCombo(): ComboSnapshot {
    return this.combo.snapshot();
  }

  getFeedback(): FeedbackMessage | null {
    return this.feedback.peek();
  }

  // ── Lifecycle ──

  /** Runs camera calibration: collects frames, computes a session profile. */
  async startCalibration(): Promise<CalibrationProfile> {
    this.state = "CALIBRATING";
    this.calibrationSamples = [];
    this.angleFilter.reset();
    this.preferredSide = null;
    this.onEvent({ type: "CALIBRATION_STARTED" });
    await this.ensureCamera();
    await this.ensurePose();
    const profile = await this.collectCalibration();
    this.profile = profile;
    this.engine.reset();
    // Apply calibration-informed tolerances.
    this.engine.setHipTolerance(profile.hipTolerance);
    this.state = "READY";
    this.onEvent({ type: "CALIBRATION_COMPLETE", profile });
    return profile;
  }

  /** Begin the live workout (after countdown). */
  start(): void {
    if (this.state !== "READY" && this.state !== "PAUSED" && this.state !== "RUNNING") return;
    if (this.state === "READY") {
      this.startedAt = performance.now();
      this.engine.reset();
      this.combo.reset();
      this.angleFilter.reset();
      this.timeline = [];
      this.invalidReasons = {};
      this.repCount = 0;
      this.invalidCount = 0;
      this.formScores = [];
      this.repDurations = [];
      this.totalConfidence = 0;
      this.confidenceSamples = 0;
      this.state = "RUNNING";
    }
    if (this.raf === 0 && !this.disposed) this.loop(performance.now());
  }

  pause(): void {
    if (this.state !== "RUNNING") return;
    this.state = "PAUSED";
    this.engine.pause();
    this.onEvent({ type: "SESSION_PAUSED" });
  }

  resume(): void {
    if (this.state !== "PAUSED") return;
    this.state = "RUNNING";
    this.engine.resume();
    this.onEvent({ type: "SESSION_RESUMED" });
    if (this.raf === 0 && !this.disposed) this.loop(performance.now());
  }

  /** End the session and produce a WorkoutResult. */
  async finish(): Promise<WorkoutResult> {
    if (this.state === "FINISHED") return this.emitResult();
    if (this.state === "RUNNING" || this.state === "PAUSED") {
      this.endedAt = performance.now();
      this.state = "FINISHED";
    } else if (this.state === "READY" || this.state === "CALIBRATING" || this.state === "CREATED") {
      this.endedAt = performance.now();
      this.state = "FINISHED";
    }
    this.stopLoop();
    return this.emitResult();
  }

  cancel(): void {
    this.state = "CANCELLED";
    this.stopLoop();
    this.engine.reset();
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.engine.reset();
    this.feedback.reset();
    this.smoother.reset();
  }

  // ── Internals ──

  private async ensureCamera(): Promise<void> {
    try {
      this.opts.cameraService.attachVideoElement(this.opts.videoElement);
      await this.opts.cameraService.initialize({ mirror: this.opts.mirror ?? true });
      await this.opts.cameraService.start();
      const video = this.opts.videoElement;
      this.width = video.videoWidth || 640;
      this.height = video.videoHeight || 480;
      this.onEvent({ type: "CAMERA_READY" });
    } catch (err) {
      const code = err instanceof CameraError ? err.code : ("CAMERA_UNAVAILABLE" as CameraErrorCode);
      this.state = "ERROR";
      this.onEvent({ type: "CAMERA_ERROR", code });
      throw err;
    }
  }

  private async ensurePose(): Promise<void> {
    if (!this.opts.poseService.isReady()) {
      await this.opts.poseService.load();
    }
  }

  private async collectCalibration(): Promise<CalibrationProfile> {
    const start = performance.now();
    const sideCounts: Record<BodySide, number> = { LEFT: 0, RIGHT: 0 };
    while (performance.now() - start < 1800) {
      const t = performance.now();
      const result = this.opts.poseService.detect(this.opts.videoElement, t);
      if (result && result.kind === "PERSON") {
        const geo = analyzeGeometry(this.smoother.smooth(result.frame.landmarks, t), {
          visibilityThreshold: cvConfig.landmarkVisibilityThreshold,
          hipTolerance: cvConfig.hipAlignmentTolerance,
        });
        // Squats are measured by knee bend, push-ups by elbow bend. Calibrating
        // on the wrong joint was why squats often never started counting.
        this.calibrationSamples.push(this.exercise === "SQUAT" ? geo.kneeAngle : geo.elbowAngle);
        if (geo.side) sideCounts[geo.side] += 1;
        if (geo.requiredLandmarksVisible) this.onEvent({ type: "POSE_DETECTED", confidence: geo.trackingConfidence });
        else this.onEvent({ type: "POSE_LOST" });
      } else {
        this.onEvent({ type: "POSE_LOST" });
      }
      await nextFrame();
    }
    const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? this.defaultTopAngle();
    const stability = this.computeStability(sorted);
    // Lock the side that was visible most often during calibration so the
    // engine never flips between the left/right arm mid-rep.
    this.preferredSide =
      sideCounts.LEFT > sideCounts.RIGHT ? "LEFT" : sideCounts.RIGHT > sideCounts.LEFT ? "RIGHT" : null;
    // Bind the engine's TOP threshold to the user's actual standing pose.
    const observedTop = this.clampTopAngle(median);
    this.engine.calibrate(observedTop);
    const profile: CalibrationProfile = {
      observedTopAngle: Math.round(observedTop),
      observedBottomAngle: this.defaultBottomAngle(),
      hipTolerance: cvConfig.hipAlignmentTolerance * (stability > 0.7 ? 1 : 1.2),
      orientationScore: 0.5 + stability * 0.5,
      stability,
      bodyScale: 1,
    };
    void this.onEvent({ type: "CALIBRATION_PROGRESS", progress: 1 });
    return profile;
  }

  private defaultTopAngle(): number {
    return this.exercise === "SQUAT" ? cvConfig.squat.topKneeAngle : cvConfig.topElbowAngle;
  }

  private defaultBottomAngle(): number {
    return this.exercise === "SQUAT" ? cvConfig.squat.bottomKneeAngle : cvConfig.bottomElbowAngle;
  }

  private clampTopAngle(a: number): number {
    if (!Number.isFinite(a)) return this.defaultTopAngle();
    const lo = this.exercise === "SQUAT" ? 110 : 120;
    return Math.max(lo, Math.min(178, a));
  }

  private computeStability(sorted: number[]): number {
    if (sorted.length < 5) return 0.5;
    const mid = Math.floor(sorted.length / 2);
    const q1 = sorted[Math.max(0, mid - Math.floor(sorted.length * 0.25))];
    const q3 = sorted[Math.min(sorted.length - 1, mid + Math.floor(sorted.length * 0.25))];
    const spread = q3 - q1;
    return Math.max(0, Math.min(1, 1 - spread / 30));
  }

  private loop(timestamp: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));

    // adaptive throttling: skip frames if last inference was slow
    const minInterval = this.lastInferenceMs > 40 ? 66 : cvConfig.minProcessingIntervalMs;
    const sinceLast = this.rafAt ? timestamp - this.rafAt : minInterval;
    this.rafAt = timestamp;
    if (sinceLast > 0 && sinceLast < minInterval && this.lastFrameHandled) return;
    this.lastFrameHandled = true;
    this.tick(timestamp);
  }

  private rafAt = 0;
  private lastFrameHandled = false;

  private tick(timestamp: number): void {
    if (this.state !== "RUNNING" && this.state !== "PAUSED") return;
    const video = this.opts.videoElement;
    if (!video || video.videoWidth === 0) return;

    const result = this.opts.poseService.detect(video, timestamp);
    this.lastInferenceMs = result?.kind === "PERSON" ? result.frame.inferenceMs : 0;

    if (this.state === "PAUSED") return;

    if (!result || result.kind !== "PERSON" || (this.opts.poseService as unknown as { ready: boolean }).ready === false) {
      this.onEvent({ type: "POSE_LOST" });
      this.pulse(timestamp);
      return;
    }

    if (result.frame.numPoses > 1) {
      // multiple people — process but flag low confidence
    }

    const landmarks = this.smoother.smooth(result.frame.landmarks, timestamp);
    const geometry = analyzeGeometry(landmarks, {
      visibilityThreshold: cvConfig.landmarkVisibilityThreshold,
      hipTolerance: this.profile?.hipTolerance ?? cvConfig.hipAlignmentTolerance,
      preferredSide: this.preferredSide ?? undefined,
    });

    if (!geometry.requiredLandmarksVisible) {
      this.onEvent({ type: "POSE_LOST" });
      this.emitFeedback("BODY_OUT_OF_FRAME");
      this.pulse(timestamp, geometry);
      return;
    }

    this.onEvent({ type: "POSE_DETECTED", confidence: geometry.trackingConfidence });

    const events = this.processFrame(geometry, timestamp);

    for (const ev of events) this.handleEngineEvent(ev, timestamp);

    this.totalConfidence += geometry.trackingConfidence;
    this.confidenceSamples += 1;

    this.emitWarnings(geometry, events);

    // session duration
    this.pulse(timestamp, geometry);
  }

  /** Builds the engine observation for the active exercise and processes it. */
  private processFrame(geometry: GeometryObservation, timestamp: number): RepEngineEvent[] {
    const engine = this.engine;
    if (engine instanceof SquatRepEngine) {
      return engine.process({
        kneeAngle: geometry.kneeAngle,
        hipAngle: geometry.hipAngle,
        kneeAligned: geometry.kneeAligned,
        hipAligned: geometry.hipAligned,
        trackingConfidence: geometry.trackingConfidence,
        reliable: geometry.requiredLandmarksVisible,
        timestamp,
      });
    }
    return engine.process({
      elbowAngle: geometry.elbowAngle,
      hipDeviation: geometry.hipDeviation,
      hipAligned: geometry.hipAligned,
      trackingConfidence: geometry.trackingConfidence,
      reliable: geometry.requiredLandmarksVisible,
      timestamp,
    });
  }

  private handleEngineEvent(ev: RepEngineEvent, timestamp: number): void {
    switch (ev.type) {
      case "VALID_REP": {
        this.repCount += 1;
        this.formScores.push(ev.formScore);
        this.repDurations.push(ev.duration);
        const combo = this.combo.onValid();
        this.timeline.push({
          repNumber: this.repCount,
          timestamp,
          duration: ev.duration,
          formScore: ev.formScore,
          validity: "VALID",
          confidence: ev.confidence,
        });
        this.onEvent({
          type: "VALID_REP",
          rep: {
            type: "VALID_REP",
            timestamp,
            repNumber: this.repCount,
            formScore: ev.formScore,
            confidence: ev.confidence,
            duration: ev.duration,
            depthScore: ev.depth,
            alignmentScore: ev.alignment,
            extensionScore: ev.extension,
          } satisfies RepEvent,
          combo,
        });
        if (ev.formScore >= 95) this.emitFeedback("PERFECT_FORM");
        else this.emitFeedback("GOOD_REP");
        break;
      }
      case "INVALID_REP": {
        this.invalidCount += 1;
        this.invalidReasons[ev.reason] = (this.invalidReasons[ev.reason] ?? 0) + 1;
        const combo = this.combo.onInvalid();
        this.timeline.push({
          repNumber: this.repCount + this.invalidCount,
          timestamp,
          duration: 0,
          formScore: ev.formScore,
          validity: "INVALID",
          reason: ev.reason,
          confidence: ev.confidence,
        });
        this.onEvent({
          type: "INVALID_REP",
          rep: {
            type: "INVALID_REP",
            timestamp,
            repNumber: this.repCount + this.invalidCount,
            formScore: ev.formScore,
            confidence: ev.confidence,
            reason: ev.reason,
          } satisfies RepEvent,
          combo,
        });
        this.emitFeedback(ev.reason);
        break;
      }
      case "LOST_TRACKING":
        this.emitFeedback("LOST_TRACKING");
        break;
      case "RESTORED":
        this.emitFeedback("GOOD_REP");
        break;
      default:
        break;
    }
  }

  private emitWarnings(geometry: GeometryObservation, events: RepEngineEvent[]): void {
    if (events.length > 0) return;
    const eng = this.engine.status();
    const angle = this.exercise === "SQUAT" ? geometry.kneeAngle : geometry.elbowAngle;
    if (!eng.inRep) {
      // Pre-rep guidance: if body is roughly ready but shallow
      if (this.exercise === "SQUAT") {
        if (angle > -1 && angle < 165) {
          this.feedback.emit({ id: "starting", code: "LOW_CONFIDENCE", message: "Get ready at the top, stand tall", priority: "GENERAL_TIP" });
        }
      } else if (angle > 75 && angle < 150) {
        this.feedback.emit({ id: "starting", code: "LOW_CONFIDENCE", message: "Get ready at the top position", priority: "GENERAL_TIP" });
      }
      return;
    }
    const delta = this.profile ? Math.abs(angle - this.profile.observedTopAngle) : 0;
    void delta;
    if (this.exercise === "SQUAT") {
      if (eng.phase === "BOTTOM") {
        if (!geometry.kneeAligned) this.emitFeedback("KNEE_DRIFT");
        else if (geometry.hipAngle < 75) this.emitFeedback("TORSO_LEAN");
      }
      return;
    }
    if (eng.phase === "BOTTOM" && !geometry.hipAligned) {
      this.emitFeedback(geometry.hipDeviation > 0 ? "HIP_SAG" : "HIP_PIKE");
    }
  }

  private emitFeedback(code: string): void {
    const cfg = FEEDBACK_LIBRARY[code];
    if (!cfg) return;
    const current = this.feedback.emit({ id: code, code, message: cfg.message, priority: cfg.priority });
    if (current) {
      this.onEvent({ type: "FORM_WARNING", code, message: cfg.message });
    }
  }

  private pulse(timestamp: number, geometry?: GeometryObservation): void {
    const duration = this.startedAt ? timestamp - this.startedAt : 0;
    const avgForm = this.formScores.length > 0 ? this.formScores.reduce((a, b) => a + b, 0) / this.formScores.length : 0;
    this.onPulse({
      state: this.state,
      validReps: this.repCount,
      invalidReps: this.invalidCount,
      combo: this.combo.snapshot().combo,
      bestCombo: this.combo.snapshot().bestCombo,
      formAccuracy: Math.round(avgForm * 10) / 10,
      elapsedMs: duration,
      width: this.width,
      height: this.height,
      status: this.engine.status(),
      geometry,
    });
  }

  private emitResult(): WorkoutResult {
    const avgForm = this.formScores.length > 0 ? this.formScores.reduce((a, b) => a + b, 0) / this.formScores.length : 0;
    const bestForm = this.formScores.length > 0 ? Math.max(...this.formScores) : 0;
    const avgDuration = this.repDurations.length > 0 ? this.repDurations.reduce((a, b) => a + b, 0) / this.repDurations.length : 0;
    const fastest = this.repDurations.length > 0 ? Math.min(...this.repDurations) : 0;
    const slowest = this.repDurations.length > 0 ? Math.max(...this.repDurations) : 0;
    const durationSec = this.endedAt ? (this.endedAt - (this.startedAt || this.endedAt)) / 1000 : 0;
    const result: WorkoutResult = {
      sessionId: this.sessionId,
      playerId: this.opts.playerId,
      mode: this.opts.mode,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationSec: Math.max(0, Math.round(durationSec)),
      validReps: this.repCount,
      invalidReps: this.invalidCount,
      formAccuracy: Math.round(avgForm * 10) / 10,
      averageFormScore: Math.round(avgForm * 10) / 10,
      bestFormScore: Math.round(bestForm),
      averageRepDuration: dur(avgDuration),
      fastestRep: dur(fastest),
      slowestRep: dur(slowest),
      bestCombo: this.combo.snapshot().bestCombo,
      repTimeline: this.timeline,
      invalidReasonCounts: { ...this.invalidReasons },
      confidenceSummary: this.confidenceSamples > 0 ? Math.round((this.totalConfidence / this.confidenceSamples) * 100) / 100 : 0,
      xpEarned: 0,
      isPersonalRecord: false,
    };
    this.onEvent({ type: "SESSION_COMPLETE", result });
    return result;
  }

  private stopLoop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }
}

function dur(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}