import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Badge, Card, SectionTitle } from "../components/Primitives";
import { Icon, type IconName } from "../components/Icons";
import { COACH_PERSONALITIES } from "../config/aiCoach";
import { coachChat, coachOpeningReview, clearCoachMemory, type CoachReply } from "../core/coach/AICoachService";
import { getSettings, setPersonality } from "../core/identity/PlayerService";
import { useAuthStore } from "../stores/authStore";
import { toast } from "../stores/toastStore";
import type { AICoachMessage, CoachPersonalityId } from "../types";
import "./pages.css";

export function CoachPage() {
  const playerId = useAuthStore((s) => s.player?.playerId);
  const [messages, setMessages] = useState<AICoachMessage[]>([]);
  const [personality, setPersonalityState] = useState<CoachPersonalityId>("SUPPORTIVE");
  const [busy, setBusy] = useState(false);
  const [backend, setBackend] = useState<"LOCAL" | "API" | null>(null);
  const [input, setInput] = useState("");
  const booted = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (booted.current || !playerId) return;
    booted.current = true;
    void (async () => {
      const settings = await getSettings(playerId);
      setPersonalityState(settings.coachPersonality);
      const opening = await coachOpeningReview(playerId, settings.coachPersonality);
      if (opening) {
        setMessages((m) => [...m, opening.message]);
        setBackend(opening.usedBackend);
      }
    })();
  }, [playerId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function switchPersonality(p: CoachPersonalityId) {
    if (busy || p === personality) return;
    setPersonalityState(p);
    if (playerId) {
      void setPersonality(playerId, p);
      toast("info", COACH_PERSONALITIES[p].name, COACH_PERSONALITIES[p].tagline);
    }
  }

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy || !playerId) return;
    setInput("");
    setBusy(true);
    const userMsg: AICoachMessage = { id: `u_${Date.now()}`, role: "user", content: t, createdAt: Date.now() };
    setMessages((m) => [...m, userMsg]);
    try {
      const reply: CoachReply = await coachChat(playerId, personality, t);
      setMessages((m) => [...m, reply.message]);
      setBackend(reply.usedBackend);
    } catch (e) {
      toast("danger", "Coach unavailable", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!playerId) return;
    await clearCoachMemory(playerId);
    setMessages([]);
    setBackend(null);
    const opening = await coachOpeningReview(playerId, personality);
    if (opening) {
      setMessages([opening.message]);
      setBackend(opening.usedBackend);
    }
    toast("ok", "Memory cleared", "The coach starts fresh.");
  }

  const persona = COACH_PERSONALITIES[personality];

  return (
    <>
      <SectionTitle
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <Icon name={persona.icon as IconName} size={20} />
            <span>{persona.name} - your AI coach</span>
          </span>
        }
        hint={persona.description}
        aside={
          <div className="row">
            {backend ? <Badge tone={backend === "API" ? "accent" : "ok"}>{backend === "API" ? "Model backend" : "On-device engine"}</Badge> : null}
            <Button variant="ghost" size="sm" onClick={() => void reset()}>
              Reset
            </Button>
          </div>
        }
      />

      <div className="row">
        {(Object.keys(COACH_PERSONALITIES) as CoachPersonalityId[]).map((id) => {
          const p = COACH_PERSONALITIES[id];
          return (
            <Button key={id} variant={personality === id ? "primary" : "ghost"} size="sm" onClick={() => switchPersonality(id)}>
              <Icon name={p.icon as IconName} size={16} /> {p.name}
            </Button>
          );
        })}
      </div>

      <Card pad="sm" style={{ marginTop: "var(--sp-3)" }}>
        <div className="row" style={{ fontSize: "var(--fs-sm)" }}>
          <span className="muted">Kind mode</span>
          <span style={{ color: "var(--brand)", fontWeight: 700 }}>Coach Nova - warm, encouraging</span>
          <span style={{ color: "var(--text-3)" }}>|</span>
          <span className="muted">Rude-tough mode</span>
          <span style={{ color: "var(--danger)", fontWeight: 700 }}>Sergeant Rex - tough love</span>
          <span style={{ color: "var(--text-3)" }}>|</span>
          <span className="muted">Data mode</span>
          <span style={{ color: "var(--accent)", fontWeight: 700 }}>Dr. Atlas - analytics</span>
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
          The coach reads your real performance records: level, rank, streak, PRs, sessions, quests and battles. Switch
          personality any time.
        </p>
      </Card>

      <div className="chat-shell">
        <div className="chat-history">
          {messages.length === 0 ? (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="chat" size={30} />
              </span>
              <span className="empty__title">Say hello to {persona.name}</span>
              <div className="row" style={{ justifyContent: "center" }}>
                <Button variant="ghost" size="sm" onClick={() => void send("How am I doing?")}>
                  How am I doing?
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void send("Give me a training plan")}>
                  Give me a plan
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void send("Make me work hard today")}>
                  Push me hard
                </Button>
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`chat-msg ${m.role === "user" ? "chat-msg--user" : "chat-msg--coach"}`}>
                {m.content}
              </div>
            ))
          )}
          {busy ? <div className="chat-msg chat-msg--coach">thinking…</div> : null}
          <div ref={endRef} />
        </div>
        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send()}
            placeholder={`Message ${persona.name}…`}
            disabled={busy}
          />
          <Button variant="primary" onClick={() => void send()} disabled={busy || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </>
  );
}