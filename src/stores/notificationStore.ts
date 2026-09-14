import { create } from "zustand";
import { NotificationService } from "../core/social/NotificationService";
import type { AppNotification } from "../types";

interface NotifState {
  list: AppNotification[];
  loaded: boolean;
  load: (playerId: string) => Promise<void>;
  subscribe: (playerId: string) => () => void;
  markRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
  clear: () => void;
}

export const useNotifStore = create<NotifState>((set) => {
  const svc = (id: string) => new NotificationService(id);
  let channel: BroadcastChannel | null = null;

  return {
    list: [],
    loaded: false,

    load: async (playerId) => {
      const list = await svc(playerId).list();
      set({ list, loaded: true });
    },

    subscribe: (playerId) => {
      const sv = svc(playerId);
      void sv.unreadCount();
      set({ list: [] });
      void sv.list().then((l) => set({ list: l, loaded: true }));
      try {
        channel?.close();
        channel = new BroadcastChannel("rep:notifications");
        channel.onmessage = (ev) => {
          if (ev.data?.type === "NEW_NOTIFICATION" && ev.data?.playerId === playerId) {
            void sv.list().then((l) => set({ list: l }));
          }
        };
      } catch {
        /* noop */
      }
      return () => {
        channel?.close();
        channel = null;
      };
    },

    markRead: async (id) => {
      const pid = useNotifStore.getState().list[0]?.playerId;
      if (!pid) return;
      await svc(pid).markRead(id);
      set((s) => ({ list: s.list.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)) }));
    },

    markAll: async () => {
      const pid = useNotifStore.getState().list[0]?.playerId;
      if (!pid) return;
      await svc(pid).markAllRead();
      set((s) => ({ list: s.list.map((n) => (n.readAt ? n : { ...n, readAt: Date.now() })) }));
    },

    clear: () => set({ list: [], loaded: false }),
  };
});

export function useUnreadCount(): number {
  return useNotifStore((s) => s.list.filter((n) => !n.readAt).length);
}