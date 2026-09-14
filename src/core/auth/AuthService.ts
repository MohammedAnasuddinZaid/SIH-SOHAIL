// Authentication service — local-first implementation with a clean interface
// so OAuth / a real backend can be dropped in later. Passwords are salted+hashed
// with PBKDF2 via SubtleCrypto. Plaintext is never stored.

import { store, createId } from "../storage/StorageService";
import { createPlayer, getPlayer } from "../identity/PlayerService";
import type { AuthenticationRecord, SessionRecord, PlayerId, OtpRecord, Player } from "../../types";
import { branding } from "../../config/branding";

export type AuthErrorCode =
  | "EMAIL_TAKEN"
  | "EMAIL_INVALID"
  | "PASSWORD_WEAK"
  | "CREDENTIALS_INVALID"
  | "USERNAME_TAKEN"
  | "USERNAME_INVALID"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_THROTTLED"
  | "SESSION_EXPIRED"
  | "NOT_AUTHENTICATED"
  | "UNKNOWN";

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message?: string) {
    super(message ?? code);
  }
}

const authStore = store<AuthenticationRecord>("rep:auth");
const sessionStore = store<SessionRecord>("rep:session");
const usernameIndex = store<PlayerId>("rep:username-index");
const emailIndex = store<AuthenticationRecord>("rep:email-index");
const otpStore = store<OtpRecord>("rep:otp");
const sessionKey = "active";

export interface Credentials {
  email: string;
  password: string;
}

// --- email validation (strict) ---

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const ALLOWED_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export interface EmailCheck {
  ok: boolean;
  reason?: string;
}

export function validateEmail(raw: string): EmailCheck {
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, reason: "Email is required." };
  if (email.length > 254) return { ok: false, reason: "Email is too long." };
  if (/\s/.test(email)) return { ok: false, reason: "Email cannot contain spaces." };
  if (/^\.|\.\.|\.$|@@/.test(email)) return { ok: false, reason: "That email looks malformed." };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, reason: "That doesn't look like a valid email address." };
  const domain = email.split("@")[1];
  if (!domain || !ALLOWED_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, reason: "Only @gmail.com addresses are supported right now." };
  }
  return { ok: true };
}

// --- password strength ---

export interface PasswordCheck {
  ok: boolean;
  score: number; // 0–5
  reason?: string;
}

const MIN_PASSWORD_LEN = 6;

export function checkPasswordStrength(raw: string): PasswordCheck {
  let score = 0;
  if (raw.length >= 8) score += 1;
  if (raw.length >= 12) score += 1;
  if (/[a-z]/.test(raw) && /[A-Z]/.test(raw)) score += 1;
  if (/\d/.test(raw)) score += 1;
  if (/[^A-Za-z0-9]/.test(raw)) score += 1;
  if (!raw) return { ok: false, score: 0, reason: "Password is required." };
  if (raw.length < MIN_PASSWORD_LEN)
    return { ok: false, score, reason: `At least ${MIN_PASSWORD_LEN} characters.` };
  return { ok: true, score };
}

// --- one-time passcode (OTP) ---
// Offline-first: a real gateway (SMTP / provider API) plugs in at `sendOtpToInbox`.
// Until then the code is handed straight to the UI so the flow works end to end.

const OTP_TTL_MS = 5 * 60 * 1000; // valid 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

export interface OtpDelivery {
  email: string;
  code: string;
  expiresInSec: number;
  simulated: boolean;
}

export async function requestOtp(email: string): Promise<OtpDelivery> {
  const emailCheck = validateEmail(email);
  if (!emailCheck.ok) throw new AuthError("EMAIL_INVALID", emailCheck.reason);
  const clean = email.trim().toLowerCase();

  const now = Date.now();
  const existing = await otpStore.get(clean);
  if (existing && now - existing.createdAt < OTP_RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - existing.createdAt)) / 1000);
    throw new AuthError("OTP_THROTTLED", `Please wait ${wait}s before requesting another code.`);
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await otpStore.put(clean, {
    email: clean,
    code,
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    attemptsLeft: OTP_MAX_ATTEMPTS,
  } satisfies OtpRecord);

  return { email: clean, code, expiresInSec: OTP_TTL_MS / 1000, simulated: true };
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  const rec = await otpStore.get(clean);
  if (!rec) throw new AuthError("OTP_INVALID", "No code has been sent to this address yet.");
  if (rec.expiresAt < Date.now()) {
    await otpStore.remove(clean);
    throw new AuthError("OTP_EXPIRED", "That code expired. Request a new one.");
  }
  if (rec.attemptsLeft <= 0) {
    await otpStore.remove(clean);
    throw new AuthError("OTP_INVALID", "Too many wrong attempts. Request a new code.");
  }
  if (rec.code !== code.trim()) {
    const left = rec.attemptsLeft - 1;
    await otpStore.put(clean, { ...rec, attemptsLeft: left });
    throw new AuthError("OTP_INVALID", `Wrong code. ${left} attempt${left === 1 ? "" : "s"} left.`);
  }
  await otpStore.remove(clean);
  return true;
}

export async function clearOtp(email: string): Promise<void> {
  await otpStore.remove(email.trim().toLowerCase());
}

// --- crypto helpers (PBKDF2 via WebCrypto) ---

async function deriveKey(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 120_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function randomSalt(): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- session tokens ---

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// --- ID generation (monotonic, unique, memorable) ---
// Public IDs look like REP-A7K2-Q9LP — short enough to type, unambiguous
// (no 0/O, 1/I/L), and easy to say out loud for friend lookups.

let idCounter = Number((store<number>("rep:meta").get("idcounter") as unknown) ?? 0);

const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 chars, confusion-safe
const ID_GROUPS = [4, 4];

async function nextPlayerSequence(): Promise<number> {
  idCounter += 1;
  await store<number>("rep:meta").put("idcounter", idCounter);
  return idCounter;
}

/** Encodes a sequence into a fixed-width base-32 code (confusion-safe alphabet). */
export function encodePlayerCode(seq: number): string {
  let n = Math.max(0, Math.floor(seq));
  let digits = "";
  do {
    digits = ID_ALPHABET[n % ID_ALPHABET.length] + digits;
    n = Math.floor(n / ID_ALPHABET.length);
  } while (n > 0);
  digits = digits.padStart(8, ID_ALPHABET[0]);
  return digits.slice(0, 8);
}

export function formatPlayerId(seq: number): PlayerId {
  const code = encodePlayerCode(seq);
  let offset = 0;
  const groups = ID_GROUPS.map((len) => {
    const part = code.slice(offset, offset + len);
    offset += len;
    return part;
  });
  return `${branding.PLAYER_ID_PREFIX}-${groups.join("-")}`;
}

// --- username validation ---

const USERNAME_MAX_LEN = 20;
const USERNAME_MIN_LEN = 3;
const USERNAME_PATTERN = /^[\p{L}\p{N}_\- ]+$/u;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export interface UsernameCheck {
  ok: boolean;
  reason?: string;
}

export function validateUsername(raw: string): UsernameCheck {
  const cleaned = normalizeUsername(raw).replace(/\s+/g, "");
  if (cleaned.length === 0) return { ok: false, reason: "Username cannot be empty." };
  if (cleaned.length < USERNAME_MIN_LEN) return { ok: false, reason: `At least ${USERNAME_MIN_LEN} characters.` };
  if (cleaned.length > USERNAME_MAX_LEN) return { ok: false, reason: `At most ${USERNAME_MAX_LEN} characters.` };
  if (!USERNAME_PATTERN.test(cleaned)) return { ok: false, reason: "Letters, numbers, spaces, _ and - only." };
  if (/[<>"'`]|script|javascript|on\w+=|&\w+;/i.test(cleaned))
    return { ok: false, reason: "That username contains characters we can't accept." };
  return { ok: true };
}

export async function usernameTaken(raw: string): Promise<boolean> {
  const cleaned = normalizeUsername(raw).toLowerCase();
  return usernameIndex.has(cleaned);
}

export async function reserveUsername(username: string, playerId: PlayerId): Promise<void> {
  const key = normalizeUsername(username).toLowerCase();
  if (await usernameIndex.has(key)) throw new AuthError("USERNAME_TAKEN");
  await usernameIndex.put(key, playerId);
}

// --- player-id to username resolution (for friend search later) ---

export async function findPlayerIdByUsername(username: string): Promise<PlayerId | null> {
  const key = normalizeUsername(username).toLowerCase();
  return usernameIndex.get(key);
}

// --- core auth flows ---

export interface RegisteredAccount {
  playerId: PlayerId;
  internalId: string;
  player: Player;
  session: SessionRecord;
}

export async function registerWithEmail(data: Credentials & { username: string }): Promise<RegisteredAccount> {
  const emailCheck = validateEmail(data.email);
  if (!emailCheck.ok) throw new AuthError("EMAIL_INVALID", emailCheck.reason);
  const usernameCheck = validateUsername(data.username);
  if (!usernameCheck.ok) throw new AuthError("USERNAME_INVALID", usernameCheck.reason);
  const passwordCheck = checkPasswordStrength(data.password);
  if (!passwordCheck.ok) throw new AuthError("PASSWORD_WEAK", passwordCheck.reason);
  if (await usernameTaken(data.username)) throw new AuthError("USERNAME_TAKEN");
  const cleanEmail = data.email.trim().toLowerCase();
  if (await emailIndex.has(cleanEmail)) throw new AuthError("EMAIL_TAKEN");

  const internalId = createId("user");
  const seq = await nextPlayerSequence();
  const playerId = formatPlayerId(seq);
  const salt = await randomSalt();
  const passwordHash = await deriveKey(data.password, salt);

  const record: AuthenticationRecord = {
    id: internalId,
    email: cleanEmail,
    passwordHash,
    salt,
    playerId,
    createdAt: Date.now(),
    provider: "password",
  };

  await reserveUsername(data.username, playerId);
  await authStore.put(internalId, record);
  await emailIndex.put(record.email, record);
  const player = await createPlayer({ playerId, username: normalizeUsername(data.username) });

  const session: SessionRecord = {
    token: newToken(),
    playerId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await sessionStore.put(sessionKey, session);

  return { playerId, internalId, player, session };
}

async function repairPlayerIfMissing(playerId: PlayerId, username?: string): Promise<Player | null> {
  const existing = await getPlayer(playerId);
  if (existing) return existing;
  const lookup = await lookupByPlayerId(playerId);
  const fallback = username ?? lookup?.username ?? `gamer_${playerId.replace(/\D/g, "").slice(-6)}`;
  return createPlayer({ playerId, username: fallback });
}

export async function credentialsAreValid(data: Credentials): Promise<boolean> {
  const rec = await emailIndex.get(data.email.trim().toLowerCase());
  if (!rec || rec.provider === "google") return false;
  const hash = await deriveKey(data.password, rec.salt);
  return hash === rec.passwordHash;
}

export async function loginWithEmail(data: Credentials): Promise<SessionRecord> {
  const rec = await emailIndex.get(data.email.trim().toLowerCase());
  if (!rec || rec.provider === "google") throw new AuthError("CREDENTIALS_INVALID");
  const hash = await deriveKey(data.password, rec.salt);
  if (hash !== rec.passwordHash) throw new AuthError("CREDENTIALS_INVALID");
  await repairPlayerIfMissing(rec.playerId);
  const session: SessionRecord = {
    token: newToken(),
    playerId: rec.playerId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await sessionStore.put(sessionKey, session);
  return session;
}

// --- Google sign-in (simulated OAuth) ---
// In production the browser Google sign-in returns an id_token; this offline flow
// derives a deterministic googleId from the verified account email instead.

export interface GoogleIdentity {
  email: string;
  name: string;
  googleId?: string;
}

export async function googleIdFor(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(`google:${email.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).slice(0, 6).join("");
}

export interface GoogleSignInResult {
  playerId: PlayerId;
  internalId: string;
  player: Player;
  session: SessionRecord;
  created: boolean;
}

async function uniqueGoogleUsername(name: string): Promise<string> {
  const cleaned =
    name.trim().replace(/[^\p{L}\p{N}_\- ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20) || "Player";
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? cleaned : `${cleaned.slice(0, 16)}${i}`;
    if (!(await usernameTaken(candidate))) return candidate;
  }
  return `Player${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function signInWithGoogle(identity: GoogleIdentity): Promise<GoogleSignInResult> {
  const emailCheck = validateEmail(identity.email);
  if (!emailCheck.ok) throw new AuthError("EMAIL_INVALID", emailCheck.reason);
  const clean = identity.email.trim().toLowerCase();
  const googleId = identity.googleId ?? (await googleIdFor(clean));

  const existing = await emailIndex.get(clean);
  if (existing) {
    if (existing.provider === "password") {
      throw new AuthError(
        "CREDENTIALS_INVALID",
        "This email already has a password account. Sign in with your password instead."
      );
    }
    if (existing.googleId && existing.googleId !== googleId) {
      throw new AuthError(
        "CREDENTIALS_INVALID",
        "That Google account doesn't match this email. Use the Google account you registered with."
      );
    }
  }

  let rec = existing;
  let created = false;

  if (!rec) {
    const internalId = createId("user");
    const seq = await nextPlayerSequence();
    const playerId = formatPlayerId(seq);
    const salt = await randomSalt();
    const passwordHash = await deriveKey(`google-${newToken()}`, salt);
    const username = await uniqueGoogleUsername(identity.name);
    rec = {
      id: internalId,
      email: clean,
      passwordHash,
      salt,
      playerId,
      createdAt: Date.now(),
      provider: "google",
      googleId,
    };
    await reserveUsername(username, playerId);
    await authStore.put(internalId, rec);
    await emailIndex.put(clean, rec);
    await createPlayer({ playerId, username });
    created = true;
  } else if (!rec.googleId) {
    rec = { ...rec, provider: "google", googleId };
    await authStore.put(rec.id, rec);
    await emailIndex.put(clean, rec);
  }

  await repairPlayerIfMissing(rec.playerId);

  const session: SessionRecord = {
    token: newToken(),
    playerId: rec.playerId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await sessionStore.put(sessionKey, session);

  const player = await getPlayer(rec.playerId);
  if (!player) throw new AuthError("UNKNOWN", "Account created but the profile could not be loaded.");
  return { playerId: rec.playerId, internalId: rec.id, player, session, created };
}

export interface LinkedGoogleAccount {
  email: string;
  username: string;
  playerId: PlayerId;
}

export async function listGoogleAccounts(): Promise<LinkedGoogleAccount[]> {
  const records = await emailIndex.getAll<AuthenticationRecord>();
  const out: LinkedGoogleAccount[] = [];
  for (const entry of records) {
    const rec = entry.value;
    if (rec.provider !== "google") continue;
    const player = await getPlayer(rec.playerId);
    out.push({
      email: rec.email,
      username: player?.username ?? `gamer_${rec.playerId.replace(/\D/g, "").slice(-6)}`,
      playerId: rec.playerId,
    });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

export async function saveSession(session: SessionRecord): Promise<void> {
  await sessionStore.put(sessionKey, session);
}

export async function currentSession(): Promise<SessionRecord | null> {
  const s = await sessionStore.get(sessionKey);
  if (s && s.expiresAt > Date.now()) return s;
  if (s && s.expiresAt <= Date.now()) await sessionStore.remove(sessionKey);
  return null;
}

export async function logout(): Promise<void> {
  await sessionStore.remove(sessionKey);
}

export async function deleteAccount(playerId: PlayerId): Promise<void> {
  const records = await authStore.getAll<AuthenticationRecord>();
  const rec = records.find((r) => r.value.playerId === playerId);
  if (rec) {
    await authStore.remove(rec.id);
    await emailIndex.remove(rec.value.email);
    const uname = await lookupUsernameForPlayer(playerId);
    if (uname) await usernameIndex.remove(uname.toLowerCase());
  }
  await sessionStore.remove(sessionKey);
}

async function lookupUsernameForPlayer(playerId: PlayerId): Promise<string | null> {
  const unames = await usernameIndex.getAll<string>();
  const found = unames.find((u) => u.value === playerId);
  return found ? found.id : null;
}

export interface PublicPlayerLookup {
  playerId: PlayerId;
  username: string;
}

export async function lookupByPlayerId(playerId: PlayerId): Promise<PublicPlayerLookup | null> {
  const unames = await usernameIndex.getAll<string>();
  const found = unames.find((u) => u.value === playerId);
  if (!found) return null;
  return { playerId, username: found.id };
}

export async function lookupByUsername(username: string): Promise<PublicPlayerLookup | null> {
  const key = normalizeUsername(username).toLowerCase();
  const playerId = await usernameIndex.get(key);
  if (!playerId) return null;
  return { playerId, username: key };
}