import { store } from "../storage/StorageService";
import { currentSession } from "../auth/AuthService";
import type { Player, AvatarSpec, PlayerPrivacy, UserSettings, CoachPersonalityId } from "../../types";

const playerCol = store<Player>("rep:player");
const settingsCol = store<UserSettings>("rep:settings");

export const DEFAULT_AVATAR: AvatarSpec = {
  icon: "🔥",
  frame: "frame_void",
  background: "bg_volt",
  accent: "#f59e0b",
};

export const DEFAULT_PRIVACY: PlayerPrivacy = {
  profile: "PUBLIC",
  allowFriendRequests: true,
  allowChallenges: true,
  showBattleHistory: true,
  showAchievements: true,
  showTrophies: true,
  showLeaderboardPosition: true,
  showRegionalRanking: false,
  showOnlineStatus: true,
  showCurrentActivity: true,
  shareAchievementsInFeed: "FRIENDS",
  allowGhostChallenges: true,
  ghostAccess: "FRIENDS",
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "LIGHT",
  reducedMotion: false,
  soundEnabled: true,
  masterVolume: 0.8,
  sfxVolume: 0.7,
  musicVolume: 0.4,
  showLandmarks: true,
  mirrorPreview: true,
  feedbackIntensity: "HIGH",
  debugMode: false,
  showOnlineStatus: true,
  showCurrentActivity: true,
  notificationPrefs: {
    FRIEND_REQUEST: true,
    CHALLENGES: true,
    BATTLE_RESULT: true,
    ACHIEVEMENTS: true,
    LEADERBOARD: true,
    SEASON: true,
    SOCIAL: true,
  },
  coachPersonality: "SUPPORTIVE",
};

export async function createPlayer(input: {
  playerId: string;
  username: string;
  avatar?: Partial<AvatarSpec>;
  title?: string;
}): Promise<Player> {
  const player: Player = {
    id: `p_${input.playerId}`,
    playerId: input.playerId,
    username: input.username,
    avatar: { ...DEFAULT_AVATAR, ...input.avatar },
    createdAt: Date.now(),
    title: input.title,
    featuredTrophyIds: [],
    privacy: DEFAULT_PRIVACY,
  };
  await playerCol.put(input.playerId, player);
  await settingsCol.put(input.playerId, DEFAULT_SETTINGS);
  return player;
}

export async function getPlayer(playerId: string): Promise<Player | null> {
  return playerCol.get(playerId);
}

export async function getPlayerOrThrow(playerId: string): Promise<Player> {
  const p = await getPlayer(playerId);
  if (!p) throw new Error("PLAYER_NOT_FOUND");
  return p;
}

export async function updatePlayer(playerId: string, patch: Partial<Player>): Promise<Player> {
  const p = await getPlayerOrThrow(playerId);
  const next = { ...p, ...patch, avatar: { ...p.avatar, ...patch.avatar } as AvatarSpec };
  await playerCol.put(playerId, next);
  return next;
}

export async function updateAvatar(playerId: string, avatar: Partial<AvatarSpec>): Promise<Player> {
  const p = await getPlayerOrThrow(playerId);
  const next = { ...p, avatar: { ...p.avatar, ...avatar } as AvatarSpec };
  await playerCol.put(playerId, next);
  return next;
}

export async function updatePrivacy(playerId: string, privacy: Partial<PlayerPrivacy>): Promise<Player> {
  const p = await getPlayerOrThrow(playerId);
  const next = { ...p, privacy: { ...p.privacy, ...privacy } };
  await playerCol.put(playerId, next);
  return next;
}

export async function getSettings(playerId: string | null | undefined): Promise<UserSettings> {
  if (!playerId) return DEFAULT_SETTINGS;
  const s = await settingsCol.get(playerId);
  if (s) return s;
  await settingsCol.put(playerId, DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(playerId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const s = await getSettings(playerId);
  const next = { ...s, ...patch, notificationPrefs: { ...s.notificationPrefs, ...patch.notificationPrefs } };
  await settingsCol.put(playerId, next);
  return next;
}

export async function setPersonality(playerId: string, personality: CoachPersonalityId): Promise<void> {
  await updateSettings(playerId, { coachPersonality: personality });
}

export async function allPlayers(): Promise<Player[]> {
  const list = await playerCol.getAll<Player>();
  return list.map((l) => l.value);
}

export async function currentPlayer(): Promise<Player | null> {
  const session = await currentSession();
  if (!session) return null;
  return getPlayer(session.playerId);
}

export async function deletePlayerRecord(playerId: string): Promise<void> {
  await playerCol.remove(playerId);
  await settingsCol.remove(playerId);
}