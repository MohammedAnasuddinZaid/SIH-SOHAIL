import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { InstallButton } from "../components/InstallButton";
import { Badge, Card, ProgressBar, Stat } from "../components/Primitives";
import { SectionTitle } from "../components/Primitives";
import { Icon } from "../components/Icons";
import { branding } from "../config/branding";
import { useAuthStore } from "../stores/authStore";
import { playerOverview } from "../core/progression/ProgressionService";
import { levelProgress } from "../core/progression/ProgressionService";
import "./pages.css";

type Overview = Awaited<ReturnType<typeof playerOverview>>;

export function Dashboard() {
  const player = useAuthStore((s) => s.player);
  const navigate = useNavigate();
  const [ov, setOv] = useState<Overview | null>(null);
  const playerId = player?.playerId;

  useEffect(() => {
    let alive = true;
    if (!playerId) return;
    void playerOverview(playerId).then((o) => {
      if (alive) setOv(o);
    });
    return () => {
      alive = false;
    };
  }, [playerId]);

  const [lvl, setLvl] = useState<Awaited<ReturnType<typeof levelProgress>> | null>(null);
  useEffect(() => {
    let alive = true;
    if (!playerId) return;
    void levelProgress(playerId).then((l) => alive && setLvl(l));
    return () => {
      alive = false;
    };
  }, [playerId]);

  return (
    <>
      <section className="home-hero">
        <Badge tone="brand">Private · On-device · Competitive</Badge>
        <h1 style={{ marginTop: "var(--sp-3)" }}>
          Turn every push-up into a <span className="grad-text">competition</span>.
        </h1>
        <p style={{ maxWidth: 560 }}>
          {branding.APP_DESCRIPTION} Your camera counts your reps with computer vision, awards XP, ranks and trophies, and
          puts you head-to-head against friends - your data never leaves this device.
        </p>
        <div className="hero-buttons">
          <Button variant="primary" size="lg" onClick={() => navigate("/train")}>
            <Icon name="dumbbell" size={18} /> Start training
          </Button>
          <Button variant="accent" size="lg" onClick={() => navigate("/battle")}>
            <Icon name="zap" size={18} /> Battle now
          </Button>
          <Button variant="ghost" size="lg" onClick={() => navigate("/coach")}>
            <Icon name="chat" size={18} /> Meet your coach
          </Button>
          <InstallButton size="lg" />
        </div>
      </section>

      {ov ? (
        <>
          <section className="grid-4">
            <Card pad="sm">
              <Stat value={lvl ? `${lvl.currentLevel}` : "·"} label={`Level · ${player?.username ?? "me"}`} />
              {lvl ? <ProgressBar value={lvl.xpIntoLevel} max={lvl.xpRequiredForNextLevel} className="mt-0" /> : null}
              <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-2)" }}>
                {lvl ? `${lvl.xpIntoLevel}/${lvl.xpRequiredForNextLevel} XP` : ""}
              </div>
            </Card>
            <Card pad="sm">
              <Stat value={ov.todayReps} label="Reps today" />
              <Stat value={`${ov.streak.current}d`} label={`Streak · best ${ov.streak.best}d`} />
            </Card>
            <Card pad="sm">
              <Stat value={ov.bestFormAvg > 0 ? `${ov.bestFormAvg}%` : "·"} label="Best form avg" />
              <Stat value={ov.bestSessionReps} label="Best session reps" />
            </Card>
            <Card pad="sm">
              <Stat value={ov.rating.rating} label={`Rating · ${ov.rankDisplay}`} />
              <Stat value={ov.wins + ov.losses} label={`Battles (${ov.wins}W/${ov.losses}L)`} />
            </Card>
          </section>

          <section className="grid-2">
            <Card>
              <SectionTitle
                title="Today's quests"
                aside={
                  <Button variant="ghost" size="sm" onClick={() => navigate("/leaderboard")}>
                    Leaderboard →
                  </Button>
                }
              />
              <div className="stack">
                {ov.quests.length === 0 ? (
                  <p className="muted">No daily quests yet - finish a workout to seed them.</p>
                ) : (
                  ov.quests.slice(0, 3).map((q) => (
                    <div key={q.id} className="row">
                      <div style={{ flex: 1 }}>
                        <div className="row">
                          <span>{q.title}</span>
                          <Badge tone={q.completed ? "ok" : "default"}>{q.completed ? "Done" : "PENDING"}</Badge>
                        </div>
                        <ProgressBar value={q.progress} max={q.target} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle title="Recent highlights" />
              <div className="stack">
                {ov.events.length === 0 ? (
                  <p className="muted">Your first XP event will appear here.</p>
                ) : (
                  ov.events.slice(0, 6).map((e) => (
                    <div key={e.id} className="row">
                      <Badge tone={(e.amount ?? 0) > 0 ? "ok" : "default"}>+{e.amount ?? 0} XP</Badge>
                      <span style={{ color: "var(--text-1)" }}>{labelForEvent(e.type, e.metadata ?? {})}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </section>

          <div className="row" style={{ justifyContent: "center" }}>
            <Button variant="ghost" size="sm" onClick={() => navigate("/profile")}>
              View full profile →
            </Button>
            <Link to="/battle" style={{ fontSize: "var(--fs-sm)" }}>
              How Battles work
            </Link>
          </div>
        </>
      ) : (
        <p className="muted">Loading your arena…</p>
      )}
    </>
  );
}

function labelForEvent(type: string, meta: Record<string, unknown>): string {
  const map: Record<string, string> = {
    WORKOUT_COMPLETED: "Workout completed",
    VALID_REP: "Validated rep bonus",
    FORM_MILESTONE: "Form milestone",
    PERSONAL_RECORD: "New personal record",
    BATTLE_WIN: "Battle won",
    BATTLE_DRAW: "Battle drawn",
    BATTLE_PARTICIPATION: "Battle played",
    QUEST_COMPLETED: "Quest completed",
    ACHIEVEMENT_UNLOCKED: "Achievement unlocked",
    STREAK_MILESTONE: "Streak milestone",
    SEASON_MILESTONE: "Season milestone",
    FIRST_WORKOUT: "First workout",
    FIRST_BATTLE: "First battle",
    DAILY_GOAL: "Daily goal hit",
    WEEKLY_GOAL: "Weekly goal hit",
    FIRST_FRIEND: "First friend",
    LEVEL_UP_BONUS: "Level up bonus",
  };
  void meta;
  return map[type] ?? type;
}