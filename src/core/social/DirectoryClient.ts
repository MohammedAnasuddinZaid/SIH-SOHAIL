// Optional public directory client. ZELUX stays offline-first: nothing is
// sent anywhere unless (a) the user leaves the directory toggle on and
// (b) the ZELUX server (server/app.mjs) is reachable. The server keeps only
// public profile fields ("hall of fame" style) and never stores IP addresses
// or camera data.

import type { PlayerId } from "../../types";

const TOGGLE_KEY = "rep:directory:enabled";
const META_CACHE_TTL = 30_000;

export interface DirectoryPlayer {
  playerId: PlayerId;
  username: string;
  level: number;
  rankDisplay: string;
  avatar: { icon: string; frame: string; background: string; accent: string };
  region?: string | null;
  updatedAt: number;
}

export interface RegionInfo {
  known: boolean;
  country?: string;
  countryCode?: string;
  city?: string | null;
  source: string;
}

function baseUrl(): string {
  const configured = (import.meta.env.VITE_DIRECTORY_URL as string | undefined)?.trim().replace(/\/+$/, "") ?? "";
  return configured;
}

export function isDirectoryEnabled(): boolean {
  try {
    return localStorage.getItem(TOGGLE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setDirectoryEnabled(on: boolean): boolean {
  try {
    localStorage.setItem(TOGGLE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  return on;
}

async function jsonFetch(path: string, init?: RequestInit, timeoutMs = 3500): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal, headers: { ...(init?.headers ?? {}) } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let metaAt = 0;
let metaOnline = false;

export async function directoryPing(): Promise<boolean> {
  if (Date.now() - metaAt < META_CACHE_TTL) return metaOnline;
  metaAt = Date.now();
  const data = await jsonFetch(`${baseUrl() || ""}/api/meta`);
  metaOnline = Boolean(data && typeof data === "object" && "name" in (data as object));
  return metaOnline;
}

export async function registerWithDirectory(pub: {
  playerId: PlayerId;
  username: string;
  level: number;
  rankDisplay: string;
  avatar: DirectoryPlayer["avatar"];
  phone?: string;
}): Promise<boolean> {
  if (!isDirectoryEnabled()) return false;
  const data = await jsonFetch(`${baseUrl() || ""}/api/directory/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...pub, ts: Date.now() }),
  });
  return Boolean(data && (data as { ok?: boolean }).ok);
}

export async function searchDirectory(query: string, selfId: PlayerId, limit = 8): Promise<DirectoryPlayer[]> {
  if (!isDirectoryEnabled() || query.trim().length < 2) return [];
  const url = `${baseUrl() || ""}/api/directory/search?q=${encodeURIComponent(query.trim())}&limit=${limit}`;
  const data = await jsonFetch(url, undefined, 2000);
  if (!data || typeof data !== "object" || !Array.isArray((data as { players?: unknown }).players)) return [];
  return ((data as { players: DirectoryPlayer[] }).players).filter((p) => p.playerId !== selfId);
}

export async function fetchCoarseRegion(): Promise<RegionInfo | null> {
  const data = await jsonFetch(`${baseUrl() || ""}/api/ip/region`);
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<RegionInfo>;
  return {
    known: Boolean(d.known),
    country: d.country,
    countryCode: d.countryCode,
    city: d.city ?? null,
    source: d.source ?? "none",
  };
}