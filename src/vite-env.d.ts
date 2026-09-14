/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_TAGLINE?: string;
  readonly VITE_REALTIME_RELAY_URL?: string;
  readonly VITE_AI_COACH_ENDPOINT?: string;
  readonly VITE_AI_API_KEY?: string;
  readonly VITE_DIRECTORY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}