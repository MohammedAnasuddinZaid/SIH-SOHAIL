// Pure vector/geometry math for pose analysis. No DOM dependencies so these
// can be unit-tested deterministically.

export interface Vec2 {
  x: number;
  y: number;
}

export interface NormalizedLandmark extends Vec2 {
  z: number;
  visibility: number;
}

/** Angle in degrees at vertex `b` formed by rays a→b and c→b (0..180). */
export function angleDeg(a: Vec2, b: Vec2, c: Vec2): number {
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;
  const dot = baX * bcX + baY * bcY;
  const magAB = Math.hypot(baX, baY);
  const magBC = Math.hypot(bcX, bcY);
  if (magAB === 0 || magBC === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (magAB * magBC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function normalize(value: number, min: number, max: number, fallback = 0.5): number {
  if (max <= min) return fallback;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Signed deviation of point P from the line A→B, normalized by segment length.
 * Positive = P is above the line (when working in screen coords where y grows
 * downward, above is smaller y); we define sign so that positive means the hip
 * is raised relative to the shoulder→ankle line and negative means sagging.
 */
export function lineDeviation(segmentA: Vec2, segmentB: Vec2, point: Vec2): number {
  const lx = segmentB.x - segmentA.x;
  const ly = segmentB.y - segmentA.y;
  const len = Math.hypot(lx, ly);
  if (len === 0) return 0;
  // cross product: (B-A) x (P-A)
  const cross = lx * (point.y - segmentA.y) - ly * (point.x - segmentA.x);
  // In screen coords: sag = hip below the line = negative when line runs
  // shoulder→ankle (y increases downward). Positive cross means point is to the
  // "left" of direction; for a downward line that is physically above the line.
  return cross / len;
}

/** Landmark visibility classification. */
export type LandmarkConfidence = "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE" | "MISSING";

export function classifyVisibility(visibility: number, high: number, medium: number, low: number): LandmarkConfidence {
  if (visibility >= high) return "HIGH_CONFIDENCE";
  if (visibility >= medium) return "MEDIUM_CONFIDENCE";
  if (visibility >= low) return "LOW_CONFIDENCE";
  return "MISSING";
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}