import { store, createId } from "../storage/StorageService";
import type { AppNotification, NotificationType, PlayerId } from "../../types";

const notifCol = store<AppNotification[]>("rep:notifications");

export class NotificationService {
  constructor(private playerId: PlayerId) {}

  async push(input: Omit<AppNotification, "id" | "createdAt">): Promise<AppNotification> {
    const all = await this.list();
    const n: AppNotification = {
      id: createId("ntf"),
      createdAt: Date.now(),
      ...input,
      playerId: this.playerId,
    };
    all.unshift(n);
    await notifCol.put(this.playerId, all.slice(0, 200));
    this.broadcast(n);
    return n;
  }

  async list(): Promise<AppNotification[]> {
    return (await notifCol.get(this.playerId)) ?? [];
  }

  async unreadCount(): Promise<number> {
    const all = await this.list();
    return all.filter((n) => !n.readAt).length;
  }

  async markRead(id: string): Promise<void> {
    const all = await this.list();
    const n = all.find((x) => x.id === id);
    if (n && !n.readAt) {
      n.readAt = Date.now();
      await notifCol.put(this.playerId, all);
    }
  }

  async markAllRead(): Promise<void> {
    const all = await this.list();
    for (const n of all) if (!n.readAt) n.readAt = Date.now();
    await notifCol.put(this.playerId, all);
  }

  async remove(id: string): Promise<void> {
    const all = await this.list();
    await notifCol.put(this.playerId, all.filter((n) => n.id !== id));
  }

  private broadcast(n: AppNotification): void {
    const ch = new BroadcastChannel("rep:notifications");
    ch.postMessage({ type: "NEW_NOTIFICATION", playerId: this.playerId, payload: n });
    setTimeout(() => ch.close(), 50);
  }
}

export function channelPlayerOfType(type: NotificationType): boolean {
  return type !== "SYSTEM";
}

export function newNotificationService(playerId: PlayerId): NotificationService {
  return new NotificationService(playerId);
}

export async function notifyTypeLabel(type: NotificationType): Promise<string> {
  const labels: Record<NotificationType, string> = {
    FRIEND_REQUEST: "Friend request",
    FRIEND_ACCEPTED: "Friends!",
    CHALLENGE: "New challenge",
    CHALLENGE_ACCEPTED: "Challenge accepted",
    BATTLE_RESULT: "Battle result",
    ACHIEVEMENT: "Achievement",
    TROPHY: "Trophy",
    RANK_CHANGE: "Rank update",
    LEVEL_UP: "Level up",
    LEADERBOARD: "Leaderboard",
    SEASON: "Season",
    QUEST_COMPLETE: "Quest complete",
    PERSONAL_RECORD: "Personal record",
    ROOM_INVITE: "Room invite",
    SYSTEM: "System",
  };
  return labels[type];
}