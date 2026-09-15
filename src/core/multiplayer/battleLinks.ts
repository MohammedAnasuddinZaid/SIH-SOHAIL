// Battle join links. A room code is encoded into a URL so it can be shared,
// copy-pasted, or scanned as a QR from another phone. Opening the link drops
// the player straight into the join flow for that room.

export function buildRoomJoinUrl(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = `${origin}/battle`;
  return `${base}?room=${encodeURIComponent(code.trim().toUpperCase())}`;
}

/** Extract a room code from a scanned/pasted value (URL or bare code). */
export function parseRoomCode(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get("room");
    if (fromQuery) return normalizeCode(fromQuery);
  } catch {
    /* not a URL — fall through */
  }
  // Maybe the whole value is "https://.../battle?room=CODE" but URL parsing
  // failed (e.g. pasted without scheme). Try a manual query extraction.
  const match = value.match(/[?&]room=([A-Za-z0-9]+)/);
  if (match) return normalizeCode(match[1]);
  return normalizeCode(value);
}

/** Room codes are 5 chars from the confusion-safe alphabet. */
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length >= 4 && code.length <= 8 ? code : null;
}