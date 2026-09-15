import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Badge, Card, SectionTitle, Stat } from "../components/Primitives";
import { AvatarIcon } from "../components/Primitives";
import { Field, Modal } from "../components/Controls";
import { Icon } from "../components/Icons";
import { QRCodeView } from "../components/QRCodeView";
import { QRScanner } from "../components/QRScanner";
import { MatchCoordinator, type OngoingMatch, type OpponentDifficulty } from "../core/multiplayer/MatchmakingService";
import { deriveMatchResult, getMatchResult, saveMatchResult } from "../core/multiplayer/MatchService";
import { applyMatchResult } from "../core/progression/ProgressionService";
import { CameraService } from "../core/cv/CameraService";
import { PoseDetectionService } from "../core/cv/PoseDetectionService";
import { WorkoutSessionManager } from "../core/cv/WorkoutSessionManager";
import { PoseOverlay } from "../components/PoseOverlay";
import type { NormalizedLandmark } from "../core/cv/LandmarkMath";
import { useAuthStore } from "../stores/authStore";
import { toast } from "../stores/toastStore";
import { buildRoomJoinUrl, parseRoomCode } from "../core/multiplayer/battleLinks";
import type { ExerciseType, MatchState, PlayerId, RepEvent, WorkoutMode } from "../types";
import "./pages.css";

type BattleExercise = ExerciseType;

export function BattlePage() {
  const playerId = useAuthStore((s) => s.player?.playerId);
  const [params, setParams] = useSearchParams();
  const [ongoing, setOngoing] = useState<OngoingMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [difficulty, setDifficulty] = useState<OpponentDifficulty>("MEDIUM");
  const [exercise, setExercise] = useState<BattleExercise>("PUSH_UP");
  const [scanning, setScanning] = useState(false);
  const autoJoined = useRef(false);

  const startSolo = useCallback(
    async (diff: OpponentDifficulty) => {
      if (!playerId || busy) return;
      setBusy(true);
      try {
        const coordinator = new MatchCoordinator();
        const m = await coordinator.createMatch({ hostId: playerId, difficulty: diff, mode: "REP_RACE", durationSec: 45, repTarget: 20 });
        setOngoing(m);
        toast("info", "Simulation battle", "Your rival is an AI-paced athlete. Invite a real friend any time.");
      } catch (e) {
        toast("danger", "Could not start", (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [playerId, busy],
  );

  const createRoom = useCallback(async () => {
    if (!playerId || busy) return;
    setBusy(true);
    try {
      const coordinator = new MatchCoordinator();
      const m = await coordinator.createMatch({ hostId: playerId, mode: "REP_RACE", durationSec: 60, repTarget: 30 });
      setOngoing(m);
    } catch (e) {
      toast("danger", "Could not create room", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [playerId, busy]);

  const joinByCode = useCallback(
    async (raw: string) => {
      if (!playerId || busy) return;
      const parsed = parseRoomCode(raw);
      if (!parsed) {
        toast("danger", "Invalid code", "Enter the 5-character room code.");
        return;
      }
      setBusy(true);
      try {
        const coordinator = new MatchCoordinator();
        const m = await coordinator.joinMatchByCode(parsed, playerId);
        setOngoing(m);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "ROOM_NOT_FOUND") toast("danger", "Room not found", "Check the code or the link and try again.");
        else toast("danger", "Could not join", msg);
      } finally {
        setBusy(false);
      }
    },
    [playerId, busy],
  );

  // Deep link: /battle?room=CODE auto-joins.
  useEffect(() => {
    const room = params.get("room");
    if (room && playerId && !autoJoined.current && !ongoing) {
      autoJoined.current = true;
      void joinByCode(room);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, playerId, ongoing]);

  if (ongoing) {
    return <LiveBattle ongoing={ongoing} playerId={playerId!} onExit={() => setOngoing(null)} />;
  }

  return (
    <>
      <SectionTitle title="Battle Arena" hint="Rep-counted head-to-head. Invite a friend with a code, link, or QR." />
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
            <Button variant="primary" onClick={() => void startSolo(difficulty)} disabled={busy || !playerId}>
              Start
            </Button>
          </div>
        </Card>
        <Card>
          <h3>
            <Icon name="users" size={18} /> Create a room
          </h3>
          <p className="muted">Host a real match, then share the code, link, or QR with a friend.</p>
          <Field label="Your exercise">
            <select className="field__control" value={exercise} onChange={(e) => setExercise(e.target.value as BattleExercise)}>
              <option value="PUSH_UP">Push-Ups</option>
              <option value="SQUAT">Squats</option>
            </select>
          </Field>
          <Button variant="accent" onClick={() => void createRoom()} disabled={busy || !playerId} block>
            Create private room
          </Button>
        </Card>
        <Card>
          <h3>
            <Icon name="lock" size={18} /> Join a room
          </h3>
          <Field label="Room code">
            <input
              className="field__control mono"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCDE"
              maxLength={8}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </Field>
          <div className="row" style={{ marginTop: "var(--sp-3)" }}>
            <Button variant="primary" onClick={() => void joinByCode(code)} disabled={busy || !playerId || code.trim().length < 4}>
              Join
            </Button>
            <Button variant="ghost" onClick={() => setScanning(true)} disabled={busy || !playerId}>
              <Icon name="camera" size={16} /> Scan QR
            </Button>
          </div>
        </Card>
      </div>
      <Card>
        <h3>How real battles work here</h3>
        <p>
          A room is <strong>host-authoritative</strong>: the host's device validates every rep event. Join from another phone/laptop using
          the room code. On the same machine, use a private/incognito window so each tab gets its own identity. For cross-device play the
          client uses the included WebSocket relay; if it is unreachable it falls back to same-browser sync.
        </p>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
          Every rep count comes from real on-device computer vision. If the camera can't confirm form, the rep is rejected.
        </p>
      </Card>

      <Modal open={scanning} onClose={() => setScanning(false)} title="Scan room QR">
        {scanning ? (
          <QRScanner
            onResult={(text) => {
              setScanning(false);
              void joinByCode(text);
            }}
            onError={(msg) => {
              toast("danger", "Scanner unavailable", msg);
              setScanning(false);
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

// ───────────────────────────────────────────
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
  const joinedRef = useRef(false);

  const [match, setMatch] = useState<MatchState | null>(ongoing.server?.snapshot() ?? ongoing.client.state);
  const [pulse, setPulse] = useState<{ validReps: number; combo: number; formAccuracy: number; feedback: string | null }>({
    validReps: 0,
    combo: 0,
    formAccuracy: 0,
    feedback: null,
  });
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[] | null>(null);
  const [grant, setGrant] = useState<Awaited<ReturnType<typeof applyMatchResult>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);

  const isHost = !!ongoing.server;
  const joinUrl = buildRoomJoinUrl(ongoing.code);

  const refresh = () => setMatch(ongoing.server?.snapshot() ?? ongoing.client.state);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const iv = window.setInterval(() => refreshRef.current(), 300);
    return () => window.clearInterval(iv);
  }, []);

  // Non-host: ensure we joined the authoritative channel.
  useEffect(() => {
    if (isHost || joinedRef.current) return;
    joinedRef.current = true;
    void ongoing.client.connect().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

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
        toast(
          "ok",
          match.winnerId === playerId ? "Victory!" : !match.winnerId ? "It's a draw" : "Defeat",
          `Final score: ${Object.values(match.finalScores ?? {}).join(" – ")}`,
        );
      } catch (e) {
        toast("danger", "Could not save result", (e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status]);

  // Bring up the player's own camera-based session for local rep detection.
  useEffect(() => {
    if (!match) return;
    if (match.status !== "COUNTDOWN" && match.status !== "LIVE" && match.status !== "LOBBY") return;
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
        session.onPulse = (p) => {
          setLandmarks(p.landmarks ?? null);
          setPulse((prev) => ({
            ...prev,
            validReps: p.validReps,
            combo: p.combo,
            formAccuracy: p.formAccuracy,
          }));
        };
        session.onEvent = (e) => {
          if (e.type === "VALID_REP") {
            setPulse((prev) => ({ ...prev, feedback: "Rep counted!" }));
            const rep = e.rep as RepEvent;
            const base = { repNumber: rep.repNumber, confidence: rep.confidence, formScore: rep.formScore, clientTime: Date.now() };
            if (ongoing.server) {
              ongoing.server.acceptRep({ kind: "SUBMIT_REP", matchId: ongoing.matchId, playerId, seq: ++seqRef.current, ...base });
            } else {
              ongoing.client.submitRep(base);
            }
          }
          if (e.type === "FORM_WARNING") setPulse((prev) => ({ ...prev, feedback: e.message ?? e.code }));
          if (e.type === "INVALID_REP" && "reason" in e.rep) setPulse((prev) => ({ ...prev, feedback: `${(e.rep as RepEvent).reason} — try again` }));
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
    ongoing.client.disconnect();
    onExit();
  }

  const hostStart = () => {
    ongoing.server?.launch();
  };

  const markReady = () => {
    setReady(true);
    ongoing.client.ready();
  };

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      toast("ok", "Link copied", "Share it with your friend.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("danger", "Copy failed", joinUrl);
    }
  }

  const remaining = match?.startAt && Date.now() < match.startAt ? Math.max(0, Math.ceil((match.startAt - Date.now()) / 1000)) : 0;
  const liveLeft = match?.endAt && Date.now() < match.endAt ? Math.max(0, Math.ceil((match.endAt - Date.now()) / 1000)) : 0;
  const me = match?.players.find((p) => p.playerId === playerId);
  const iAmReady = me?.ready || ready;

  return (
    <div className="stack">
      <div className="row">
        {ongoing.simulated ? <Badge tone="danger">SIMULATION - AI-paced rival</Badge> : <Badge tone="info">Live room {ongoing.code}</Badge>}
        <Badge tone="accent">{match?.kind}</Badge>
        {match?.status === "COUNTDOWN" ? <Badge tone="brand">Countdown {remaining}s</Badge> : null}
        {match?.status === "LIVE" ? <Badge tone="ok">LIVE · {liveLeft}s left</Badge> : null}
        {match?.status === "COMPLETED" ? <Badge tone="default">Final</Badge> : null}
      </div>

      {match ? (
        <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          {match.players.map((p) => (
            <Card key={p.playerId} pad="sm" className={p.connected ? "" : "opacity"} style={{ flex: 1, minWidth: 220 }}>
              <div className="row">
                <AvatarIcon name={p.username} size="sm" />
                <div>
                  <strong>{p.username}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {p.playerId === playerId ? "You" : ongoing.simulated?.opponentId === p.playerId ? "SIM" : "Rival"} · {p.ready ? "ready" : "waiting"}
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

      <div className="match-live-card battle-live-card">
        <video ref={videoRef} autoPlay playsInline muted className="workout-video" style={{ transform: "scaleX(-1)", objectFit: "contain", background: "#000" }} />
        <PoseOverlay landmarks={landmarks} videoRef={videoRef} />
        {match?.status === "LIVE" ? (
          <div className="overlay-hud">
            <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "center", flexWrap: "wrap" }}>
              <span className="hud-pill hud-pill--big">My reps {pulse.validReps ?? 0}</span>
              <span className="hud-pill">
                <Icon name="flame" size={14} /> {pulse.combo}
              </span>
              <span className="hud-pill">Form {Math.round(pulse.formAccuracy)}%</span>
            </div>
            {pulse.feedback ? (
              <div className="hud-pill" style={{ margin: "0 auto" }}>
                {pulse.feedback}
              </div>
            ) : null}
          </div>
        ) : match?.status === "COUNTDOWN" || match?.status === "LOBBY" ? (
          <div className="overlay-hud">
            <div style={{ display: "flex", gap: "var(--sp-4)", justifyContent: "center", flexWrap: "wrap" }}>
              <span className="hud-pill">My reps {pulse.validReps ?? 0}</span>
            </div>
          </div>
        ) : null}
      </div>

      {match?.status === "LOBBY" ? (
        <Card>
          <h3>Invite your rival</h3>
          <div className="qr-share">
            <div className="qr-share__code">
              <span className="field__label">Room code</span>
              <span className="qr-share__code-value">{ongoing.code}</span>
              <span className="qr-share__link">{joinUrl}</span>
              <div className="row" style={{ marginTop: "var(--sp-2)" }}>
                <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
                  <Icon name="external" size={14} /> {copied ? "Copied!" : "Copy invite link"}
                </Button>
              </div>
            </div>
            <QRCodeView value={joinUrl} size={168} className="qr-code-view" alt={`Join room ${ongoing.code}`} />
          </div>
          <p className="muted" style={{ marginTop: "var(--sp-3)" }}>
            Have your friend open the link, type the code, or scan this QR on their phone. Both players hit ready to start.
          </p>
          <div className="row">
            {isHost ? (
              <Button variant="primary" size="lg" onClick={hostStart} disabled={!iAmReady || (match.players.filter((p) => p.connected).length < 2 && !ongoing.simulated)}>
                <Icon name="play" size={18} /> Start match
              </Button>
            ) : null}
            {!iAmReady ? (
              <Button variant={isHost ? "ghost" : "primary"} size="lg" onClick={markReady}>
                <Icon name="check" size={18} /> I'm ready
              </Button>
            ) : (
              <Badge tone="ok">You're ready</Badge>
            )}
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
            <Stat value={grant.rating ? `${grant.rating.change >= 0 ? "+" : ""}${grant.rating.change}` : "·"} label="Rating" />
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