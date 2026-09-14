import { store, createId } from "../storage/StorageService";
import { GAME_CONFIG } from "../../config/game";
import { getPlayer } from "../identity/PlayerService";
import { getRating, levelProgress, rankDisplayName } from "../progression/ProgressionService";
import type { PlayerId, Room, RoomStatus, RoomSettings, RoomPlayer } from "../../types";

const roomCol = store<Room[]>("rep:rooms");

function chars(): string {
  return GAME_CONFIG.roomCodeChars;
}

export function generateRoomCode(): string {
  let code = "";
  const set = chars();
  for (let i = 0; i < GAME_CONFIG.roomCodeLength; i++) {
    code += set[Math.floor(Math.random() * set.length)];
  }
  return code;
}

export async function findRoomByCode(code: string): Promise<Room | null> {
  const normalized = code.trim().toUpperCase();
  const rooms = await roomCol.get("all");
  if (!rooms) return null;
  const room = rooms.find((r) => r.code === normalized && r.expiresAt > Date.now() && r.status !== "CANCELLED" && r.status !== "FINISHED");
  return room ?? null;
}

async function allRooms(): Promise<Room[]> {
  return (await roomCol.get("all")) ?? [];
}

async function saveRooms(rooms: Room[]): Promise<void> {
  await roomCol.put("all", rooms);
}

async function toRoomPlayer(playerId: PlayerId, host: boolean): Promise<RoomPlayer> {
  const p = await getPlayer(playerId);
  const rating = await getRating(playerId);
  const level = await levelProgress(playerId);
  return {
    playerId,
    username: p?.username ?? playerId,
    avatar: p?.avatar ?? { icon: "🔥", frame: "frame_void", background: "bg_volt", accent: "#f59e0b" },
    level: level.currentLevel,
    rankDisplay: rankDisplayName(rating.rank, rating.division),
    ready: false,
    host,
    joinedAt: Date.now(),
    connected: true,
  };
}

export async function createRoom(hostId: PlayerId, settings: Partial<RoomSettings> = {}): Promise<Room> {
  const rooms = await allRooms();
  // prune expired
  await saveRooms(rooms.filter((r) => r.expiresAt > Date.now() || r.status === "LIVE"));
  const freshRooms = await allRooms();
  const merged: RoomSettings = { ...GAME_CONFIG.defaultRoomSettings(), ...settings };
  const player = await toRoomPlayer(hostId, true);
  const room: Room = {
    id: createId("room"),
    code: generateRoomCode(),
    hostId,
    players: [player],
    settings: merged,
    status: "WAITING",
    createdAt: Date.now(),
    expiresAt: Date.now() + GAME_CONFIG.roomTtlMs,
  };
  freshRooms.push(room);
  await saveRooms(freshRooms);
  broadcastRooms();
  return room;
}

export async function joinRoom(code: string, playerId: PlayerId): Promise<Room> {
  const room = await findRoomByCode(code);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.players.length >= room.settings.playerLimit) throw new Error("ROOM_FULL");
  if (room.players.some((p) => p.playerId === playerId)) return room;
  if (room.status !== "WAITING" && room.status !== "COUNTDOWN") throw new Error("ROOM_ALREADY_STARTED");
  const joined = await toRoomPlayer(playerId, false);
  room.players.push(joined);
  await saveRooms(await allRooms().then((rs) => rs.map((r) => (r.id === room.id ? room : r))));
  broadcastRooms();
  return room;
}

export async function leaveRoom(roomId: string, playerId: PlayerId): Promise<void> {
  const rooms = await allRooms();
  const idx = rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) return;
  const room = rooms[idx];
  room.players = room.players.filter((p) => p.playerId !== playerId);
  if (room.hostId === playerId) {
    // host migration to earliest-joined active player
    if (room.players.length > 0) {
      const newHost = room.players[0];
      newHost.host = true;
      room.hostId = newHost.playerId;
    }
  }
  if (room.players.length === 0) {
    room.status = "CANCELLED";
  }
  await saveRooms(rooms);
  broadcastRooms();
}

export async function setReady(roomId: string, playerId: PlayerId, ready: boolean): Promise<Room> {
  const rooms = await allRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  const p = room.players.find((p) => p.playerId === playerId);
  if (p) p.ready = ready;
  await saveRooms(rooms);
  broadcastRooms();
  return room;
}

export async function getRoom(roomId: string): Promise<Room | null> {
  const rooms = await allRooms();
  return rooms.find((r) => r.id === roomId) ?? null;
}

export async function getRoomsForPlayer(playerId: PlayerId, status?: RoomStatus): Promise<Room[]> {
  const rooms = await allRooms();
  return rooms.filter((r) => r.players.some((p) => p.playerId === playerId) && (!status || r.status === status));
}

export async function updateRoomStatus(roomId: string, status: RoomStatus): Promise<Room> {
  const rooms = await allRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (room) {
    room.status = status;
    await saveRooms(rooms);
  }
  return room ?? ({} as Room);
}

export async function updateRoomSettings(roomId: string, settings: RoomSettings): Promise<Room> {
  const rooms = await allRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (room) {
    room.settings = settings;
    await saveRooms(rooms);
  }
  broadcastRooms();
  return room ?? ({} as Room);
}

export async function linkRoomToMatch(roomId: string, matchId: string): Promise<Room | null> {
  const rooms = await allRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (room) {
    room.matchId = matchId;
    await saveRooms(rooms);
  }
  return room ?? null;
}

export async function kickPlayer(roomId: string, playerId: PlayerId): Promise<void> {
  const rooms = await allRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return;
  room.players = room.players.filter((p) => p.playerId !== playerId);
  await saveRooms(rooms);
  broadcastRooms();
}

export async function closeRoom(roomId: string): Promise<void> {
  const rooms = await allRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (room) room.status = "CANCELLED";
  await saveRooms(rooms);
  broadcastRooms();
}

// Cross-tab synchronization: rooms list changes are broadcast.
const ROOM_CHANNEL = "rep:rooms";
let bc: BroadcastChannel | null = null;

function broadcastRooms(): void {
  try {
    if (!bc) bc = new BroadcastChannel(ROOM_CHANNEL);
    bc.postMessage({ type: "ROOMS_CHANGED", at: Date.now() });
  } catch {
    /* noop */
  }
}

export interface RoomSyncListener {
  onRoomsChanged(rooms: Room[]): void;
}

export function subscribeRooms(listener: RoomSyncListener): () => void {
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(ROOM_CHANNEL);
    ch.onmessage = () => {
      void allRooms().then(listener.onRoomsChanged);
    };
  } catch {
    /* noop */
  }
  return () => ch?.close();
}