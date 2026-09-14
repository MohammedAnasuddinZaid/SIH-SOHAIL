import { create } from "zustand";
import {
  currentSession,
  googleIdFor,
  loginWithEmail,
  logout,
  registerWithEmail,
  signInWithGoogle,
  type GoogleSignInResult,
} from "../core/auth/AuthService";
import { currentPlayer, getPlayer } from "../core/identity/PlayerService";
import type { Player, PlayerId } from "../types";

interface AuthState {
  player: Player | null;
  busy: boolean;
  bootstrapped: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<PlayerId>;
  signIn: (email: string, password: string) => Promise<void>;
  googleSignIn: (name: string, email: string) => Promise<GoogleSignInResult>;
  signOut: () => Promise<void>;
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
    const session = await currentSession();
    let player: Player | null = null;
    if (session) {
      player = await getPlayer(session.playerId);
    } else {
      player = await currentPlayer(); // dev fallback: single shared local profile
    }
    set({ player, bootstrapped: true, busy: false });
  },

  register: async (email, username, password) => {
    set({ busy: true, error: null });
    try {
      const { playerId, player } = await registerWithEmail({ email, password, username });
      set({ player, busy: false });
      return playerId;
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
      throw e;
    }
  },

  signIn: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const session = await loginWithEmail({ email, password });
      const player = await getPlayer(session.playerId);
      set({ player, busy: false });
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
      throw e;
    }
  },

  googleSignIn: async (name, email) => {
    set({ busy: true, error: null });
    try {
      const result = await signInWithGoogle({ name, email, googleId: await googleIdFor(email) });
      set({ player: result.player, busy: false });
      return result;
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
      throw e;
    }
  },

  signOut: async () => {
    await logout();
    set({ player: null });
  },

  refreshProfile: async () => {
    const id = get().player?.playerId;
    if (id) set({ player: await getPlayer(id) });
  },
}));

export function usePlayerId(): PlayerId | null {
  return useAuthStore((s) => s.player?.playerId ?? null);
}