import { store, createId } from "../storage/StorageService";
import { lookupByPlayerId } from "../auth/AuthService";
import { allPlayers, getPlayer } from "../identity/PlayerService";
import type {
  FriendRecord,
  FriendRequest,
  PlayerId,
  FriendshipState,
  BlockRecord,
  PublicPlayerLookup,
} from "../../types";
import type { NotificationService } from "./NotificationService";

const friendsCol = store<FriendRecord[]>("rep:friends");
const requestsCol = store<FriendRequest[]>("rep:requests");
const blocksCol = store<BlockRecord[]>("rep:blocks");

export async function getFriends(playerId: PlayerId): Promise<FriendRecord[]> {
  return (await friendsCol.get(playerId)) ?? [];
}

export async function getFriendCount(playerId: PlayerId): Promise<number> {
  return (await getFriends(playerId)).length;
}

export async function areFriends(a: PlayerId, b: PlayerId): Promise<boolean> {
  const fa = await getFriends(a);
  return fa.some((f) => f.friendId === b);
}

export async function getFriendIds(playerId: PlayerId): Promise<PlayerId[]> {
  return (await getFriends(playerId)).map((f) => f.friendId);
}

export async function relationBetween(a: PlayerId, b: PlayerId): Promise<FriendshipState> {
  if (await isBlocked(a, b)) return "BLOCKED";
  if (await areFriends(a, b)) return "FRIENDS";
  const reqs = await allRequestsFor(a);
  const out = reqs.find((r) => r.senderId === a && r.recipientId === b && r.status === "PENDING");
  if (out) return "OUTGOING_PENDING";
  const incoming = reqs.find((r) => r.senderId === b && r.recipientId === a && r.status === "PENDING");
  if (incoming) return "INCOMING_PENDING";
  return "NONE";
}

async function allRequestsFor(playerId: PlayerId): Promise<FriendRequest[]> {
  const sent = (await requestsCol.get(`${playerId}:sent`)) ?? [];
  const recv = (await requestsCol.get(`${playerId}:recv`)) ?? [];
  return [...sent, ...recv];
}

async function saveSent(playerId: PlayerId, reqs: FriendRequest[]): Promise<void> {
  await requestsCol.put(`${playerId}:sent`, reqs);
}
async function saveRecv(playerId: PlayerId, reqs: FriendRequest[]): Promise<void> {
  await requestsCol.put(`${playerId}:recv`, reqs);
}

export async function sendFriendRequest(senderId: PlayerId, recipientId: PlayerId, notify: NotificationService): Promise<FriendRequest> {
  if (senderId === recipientId) throw new Error("Cannot friend yourself.");
  if (await areFriends(senderId, recipientId)) throw new Error("Already friends.");
  if (await isBlocked(senderId, recipientId)) throw new Error("BLOCKED");
  const rel = await relationBetween(senderId, recipientId);
  if (rel === "OUTGOING_PENDING") throw new Error("Request already sent.");
  if (rel === "INCOMING_PENDING") throw new Error("This player already sent you a request - accept it instead.");
  const req: FriendRequest = { id: createId("fr"), senderId, recipientId, status: "PENDING", createdAt: Date.now() };
  const sent = (await requestsCol.get(`${senderId}:sent`)) ?? [];
  const recv = (await requestsCol.get(`${recipientId}:recv`)) ?? [];
  sent.unshift(req);
  recv.unshift(req);
  await saveSent(senderId, sent);
  await saveRecv(recipientId, recv);
  await notify.push({
    playerId: recipientId,
    type: "FRIEND_REQUEST",
    title: "Friend request",
    body: `${await usernameOf(senderId)} wants to be your rival-turned-friend.`,
    payload: { senderId },
  });
  return req;
}

export async function acceptFriendRequest(playerId: PlayerId, requestId: string, notify: NotificationService): Promise<void> {
  const recv = (await requestsCol.get(`${playerId}:recv`)) ?? [];
  const req = recv.find((r) => r.id === requestId && r.recipientId === playerId);
  if (!req) throw new Error("Request not found.");
  if (req.status !== "PENDING") throw new Error("Request already handled.");
  req.status = "ACCEPTED";
  req.respondedAt = Date.now();
  await saveRecv(playerId, recv);
  const sent = (await requestsCol.get(`${req.senderId}:sent`)) ?? [];
  const senderReq = sent.find((r) => r.id === requestId);
  if (senderReq) {
    senderReq.status = "ACCEPTED";
    senderReq.respondedAt = Date.now();
    await saveSent(req.senderId, sent);
  }
  const fa = (await friendsCol.get(playerId)) ?? [];
  const fb = (await friendsCol.get(req.senderId)) ?? [];
  if (!fa.some((f) => f.friendId === req.senderId)) {
    fa.push({ id: createId("fr"), playerId, friendId: req.senderId, createdAt: Date.now() });
    await friendsCol.put(playerId, fa);
  }
  if (!fb.some((f) => f.friendId === playerId)) {
    fb.push({ id: createId("fr"), playerId: req.senderId, friendId: playerId, createdAt: Date.now() });
    await friendsCol.put(req.senderId, fb);
  }
  await notify.push({
    playerId: req.senderId,
    type: "FRIEND_ACCEPTED",
    title: "Request accepted",
    body: `${await usernameOf(playerId)} accepted your friend request.`,
    payload: { from: playerId },
  });
}

export async function declineFriendRequest(playerId: PlayerId, requestId: string): Promise<void> {
  const recv = (await requestsCol.get(`${playerId}:recv`)) ?? [];
  const req = recv.find((r) => r.id === requestId && r.recipientId === playerId);
  if (!req || req.status !== "PENDING") return;
  req.status = "DECLINED";
  req.respondedAt = Date.now();
  await saveRecv(playerId, recv);
  const sent = (await requestsCol.get(`${req.senderId}:sent`)) ?? [];
  const s = sent.find((r) => r.id === requestId);
  if (s) {
    s.status = "DECLINED";
    await saveSent(req.senderId, sent);
  }
}

export async function cancelFriendRequest(senderId: PlayerId, requestId: string): Promise<void> {
  const sent = (await requestsCol.get(`${senderId}:sent`)) ?? [];
  const req = sent.find((r) => r.id === requestId && r.senderId === senderId);
  if (!req) return;
  req.status = "CANCELLED";
  await saveSent(senderId, sent);
}

export async function removeFriend(playerId: PlayerId, friendId: PlayerId): Promise<void> {
  const fa = (await friendsCol.get(playerId)) ?? [];
  const fb = (await friendsCol.get(friendId)) ?? [];
  await friendsCol.put(playerId, fa.filter((f) => f.friendId !== friendId));
  await friendsCol.put(friendId, fb.filter((f) => f.friendId !== playerId));
}

export async function getPendingRequests(playerId: PlayerId): Promise<FriendRequest[]> {
  const recv = (await requestsCol.get(`${playerId}:recv`)) ?? [];
  return recv.filter((r) => r.status === "PENDING");
}

// ── blocking ──

export async function isBlocked(a: PlayerId, b: PlayerId): Promise<boolean> {
  const bl = (await blocksCol.get(a)) ?? [];
  return bl.some((x) => x.blockedId === b) || (await isBlockedBy(b, a));
}
async function isBlockedBy(b: PlayerId, a: PlayerId): Promise<boolean> {
  const bl = (await blocksCol.get(b)) ?? [];
  return bl.some((x) => x.blockedId === a);
}

export async function block(target: PlayerId, victim: PlayerId): Promise<void> {
  const bl = (await blocksCol.get(target)) ?? [];
  if (!bl.some((x) => x.blockedId === victim)) {
    bl.push({ id: createId("blk"), blockerId: target, blockedId: victim, createdAt: Date.now() });
    await blocksCol.put(target, bl);
  }
  await removeFriend(target, victim);
  await removeFriend(victim, target);
}

export async function unblock(target: PlayerId, victim: PlayerId): Promise<void> {
  const bl = (await blocksCol.get(target)) ?? [];
  await blocksCol.put(target, bl.filter((x) => x.blockedId !== victim));
}

export async function blockedIds(playerId: PlayerId): Promise<PlayerId[]> {
  const bl = (await blocksCol.get(playerId)) ?? [];
  return bl.map((b) => b.blockedId);
}

// ── search ──

export interface PlayerSearchHit extends PublicPlayerLookup {
  level: number;
  rankDisplay: string;
  avatar: { icon: string; frame: string; background: string; accent: string };
  /** "directory" = found in the public ZELUX registry, friend-linking is local-only. */
  origin?: "local" | "directory";
  region?: string | null;
}

export async function searchPlayers(query: string, selfId: PlayerId): Promise<PlayerSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  // exact player id lookup (highest priority) — ZX-XXXX-XXXX (ZELUX) or legacy
  // REP-XXXX-XXXX codes, with or without the leading '#'. If the player was
  // found locally we stop there; otherwise we keep going so the server
  // directory can answer for players on OTHER devices.
  if (/^#?[A-Z]{2,3}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/i.test(q)) {
    const normalized = q.toUpperCase().replace(/^#/, "");
    const found = await lookupByPlayerId(normalized);
    if (found && found.playerId !== selfId) {
      const hit = await toHit(found);
      if (hit) return [hit];
    }
  }
  // phone-number lookup (e.g. +91 98765 43210 / 9876543210)
  const digits = q.replace(/[^\d]/g, "");
  if (digits.length >= 7 && digits.length <= 15) {
    const { findByPhone } = await import("../identity/PlayerService");
    const owner = await findByPhone(digits);
    const allWithPhone = (await allPlayers()).filter(
      (p) => p.phone && p.phone.replace(/[^\d]/g, "").includes(digits) && p.playerId !== selfId,
    );
    const phoneHits: PlayerSearchHit[] = [];
    for (const p of allWithPhone) {
      const hit = await toHit({ playerId: p.playerId, username: p.username });
      if (hit) phoneHits.push(hit);
    }
    if (owner && owner.playerId !== selfId && !allWithPhone.some((p) => p.playerId === owner.playerId)) {
      const hit = await toHit({ playerId: owner.playerId, username: owner.username });
      if (hit) phoneHits.unshift(hit);
    }
    if (phoneHits.length > 0) return phoneHits.slice(0, 10);
  }
  // username lookup (case-insensitive contains)
  const lower = q.toLowerCase();
  const players = await allPlayers();
  const matches = players
    .filter((p) => p.username.toLowerCase().includes(lower))
    .filter((p) => p.playerId !== selfId)
    .slice(0, 10);
  const hits: PlayerSearchHit[] = [];
  for (const p of matches) {
    const hit = await toHit({ playerId: p.playerId, username: p.username });
    if (hit) hits.push(hit);
  }
  // Public directory results (server reachable + toggle on). Honest summary
  // only: they exist on the device? No. We cannot route a local friend
  // request to another browser, so directory hits are purely informational.
  const { searchDirectory } = await import("./DirectoryClient");
  const remote = await searchDirectory(q, selfId);
  const seen = new Set(hits.map((h) => h.playerId));
  for (const r of remote) {
    if (seen.has(r.playerId)) continue;
    seen.add(r.playerId);
    hits.push({
      playerId: r.playerId,
      username: r.username,
      level: r.level,
      rankDisplay: r.rankDisplay,
      avatar: r.avatar,
      region: r.region ?? null,
      origin: "directory",
    });
  }
  return hits.slice(0, 12);
}

async function toHit(lookup: PublicPlayerLookup): Promise<PlayerSearchHit | null> {
  const p = await getPlayer(lookup.playerId);
  const { getRating, levelProgress, rankDisplayName } = await import("../progression/ProgressionService");
  const level = await levelProgress(lookup.playerId);
  const rating = await getRating(lookup.playerId);
  return {
    playerId: lookup.playerId,
    username: p?.username ?? lookup.username,
    level: level.currentLevel,
    rankDisplay: rankDisplayName(rating.rank, rating.division),
    avatar: p?.avatar ?? { icon: "R", frame: "frame_1", background: "bg_1", accent: "#ff7a1a" },
  };
}

async function usernameOf(playerId: PlayerId): Promise<string> {
  const p = await getPlayer(playerId);
  if (p) return p.username;
  const lu = await lookupByPlayerId(playerId);
  return lu?.username ?? playerId;
}