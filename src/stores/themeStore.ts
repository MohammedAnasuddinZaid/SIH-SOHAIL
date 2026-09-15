// ZELUX theme store. Dark is the default; light is an opt-in user choice. The
// theme is applied before first paint by an inline script in index.html and
// kept in sync here for the toggle UI.

import { create } from "zustand";

export type AppTheme = "light" | "dark";

const KEY = "rep:theme";
const META_THEME_DARK = "#000000";
const META_THEME_LIGHT = "#ffffff";

function initialTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

function applyTheme(theme: AppTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.getElementById("theme-color") as HTMLMetaElement | null;
  if (meta) meta.content = theme === "dark" ? META_THEME_DARK : META_THEME_LIGHT;
}

let active = initialTheme();
applyTheme(active);

interface ThemeStore {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: active,
  setTheme: (theme) => {
    active = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable */
    }
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => {
    get().setTheme(get().theme === "light" ? "dark" : "light");
  },
}));