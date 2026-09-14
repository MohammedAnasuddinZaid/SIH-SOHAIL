// DeviceIdentity: every physical device is its own player. No login, no OTP,
// no account wall — the app boots straight into the arena. Each phone, each
// browser profile, gets a stable unique REP-XXXX-XXXX code derived from a
// random device id. Friends type that code to find you.
//
// A session is bound automatically so storage/identity helpers that check
// `currentSession()` keep working unchanged.

import { store } from "../storage/StorageService";
import { createPlayer, getPlayer } from "../identity/PlayerService";
import { saveSession } from "./AuthService";
import { branding } from "../../config/branding";
import type { Player, PlayerId, SessionRecord } from "../../types";

const deviceStore = store<string>("rep:device");
const DEVICE_KEY = "id";

const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 chars, confusion-safe

function randomHex(bytes: number): string {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable per-device random id (created once, reused forever on this device). */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await deviceStore.get(DEVICE_KEY);
  if (existing) return existing;
  const id = randomHex(16);
  await deviceStore.put(DEVICE_KEY, id);
  return id;
}

/** Wipes the stored device id and returns a brand-new one (fresh identity). */
export async function rotateDeviceId(): Promise<string> {
  const id = randomHex(16);
  await deviceStore.put(DEVICE_KEY, id);
  return id;
}

/** Deterministic, unique, memorable code for a device: REP-XXXX-XXXX. */
export function devicePlayerId(deviceId: string): PlayerId {
  const hex = deviceId.replace(/[^0-9a-f]/gi, "").slice(0, 16).padEnd(16, "0") || "0";
  let n = BigInt(`0x${hex}`);
  let digits = "";
  do {
    digits = ID_ALPHABET[Number(n % 32n)] + digits;
    n = n / 32n;
  } while (n > 0n);
  digits = digits.padStart(8, ID_ALPHABET[0]).slice(0, 8);
  return `${branding.PLAYER_ID_PREFIX}-${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

/** Type-level brand so a validated code is only usable as a PlayerCode. */
export type PlayerCode = string & { __brand: "REP_PLAYER_CODE" };

/** True only for a valid `REP-XXXX-XXXX` code (confusion-safe alphabet). */
export function isValidPlayerCode(code: string): code is PlayerCode {
  return /^REP-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/.test(code);
}

/**
 * Compose a final code string, normalizing any case/whitespace the user typed.
 * Returns null when the input is not a recognizable code.
 */
export function parsePlayerCode(raw: string): PlayerCode | null {
  const cleaned = raw.trim().toUpperCase();
  return isValidPlayerCode(cleaned) ? cleaned : null;
}

/** Last 4 code chars, e.g. "7K2Q". */
export function deviceHandle(playerId: PlayerId): string {
  return playerId.slice(-4);
}

function bindSession(playerId: PlayerId): void {
  const session: SessionRecord = {
    token: randomHex(32),
    playerId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
  };
  void saveSession(session);
}

/** Returns (creating if needed) this device's player, always bound to a session. */
export async function getOrCreateDevicePlayer(): Promise<Player> {
  const deviceId = await getOrCreateDeviceId();
  const playerId = devicePlayerId(deviceId);
  const existing = await getPlayer(playerId);
  if (existing) {
    bindSession(playerId);
    return existing;
  }
  bindSession(playerId);
  return createPlayer({
    playerId,
    username: `Athlete ${deviceHandle(playerId)}`,
    title: "On the grind",
  });
}

/** Rotates this device to a brand-new identity and returns the fresh player. */
export async function rotateDevicePlayer(): Promise<Player> {
  const deviceId = await rotateDeviceId();
  const playerId = devicePlayerId(deviceId);
  bindSession(playerId);
  return createPlayer({
    playerId,
    username: `Athlete ${deviceHandle(playerId)}`,
    title: "On the grind",
  });
}