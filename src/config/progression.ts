import type { RankName, RankDefinition } from "../types";

// Centralized progression economy. All XP, level, rank and quest balancing lives here.

export const XPConfig = {
  validRepXP: 2,
  workoutCompletionXP: 40,
  battleParticipationXP: 30,
  battleWinXP: 120,
  battleDrawXP: 60,
  personalRecordXP: 100,
  levelUpBonusXP: 60,
  firstWorkoutXP: 50,
  firstBattleXP: 50,
  firstFriendXP: 30,
  dailyGoalXP: 80,
  weeklyGoalXP: 200,
  formMilestoneXP: 40,
  maxAuxiliaryPerDay: 400, // caps non-rep auxiliary rewards per day
};

const LEVEL_XP_CURVE: Record<number, number> = {
  1: 0, 2: 100, 3: 250, 4: 450, 5: 700, 6: 1000, 7: 1350, 8: 1750, 9: 2200, 10: 2700,
  11: 3250, 12: 3850, 13: 4500, 14: 5200, 15: 5950, 16: 6750, 17: 7600, 18: 8500, 19: 9450, 20: 10450,
};

export function baseCurveForLevel(level: number): number {
  if (LEVEL_XP_CURVE[level] !== undefined) return LEVEL_XP_CURVE[level];
  // Extrapolate with a gently rising curve after level 20: ~550 XP per extra level.
  const lastKnown = LEVEL_XP_CURVE[20];
  return lastKnown + (level - 20) * 550;
}

export function getLevelFromXP(totalXP: number): number {
  let level = 1;
  let remaining = totalXP;
  const maxLevel = 999;
  while (level < maxLevel) {
    const req = baseCurveForLevel(level + 1) - baseCurveForLevel(level);
    if (remaining >= req) {
      remaining -= req;
      level += 1;
    } else break;
  }
  return level;
}

export function getXPRequiredForLevel(level: number): number {
  return baseCurveForLevel(level) - baseCurveForLevel(Math.max(1, level - 1));
}

export function getProgress(level: number, totalXP: number): {
  xpIntoLevel: number;
  xpRequiredForNextLevel: number;
  progressPercent: number;
} {
  const levelBase = baseCurveForLevel(level);
  const nextBase = baseCurveForLevel(level + 1);
  const xpIntoLevel = Math.max(0, totalXP - levelBase);
  const xpRequiredForNextLevel = nextBase - levelBase;
  const progressPercent = Math.min(100, Math.max(0, (xpIntoLevel / xpRequiredForNextLevel) * 100));
  return { xpIntoLevel, xpRequiredForNextLevel, progressPercent };
}

export const RANKS: RankName[] = [
  "ROOKIE", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "CHAMPION", "LEGEND",
];

export const RANK_DEFINITIONS: RankDefinition[] = [
  { rank: "ROOKIE", minRating: 0, colorToken: "rank-rookie", icon: "●" },
  { rank: "BRONZE", minRating: 200, colorToken: "rank-bronze", icon: "◆" },
  { rank: "SILVER", minRating: 400, colorToken: "rank-silver", icon: "◆" },
  { rank: "GOLD", minRating: 650, colorToken: "rank-gold", icon: "◆" },
  { rank: "PLATINUM", minRating: 900, colorToken: "rank-platinum", icon: "◆" },
  { rank: "DIAMOND", minRating: 1150, colorToken: "rank-diamond", icon: "◆" },
  { rank: "MASTER", minRating: 1400, colorToken: "rank-master", icon: "★" },
  { rank: "GRANDMASTER", minRating: 1700, colorToken: "rank-grandmaster", icon: "★" },
  { rank: "CHAMPION", minRating: 2000, colorToken: "rank-champion", icon: "★" },
  { rank: "LEGEND", minRating: 2300, colorToken: "rank-legend", icon: "▲" },
];

export const DIVISIONS = 3; // III, II, I

export function getRankFromRating(rating: number): { rank: RankName; division: number } {
  let current = RANK_DEFINITIONS[0];
  for (const def of RANK_DEFINITIONS) {
    if (rating >= def.minRating) current = def;
    else break;
  }
  const idx = RANK_DEFINITIONS.findIndex((d) => d.rank === current.rank);
  const nextMin = RANK_DEFINITIONS[idx + 1]?.minRating;
  const span = nextMin !== undefined ? nextMin - current.minRating : 300;
  const progress = Math.max(0, Math.min(1, (rating - current.minRating) / span));
  const division = Math.max(1, DIVISIONS - Math.floor(progress * DIVISIONS));
  return { rank: current.rank, division };
}

export function rankDisplayName(rank: RankName, division?: number): string {
  const base = rank.charAt(0) + rank.slice(1).toLowerCase();
  if (division === undefined || rank === "LEGEND" || rank === "CHAMPION") return base;
  const roman = ["", "III", "II", "I"];
  return `${base} ${roman[division] ?? "I"}`;
}

export const RATING_CONFIG = {
  kFactor: 32,
  placementMatches: 5,
  initialRating: 1000,
  demotionProtectionRating: 100, // can't drop below this many points under current rank floor
  maxRatingChangePerMatch: 40,
};

export const SEASON_CONFIG = {
  seasonLengthDays: 28,
  seasonScorePerRep: 1,
  seasonScorePerWin: 100,
  seasonScorePerPerfectForm: 25,
  quarterlyRewards: { top3XP: 5000, top10XP: 2500, top100XP: 1000 },
};

export const LEADERBOARD_CONFIG = {
  dailyResetHourUTC: 0,
  weeklyResetDayUTC: 1, // Monday
  monthlyResetDayUTC: 1,
  viewWindow: 60,
  ownMargin: 5,
  topN: 100,
};

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365];

export const ACHIEVEMENTS = [
  { id: "first_rep", name: "First Rep", description: "Complete your first verified push-up.", category: "BEGINNER", requirement: { type: "TOTAL_REPS", value: 1 }, rewardXP: 50, icon: "1️⃣" },
  { id: "first_workout", name: "First Workout", description: "Finish your first verified workout.", category: "BEGINNER", requirement: { type: "WORKOUTS", value: 1 }, rewardXP: 50, icon: "🏁" },
  { id: "hundred_reps", name: "Centurion", description: "Reach 100 lifetime valid reps.", category: "TRAINING", requirement: { type: "TOTAL_REPS", value: 100 }, rewardXP: 100, icon: "💯" },
  { id: "thousand_reps", name: "The Wall", description: "Reach 1,000 lifetime valid reps.", category: "TRAINING", requirement: { type: "TOTAL_REPS", value: 1000 }, rewardXP: 300, icon: "🧱" },
  { id: "ten_workouts", name: "Seasoned", description: "Complete 10 workouts.", category: "TRAINING", requirement: { type: "WORKOUTS", value: 10 }, rewardXP: 150, icon: "🎒" },
  { id: "first_battle", name: "First Blood", description: "Complete your first battle.", category: "COMPETITION", requirement: { type: "BATTLES", value: 1 }, rewardXP: 80, icon: "⚔️" },
  { id: "first_win", name: "Victor", description: "Win your first battle.", category: "COMPETITION", requirement: { type: "BATTLE_WINS", value: 1 }, rewardXP: 120, icon: "🏆" },
  { id: "ten_wins", name: "Dominator", description: "Win 10 battles.", category: "COMPETITION", requirement: { type: "BATTLE_WINS", value: 10 }, rewardXP: 400, icon: "🥇" },
  { id: "streak_7", name: "Momentum", description: "Reach a 7-day consistency streak.", category: "CONSISTENCY", requirement: { type: "STREAK", value: 7 }, rewardXP: 200, icon: "🔥" },
  { id: "streak_30", name: "Unstoppable", description: "Reach a 30-day consistency streak.", category: "CONSISTENCY", requirement: { type: "STREAK", value: 30 }, rewardXP: 600, icon: "🌋" },
  { id: "form_90", name: "Form Master", description: "Achieve an average form score of 90+ in a session.", category: "FORM", requirement: { type: "FORM_AVG", value: 90 }, rewardXP: 200, icon: "🎯" },
  { id: "perfect_session", name: "Perfect Session", description: "Complete a session with perfect form.", category: "FORM", requirement: { type: "PERFECT_FORM_SESSION", value: 1 }, rewardXP: 250, icon: "✨" },
  { id: "first_friend", name: "Companion", description: "Add your first friend.", category: "SOCIAL", requirement: { type: "FRIENDS", value: 1 }, rewardXP: 50, icon: "🤝" },
  { id: "five_friends", name: "Squad", description: "Add 5 friends.", category: "SOCIAL", requirement: { type: "FRIENDS", value: 5 }, rewardXP: 150, icon: "👥" },
  { id: "level_10", name: "Rising Competitor", description: "Reach level 10.", category: "EXPLORATION", requirement: { type: "LEVEL", value: 10 }, rewardXP: 200, icon: "📈" },
  { id: "level_25", name: "Arena Veteran", description: "Reach level 25.", category: "EXPLORATION", requirement: { type: "LEVEL", value: 25 }, rewardXP: 600, icon: "🎖️" },
  { id: "pr_first", name: "Personal Legend", description: "Set your first personal record.", category: "MASTERY", requirement: { type: "PRS", value: 1 }, rewardXP: 80, icon: "🏅" },
  { id: "pr_ten", name: "Record Breaker", description: "Set 10 personal records.", category: "MASTERY", requirement: { type: "PRS", value: 10 }, rewardXP: 400, icon: "💎" },
  { id: "rating_1150", name: "Diamond Hands", description: "Reach Diamond rating.", category: "COMPETITION", requirement: { type: "RATING", value: 1150 }, rewardXP: 500, icon: "💠" },
] as const;

export const TROPHIES = [
  { id: "trophy_first_rep", name: "First Rep", description: "Completed your first valid rep.", rarity: "COMMON", icon: "🏅", requirement: { type: "TOTAL_REPS", value: 1 } },
  { id: "trophy_1000", name: "Iron Wall", description: "1,000 lifetime valid reps.", rarity: "RARE", icon: "🧗", requirement: { type: "TOTAL_REPS", value: 1000 } },
  { id: "trophy_100_win", name: "Century Champion", description: "Win 100 battles.", rarity: "LEGENDARY", icon: "👑", requirement: { type: "BATTLE_WINS", value: 100 } },
  { id: "trophy_streak_365", name: "Year Zero", description: "365-day consistency streak.", rarity: "LEGENDARY", icon: "🔥", requirement: { type: "STREAK", value: 365 } },
  { id: "trophy_diamond", name: "Diamond Mastery", description: "Reach Diamond rating.", rarity: "EPIC", icon: "💎", requirement: { type: "RATING", value: 1150 } },
  { id: "trophy_perfect", name: "Perfect Form", description: "One perfect-form session.", rarity: "EPIC", icon: "🎯", requirement: { type: "PERFECT_FORM_SESSION", value: 1 } },
] as const;

export const QUEST_TEMPLATES: Record<"DAILY" | "WEEKLY", Array<{ id: string; title: string; description: string; requirement: { type: string; value: number }; rewardXP: number }>> = {
  DAILY: [
    { id: "d_workout", title: "Complete a workout", description: "Finish one verified workout today.", requirement: { type: "WORKOUTS", value: 1 }, rewardXP: XPConfig.dailyGoalXP },
    { id: "d_reps_50", title: "Perform 50 valid reps", description: "Accumulate 50 valid reps today.", requirement: { type: "TOTAL_REPS", value: 50 }, rewardXP: 150 },
    { id: "d_battle", title: "Complete a battle", description: "Finish one battle today.", requirement: { type: "BATTLES", value: 1 }, rewardXP: 200 },
    { id: "d_win", title: "Win a battle", description: "Win one battle today.", requirement: { type: "BATTLE_WINS", value: 1 }, rewardXP: 250 },
  ],
  WEEKLY: [
    { id: "w_workouts_3", title: "3 workouts this week", description: "Complete three verified workouts.", requirement: { type: "WORKOUTS", value: 3 }, rewardXP: XPConfig.weeklyGoalXP },
    { id: "w_battles_2", title: "2 battles this week", description: "Complete two battles.", requirement: { type: "BATTLES", value: 2 }, rewardXP: 750 },
    { id: "w_reps_300", title: "300 reps this week", description: "Accumulate 300 valid reps.", requirement: { type: "TOTAL_REPS", value: 300 }, rewardXP: 900 },
    { id: "w_pr", title: "Set a personal record", description: "Set any personal record this week.", requirement: { type: "PRS", value: 1 }, rewardXP: 600 },
    { id: "w_form", title: "90+ form average", description: "Achieve 90+ average form in one session.", requirement: { type: "FORM_AVG", value: 90 }, rewardXP: 700 },
  ],
};