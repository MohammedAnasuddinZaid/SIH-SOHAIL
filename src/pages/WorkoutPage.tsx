import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card, Stat } from "../components/Primitives";
import { Icon } from "../components/Icons";
import { CameraService } from "../core/cv/CameraService";
import { PoseDetectionService } from "../core/cv/PoseDetectionService";
import { WorkoutSessionManager, type SessionPulse, type WorkoutSessionOptions } from "../core/cv/WorkoutSessionManager";
import { applyWorkoutResult, type WorkoutGrant } from "../core/progression/ProgressionService";
import { useAuthStore } from "../stores/authStore";
import type { ExerciseType, PlayerId, WorkoutMode } from "../types";
import "./pages.css";

type Phase = "SETUP" | "CALIBRATING" | "READY" | "RUNNING" | "PAUSED" | "FINISHED" | "ERROR";

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
  const [calProgress, setCalProgress] = useState(0);
  const [pulse, setPulse] = useState<SessionPulse | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [grant, setGrant] = useState<WorkoutGrant | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handlePulse = useCallback((p: SessionPulse) => {
    setPulse(p);
    if (duration > 0 && p.state === "RUNNING" && p.elapsedMs >= duration * 1000 && sessionRef.current) {
      void finishIt(sessionRef.current);
    }
    if (duration === 0 && p.state === "RUNNING" && p.validReps >= target && sessionRef.current) {
      void finishIt(sessionRef.current);
    }
  }, [duration, target]);

  async function finishIt(session: WorkoutSessionManager): Promise<void> {
    if (sessionRef.current !== session) return;
    const result = await session.finish();
    if (playerId) {
      const g = await applyWorkoutResult(playerId, result);
      setGrant(g);
    }
    setPhase("FINISHED");
  }

  const startCalibration = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || phase !== "SETUP") return;
    setPhase("CALIBRATING");
    try {
      await session.startCalibration();
      setPhase("READY");
    } catch (e) {
      console.error(e);
      setErr((e as Error).message || "Camera could not start. Grant camera permission and try again.");
      setPhase("ERROR");
    }
  }, [phase]);

  // wire page controls to session events
  const wire = useCallback((session: WorkoutSessionManager) => {
    session.onEvent = (e) => {
      if (e.type === "CALIBRATION_PROGRESS") setCalProgress(e.progress);
      if (e.type === "FORM_WARNING") setFeedback(e.message ?? e.code);
      if (e.type === "VALID_REP") setFeedback("Rep counted ✓");
    };
  }, []);

  const startRun = useCallback(() => {
    const session = sessionRef.current;
    if (!session || phase !== "READY") return;
    setCountdown(3);
    let c = 3;
    const iv = window.setInterval(() => {
      c -= 1;
      if (c <= 0) {
        window.clearInterval(iv);
        setCountdown(null);
        session.start();
        setPhase("RUNNING");
        return;
      }
      setCountdown(c);
    }, 1000);
  }, [phase]);

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

  // init once
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
        // warm the model early
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

  return (
    <div className="stack">
      <div className="match-live-card">
        <video ref={videoRef} className={phase === "SETUP" || phase === "CALIBRATING" || phase === "READY" || phase === "RUNNING" || phase === "PAUSED" ? "" : "hidden-video"} autoPlay playsInline muted style={{ transform: "scaleX(-1)" }} />
        {phase !== "FINISHED" && phase !== "ERROR" ? (
          <div className="overlay-hud">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="hud-pill">● {phaseLabel(phase)}</span>
              <span className="hud-pill">{duration > 0 ? fmtTime(duration, pulse?.elapsedMs) : `${target} rep goal`}</span>
            </div>
            {phase === "RUNNING" || phase === "PAUSED" ? (
              <>
                <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "center" }}>
                  <div className="hud-pill" style={{ fontSize: "1.15rem" }}>Reps {pulse?.validReps ?? 0}</div>
                  <div className="hud-pill" style={{ fontSize: "1.15rem" }}><Icon name="flame" size={16} /> {pulse?.combo ?? 0}</div>
                  <div className="hud-pill" style={{ fontSize: "1.15rem" }}>Form {Math.round(pulse?.formAccuracy ?? 0)}%</div>
                </div>
                {feedback ? <div className="hud-pill" style={{ margin: "0 auto" }}>{feedback}</div> : null}
                <div className="row" style={{ justifyContent: "center" }}>
                  {phase === "RUNNING" ? <Button variant="danger" size="sm" onClick={pauseRun}><Icon name="pause" size={16} /> Pause</Button> : <Button variant="primary" size="sm" onClick={resumeRun}><Icon name="play" size={16} /> Resume</Button>}
                  <Button variant="ghost" size="sm" onClick={() => void stopRun()}><Icon name="stop" size={14} /> Finish</Button>
                </div>
              </>
            ) : null}
            {phase === "CALIBRATING" ? (
              <div style={{ alignSelf: "center" }}>
                <div className="hud-pill">Calibrating your pose… {Math.round(calProgress * 100)}%</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {phase === "SETUP" ? (
        <Card>
          <h3>How a session works</h3>
          <p>
            {exercise === "SQUAT"
              ? "First your pose is calibrated — stand tall in your squat (top) position and hold for a moment. Then you get a 3-second countdown and the engine counts validated squats by tracking your knee depth and torso control. Your camera feed is processed entirely on this device."
              : "First your pose is calibrated — get into an extended plank (top) position and hold it for a moment. Then you get a 3-second countdown and the engine counts validated push-ups. Your camera feed is processed entirely on this device."}
          </p>
          <div className="row">
            <Button variant="primary" onClick={() => void startCalibration()}>Start calibration</Button>
            <Button variant="ghost" onClick={() => navigate("/train")}>Change settings</Button>
          </div>
        </Card>
      ) : null}

      {phase === "READY" ? (
        <Card>
          <h3>Pose calibrated</h3>
          <p>Engine ready. Your camera has your pose locked. You get {countdown !== null ? countdown : ""} seconds — then go.</p>
          <div className="row">
            <Button variant="primary" size="lg" onClick={startRun}><Icon name="play" size={18} /> Go ({countdown ?? 3})</Button>
            <Button variant="ghost" onClick={() => navigate("/train")}>Back</Button>
          </div>
        </Card>
      ) : null}

      {phase === "ERROR" ? (
        <Card>
          <h3>Unable to start camera</h3>
          <p>{err}</p>
          <div className="row">
            <Button variant="primary" onClick={() => window.location.reload()}>Retry</Button>
            <Button variant="ghost" onClick={() => navigate("/train")}>Back</Button>
          </div>
        </Card>
      ) : null}

      {phase === "FINISHED" && grant ? (
        <Card>
          <h3>Session complete</h3>
          <div className="grid-4">
            <Stat value={grant.xpTransactions.reduce((a, x) => a + x.amount, 0)} label="XP earned" />
            <Stat value={grant.levelUps.length} label="Level ups" />
            <Stat value={grant.newPRs.length} label="New PRs" />
            <Stat value={grant.streak.current} label={`Streak (${grant.streak.best} best)`} />
          </div>
          {grant.newAchievements.length > 0 ? (
            <p>
              <Icon name="trophy" size={16} /> Achievements: {grant.newAchievements.map((a) => a.achievementId).join(", ")}
            </p>
          ) : null}
          <div className="row">
            <Button variant="primary" onClick={() => navigate("/")}>Done</Button>
            <Button variant="ghost" onClick={() => window.location.reload()}>Train again</Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function phaseLabel(p: Phase): string {
  return p === "SETUP" ? "Setup" : p === "CALIBRATING" ? "Calibrating" : p === "READY" ? "Ready" : p === "RUNNING" ? "Live" : p === "PAUSED" ? "Paused" : p;
}

function fmtTime(total: number, elapsed?: number): string {
  const left = Math.max(0, (elapsed ?? 0) >= total * 1000 ? 0 : total - (elapsed ?? 0) / 1000);
  const s = Math.ceil(left);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}