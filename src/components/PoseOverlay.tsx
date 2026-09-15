// PoseOverlay — draws the MediaPipe skeleton on a canvas over the camera feed
// so users can see exactly what the engine is tracking. Mirrors the preview
// horizontally to match the selfie video and compensates for letterboxing when
// the video uses object-fit: contain, so the skeleton always lines up with the
// body even on tall phone screens.

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { GeometryObservation } from "../core/cv/BodyGeometry";
import type { NormalizedLandmark } from "../core/cv/LandmarkMath";

// MediaPipe Pose 33-point topology (subset that matters for push-ups/squats).
const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
];

export function PoseOverlay({
  landmarks,
  videoRef,
  geometry,
  mirror = true,
}: {
  landmarks: NormalizedLandmark[] | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  geometry?: GeometryObservation | null;
  mirror?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    if (!landmarks || landmarks.length < 29) return;

    // Letterboxed drawing rect that matches the video's object-fit: contain.
    const video = videoRef.current;
    const vw = video?.videoWidth || 16;
    const vh = video?.videoHeight || 9;
    const scale = Math.min(w / vw, h / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    const offsetX = (w - drawW) / 2;
    const offsetY = (h - drawH) / 2;

    const px = (i: number) => (mirror ? 1 - landmarks[i].x : landmarks[i].x) * drawW + offsetX;
    const py = (i: number) => landmarks[i].y * drawH + offsetY;
    const visible = (i: number) => (landmarks[i]?.visibility ?? 0) > 0.25;

    // Connections
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.006);
    ctx.strokeStyle = "rgba(255, 122, 26, 0.95)";
    ctx.shadowColor = "rgba(255, 122, 26, 0.6)";
    ctx.shadowBlur = 8;
    for (const [a, b] of POSE_CONNECTIONS) {
      if (!landmarks[a] || !landmarks[b] || !visible(a) || !visible(b)) continue;
      ctx.beginPath();
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
      ctx.stroke();
    }

    // Joints
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    for (let i = 11; i <= 28; i++) {
      if (!landmarks[i] || !visible(i)) continue;
      ctx.beginPath();
      ctx.arc(px(i), py(i), Math.max(3, Math.min(w, h) * 0.009), 0, Math.PI * 2);
      ctx.fill();
    }
  }, [landmarks, geometry, mirror, videoRef]);

  return <canvas ref={canvasRef} className="pose-canvas" />;
}