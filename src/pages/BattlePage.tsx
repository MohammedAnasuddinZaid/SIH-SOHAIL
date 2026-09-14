import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Badge, Card, SectionTitle, Stat } from "../components/Primitives";
import { AvatarIcon } from "../components/Primitives";
import { Field } from "../components/Controls";
import { Icon } from "../components/Icons";
import { MatchCoordinator, type OngoingMatch, type OpponentDifficulty } from "../core/multiplayer/MatchmakingService";
import { deriveMatchResult, getMatchResult, saveMatchResult } from "../core/multiplayer/MatchService";
import { applyMatchResult } from "../core/progression/ProgressionService";
import { CameraService } from "../core/cv/CameraService";
import { PoseDetectionService } from "../core/cv/PoseDetectionService";
import { WorkoutSessionManager } from "../core/cv/WorkoutSessionManager";
import { useAuthStore } from "../stores/authStore";
import { toast } from "../stores/toastStore";
import type { MatchState, PlayerId, RepEvent, WorkoutMode } from "../types";
import "./pages.css";

export function BattlePage() {
  const playerId = useAuthStore((s) => s.player?.playerId);
  const [ongoing, setOngoing] = useState<OngoingMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [difficulty, setDifficulty] = useState<OpponentDifficulty>("MEDIUM");

  async function createSolo() {
    if (!playerId || busy) return;
    setBusy(true);
    try {
      const coordinator = new MatchCoordinator(false);
      const m = await coordinator.createMatch({ hostId: playerId, difficulty, mode: "REP_RACE", durationSec: 45, repTarget: 20 });
      setOngoing(m);
      toast("info", "SIMULATION battle", "Your rival is an AI-paced athlete. Real battles need a second player in another tab/device.");
    } catch (e) {
      toast("danger", "Could not start", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    if (!playerId || busy) return;
    setBusy(true);
    try {
      const coordinator = new MatchCoordinator(false);
      const m = await coordinator.createMatch({ hostId: playerId, mode: "REP_RACE", durationSec: 60, repTarget: 30 });
      setOngoing(m);
    } catch (e) {
      toast("danger", "Could not create room", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinByCode() {
    if (!playerId || busy || code.trim().length < 4) return;
    setBusy(true);
    try {
      const coordinator = new MatchCoordinator(false);
      const m = await coordinator.joinMatchByCode(code.trim().toUpperCase(), playerId);
      setOngoing(m);
    } catch (e) {
      toast("danger", "Could not join", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (ongoing) {
    return <LiveBattle ongoing={ongoing} playerId={playerId!} onExit={() => setOngoing(null)} />;
  }

  return (
    <>
      <SectionTitle title="Battle Arena" hint="Push-up competition in real time. Your reps are your score." />
      <div className="grid-3">
        <Card>
          <h3>
            <Icon name="zap" size={18} /> Quick solo battle
          </h3>
          <p className="muted">Face an AI-paced opponent to sharpen your race skills.</p>
          <Field label="Rival difficulty">
            <select className="field__control" value={difficulty} onChange={(e) => setDifficulty(e.target.value as OpponentDifficulty)}>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </Field>
          <div className="row" style={{ marginTop: "var(--sp-3)" }}>
            <Badge tone="danger">SIMULATION</Badge>
            <Button variant="primary" onClick={() => void createSolo()} disabled={busy || !playerId}>
              Start
            </Button>
          </div>
        </Card>
        <Card>
          <h3>
            <Icon name="users" size={18} /> Create a room
          </h3>
          <p className="muted">
            Host a real match. Give the code to a friend — they join on this device in a <strong>private/incognito window</strong>, or via
            the relay server on another device. Both of you must be ready.
          </p>
          <Button variant="accent" onClick={() => void createRoom()} disabled={busy || !playerId} block>
            Create private room
          </Button>
        </Card>
        <Card>
          <h3>
            <Icon name="lock" size={18} /> Join a room
          </h3>
          <Field label="Room code">
            <input className="field__control mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE" maxLength={6} />
          </Field>
          <div className="row" style={{ marginTop: "var(--sp-3)" }}>
            <Button variant="primary" onClick={() => void joinByCode()} disabled={busy || !playerId || code.trim().length < 4}>
              Join
            </Button>
          </div>
        </Card>
      </div>
      <Card>
        <h3>How real battles work here</h3>
        <p>
          REP ARENA is offline-first: there is no central game server yet. A room runs <strong>host-authoritative</strong> — the host’s tab
          validates every rep event. Two tabs on the same machine need to be in <strong>different browser contexts</strong> (e.g. normal +
          incognito) so each can sign in as a different player. For cross-device play you can run the relay server included in this repo.
        </p>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
          Every rep count is produced by real on-device computer vision. When the camera can’t confirm form, the rep is rejected — no animal gets free points.
        </p>
      </Card>
    </>
  );
}

// ────────────────────────────────────────────
// Live battle (host or challenger)
// ────────────────────────────────────────────

interface LiveProps {
  ongoing: OngoingMatch;
  playerId: PlayerId;
  onExit: () => void;
}

function LiveBattle({ ongoing, playerId, onExit }: LiveProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<WorkoutSessionManager | null>(null);
  const camRef = useRef<CameraService | null>(null);
  const poseRef = useRef<PoseDetectionService | null>(null);
  const seqRef = useRef(0);
  const appliedRef = useRef(false);
  const simStartedRef = useRef(false);

  const [match, setMatch] = useState<MatchState | null>(ongoing.server?.snapshot() ?? ongoing.client.state);
  const [pulse, setPulse] = useState<{ validReps: number; combo: number; formAccuracy: number; feedback: string | null }>({ validReps: 0, combo: 0, formAccuracy: 0, feedback: null });
  const [grant, setGrant] = useState<Awaited<ReturnType<typeof applyMatchResult>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isHost = !!ongoing.server;

  // Poll authoritative state.
  const refresh = () => {
    setMatch(ongoing.server?.snapshot() ?? ongoing.client.state);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const iv = window.setInterval(() => refreshRef.current(), 400);
    return () => window.clearInterval(iv);
  }, []);

  // Sim start + auto start for solo host
  useEffect(() => {
    if (!match || match.status !== "LIVE" || simStartedRef.current) return;
    if (ongoing.simulated) {
      simStartedRef.current = true;
      ongoing.simulated.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status, ongoing]);

  // Complete flow
  useEffect(() => {
    if (!match || match.status !== "COMPLETED" || appliedRef.current) return;
    appliedRef.current = true;
    ongoing.simulated?.stop();
    void (async () => {
      try {
        const result = deriveMatchResult(match);
        await saveMatchResult(result);
        const existing = await getMatchResult(result.matchId);
        if (!existing) await saveMatchResult(result);
        const g = await applyMatchResult(playerId, result);
        setGrant(g);
        toast("ok", match.winnerId === playerId ? "Victory!" : !match.winnerId ? "It's a draw" : "Defeat", `Final score: ${Object.values(match.finalScores ?? {}).join(" – ")}`);
      } catch (e) {
        toast("danger", "Could not save result", (e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status]);

  // Bring up the player's own camera-based session for local rep detection.
  useEffect(() => {
    if (!match) return;
    if (match.status !== "COUNTDOWN" && match.status !== "LIVE") return;
    if (sessionRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    void (async () => {
      try {
        const cam = new CameraService();
        const pose = new PoseDetectionService();
        camRef.current = cam;
        poseRef.current = pose;
        const session = new WorkoutSessionManager({
          playerId,
          videoElement: video,
          cameraService: cam,
          poseService: pose,
          mode: (match.mode as WorkoutMode) ?? "REP_RACE",
          strictness: "NORMAL",
          durationSec: match.durationSec,
          repTarget: match.repTarget,
          mirror: true,
        });
        session.onPulse = (p) => setPulse((prev) => ({ ...prev, validReps: p.validReps, combo: p.combo, formAccuracy: p.formAccuracy }));
        session.onEvent = (e) => {
          if (e.type === "CALIBRATION_COMPLETE") {
            if (match.status === "COUNTDOWN" || match.status === "LIVE") session.start();
          }
          if (e.type === "FORM_WARNING") setPulse((prev) => ({ ...prev, feedback: e.message ?? e.code }));
          if (e.type === "VALID_REP") {
            setPulse((prev) => ({ ...prev, feedback: "Rep locked in ✓" }));
            const rep = e.rep as RepEvent;
            const base = { repNumber: rep.repNumber, confidence: rep.confidence, formScore: rep.formScore, clientTime: Date.now() };
            if (ongoing.server) {
              ongoing.server.acceptRep({ kind: "SUBMIT_REP", matchId: ongoing.matchId, playerId, seq: ++seqRef.current, ...base });
            } else {
              ongoing.client.submitRep(base);
            }
          }
        };
        sessionRef.current = session;
        await session.startCalibration();
        if (disposed) return;

      } catch (e) {
        console.error(e);
        setErr((e as Error).message);
      }
    })();
    return () => {
      disposed = true;
      sessionRef.current?.dispose();
      camRef.current?.dispose();
      poseRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id]);

  function stopSession() {
    ongoing.simulated?.stop();
    sessionRef.current?.dispose();
    onExit();
  }

  const hostStart = () => {
    ongoing.server?.launch();
  };

  const remaining = match?.startAt && Date.now() < match.startAt ? Math.max(0, Math.ceil((match.startAt - Date.now()) / 1000)) : 0;
  const liveLeft = match?.endAt && Date.now() < match.endAt ? Math.max(0, Math.ceil((match.endAt - Date.now()) / 1000)) : 0;

  return (
    <div className="stack">
      <div className="row">
        {ongoing.simulated ? <Badge tone="danger">SIMULATION — AI-paced rival</Badge> : <Badge tone="info">Live room {ongoing.code}</Badge>}
        <Badge tone="accent">{match?.kind}</Badge>
        {match?.status === "COUNTDOWN" ? <Badge tone="brand">Countdown {remaining}s</Badge> : null}
        {match?.status === "LIVE" ? <Badge tone="ok">LIVE · {liveLeft}s left</Badge> : null}
        {match?.status === "COMPLETED" ? <Badge tone="default">Final</Badge> : null}
      </div>

      {match ? (
        <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          {match.players.map((p) => (
            <Card key={p.playerId} pad="sm" className={p.connected ? "" : "opacity"}>
              <div className="row">
                <AvatarIcon name={p.username} size="sm" />
                <div>
                  <strong>{p.username}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {p.playerId === playerId ? "You" : ongoing.simulated?.opponentId === p.playerId ? "SIM" : "Rival"}
                  </div>
                </div>
                <div style={{ flex: 1, textAlign: "right" }}>
                  <span className="mono" style={{ fontSize: "var(--fs-3xl)", fontWeight: 700 }}>
                    {p.reps}
                  </span>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    form {Math.round(p.formScore)}% · combo {p.combo}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="match-live-card">
        <video ref={videoRef} autoPlay playsInline muted style={{ transform: "scaleX(-1)" }} />
        {(match?.status === "COUNTDOWN" || match?.status === "LIVE") && !sessionRef.current ? (
          <div className="overlay-hud">
            <div className="row" style={{ justifyContent: "center" }}>
              <span className="hud-pill">Preparing camera…</span>
            </div>
          </div>
        ) : null}
        {match?.status === "LIVE" ? (
          <div className="overlay-hud">
            <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "center" }}>
              <span className="hud-pill">My reps {pulse.validReps ?? 0}</span>
              <span className="hud-pill"><Icon name="flame" size={14} /> {pulse.combo}</span>
              <span className="hud-pill">Form {Math.round(pulse.formAccuracy)}%</span>
            </div>
            {pulse.feedback ? <div className="hud-pill" style={{ margin: "0 auto" }}>{pulse.feedback}</div> : null}
          </div>
        ) : null}
      </div>

      {match?.status === "LOBBY" && isHost ? (
        <Card>
          <h3>Room ready</h3>
          <p>
            Code: <span className="mono" style={{ fontSize: "var(--fs-2xl)", fontWeight: 700 }}>{ongoing.code}</span>
          </p>
          <p className="muted">
            {ongoing.simulated
              ? "Your simulated rival is warming up. Start when ready."
              : "Open this URL in a different browser context (incognito window), sign in as another player, and join with this code. Both players should hit ready."}
          </p>
          <div className="row">
            <Button variant="primary" size="lg" onClick={hostStart}>
              <Icon name="play" size={18} /> Start match
            </Button>
            <Button variant="ghost" onClick={stopSession}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {match?.status === "COUNTDOWN" || match?.status === "LIVE" ? (
        <div className="row" style={{ justifyContent: "center" }}>
          <Button variant="danger" onClick={stopSession}>
            Quit battle
          </Button>
        </div>
      ) : null}

      {err ? (
        <Card>
          <h3>Camera issue</h3>
          <p>{err}</p>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </Card>
      ) : null}

      {match?.status === "COMPLETED" && grant ? (
        <Card>
          <h3>{match.winnerId === playerId ? "You win!" : !match.winnerId ? "It's a draw" : "Defeat"}</h3>
          <div className="grid-4">
            <Stat value={grant.xpTransactions.reduce((a, x) => a + x.amount, 0)} label="XP earned" />
            <Stat value={grant.rating ? `${grant.rating.change >= 0 ? "+" : ""}${grant.rating.change}` : "—"} label="Rating" />
            <Stat value={grant.newPRs.length} label="New PRs" />
            <Stat value={grant.levelUps.length} label="Level ups" />
          </div>
          <div className="row" style={{ marginTop: "var(--sp-3)" }}>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Battle again
            </Button>
            <Button variant="ghost" onClick={() => onExit()}>
              Back to arena
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}