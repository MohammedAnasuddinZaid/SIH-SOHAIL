import { create } from "zustand";
import { currentSession } from "../core/auth/AuthService";
import { getOrCreateDevicePlayer, rotateDevicePlayer } from "../core/auth/DeviceIdentity";
import { getPlayer } from "../core/identity/PlayerService";
import type { Player, PlayerId } from "../types";

interface AuthState {
  player: Player | null;
  busy: boolean;
  bootstrapped: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  /** Rotate this device to a brand-new identity (no login, no account). */
  resetIdentity: () => Promise<Player>;
  refreshProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  player: null,
  busy: false,
  bootstrapped: false,
  error: null,

  bootstrap: async () => {
    if (get().bootstrapped) return;
    set({ busy: true, error: null });
    let player: Player | null = null;
    const session = await currentSession();
    if (session) {
      // Bound account/device identity already present for this player.
      player = (await getPlayer(session.playerId)) ?? (await getOrCreateDevicePlayer());
    } else {
      // No session yet → every device gets its own identity automatically.
      player = await getOrCreateDevicePlayer();
    }
    set({ player, bootstrapped: true, busy: false });
  },

  resetIdentity: async () => {
    set({ busy: true, error: null });
    try {
      const player = await rotateDevicePlayer();
      set({ player, busy: false });
      return player;
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
      throw e;
    }
  },

  refreshProfile: async () => {
    const id = get().player?.playerId;
    if (id) set({ player: (await getPlayer(id)) ?? (await getOrCreateDevicePlayer()) });
  },
}));

export function usePlayerId(): PlayerId | null {
  return useAuthStore((s) => s.player?.playerId ?? null);
}