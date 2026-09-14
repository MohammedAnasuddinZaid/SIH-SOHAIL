import type { NormalizedLandmark } from "./LandmarkMath";

/**
 * Exponential moving average smoother for landmark streams.
 * Balances stability vs latency; alpha is configurable.
 *
 * Also applies single-frame spike clamping: a landmark that jumps farther than
 * `clampDistance` (normalized units) in one frame is almost certainly a
 * misdetection, so the previous smoothed value is held instead of chasing the
 * spike. This prevents the elbow angle from "bouncing" for a single noisy frame.
 */
export class LandmarkSmoother {
  private smoothed: Map<number, NormalizedLandmark> = new Map();
  private initialized = false;

  constructor(private alpha: number = 0.55, private clampDistance = 0.3) {}

  setAlpha(alpha: number): void {
    this.alpha = Math.max(0.05, Math.min(0.95, alpha));
  }

  setClampDistance(clamp: number): void {
    this.clampDistance = clamp;
  }

  reset(): void {
    this.smoothed.clear();
    this.initialized = false;
  }

  /** Feed one frame's landmarks; returns the smoothed frame. */
  smooth(landmarks: NormalizedLandmark[], timestamp: number): NormalizedLandmark[] {
    const out: NormalizedLandmark[] = [];
    for (let i = 0; i < 33; i++) {
      const cur = landmarks[i];
      if (!cur) {
        this.smoothed.delete(i);
        out.push({ x: 0, y: 0, z: 0, visibility: 0 });
        continue;
      }
      const prev = this.smoothed.get(i);
      if (!prev || !this.initialized) {
        this.smoothed.set(i, cur);
        out.push(cur);
        continue;
      }
      // Spike veto: hold the smoothed value one frame when the raw sample jumps
      // implausibly far (detector glitch), but still nudge visibility toward it.
      const jump = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const isSpike = jump > this.clampDistance && prev.visibility >= 0.4;
      const held = {
        x: prev.x,
        y: prev.y,
        z: prev.z,
        visibility: prev.visibility + (cur.visibility - prev.visibility) * this.alpha,
      };
      if (isSpike) {
        this.smoothed.set(i, held);
        out.push(held);
        continue;
      }
      // Only smooth the position when visibility is decent; otherwise trust raw.
      const useAlpha = cur.visibility >= 0.4 ? this.alpha : 1;
      const next: NormalizedLandmark = {
        x: prev.x + (cur.x - prev.x) * useAlpha,
        y: prev.y + (cur.y - prev.y) * useAlpha,
        z: prev.z + (cur.z - prev.z) * useAlpha,
        visibility: prev.visibility + (cur.visibility - prev.visibility) * this.alpha,
      };
      this.smoothed.set(i, next);
      out.push(next);
    }
    this.initialized = true;
    void timestamp;
    return out;
  }
}

/** Simple moving-window median filter for a scalar series (jitter removal). */
export class MedianFilter {
  private window: number[] = [];
  constructor(private size = 5) {}

  push(value: number): number {
    this.window.push(value);
    if (this.window.length > this.size) this.window.shift();
    const sorted = [...this.window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  reset(): void {
    this.window = [];
  }
}

/**
 * One Euro Filter — adaptive low-pass that keeps fast movements responsive
 * while smoothing slow jitter. Lightweight scalar implementation.
 */
export class OneEuroFilter {
  private prevRaw = 0;
  private prevFiltered = 0;
  private prevTimestamp: number | null = null;
  private smoothedDerivative = 0;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.007,
    private dCutoff = 1.0
  ) {}

  filter(value: number, timestamp: number): number {
    if (this.prevTimestamp === null) {
      this.prevRaw = value;
      this.prevFiltered = value;
      this.prevTimestamp = timestamp;
      return value;
    }
    const dt = Math.max(1, timestamp - this.prevTimestamp) / 1000;
    const dvalue = (value - this.prevRaw) / dt;
    const alphaD = smoothingFactor(this.dCutoff, dt);
    this.smoothedDerivative = this.smoothedDerivative + alphaD * (dvalue - this.smoothedDerivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.smoothedDerivative);
    const alpha = smoothingFactor(cutoff, dt);
    const filtered = this.prevFiltered + alpha * (value - this.prevFiltered);
    this.prevRaw = value;
    this.prevFiltered = filtered;
    this.prevTimestamp = timestamp;
    return filtered;
  }

  reset(): void {
    this.prevTimestamp = null;
  }
}

function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}