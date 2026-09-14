import { store, createId } from "../storage/StorageService";
import { getFriends, isBlocked, blockedIds } from "./FriendService";
import { getPlayer } from "../identity/PlayerService";
import type { PlayerId, SocialActivity, SocialActivityType, ProgressionEvent } from "../../types";

const feedCol = store<SocialActivity[]>("rep:social-feed");

export async function publishActivity(
  playerId: PlayerId,
  type: SocialActivityType,
  title: string,
  body: string
): Promise<SocialActivity> {
  const feed = (await feedCol.get("all")) ?? [];
  const act: SocialActivity = {
    id: createId("act"),
    playerId,
    type,
    title,
    body,
    createdAt: Date.now(),
    reactions: {},
    muted: false,
  };
  feed.unshift(act);
  await feedCol.put("all", feed.slice(0, 500));
  return act;
}

export async function getPublicFeed(viewerId: PlayerId, opts: { limit?: number } = {}): Promise<SocialActivity[]> {
  const feed = (await feedCol.get("all")) ?? [];
  const friends = new Set((await getFriends(viewerId)).map((f) => f.friendId));
  const blocked = new Set(await blockedIdsOf(viewerId));
  const out: SocialActivity[] = [];
  for (const act of feed) {
    if (out.length >= (opts.limit ?? 40)) break;
    if (blocked.has(act.playerId)) continue;
    if (act.playerId === viewerId) {
      out.push(act);
      continue;
    }
    if (!friends.has(act.playerId)) continue; // friends feed for MVP
    const author = await getPlayer(act.playerId);
    if (author && author.privacy.shareAchievementsInFeed === "OFF") continue;
    if (author && author.privacy.shareAchievementsInFeed === "FRIENDS" && !friends.has(viewerId)) continue;
    out.push(act);
  }
  return out;
}

async function blockedIdsOf(playerId: PlayerId): Promise<PlayerId[]> {
  const mine = new Set(await blockedIds(playerId));
  return [...mine];
}

export async function reactToActivity(playerId: PlayerId, activityId: string, reaction: string): Promise<void> {
  const feed = (await feedCol.get("all")) ?? [];
  const act = feed.find((a) => a.id === activityId);
  if (!act) return;
  const list = act.reactions[reaction] ?? [];
  if (!list.includes(playerId)) list.push(playerId);
  else {
    const idx = list.indexOf(playerId);
    list.splice(idx, 1);
  }
  act.reactions[reaction] = list;
  await feedCol.put("all", feed);
}

export async function mineOwnFeed(playerId: PlayerId): Promise<SocialActivity[]> {
  const feed = (await feedCol.get("all")) ?? [];
  return feed.filter((a) => a.playerId === playerId);
}

export interface FriendActivityItem {
  type: string;
  title: string;
  body: string;
  playerId: PlayerId;
  createdAt: number;
  username?: string;
}

export async function friendActivity(viewerId: PlayerId): Promise<FriendActivityItem[]> {
  const acts = await getPublicFeed(viewerId, { limit: 30 });
  const out: FriendActivityItem[] = [];
  for (const a of acts) {
    if (a.playerId === viewerId) continue;
    const p = await getPlayer(a.playerId);
    out.push({ type: a.type, title: a.title, body: a.body, playerId: a.playerId, createdAt: a.createdAt, username: p?.username });
  }
  return out;
}

// Progression timeline events are already stored per-user; this surfaces recent highlights
export async function recentMilestones(playerId: PlayerId): Promise<ProgressionEvent[]> {
  const { getEvents } = await import("../progression/ProgressionService");
  const evs = await getEvents(playerId);
  return evs.slice(-12);
}

export async function isInteractableWith(viewerId: PlayerId, targetId: PlayerId): Promise<boolean> {
  if (viewerId === targetId) return true;
  if (await isBlocked(viewerId, targetId)) return false;
  const target = await getPlayer(targetId);
  if (!target) return false;
  if (target.privacy.allowChallenges === false) return false;
  return true;
}