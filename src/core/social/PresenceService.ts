import { store, createId } from "../storage/StorageService";
import type { PresenceRecord, PlayerId } from "../../types";

const CHANNEL = "rep:presence";

export class PresenceService {
  private bc: BroadcastChannel | null = null;
  private timer: number | null = null;
  private playerId: PlayerId | null = null;

  start(playerId: PlayerId): void {
    this.playerId = playerId;
    try {
      this.bc = new BroadcastChannel(CHANNEL);
    } catch {
      this.bc = null;
    }
    this.set("ONLINE");
    this.timer = window.setInterval(() => this.heartbeat(), 30_000);
  }

  set(state: PresenceRecord["state"], activity?: string): void {
    if (!this.playerId) return;
    const rec: PresenceRecord = { playerId: this.playerId, state, activity, updatedAt: Date.now() };
    const col = store<PresenceRecord>(CHANNEL);
    void col.put(this.playerId, rec);
    this.bc?.postMessage({ type: "PRESENCE", rec });
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    if (this.playerId) this.set("OFFLINE");
    this.bc?.close();
    this.bc = null;
    this.playerId = null;
  }

  private heartbeat(): void {
    if (!this.playerId) return;
    const col = store<PresenceRecord>(CHANNEL);
    void col.put(this.playerId, {
      playerId: this.playerId,
      state: "ONLINE",
      activity: "Exploring",
      updatedAt: Date.now(),
    } as PresenceRecord);
  }
}

const presenceStore = store<PresenceRecord>("rep:presence");

export async function getPresence(playerId: PlayerId): Promise<PresenceRecord | null> {
  const rec = await presenceStore.get(playerId);
  if (!rec) return null;
  if (rec.updatedAt && Date.now() - rec.updatedAt > 120_000) {
    return { ...rec, state: "OFFLINE" };
  }
  return rec;
}

export async function presenceOfMany(ids: PlayerId[]): Promise<Map<PlayerId, PresenceRecord | null>> {
  const map = new Map<PlayerId, PresenceRecord | null>();
  for (const id of ids) map.set(id, await getPresence(id));
  return map;
}

export async function onlineFriendIds(friendIds: PlayerId[]): Promise<PlayerId[]> {
  const out: PlayerId[] = [];
  for (const id of friendIds) {
    const p = await getPresence(id);
    if (p && p.state !== "OFFLINE" && Date.now() - p.updatedAt < 120_000) out.push(id);
  }
  return out;
}

export function setPresence(playerId: PlayerId, state: PresenceRecord["state"]): void {
  const rec: PresenceRecord = { playerId, state, updatedAt: Date.now() };
  void presenceStore.put(playerId, rec);
}

export { createId };