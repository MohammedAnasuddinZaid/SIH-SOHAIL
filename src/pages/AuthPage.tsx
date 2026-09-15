import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Icon } from "../components/Icons";
import { branding } from "../config/branding";
import { useAuthStore } from "../stores/authStore";
import { toast } from "../stores/toastStore";
import { bindPhone } from "../core/identity/PlayerService";
import "./pages.css";

const ArenaBackground = lazy(() => import("../components/ArenaBackground").then((m) => ({ default: m.ArenaBackground })));

export function AuthPage() {
  const player = useAuthStore((s) => s.player);
  const resetIdentity = useAuthStore((s) => s.resetIdentity);
  const busy = useAuthStore((s) => s.busy);
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState(player?.phone ?? "");
  const [phoneBusy, setPhoneBusy] = useState(false);

  async function copyCode() {
    if (!player) return;
    try {
      await navigator.clipboard.writeText(player.playerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast("ok", "Code copied", "Share it so friends can find you.");
    } catch {
      toast("info", "Copy ready", player.playerId);
    }
  }

  async function linkPhone() {
    if (!player) return;
    if (phone.trim().length < 7) {
      toast("danger", "Enter a valid mobile number", "Include your country code, e.g. +91 98765 43210.");
      return;
    }
    setPhoneBusy(true);
    try {
      const { linked, player: linkedPlayer } = await bindPhone(player.playerId, phone);
      if (linked) {
        toast("ok", "Phone linked", "This device is now tracked by your number. Friends can find you by it.");
      } else {
        toast("danger", "Number already taken", `That number belongs to ${linkedPlayer.username} on this device.`);
      }
    } catch (e) {
      toast("danger", "Could not link", (e as Error).message);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function newIdentity() {
    if (!window.confirm("Start a fresh identity on this device? Your current code and its data stay, but this device will use a NEW code from now on.")) return;
    await resetIdentity();
    setCopied(false);
    toast("ok", "New identity", "This device has a brand-new player code.");
  }

  return (
    <div className="auth-wrap">
      <Suspense fallback={null}>
        <ArenaBackground />
      </Suspense>
      <div className="auth-grid" />
      <div className="auth-orb auth-orb--a" />
      <div className="auth-orb auth-orb--b" />
      <div className="auth-orb auth-orb--c" />

      <div className="auth-card">
        <div className="auth-brand">
          <h1 className="grad-text">{branding.APP_NAME}</h1>
          <p className="auth-tagline">No account. No password. No OTP.</p>
          <p className="auth-sub">
            Your device <i>is</i> your player. Every phone gets its own unique{" "}
            <strong>{branding.PLAYER_ID_PREFIX}-XXXX-XXXX</strong> code automatically. Link your mobile
            number below and friends find you by your number too.
          </p>
        </div>

        <div className="demo-inbox">
          <span className="demo-inbox__badge">Your player code</span>
          <p>Friends type this code under Friends → Add to find you.</p>
          <div className="demo-code">{player?.playerId ?? "…"}</div>
          <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
            <Button variant="primary" onClick={() => void copyCode()} disabled={!player}>
              <Icon name="copy" size={16} /> {copied ? "Copied!" : "Copy code"}
            </Button>
            <Link to="/" className="auth-link-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="arrow-right" size={16} /> Continue to arena
            </Link>
          </div>
        </div>

        <ul className="auth-trust">
          <li>Auto-created the first time you open the app</li>
          <li>Stored only on this device</li>
          <li>Shared by typing your code</li>
        </ul>

        {player ? (
          <div style={{ marginTop: "var(--sp-4)", textAlign: "center" }}>
            <div className="auth-phone">
              <div className="field__label">Link your mobile number (tracked identity)</div>
              <div className="row" style={{ justifyContent: "center", gap: 8 }}>
                <input
                  className="field__control"
                  type="tel"
                  inputMode="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ maxWidth: 240 }}
                />
                <Button variant="primary" size="sm" onClick={() => void linkPhone()} disabled={phoneBusy || !phone.trim()}>
                  {phoneBusy ? "Linking…" : player.phone ? "Update" : "Link phone"}
                </Button>
              </div>
              <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-2)" }}>
                {player.phone
                  ? `Phone ${player.phone} is linked to ${player.username}. Friends can find you by it.`
                  : "No phone linked yet. Without it, friends can only find you by your code."}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void newIdentity()} disabled={busy}>
              <Icon name="refresh" size={14} /> Start a new identity on this device
            </Button>
            <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-2)" }}>
              Your progression stays attached to your old code. The new code starts fresh.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}