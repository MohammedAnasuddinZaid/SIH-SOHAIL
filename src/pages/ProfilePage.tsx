import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { Modal, Field, Toggle } from "../components/Controls";
import { updatePlayer, updateAvatar, updatePrivacy, bindPhone } from "../core/identity/PlayerService";
import { Badge, Card, ProgressBar, SectionTitle, Stat } from "../components/Primitives";
import { EmptyState } from "../components/Primitives";
import { Button } from "../components/Button";
import { AvatarIcon } from "../components/Primitives";
import { Icon } from "../components/Icons";
import { levelProgress, getPRs, playerOverview, getUserAchievements, getRating } from "../core/progression/ProgressionService";
import { getMatchHistory } from "../core/multiplayer/MatchService";
import { toast } from "../stores/toastStore";
import type { MatchResult, PersonalRecord } from "../types";

const AVATAR_ICONS = ["🔥", "⚡", "💪", "🏆", "🥇", "🐺", "🦁", "🐉", "🏃", "🥊", "🛡️", "👑", "🚀", "🎯", "❄️", "🦾"];
const ACCENT_COLORS = ["#f59e0b", "#ef5a10", "#1f6feb", "#0f9d8f", "#d3222e", "#16a34a", "#0d9488", "#e879f9"];
const VISIBILITY_OPTIONS = ["PUBLIC", "FRIENDS", "PRIVATE"] as const;

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
  const [editing, setEditing] = useState(false);
  const [editUsername, setEditUsername] = useState(player?.username ?? "");
  const [editTitle, setEditTitle] = useState(player?.title ?? "");
  const [editPhone, setEditPhone] = useState(player?.phone ?? "");
  const [editIcon, setEditIcon] = useState(player?.avatar?.icon ?? "🔥");
  const [editAccent, setEditAccent] = useState(player?.avatar?.accent ?? "#f59e0b");
  const [editVisibility, setEditVisibility] = useState<"PUBLIC" | "FRIENDS" | "PRIVATE">(
    (player?.privacy?.profile as "PUBLIC" | "FRIENDS" | "PRIVATE") ?? "PUBLIC"
  );
  const [editFriendRequests, setEditFriendRequests] = useState(player?.privacy?.allowFriendRequests ?? true);
  const [editChallenges, setEditChallenges] = useState(player?.privacy?.allowChallenges ?? true);

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

  useEffect(() => {
    if (editing && player) {
      setEditUsername(player.username);
      setEditTitle(player.title ?? "");
      setEditPhone(player.phone ?? "");
      setEditIcon(player.avatar?.icon ?? "🔥");
      setEditAccent(player.avatar?.accent ?? "#f59e0b");
      setEditVisibility((player.privacy?.profile as any) ?? "PUBLIC");
      setEditFriendRequests(player.privacy?.allowFriendRequests ?? true);
      setEditChallenges(player.privacy?.allowChallenges ?? true);
    }
  }, [editing, player]);

  const saveProfile = useCallback(async () => {
    const id = player?.playerId;
    if (!id) return;
    const name = editUsername.trim();
    if (!name) {
      toast("danger", "Username required", "Please enter a username.");
      return;
    }
    try {
      await updatePlayer(id, { username: name, title: editTitle.trim() || undefined });
      if (editPhone.trim().length >= 7) {
        const { linked } = await bindPhone(id, editPhone);
        if (!linked) toast("info", "Phone kept", "That number is already linked to another player here.");
      }
      await updateAvatar(id, { icon: editIcon, accent: editAccent });
      await updatePrivacy(id, {
        profile: editVisibility,
        allowFriendRequests: editFriendRequests,
        allowChallenges: editChallenges,
      });
      await useAuthStore.getState().refreshProfile();
      toast("ok", "Profile saved", "Your profile has been updated.");
      setEditing(false);
    } catch (e) {
      toast("danger", "Save failed", (e as Error).message || "Try again.");
    }
  }, [player, editUsername, editTitle, editPhone, editIcon, editAccent, editVisibility, editFriendRequests, editChallenges]);

  if (!player) return null;

  return (
    <>
      <Card>
        <div className="row">
          <AvatarIcon name={player.username} size="lg" />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>{player.username}</h3>
            <div className="row">
              <Badge tone="brand">Level {lvl?.currentLevel ?? "·"}</Badge>
              <PlayerCodeChip code={player.playerId} />
              {player.phone ? <Badge tone="info">📱 {player.phone}</Badge> : null}
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
                      {p.achievedAt ? new Date(p.achievedAt).toLocaleDateString() : "·"}
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

      <div className="profile-edit-row">
        <Button variant="primary" onClick={() => setEditing(true)}>
          <Icon name="edit" size={16} /> Edit profile
        </Button>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit profile">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Field label="Username">
            <input className="field__control" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} maxLength={24} />
          </Field>
          <Field label="Title (optional)" hint="e.g. The Beast, Push-Up King">
            <input className="field__control" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Mobile number (tracked identity)" hint="Friends search you by this, e.g. +91 98765 43210">
            <input className="field__control" type="tel" inputMode="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Not linked yet" />
          </Field>
          <div>
            <span className="field__label" style={{ marginBottom: "var(--sp-2)", display: "block" }}>Avatar icon</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "6px" }}>
              {AVATAR_ICONS.map((icon) => (
                <button key={icon} type="button" onClick={() => setEditIcon(icon)}
                  style={{
                    padding: "8px",
                    fontSize: "1.2rem",
                    borderRadius: "var(--r-md)",
                    border: editIcon === icon ? "2px solid var(--brand)" : "1px solid var(--border-soft)",
                    background: editIcon === icon ? "var(--warn-dim)" : "var(--bg-2)",
                    cursor: "pointer",
                    transition: "all 120ms",
                  }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="field__label" style={{ marginBottom: "var(--sp-2)", display: "block" }}>Accent color</span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {ACCENT_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setEditAccent(c)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: c,
                    border: editAccent === c ? "3px solid var(--text-0)" : "2px solid transparent",
                    cursor: "pointer",
                    boxShadow: editAccent === c ? "0 0 0 2px var(--surface)" : "none",
                    transition: "all 120ms",
                  }} />
              ))}
            </div>
          </div>
          <div>
            <span className="field__label" style={{ marginBottom: "var(--sp-2)", display: "block" }}>Profile visibility</span>
            <div className="tabs" role="tablist">
              {VISIBILITY_OPTIONS.map((v) => (
                <button key={v} role="tab" aria-selected={editVisibility === v}
                  className={`tabs__btn ${editVisibility === v ? "is-active" : ""}`}
                  onClick={() => setEditVisibility(v)}>
                  {v === "PUBLIC" ? "Public" : v === "FRIENDS" ? "Friends" : "Private"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="field__label">Allow friend requests</span>
            <Toggle on={editFriendRequests} onChange={setEditFriendRequests} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="field__label">Allow challenges</span>
            <Toggle on={editChallenges} onChange={setEditChallenges} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: "var(--sp-3)", marginTop: "var(--sp-2)" }}>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveProfile}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}