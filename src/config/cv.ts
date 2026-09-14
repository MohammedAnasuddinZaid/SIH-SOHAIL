// Centralized computer-vision configuration. Every magic number for the CV
// engine lives here so the system can be tuned without touching logic.

export interface CVConfiguration {
  // pose detection
  poseConfidenceThreshold: number;
  landmarkVisibilityThreshold: number;
  singlePersonThreshold: number;
  multiPersonThreshold: number;

  // angles (degrees)
  topElbowAngle: number;
  bottomElbowAngle: number;

  // rep timing (ms)
  minRepDuration: number;
  maxRepDuration: number;
  minDownDuration: number;
  minUpDuration: number;

  // alignment
  hipAlignmentTolerance: number; // fraction of torso length allowed off body line
  elbowWidthFactor: number;

  // smoothing
  smoothingFactor: number; // EMA alpha 0..1
  smoothingLatencyMs: number;

  // feedback
  feedbackCooldownMs: number;

  // processing
  adaptiveTargetFps: number;
  minProcessingIntervalMs: number;

  // form scoring weights (sum ~1.0)
  weights: {
    depth: number;
    extension: number;
    alignment: number;
    elbow: number;
    confidence: number;
    consistency: number;
  };
}

export const cvConfig: CVConfiguration = {
  poseConfidenceThreshold: 0.5,
  landmarkVisibilityThreshold: 0.55,
  singlePersonThreshold: 0.6,
  multiPersonThreshold: 0.7,

  topElbowAngle: 162,
  bottomElbowAngle: 88,

  minRepDuration: 380,
  maxRepDuration: 6000,
  minDownDuration: 120,
  minUpDuration: 120,

  hipAlignmentTolerance: 0.22,
  elbowWidthFactor: 1.4,

  smoothingFactor: 0.55,
  smoothingLatencyMs: 60,

  feedbackCooldownMs: 1800,

  adaptiveTargetFps: 30,
  minProcessingIntervalMs: 33,

  weights: {
    depth: 0.3,
    extension: 0.2,
    alignment: 0.2,
    elbow: 0.1,
    confidence: 0.1,
    consistency: 0.1,
  },
};

// MediaPipe model assets
export const MEDIAPIPE = {
  wasmRoot:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  // The "full" landmarker is noticeably more accurate at joint positions and
  // elbow angles than "lite", which matters for reliable rep validation.
  poseModel:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

// Required landmarks for push-up tracking (indices used by MediaPipe Pose).
export const TRACKED_LANDMARKS: Record<string, number> = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

// Important landmarks for push-up validity (used for "must be visible" checks)
export const REQUIRED_LANDMARKS = [
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
] as const;