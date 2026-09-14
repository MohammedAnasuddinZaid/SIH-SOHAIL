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
  APP_NAME: env.VITE_APP_NAME ?? "REP ARENA",
  APP_TAGLINE: env.VITE_APP_TAGLINE ?? "Turn every push-up into a competition.",
  APP_DESCRIPTION:
    "A competitive fitness game. Your camera reads your push-ups, your reps are your score, and the arena never ends.",
  APP_VERSION: "1.0.0",
  APP_LOGO: "/icons/icon.svg",
  PLAYER_ID_PREFIX: "REP",
  DEFAULT_REGION: "GLOBAL",
};