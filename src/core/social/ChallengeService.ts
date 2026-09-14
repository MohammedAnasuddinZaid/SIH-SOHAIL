import { store, createId } from "../storage/StorageService";
import type { Challenge, ChallengeStatus, PlayerId } from "../../types";
import type { NotificationService } from "./NotificationService";
import { isBlocked } from "./FriendService";
import { getPlayer } from "../identity/PlayerService";

const chalCol = store<Challenge[]>("rep:challenges");
const CHALLENGE_TTL = 1000 * 60 * 60 * 24; // 24h

export const CHALLENGE_OPTIONS = {
  repTargets: [20, 30, 50, 75, 100],
  durations: [30, 60, 90, 120],
};

export interface ChallengeInput {
  challengerId: PlayerId;
  opponentId: PlayerId;
  battleMode: "REP_RACE" | "TIME_TRIAL" | "FIRST_TO";
  ranked: boolean;
  repTarget?: number;
  durationSec?: number;
}

export async function createChallenge(input: ChallengeInput, notify: NotificationService): Promise<Challenge> {
  if (await isBlocked(input.challengerId, input.opponentId)) throw new Error("BLOCKED");
  const c: Challenge = {
    id: createId("ch"),
    challengerId: input.challengerId,
    opponentId: input.opponentId,
    battleMode: input.battleMode,
    ranked: input.ranked,
    repTarget: input.repTarget,
    durationSec: input.durationSec,
    status: "PENDING",
    createdAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_TTL,
  };
  const mine = await listChallenges(input.challengerId);
  mine.unshift(c);
  await chalCol.put(input.challengerId, mine);
  const theirs = await listChallenges(input.opponentId);
  theirs.unshift(c);
  await chalCol.put(input.opponentId, theirs);
  const cz = await getPlayer(input.challengerId);
  await notify.push({
    playerId: input.opponentId,
    type: "CHALLENGE",
    title: "New challenge",
    body: `${cz?.username ?? "Someone"} challenged you to a 1v1 push-up battle.`,
    payload: { challengeId: c.id, challengerId: input.challengerId },
  });
  return c;
}

export async function listChallenges(playerId: PlayerId): Promise<Challenge[]> {
  const all = (await chalCol.get(playerId)) ?? [];
  const expire = all.filter((c) => c.status === "PENDING" && c.expiresAt < Date.now());
  if (expire.length > 0) {
    for (const c of expire) {
      const idx = all.findIndex((x) => x.id === c.id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], status: "EXPIRED" };
        // mirror to other party
        const otherId = c.challengerId === playerId ? c.opponentId : c.challengerId;
        const theirs = await listChallenges(otherId);
        const tIdx = theirs.findIndex((x) => x.id === c.id);
        if (tIdx >= 0) theirs[tIdx] = { ...theirs[tIdx], status: "EXPIRED" };
        await chalCol.put(otherId, theirs);
      }
    }
    await chalCol.put(playerId, all);
  }
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export type ChallengeAction = (c: Challenge) => Promise<void>;

export async function setChallengeStatus(playerId: PlayerId, challengeId: string, status: ChallengeStatus, notify?: NotificationService): Promise<Challenge> {
  const all = await listChallenges(playerId);
  const c = all.find((x) => x.id === challengeId);
  if (!c) throw new Error("Challenge not found.");
  c.status = status;
  await chalCol.put(playerId, all);
  const otherId = c.challengerId === playerId ? c.opponentId : c.challengerId;
  const theirs = await listChallenges(otherId);
  const t = theirs.find((x) => x.id === challengeId);
  if (t) t.status = status;
  await chalCol.put(otherId, theirs);
  if (notify && (status === "ACCEPTED" || status === "DECLINED")) {
    await notify.push({
      playerId: otherId,
      type: "CHALLENGE_ACCEPTED",
      title: status === "ACCEPTED" ? "Challenge accepted!" : "Challenge declined",
      body: status === "ACCEPTED" ? "Your opponent is ready. Get the battle going." : "Maybe next time.",
      payload: { challengeId },
    });
  }
  return c;
}

export async function challengeBindToMatch(challengeId: string, matchId: string): Promise<void> {
  const both = await gatherBoth(challengeId);
  for (const pid of both) {
    const all = await listChallenges(pid);
    const c = all.find((x) => x.id === challengeId);
    if (c) {
      c.matchId = matchId;
      c.status = "COMPLETED";
      await chalCol.put(pid, all);
    }
  }
}

async function gatherBoth(challengeId: string): Promise<PlayerId[]> {
  const me = await listChallengesTmp(challengeId);
  return me;
}

async function listChallengesTmp(challengeId: string): Promise<PlayerId[]> {
  const out: PlayerId[] = [];
  // challenge stored under both participants' keys; probe a few known owners is not possible,
  // so the caller keeps track. We instead derive from stored challenge objects.
  const keys = chalCol.keys();
  for (const k of keys) {
    const list = await chalCol.get(k);
    const found = list?.find((c) => c.id === challengeId);
    if (found) {
      out.push(found.challengerId, found.opponentId);
      break;
    }
  }
  return [...new Set(out)];
}