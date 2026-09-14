// CameraService: wraps getUserMedia with a clean state machine and error handling.

export type CameraState =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "ERROR"
  | "STOPPED";

export type CameraErrorCode =
  | "CAMERA_PERMISSION_DENIED"
  | "CAMERA_NOT_FOUND"
  | "CAMERA_IN_USE"
  | "CAMERA_UNAVAILABLE"
  | "NOT_SUPPORTED"
  | "UNKNOWN";

export class CameraError extends Error {
  constructor(public code: CameraErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CameraError";
  }
}

export interface CameraCapability {
  devices: MediaDeviceInfo[];
  facingMode: string | null;
}

export class CameraService {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  state: CameraState = "IDLE";
  lastError: CameraError | null = null;
  private preferredDeviceId: string | undefined;
  private mirror = true;

  constructor(opts?: { deviceId?: string; mirror?: boolean }) {
    this.preferredDeviceId = opts?.deviceId;
    this.mirror = opts?.mirror ?? true;
  }

  attachVideoElement(video: HTMLVideoElement): void {
    this.videoEl = video;
  }

  setMirror(mirror: boolean): void {
    this.mirror = mirror;
    if (this.videoEl) {
      this.videoEl.style.transform = mirror ? "scaleX(-1)" : "none";
    }
  }

  getCameraState(): CameraState {
    return this.state;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoEl;
  }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "videoinput");
    } catch {
      return [];
    }
  }

  async initialize(opts?: { deviceId?: string; mirror?: boolean }): Promise<void> {
    if (opts?.deviceId) this.preferredDeviceId = opts.deviceId;
    if (opts?.mirror !== undefined) this.mirror = opts.mirror;
    if (this.videoEl) this.setMirror(this.mirror);
  }

  async start(): Promise<HTMLVideoElement> {
    if (this.state === "RUNNING") return this.videoElement();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw this.fail(new CameraError("NOT_SUPPORTED", "Camera not supported in this browser."));
    }
    this.state = "REQUESTING_PERMISSION";
    try {
      const constraints: MediaStreamConstraints = {
        video: this.preferredDeviceId
          ? { deviceId: { exact: this.preferredDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
          : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if ((err as DOMException)?.name === "NotAllowedError" || (err as DOMException)?.name === "PermissionDeniedError") {
        throw this.fail(new CameraError("CAMERA_PERMISSION_DENIED", "Camera permission was denied."));
      }
      if ((err as DOMException)?.name === "NotFoundError" || (err as DOMException)?.name === "OverconstrainedError") {
        throw this.fail(new CameraError("CAMERA_NOT_FOUND", "No camera was found."));
      }
      if ((err as DOMException)?.name === "NotReadableError") {
        throw this.fail(new CameraError("CAMERA_IN_USE", "The camera is in use by another app."));
      }
      throw this.fail(new CameraError("CAMERA_UNAVAILABLE", "The camera could not be started."));
    }
    const video = this.videoElement();
    video.srcObject = this.stream;
    video.playsInline = true;
    video.muted = true;
    this.setMirror(this.mirror);
    await video.play().catch(() => {
      // some browsers require user interaction; handled by caller retry
    });
    if (this.stream && this.stream.getVideoTracks()[0]) {
      const track = this.stream.getVideoTracks()[0];
      this.preferredDeviceId = track.getSettings().deviceId;
    }
    this.state = "RUNNING";
    this.lastError = null;
    return video;
  }

  pause(): void {
    if (this.stream) {
      this.stream.getVideoTracks().forEach((t) => (t.enabled = false));
    }
    this.state = "PAUSED";
  }

  resume(): void {
    if (this.stream) {
      this.stream.getVideoTracks().forEach((t) => (t.enabled = true));
    }
    this.state = "RUNNING";
  }

  async switchCamera(): Promise<void> {
    const devices = await this.listCameras();
    if (devices.length < 2) return;
    const next = devices.find((d) => d.deviceId !== this.preferredDeviceId) ?? devices[0];
    const wasRunning = this.state === "RUNNING";
    this.stop();
    this.preferredDeviceId = next.deviceId;
    if (this.videoEl) this.videoEl.srcObject = null;
    if (wasRunning) await this.start();
  }

  stop(): void {
    if (this.stream) {
      this.stream.getVideoTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    this.state = "STOPPED";
  }

  getVideoStream(): MediaStream | null {
    return this.stream;
  }

  private videoElement(): HTMLVideoElement {
    if (!this.videoEl) throw new Error("Video element not attached.");
    return this.videoEl;
  }

  private fail(err: CameraError): CameraError {
    this.lastError = err;
    this.state = "ERROR";
    return err;
  }

  dispose(): void {
    this.stop();
    this.videoEl = null;
  }
}