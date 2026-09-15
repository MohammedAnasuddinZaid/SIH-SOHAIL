import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Badge, Card, SectionTitle, Stat } from "../components/Primitives";
import { Field } from "../components/Controls";
import { Icon } from "../components/Icons";
import { BATTLE_MODES } from "../config/game";
import { useAuthStore } from "../stores/authStore";
import { toast } from "../stores/toastStore";
import type { BattleMode, ExerciseType, WorkoutMode } from "../types";

const MODE_META: Record<BattleMode, { label: string; desc: string; mode: WorkoutMode }> = {
  REP_RACE: { label: "Rep Race", desc: "Most validated reps wins the round.", mode: "REP_TARGET" },
  TIME_TRIAL: { label: "Time Trial", desc: "Rep target on a clock.", mode: "TIME_TRIAL" },
  FIRST_TO: { label: "First to X", desc: "First to hit the rep target wins.", mode: "REP_TARGET" },
  FFA: { label: "Free For All", desc: "Everyone races, best score wins.", mode: "REP_TARGET" },
  TEAM: { label: "Team Battle", desc: "COMING SOON.", mode: "REP_TARGET" },
  FORM_WARS: { label: "Form Wars", desc: "COMING SOON.", mode: "FORM_TRAINING" },
};

export function TrainPage() {
  const navigate = useNavigate();
  const playerId = useAuthStore((s) => s.player?.playerId);
  const [mode, setMode] = useState<BattleMode>("REP_RACE");
  const [duration, setDuration] = useState(60);
  const [target, setTarget] = useState(20);
  const [strictness, setStrictness] = useState<"RELAXED" | "NORMAL" | "STRICT">("RELAXED");
  const [exercise, setExercise] = useState<ExerciseType>("PUSH_UP");

  const meta = MODE_META[mode];
  const durationChoice = mode === "FIRST_TO" ? 0 : duration; // first-to uses rep target

  function start() {
    if (!playerId) return;
    toast("info", "Opening workout", "Calibrate your pose, then reps count automatically.");
    const params = new URLSearchParams({ mode: meta.mode, duration: String(durationChoice), target: String(target), strictness, exercise });
    navigate(`/workout?${params.toString()}`);
  }

  return (
    <>
      <section>
        <SectionTitle title="Solo training" hint="Your camera detects push-ups or squats in real time. Fully on-device." />
        <div className="grid-3">
          {BATTLE_MODES.map((bm) => {
            const m = MODE_META[bm.id];
            const available = bm.available;
            return (
              <Card key={bm.id} className={mode === bm.id ? "mode-card is-selected" : "mode-card"} style={{ cursor: "pointer" }} onClick={() => available && setMode(bm.id)}>
                <div className="row">
                  <h3 style={{ margin: 0 }}>{m.label}</h3>
                  {!available ? <Badge tone="accent">Soon</Badge> : mode === bm.id ? <Badge tone="brand">Selected</Badge> : null}
                </div>
                <p style={{ color: available ? "var(--text-1)" : "var(--text-3)" }}>{m.desc}</p>
                {available && mode === bm.id ? (
                  <div className="row">
                    <Stat value={durationChoice > 0 ? `${duration}s` : "until goal"} label="Round" />
                    <Stat value={target} label="Rep target" />
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>

      <Card>
        <SectionTitle title="Round settings" />
        <div className="grid-2">
          <Field label="Exercise">
            <select className="field__control" value={exercise} onChange={(e) => setExercise(e.target.value as ExerciseType)}>
              <option value="PUSH_UP">Push-Ups</option>
              <option value="SQUAT">Squats</option>
            </select>
          </Field>
          <Field label="Duration (seconds)">
            <select className="field__control" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[30, 60, 90, 120, 180].map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rep target">
            <select className="field__control" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {[10, 15, 20, 25, 30, 40, 50].map((t) => (
                <option key={t} value={t}>
                  {t} reps
                </option>
              ))}
            </select>
          </Field>
          <Field label="Form strictness">
            <select className="field__control" value={strictness} onChange={(e) => setStrictness(e.target.value as "RELAXED" | "NORMAL" | "STRICT")}>
              <option value="RELAXED">Relaxed - every rep counts</option>
              <option value="NORMAL">Normal - balanced standard</option>
              <option value="STRICT">Strict - deep, clean reps only</option>
            </select>
          </Field>
        </div>
        <div className="row" style={{ marginTop: "var(--sp-4)" }}>
          <Button variant="primary" size="lg" onClick={start}>
            <Icon name="play" size={18} /> Start workout
          </Button>
          <Button variant="ghost" onClick={() => navigate("/battle")}>
            Or take it online →
          </Button>
        </div>
      </Card>
    </>
  );
}