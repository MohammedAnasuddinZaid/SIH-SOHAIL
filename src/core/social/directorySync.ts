// Registers the current player with the optional public directory when it is
// reachable and the user has left sharing enabled. Fire-and-forget: failures
// are silent because the app is fully functional offline.

import { getPlayer } from "../identity/PlayerService";
import { registerWithDirectory } from "./DirectoryClient";
import type { PlayerId } from "../../types";

const LAST_SYNC_KEY = "rep:directory:last-register";

export async function syncPlayerToDirectory(playerId: PlayerId): Promise<boolean> {
  if (!(await isWorthSyncing(playerId))) return false;
  const p = await getPlayer(playerId);
  if (!p) return false;
  const { levelProgress, getRating, rankDisplayName } = await import("../progression/ProgressionService");
  const [lvl, rating] = await Promise.all([levelProgress(playerId), getRating(playerId)]);
  const ok = await registerWithDirectory({
    playerId,
    username: p.username,
    level: lvl.currentLevel,
    rankDisplay: rankDisplayName(rating.rank, rating.division),
    avatar: p.avatar,
    phone: p.phone,
  });
  if (ok) cacheSync(playerId);
  return ok;
}

async function isWorthSyncing(playerId: PlayerId): Promise<boolean> {
  const cached = readCacheSync();
  if (cached && cached.playerId === playerId && Date.now() - cached.at < 60_000) return false;
  const { directoryPing, isDirectoryEnabled } = await import("./DirectoryClient");
  if (!isDirectoryEnabled()) return false;
  return directoryPing();
}

function readCacheSync(): { playerId: string; at: number } | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    return raw ? (JSON.parse(raw) as { playerId: string; at: number }) : null;
  } catch {
    return null;
  }
}

function cacheSync(playerId: PlayerId): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, JSON.stringify({ playerId, at: Date.now() }));
  } catch {
    /* ignore */
  }
}