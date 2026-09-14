import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { AvatarIcon, Card, Badge, SectionTitle, EmptyState } from "../components/Primitives";
import { Button } from "../components/Button";
import { Tabs } from "../components/Controls";
import { getLeaderboard, periodRange } from "../core/progression/ProgressionService";
import type { LeaderboardPeriod, LeaderboardScope } from "../types";

export function LeaderboardPage() {
  const playerId = useAuthStore((s) => s.player?.playerId);
  const [period, setPeriod] = useState<LeaderboardPeriod>("DAILY");
  const [scope, setScope] = useState<LeaderboardScope>("GLOBAL");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getLeaderboard>>["rows"]>([]);
  const [you, setYou] = useState<Awaited<ReturnType<typeof getLeaderboard>>["you"] | null>(null);

  useEffect(() => {
    if (!playerId) return;
    let alive = true;
    void getLeaderboard(period, scope, playerId, { top: 50 }).then((l) => {
      if (!alive) return;
      setRows(l.rows);
      setYou(l.you);
    });
    return () => {
      alive = false;
    };
  }, [playerId, period, scope]);

  return (
    <>
      <SectionTitle
        title="Leaderboards"
        hint={`${period} · ${scope === "GLOBAL" ? "Global" : "Friends-only"}`}
        aside={
          <div className="row">
            <Tabs
              options={[
                { id: "DAILY" as LeaderboardPeriod, label: "Daily" },
                { id: "WEEKLY" as LeaderboardPeriod, label: "Weekly" },
                { id: "MONTHLY" as LeaderboardPeriod, label: "Monthly" },
                { id: "ALL_TIME" as LeaderboardPeriod, label: "All time" },
              ]}
              value={period}
              onChange={setPeriod}
            />
            <Tabs
              options={[
                { id: "GLOBAL" as LeaderboardScope, label: "Global" },
                { id: "FRIENDS" as LeaderboardScope, label: "Friends" },
              ]}
              value={scope}
              onChange={setScope}
            />
          </div>
        }
      />

      {you ? (
        <Card pad="sm">
          <div className="row">
            <Badge tone="brand">Your position</Badge>
            <span className="lb-rank">#{you.rank}</span>
            <span className="muted">Score: {you.score} reps</span>
          </div>
        </Card>
      ) : null}

      <Card pad="sm" style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <EmptyState title="No scores yet">
            <p>Complete a workout or battle to climb the board.</p>
          </EmptyState>
        ) : (
          <table className="lb-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Score</th>
                <th>Form</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.playerId}-${period}-${scope}`} className={r.isYou ? "is-me" : ""}>
                  <td className="lb-rank">{r.rank}</td>
                  <td>
                    <span style={{ marginRight: "var(--sp-2)", verticalAlign: "middle" }}>
                      <AvatarIcon name={r.username} size="sm" />
                    </span>
                    {r.username} {r.isYou ? <Badge tone="brand">you</Badge> : null}
                  </td>
                  <td className="mono">{r.score}</td>
                  <td>{Math.round(r.formAccuracy ?? 0)}%</td>
                  <td>{r.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="row">
        <Button variant="ghost" size="sm" onClick={() => alert(`Board window: ${periodRange(period).map((t) => new Date(t).toLocaleDateString()).join(" → ")}`)}>
          Window info
        </Button>
      </div>
    </>
  );
}