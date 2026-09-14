import { TRACKED_LANDMARKS } from "../../config/cv";
import { angleDeg, distance, lineDeviation, midpoint, normalize, clamp01 } from "./LandmarkMath";
import type { NormalizedLandmark } from "./LandmarkMath";

export type BodySide = "LEFT" | "RIGHT";
export type BodyOrientation = "SIDE" | "FRONT" | "BACK" | "UNKNOWN";

export interface SelectableSide {
  side: BodySide;
  shoulderIdx: number;
  elbowIdx: number;
  wristIdx: number;
  hipIdx: number;
  kneeIdx: number;
  ankleIdx: number;
}

export const SIDES: Record<BodySide, SelectableSide> = {
  LEFT: {
    side: "LEFT",
    shoulderIdx: TRACKED_LANDMARKS.leftShoulder,
    elbowIdx: TRACKED_LANDMARKS.leftElbow,
    wristIdx: TRACKED_LANDMARKS.leftWrist,
    hipIdx: TRACKED_LANDMARKS.leftHip,
    kneeIdx: TRACKED_LANDMARKS.leftKnee,
    ankleIdx: TRACKED_LANDMARKS.leftAnkle,
  },
  RIGHT: {
    side: "RIGHT",
    shoulderIdx: TRACKED_LANDMARKS.rightShoulder,
    elbowIdx: TRACKED_LANDMARKS.rightElbow,
    wristIdx: TRACKED_LANDMARKS.rightWrist,
    hipIdx: TRACKED_LANDMARKS.rightHip,
    kneeIdx: TRACKED_LANDMARKS.rightKnee,
    ankleIdx: TRACKED_LANDMARKS.rightAnkle,
  },
};

export interface GeometryObservation {
  elbowAngle: number; // 0..180
  hipDeviation: number; // normalized signed deviation
  hipAligned: boolean;
  depthProgress: number; // 0 (top) .. 1 (deep)
  extensionProgress: number; // 0 (deep) .. 1 (full extension)
  trackingConfidence: number; // 0..1
  side: BodySide | null;
  orientation: BodyOrientation;
  orientationScore: number; // 0..1
  shoulderY: number;
  wristY: number;
  requiredLandmarksVisible: boolean;
  bodyWidth: number;
  hipY: number;
  ankleY: number;
  torsoLength: number;
  // Squat-specific angles (computed always; only meaningful for squat tracking)
  kneeAngle: number; // angle at knee: hip–knee–ankle
  hipAngle: number; // angle at hip: shoulder–hip–knee (torso vs thigh)
  kneeAligned: boolean;
}

const SIDE_VIEW_TRACKED = [
  TRACKED_LANDMARKS.leftShoulder,
  TRACKED_LANDMARKS.rightShoulder,
  TRACKED_LANDMARKS.leftElbow,
  TRACKED_LANDMARKS.rightElbow,
  TRACKED_LANDMARKS.leftWrist,
  TRACKED_LANDMARKS.rightWrist,
  TRACKED_LANDMARKS.leftHip,
  TRACKED_LANDMARKS.rightHip,
] as const;

/**
 * Computes the push-up geometry from a 33-landmark frame.
 * Normalized coordinates (0..1, relative to image) — resolution-independent.
 */
export function analyzeGeometry(
  landmarks: NormalizedLandmark[],
  opts: {
    visibilityThreshold?: number;
    hipTolerance?: number;
    /**
     * Preferred body side. When set, that side is used as long as it stays
     * visible enough, which stops the engine from flipping sides mid-rep when
     * the mirror of a side ~ camera flips the visibility sums by a hair.
     */
    preferredSide?: BodySide;
  }
): GeometryObservation {
  const visThreshold = opts.visibilityThreshold ?? 0.55;
  const hipTolerance = opts.hipTolerance ?? 0.22;

  const sideVisible = (s: SelectableSide, min: number): boolean =>
    (landmarks[s.elbowIdx]?.visibility ?? 0) >= min && (landmarks[s.wristIdx]?.visibility ?? 0) >= min && (landmarks[s.shoulderIdx]?.visibility ?? 0) >= min;

  const pickSide = (): SelectableSide | null => {
    const preferred = opts.preferredSide;
    if (preferred && sideVisible(SIDES[preferred], visThreshold)) return SIDES[preferred];
    const leftVis =
      (landmarks[SIDES.LEFT.wristIdx]?.visibility ?? 0) + (landmarks[SIDES.LEFT.elbowIdx]?.visibility ?? 0);
    const rightVis =
      (landmarks[SIDES.RIGHT.wristIdx]?.visibility ?? 0) + (landmarks[SIDES.RIGHT.elbowIdx]?.visibility ?? 0);
    if (leftVis >= visThreshold * 2 && leftVis >= rightVis) return SIDES.LEFT;
    if (rightVis >= visThreshold * 2 && rightVis >= leftVis) return SIDES.RIGHT;
    if (leftVis >= visThreshold) return SIDES.LEFT;
    if (rightVis >= visThreshold) return SIDES.RIGHT;
    return null;
  };

  const requiredVisible = SIDE_VIEW_TRACKED.every((idx) => (landmarks[idx]?.visibility ?? 0) >= visThreshold * 0.8);
  const side = pickSide();
  const s = side ?? SIDES.RIGHT;

  const sh = landmarks[s.shoulderIdx];
  const el = landmarks[s.elbowIdx];
  const wr = landmarks[s.wristIdx];
  const hip = landmarks[s.hipIdx];
  const an = landmarks[s.ankleIdx];

  const exist = (l: NormalizedLandmark | undefined): l is NormalizedLandmark => !!l;
  const elbowAngle = exist(sh) && exist(el) && exist(wr) ? angleDeg(sh, el, wr) : 180;

  const kn = landmarks[s.kneeIdx];
  const kneeAngle = exist(hip) && exist(kn) && exist(an) ? angleDeg(hip, kn, an) : 180;
  const hipAngle = exist(sh) && exist(hip) && exist(kn) ? angleDeg(sh, hip, kn) : 180;
  const kneeAligned = exist(sh) && exist(hip) && exist(kn) ? Math.abs(sh.x - kn.x) * 2 <= torsoScale() : true;

  function torsoScale(): number {
    return Math.max(distance(sh, hip), distance(hip, kn), 0.08);
  }

  const torsoLength =
    exist(sh) && exist(hip)
      ? Math.max(distance(sh, hip), 0.08)
      : exist(sh) && exist(an)
        ? distance(sh, an) * 0.5
        : 0.2;

  const hipDeviation =
    exist(sh) && exist(hip) && exist(an) ? lineDeviation(sh, an, hip) / torsoLength : 0;

  const hipAligned = Math.abs(hipDeviation) <= hipTolerance;

  // Depth: how bent the elbow is (normalized 0 at top/config angle, 1 at/past bottom).
  const depthProgress = normalize(180 - elbowAngle, 180 - 160, 180 - 85, 0);
  const extensionProgress = normalize(elbowAngle, 85, 160, 1);

  // Orientation score: for a side view, shoulders and hips should be roughly perpendicular
  // to the camera's horizontal axis: shoulder-to-hip x distance modest compared to y distance.
  let orientation: BodyOrientation = "UNKNOWN";
  let orientationScore = 0.25;
  if (exist(sh) && exist(hip)) {
    const dx = Math.abs(sh.x - hip.x);
    const dy = Math.abs(sh.y - hip.y);
    const axis = Math.max(0.15, dy / (dy + dx));
    orientationScore = clamp01((axis - 0.35) / 0.45);
    if (axis >= 0.65) orientation = "SIDE";
    else if (axis <= 0.4) orientation = "FRONT";
    else orientation = "SIDE";
  }

  const trackingConfidence =
    (landmarks[s.shoulderIdx]?.visibility ?? 0) * 0.2 +
    (landmarks[s.elbowIdx]?.visibility ?? 0) * 0.35 +
    (landmarks[s.wristIdx]?.visibility ?? 0) * 0.25 +
    (landmarks[s.hipIdx]?.visibility ?? 0) * 0.2;

  const shoulderY = sh?.y ?? 0.5;
  const wristY = wr?.y ?? 0.6;
  const hipY = hip?.y ?? 0.5;
  const ankleY = an?.y ?? 0.8;
  const bodyWidth = distance(sh ?? { x: 0, y: 0 }, hip ?? { x: 0, y: 0 });

  return {
    elbowAngle,
    hipDeviation,
    hipAligned,
    depthProgress,
    extensionProgress,
    trackingConfidence,
    kneeAngle,
    hipAngle,
    kneeAligned,
    side: side ? side.side : null,
    orientation,
    orientationScore,
    shoulderY,
    wristY,
    requiredLandmarksVisible: requiredVisible,
    bodyWidth,
    hipY,
    ankleY,
    torsoLength,
  };
}

export interface NamedFrame {
  shoulder: NormalizedLandmark | undefined;
  elbow: NormalizedLandmark | undefined;
  wrist: NormalizedLandmark | undefined;
  hip: NormalizedLandmark | undefined;
  ankle: NormalizedLandmark | undefined;
  knee: NormalizedLandmark | undefined;
}

export function pickSideSample(landmarks: NormalizedLandmark[], side: BodySide): NamedFrame {
  const s = SIDES[side];
  return {
    shoulder: landmarks[s.shoulderIdx],
    elbow: landmarks[s.elbowIdx],
    wrist: landmarks[s.wristIdx],
    hip: landmarks[s.hipIdx],
    knee: landmarks[s.kneeIdx],
    ankle: landmarks[s.ankleIdx],
  };
}

export function midpointOf(a: NormalizedLandmark | undefined, b: NormalizedLandmark | undefined) {
  if (a && b) return midpoint(a, b);
  return a ?? b;
}

export { midpoint, distance, normalize };