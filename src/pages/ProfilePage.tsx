import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { Badge, Card, ProgressBar, SectionTitle, Stat } from "../components/Primitives";
import { EmptyState } from "../components/Primitives";
import { Button } from "../components/Button";
import { AvatarIcon } from "../components/Primitives";
import { Icon } from "../components/Icons";
import { levelProgress, getPRs, playerOverview, getUserAchievements, getRating } from "../core/progression/ProgressionService";
import { getMatchHistory } from "../core/multiplayer/MatchService";
import { toast } from "../stores/toastStore";
import type { MatchResult, PersonalRecord } from "../types";

function PlayerCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast("ok", "Code copied", "Share it so friends find you.");
    } catch {
      toast("info", "Your code", code);
    }
  }
  return (
    <button type="button" className="code-chip" onClick={() => void copy()} title="Copy player code">
      <span className="mono">{code}</span>
      <Icon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}

export function ProfilePage() {
  const player = useAuthStore((s) => s.player);
  const id = player?.playerId;
  const [lvl, setLvl] = useState<Awaited<ReturnType<typeof levelProgress>> | null>(null);
  const [rating, setRating] = useState<Awaited<ReturnType<typeof getRating>> | null>(null);
  const [prs, setPrs] = useState<PersonalRecord[]>([]);
  const [achCount, setAchCount] = useState(0);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [ov, setOv] = useState<Awaited<ReturnType<typeof playerOverview>> | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void Promise.all([levelProgress(id), getRating(id), getPRs(id), getUserAchievements(id), playerOverview(id), getMatchHistory(id)]).then(([l, r, p, a, o, m]) => {
      if (!alive) return;
      setLvl(l);
      setRating(r);
      setPrs(p);
      setAchCount(a.length);
      setOv(o);
      setMatches(m);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!player) return null;

  return (
    <>
      <Card>
        <div className="row">
          <AvatarIcon name={player.username} size="lg" />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>{player.username}</h3>
            <div className="row">
              <Badge tone="brand">Level {lvl?.currentLevel ?? "—"}</Badge>
              <PlayerCodeChip code={player.playerId} />
              {player.title ? <Badge>{player.title}</Badge> : null}
            </div>
            {lvl ? <ProgressBar value={lvl.xpIntoLevel} max={lvl.xpRequiredForNextLevel} /> : null}
            <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {lvl ? `${lvl.xpIntoLevel}/${lvl.xpRequiredForNextLevel} XP to level ${lvl.currentLevel + 1}` : ""}
            </div>
          </div>
        </div>
        <div className="grid-4" style={{ marginTop: "var(--sp-4)" }}>
          <Stat value={ov?.totalReps ?? 0} label="Lifetime reps" />
          <Stat value={ov?.totalWorkouts ?? 0} label="Workouts" />
          <Stat value={rating?.rating ?? 0} label="Rating" />
          <Stat value={ov?.achievementsCount ?? achCount} label="Achievements" />
        </div>
      </Card>

      <section className="grid-2">
        <Card>
          <SectionTitle title="Competitive record" />
          <div className="grid-3">
            <Stat value={ov?.wins ?? 0} label="Wins" />
            <Stat value={ov?.losses ?? 0} label="Losses" />
            <Stat value={rating?.bestRating ?? 0} label="Peak rating" />
          </div>
          {rating ? (
            <div className="row" style={{ marginTop: "var(--sp-3)" }}>
              <Badge tone="accent">{rating.rank}</Badge>
              <span className="muted">Division {rating.division}</span>
              <span className="muted">wins {rating.wins} · losses {rating.losses}</span>
            </div>
          ) : null}
          {matches.length > 0 ? (
            <div className="stack" style={{ marginTop: "var(--sp-3)" }}>
              {matches.slice(0, 6).map((m) => (
                <div key={m.matchId} className="list-row">
                  <Badge tone={m.winnerId === player.playerId ? "ok" : m.draw ? "default" : "danger"}>{m.winnerId === player.playerId ? "Win" : m.draw ? "Draw" : "Loss"}</Badge>
                  <span className="muted">{new Date(m.endedAt).toLocaleDateString()}</span>
                  <span className="muted mono">{m.participants.map((p) => `${p.reps}`).join(" – ")} reps</span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <SectionTitle title="Personal records" />
          {prs.length === 0 ? (
            <EmptyState title="No PRs yet">
              <p>Set records in training and battles.</p>
            </EmptyState>
          ) : (
            <div className="stack">
              {prs.map((p) => (
                <div key={p.metric} className="row">
                  <div style={{ flex: 1 }}>
                    <strong>{p.metric}</strong>
                    <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {p.achievedAt ? new Date(p.achievedAt).toLocaleDateString() : "—"}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: "var(--fs-xl)", fontWeight: 700 }}>
                    {p.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <div className="row" style={{ justifyContent: "center" }}>
        <Button variant="ghost" onClick={() => alert("Your profile is stored only on this device. Exporting/editing avatars arrives in a later update.")}>
          Edit profile (coming soon)
        </Button>
      </div>
    </>
  );
}