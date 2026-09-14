// PoseDetectionService: registers @mediapipe/tasks-vision PoseLandmarker and
// detects poses on video frames on the main thread (with adaptive throttling).
// Structured so it can be moved into a Worker later without changing callers.

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { MEDIAPIPE } from "../../config/cv";
import type { NormalizedLandmark } from "./LandmarkMath";

export interface DetectionFrame {
  landmarks: NormalizedLandmark[];
  numPoses: number;
  timestamp: number;
  inferenceMs: number;
}

export type DetectionResult =
  | { kind: "PERSON"; frame: DetectionFrame }
  | { kind: "NO_PERSON"; timestamp: number; inferenceMs: number };

export class PoseDetectionService {
  private landmarker: PoseLandmarker | null = null;
  private loadingPromise: Promise<void> | null = null;
  ready = false;
  private lastVideoTime = -1;

  /** Loads model + wasm. Safe to call multiple times. */
  async load(): Promise<void> {
    if (this.loadingPromise || this.ready) return this.loadingPromise ?? Promise.resolve();
    this.loadingPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE.wasmRoot);
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MEDIAPIPE.poseModel,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 2,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.ready = true;
    })();
    return this.loadingPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Detect pose in the given video element. Returns null when the video frame
   * hasn't advanced since the last call (avoids re-inferencing identical frames).
   *
   * MediaPipe's VIDEO mode requires strictly monotonically increasing
   * timestamps measured on the video clock (proportional to presentation time),
   * so we use `video.currentTime * 1000` rather than wall/performance clocks —
   * mismatched timestamps make landmark tracking "pop" and miss detections.
   */
  detect(video: HTMLVideoElement, _timestamp: number): DetectionResult | null {
    if (!this.landmarker || !this.ready || !video.videoWidth) return null;
    const videoTime = video.currentTime * 1000;
    if (videoTime <= this.lastVideoTime) return null;
    this.lastVideoTime = videoTime;
    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(video, videoTime);
    } catch {
      return { kind: "NO_PERSON", timestamp: videoTime, inferenceMs: performance.now() - t0 };
    }
    const inferenceMs = performance.now() - t0;
    const landmarks = result.landmarks ?? [];
    if (landmarks.length === 0) return { kind: "NO_PERSON", timestamp: videoTime, inferenceMs };
    const frame: DetectionFrame = {
      landmarks: (landmarks[0] ?? []).map((lm, i) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z ?? 0,
        visibility: i < 33 ? (lm.visibility ?? 0.9) : 0.9,
      })),
      numPoses: landmarks.length,
      timestamp: videoTime,
      inferenceMs,
    };
    return { kind: "PERSON", frame };
  }

  dispose(): void {
    try {
      this.landmarker?.close();
    } catch {
      // already closed
    }
    this.landmarker = null;
    this.ready = false;
    this.loadingPromise = null;
  }
}

export type PoseEventPub = (event: string, payload?: unknown) => void;