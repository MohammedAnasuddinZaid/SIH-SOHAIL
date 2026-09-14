import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Badge, Card, SectionTitle } from "../components/Primitives";
import { Field, Toggle } from "../components/Controls";
import { Icon, type IconName } from "../components/Icons";
import { COACH_PERSONALITIES, DEFAULT_AI_ENDPOINT } from "../config/aiCoach";
import { deleteAccount } from "../core/auth/AuthService";
import { getSettings, setPersonality, updateSettings, deletePlayerRecord } from "../core/identity/PlayerService";
import { useAuthStore } from "../stores/authStore";
import { toast } from "../stores/toastStore";
import type { CoachPersonalityId, UserSettings } from "../types";

export function SettingsPage() {
  const player = useAuthStore((s) => s.player);
  const refresh = useAuthStore((s) => s.refreshProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const id = player?.playerId;
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    if (id) void getSettings(id).then(setSettings);
  }, [id]);

  async function apply(patch: Partial<UserSettings>) {
    if (!id) return;
    const next = await updateSettings(id, patch);
    setSettings(next);
    toast("ok", "Saved");
  }

  async function changePersonality(p: CoachPersonalityId) {
    if (!id) return;
    await setPersonality(id, p);
    setSettings((s) => (s ? { ...s, coachPersonality: p } : s));
    toast("ok", COACH_PERSONALITIES[p].name, COACH_PERSONALITIES[p].tagline);
  }

  async function wipe() {
    if (!id) return;
    if (!window.confirm("Delete this account and all its data on this device? This cannot be undone.")) return;
    await deleteAccount(id);
    await deletePlayerRecord(id);
    toast("info", "Account deleted");
    window.location.assign("/auth");
  }

  if (!settings || !id) return null;

  return (
    <>
      <SectionTitle title="Settings" hint="All settings are stored on this device. No account data leaves your browser." />

      <Card>
        <SectionTitle title="AI Coach (personalty & model)" />
        <div className="row">
          {(Object.keys(COACH_PERSONALITIES) as CoachPersonalityId[]).map((p) => {
            const c = COACH_PERSONALITIES[p];
            return (
              <Button key={p} variant={settings.coachPersonality === p ? "primary" : "ghost"} onClick={() => void changePersonality(p)}>
                <Icon name={c.icon as IconName} size={16} /> {c.name}
              </Button>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {COACH_PERSONALITIES[settings.coachPersonality]?.description}
        </p>
        <Field
          label="Coach model (optional)"
          hint="Leave the API key empty to use the built-in on-device coach engine — no network needed. Add a key to enable a richer model."
        >
          <input className="field__control" value={settings.coachApiEndpoint ?? DEFAULT_AI_ENDPOINT} onChange={(e) => void apply({ coachApiEndpoint: e.target.value })} />
        </Field>
        <Field label="Coach API key (stored locally only)">
          <input className="field__control" type="password" value={settings.coachApiKey ?? ""} placeholder="sk-…" onChange={(e) => void apply({ coachApiKey: e.target.value })} />
        </Field>
      </Card>

      <Card>
        <SectionTitle title="Notifications" />
        <div className="stack">
          <div className="row">
            <span style={{ flex: 1 }}>Friend requests</span>
            <Toggle on={!!settings.notificationPrefs?.FRIEND_REQUEST} onChange={(v) => void apply({ notificationPrefs: { ...settings.notificationPrefs, FRIEND_REQUEST: v } })} label="Friend request notifications" />
          </div>
          <div className="row">
            <span style={{ flex: 1 }}>Battle results</span>
            <Toggle on={!!settings.notificationPrefs?.BATTLE_RESULT} onChange={(v) => void apply({ notificationPrefs: { ...settings.notificationPrefs, BATTLE_RESULT: v } })} label="Battle notifications" />
          </div>
          <div className="row">
            <span style={{ flex: 1 }}>Personal records</span>
            <Toggle on={!!settings.notificationPrefs?.PERSONAL_RECORD} onChange={(v) => void apply({ notificationPrefs: { ...settings.notificationPrefs, PERSONAL_RECORD: v } })} label="PR notifications" />
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Coach API connectivity test" />
        <Button variant="ghost" size="sm" onClick={() => toast(settings.coachApiKey ? "ok" : "info", settings.coachApiKey ? "API key set" : "Using on-device coach engine", settings.coachApiKey ? "Coach will prefer the model backend." : "Visit /coach to talk to the local coach.")}>
          Check coach backend
        </Button>
      </Card>

      <Card>
        <SectionTitle title="Account" />
        <div className="row">
          <Badge tone="info">{player?.playerId}</Badge>
          <span className="muted">{player?.username}</span>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" onClick={() => void refresh()}>
            Refresh profile
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
        <div style={{ marginTop: "var(--sp-4)" }}>
          <Button variant="danger" onClick={() => void wipe()}>
            Delete account & data
          </Button>
        </div>
      </Card>
    </>
  );
}