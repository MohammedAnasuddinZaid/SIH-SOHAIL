// Centralized application branding configuration.
// Change the product name / tagline here once — nothing in the UI hard-codes it.

interface BrandingConfig {
  readonly APP_NAME: string;
  readonly APP_TAGLINE: string;
  readonly APP_DESCRIPTION: string;
  readonly APP_VERSION: string;
  readonly APP_LOGO: string;
  readonly PLAYER_ID_PREFIX: string;
  readonly DEFAULT_REGION: string;
}

const env = (import.meta.env ?? {}) as Record<string, string | undefined>;

export const branding: BrandingConfig = {
  APP_NAME: env.VITE_APP_NAME ?? "ZELUX",
  APP_TAGLINE: env.VITE_APP_TAGLINE ?? "Your reps are your power.",
  APP_DESCRIPTION:
    "ZELUX counts your push-ups and squats live from your camera, then turns every rep into levels, ranks, battles and streaks. Private, offline-first, no accounts.",
  APP_VERSION: "2.1.0",
  APP_LOGO: "/icons/icon.svg",
  PLAYER_ID_PREFIX: "ZX",
  DEFAULT_REGION: "GLOBAL",
};