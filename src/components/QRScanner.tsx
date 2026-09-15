// QRScanner — camera-based QR reader. Used to join a battle room by scanning
// the host's on-screen QR (which encodes the join URL). Falls back gracefully
// when the camera is unavailable.

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export function QRScanner({ onResult, onError }: { onResult: (text: string) => void; onError?: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play().catch(() => {});
        setReady(true);
        tick();
      } catch (e) {
        onError?.((e as Error).message || "Camera unavailable for scanning.");
      }
    })();

    function tick() {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(tick);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState !== v.HAVE_ENOUGH_DATA) return;
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (!w || !h) return;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const code = jsQR(data.data, w, h, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        cancelled = true;
        cancelAnimationFrame(rafRef.current);
        onResult(code.data);
      }
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="qr-scanner">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="qr-scanner__frame" aria-hidden />
      {!ready ? <p className="qr-scanner__hint">Starting camera…</p> : <p className="qr-scanner__hint">Point at the room QR</p>}
    </div>
  );
}