import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card, Stat } from "../components/Primitives";
import { Icon } from "../components/Icons";
import { PoseOverlay } from "../components/PoseOverlay";
import { CameraService } from "../core/cv/CameraService";
import { PoseDetectionService } from "../core/cv/PoseDetectionService";
import { WorkoutSessionManager, type SessionPulse, type WorkoutSessionOptions } from "../core/cv/WorkoutSessionManager";
import { applyWorkoutResult, type WorkoutGrant } from "../core/progression/ProgressionService";
import type { NormalizedLandmark } from "../core/cv/LandmarkMath";
import { useAuthStore } from "../stores/authStore";
import type { ExerciseType, PlayerId, WorkoutMode } from "../types";
import "./pages.css";

type Phase = "SETUP" | "STARTING" | "RUNNING" | "PAUSED" | "FINISHED" | "ERROR";

export function WorkoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const playerId = useAuthStore((s) => s.player?.playerId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<WorkoutSessionManager | null>(null);
  const camRef = useRef<CameraService | null>(null);
  const poseRef = useRef<PoseDetectionService | null>(null);
  const initStarted = useRef(false);

  const mode = (params.get("mode") as WorkoutMode | null) ?? "REP_TARGET";
  const duration = Number(params.get("duration") ?? 60);
  const target = Number(params.get("target") ?? 20);
  const strictness = (params.get("strictness") as "RELAXED" | "NORMAL" | "STRICT" | null) ?? "NORMAL";
  const exercise = (params.get("exercise") as ExerciseType | null) ?? "PUSH_UP";

  const [phase, setPhase] = useState<Phase>("SETUP");
  const [pulse, setPulse] = useState<SessionPulse | null>(null);
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[] | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [grant, setGrant] = useState<WorkoutGrant | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [autoCalibrating, setAutoCalibrating] = useState(false);

  const handlePulse = useCallback(
    (p: SessionPulse) => {
      setPulse(p);
      setAutoCalibrating(p.autoCalibrating);
      setLandmarks(p.landmarks ?? null);
      if (duration > 0 && p.state === "RUNNING" && p.elapsedMs >= duration * 1000 && sessionRef.current) {
        void finishIt(sessionRef.current);
      }
      if (duration === 0 && p.state === "RUNNING" && p.validReps >= target && sessionRef.current) {
        void finishIt(sessionRef.current);
      }
    },
    [duration, target],
  );

  async function finishIt(session: WorkoutSessionManager): Promise<void> {
    if (sessionRef.current !== session) return;
    const result = await session.finish();
    if (playerId) {
      const g = await applyWorkoutResult(playerId, result);
      setGrant(g);
    }
    setPhase("FINISHED");
  }

  const startLiveSession = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || phase !== "SETUP") return;
    setPhase("STARTING");
    try {
      await session.startLive();
      setPhase("RUNNING");
    } catch (e) {
      console.error(e);
      setErr((e as Error).message || "Camera could not start.");
      setPhase("ERROR");
    }
  }, [phase]);

  const wire = useCallback((session: WorkoutSessionManager) => {
    session.onEvent = (e) => {
      if (e.type === "CALIBRATION_COMPLETE") setAutoCalibrating(false);
      if (e.type === "FORM_WARNING") setFeedback(e.message ?? e.code);
      if (e.type === "VALID_REP") setFeedback("Rep counted!");
      if (e.type === "INVALID_REP" && "reason" in e.rep) setFeedback(`${(e.rep as any).reason} - try again`);
    };
  }, []);

  const pauseRun = useCallback(() => {
    sessionRef.current?.pause();
    setPhase("PAUSED");
  }, []);

  const resumeRun = useCallback(() => {
    sessionRef.current?.resume();
    setPhase("RUNNING");
  }, []);

  const stopRun = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      navigate("/train");
      return;
    }
    if (session.getState() === "RUNNING" || session.getState() === "PAUSED") {
      await finishIt(session);
      setPhase("FINISHED");
    } else {
      navigate("/train");
    }
  }, [navigate]);

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;
    const video = videoRef.current;
    if (!video || !playerId) return;
    let disposed = false;

    void (async () => {
      try {
        const cam = new CameraService();
        const pose = new PoseDetectionService();
        camRef.current = cam;
        poseRef.current = pose;
        const opts: WorkoutSessionOptions = {
          playerId: playerId as PlayerId,
          videoElement: video,
          cameraService: cam,
          poseService: pose,
          mode,
          strictness,
          durationSec: duration > 0 ? duration : undefined,
          repTarget: target,
          mirror: true,
          exercise,
        };
        const session = new WorkoutSessionManager(opts);
        session.onPulse = handlePulse;
        wire(session);
        sessionRef.current = session;
        await pose.load();
        if (disposed) return;
        setPhase("SETUP");
      } catch (e) {
        console.error(e);
        setErr((e as Error).message);
        setPhase("ERROR");
      }
    })();

    return () => {
      disposed = true;
      sessionRef.current?.dispose();
      camRef.current?.dispose();
      poseRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  if (!playerId) return null;

  const live = phase === "RUNNING" || phase === "PAUSED";

  return (
    <>
      {/* Start camera button — kept up top, always visible in SETUP */}
      {phase === "SETUP" && (
        <div className="workout-bar" style={{ justifyContent: "center" }}>
          <Button variant="primary" size="lg" onClick={() => void startLiveSession()} style={{ width: "100%", maxWidth: 420 }}>
            <Icon name="camera" size={18} /> Start camera — count reps live
          </Button>
        </div>
      )}
      {phase === "STARTING" && (
        <div className="workout-bar" style={{ justifyContent: "center" }}>
          <span className="hud-pill">Starting camera…</span>
        </div>
      )}

      {/* Single persistent live stage: the same <video> node across SETUP and
          fullscreen, so the camera stream never gets torn down mid-lift. */}
      <div className={live ? "workout-fullscreen" : "live-stage-wrapper"}>
        <div className={live ? "match-live-card" : "match-live-card stage-card"}>
          <video
            ref={videoRef}
            className="workout-video"
            autoPlay
            playsInline
            muted
            style={{ transform: "scaleX(-1)", objectFit: "contain", background: "#000" }}
          />
          {live || phase === "STARTING" ? <PoseOverlay landmarks={landmarks} videoRef={videoRef} /> : null}

          {live && (
            <>
              <div className="workout-fullscreen__top">
                <span className="hud-pill">● {phaseLabel(phase)}</span>
                <span className="hud-pill">
                  {duration > 0 ? fmtTime(duration, pulse?.elapsedMs) : `${target} rep goal`}
                </span>
              </div>

              {autoCalibrating ? (
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 4 }}>
                  <span className="hud-pill">Calibrating… get ready to move</span>
                </div>
              ) : null}

              <div className="big-count">
                <span className="big-count__value">{pulse?.validReps ?? 0}</span>
                <span className="big-count__label">reps</span>
              </div>

              {feedback ? (
                <div style={{ position: "absolute", top: "24%", left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 4 }}>
                  <span className="hud-pill">{feedback}</span>
                </div>
              ) : null}

              <div className="workout-fullscreen__bottom">
                <div className="row" style={{ justifyContent: "center", gap: "var(--sp-2)" }}>
                  <span className="hud-pill">
                    <Icon name="flame" size={16} /> {pulse?.combo ?? 0}
                  </span>
                  <span className="hud-pill">Form {Math.round(pulse?.formAccuracy ?? 0)}%</span>
                </div>
                <div className="workout-fullscreen__actions">
                  {phase === "RUNNING" ? (
                    <Button variant="danger" size="lg" onClick={pauseRun}>
                      <Icon name="pause" size={18} /> Pause
                    </Button>
                  ) : (
                    <Button variant="primary" size="lg" onClick={resumeRun}>
                      <Icon name="play" size={18} /> Resume
                    </Button>
                  )}
                  <Button variant="ghost" size="lg" onClick={() => void stopRun()}>
                    <Icon name="stop" size={16} /> Finish
                  </Button>
                </div>
              </div>
            </>
          )}

          {phase === "STARTING" && (
            <div className="overlay-hud" style={{ justifyContent: "center", alignItems: "center" }}>
              <span className="hud-pill">Starting camera…</span>
            </div>
          )}
        </div>
      </div>

      {/* Setup info */}
      {phase === "SETUP" && (
        <Card>
          <p style={{ margin: 0 }}>
            {exercise === "SQUAT"
              ? "Stand tall so your whole body is visible. The moment you press start the camera opens and every squat counts live."
              : "Get into a plank position so your whole body is visible. The moment you press start the camera opens and every push-up counts live."}
          </p>
          <p style={{ margin: "var(--sp-2) 0 0", fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
            No setup pose needed — the engine calibrates itself in the background while you train. Every rep is verified against your form.
          </p>
        </Card>
      )}

      {/* Error card */}
      {phase === "ERROR" && (
        <Card>
          <h3>Unable to start camera</h3>
          <p>{err}</p>
          <div className="row">
            <Button variant="primary" onClick={() => window.location.reload()}>Retry</Button>
            <Button variant="ghost" onClick={() => navigate("/train")}>Back</Button>
          </div>
        </Card>
      )}

      {/* Finished card */}
      {phase === "FINISHED" && grant && (
        <Card>
          <h3>Session complete</h3>
          <div className="grid-4">
            <Stat value={grant.xpTransactions.reduce((a, x) => a + x.amount, 0)} label="XP earned" />
            <Stat value={grant.levelUps.length} label="Level ups" />
            <Stat value={grant.newPRs.length} label="New PRs" />
            <Stat value={grant.streak.current} label={`Streak (${grant.streak.best} best)`} />
          </div>
          {grant.newAchievements.length > 0 && (
            <p>
              <Icon name="trophy" size={16} /> Achievements: {grant.newAchievements.map((a) => a.achievementId).join(", ")}
            </p>
          )}
          <div className="row">
            <Button variant="primary" onClick={() => navigate("/")}>Done</Button>
            <Button variant="ghost" onClick={() => window.location.reload()}>Train again</Button>
          </div>
        </Card>
      )}
    </>
  );
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case "SETUP": return "Setup";
    case "STARTING": return "Starting...";
    case "RUNNING": return "Live";
    case "PAUSED": return "Paused";
    case "FINISHED": return "Finished";
    case "ERROR": return "Error";
  }
}

function fmtTime(total: number, elapsed?: number): string {
  const left = Math.max(0, (elapsed ?? 0) >= total * 1000 ? 0 : total - (elapsed ?? 0) / 1000);
  const s = Math.ceil(left);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}