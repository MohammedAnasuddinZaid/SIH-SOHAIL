// CoachLocalEngine: a deterministic reasoning layer that turns the REAL
// CoachContext into coaching decisions. It powers every coach reply when no
// model API is configured (offline-first), and provides structured widgets
// (session plan, focus, highlights) for the UI regardless of backend used.

import type { CoachContext } from "./CoachContextBuilder";
import type { CoachPersonalityId } from "../../types";

export type CoachFocus = "TECHNIQUE" | "VOLUME" | "CONSISTENCY" | "RECOVERY" | "COMPETITION";

export interface CoachAssessment {
  focus: CoachFocus;
  focusReason: string;
  strengths: string[];
  gaps: string[];
  nextSession: { sets: number; reps: number; restSec: number } | null;
  sessionRationale: string;
  headline: string;
  highlights: string[];
  wantRest: boolean;
  coherent: boolean;
}

export function assess(ctx: CoachContext): CoachAssessment {
  const o = ctx.overview;
  const gaps: string[] = [];
  const strengths: string[] = [];
  let focus: CoachFocus = "CONSISTENCY";
  let focusReason = "Build consistency first — regular sessions beat heroic one-offs.";

  const wantRest = ctx.lastWorkoutDaysAgo === 1 && o.todayWorkouts >= 1;

  if (o.totalWorkouts === 0) {
    return {
      focus: "CONSISTENCY",
      focusReason: "You haven't completed a verified session yet. First thing: one clean set of push-ups.",
      strengths: [],
      gaps: ["No recorded sessions", "No verified reps yet"],
      nextSession: { sets: 3, reps: 8, restSec: 90 },
      sessionRationale: "Start gentle: 3 rounds of 8 clean reps with full range, 90s rest. Form over speed.",
      headline: "Welcome to the arena. Let's earn your first rep.",
      highlights: [],
      wantRest: false,
      coherent: true,
    };
  }

  if (strengths.length === 0) strengths.push(`Verified ${o.totalReps} total reps across ${o.totalWorkouts} sessions`);

  const lastForm = ctx.recentSessions[0]?.form;
  if (lastForm !== undefined) {
    if (lastForm >= 85) strengths.push(`Last session form averaged ${lastForm} — clean, controlled reps`);
    else if (lastForm < 70) gaps.push(`Form dipped to ${lastForm} last session — likely rushing the descent`);
  }

  if (o.streak.current >= 3) strengths.push(`On a ${o.streak.current}-day streak (best ${o.streak.best})`);
  if (ctx.missedDays >= 3 && o.totalWorkouts > 0) gaps.push(`Only ${ctx.daysThisWeek} active day(s) this week`);

  if (ctx.formTrend === "DECLINING") {
    focus = "TECHNIQUE";
    focusReason = "Your form trend is declining — reassure it: slower, deeper, controlled reps.";
    gaps.push("Form trend angled down; reduce pace and lower volume this week");
  } else if (ctx.lastWorkoutDaysAgo !== null && ctx.lastWorkoutDaysAgo >= 5) {
    focus = "RECOVERY";
    focusReason = "It's been a few days. Rest isn't the enemy — returning gently is the plan.";
    gaps.push(`${ctx.lastWorkoutDaysAgo} days since last session`);
  } else if (o.todayReps === 0 && ctx.daysThisWeek >= 1) {
    focus = "CONSISTENCY";
    focusReason = "Solid week, but today is still zero. One session keeps the streak alive.";
  } else if (lastForm !== undefined && lastForm >= 87) {
    focus = "VOLUME";
    focusReason = "Your form is locked. Now push volume without sacrificing technique.";
    strengths.push("Form quality is consistent — volume can grow");
  } else if (o.totalBattles > 0 && ctx.battleWinRate !== null && ctx.battleWinRate >= 0.5) {
    focus = "COMPETITION";
    focusReason = "You're winning more than half your battles. Sharpen race starts and pacing.";
  }

  if (o.todayReps === 0 && o.streak.current > 0) {
    strengths.push(ctx.daysThisWeek >= 1 ? "Streak alive this week" : "Streak intact");
  }

  // Next-session plan scaled by focus.
  let nextSession: CoachAssessment["nextSession"] = { sets: 4, reps: 12, restSec: 60 };
  let sessionRationale = "4 rounds of 12 with 60s rest, aiming for form 85+ on every rep.";
  if (focus === "TECHNIQUE") {
    nextSession = { sets: 4, reps: 8, restSec: 90 };
    sessionRationale = "4x8 controlled reps, 90s rest. Descend over 2s, press over 1.5s. Stop at 10 form dips.";
  } else if (focus === "RECOVERY") {
    nextSession = { sets: 3, reps: 6, restSec: 120 };
    sessionRationale = "A gentle 3x6 with long rests. Staying active heals faster than sitting out.";
  } else if (focus === "VOLUME") {
    nextSession = { sets: 5, reps: 15, restSec: 45 };
    sessionRationale = "5x15 with 45s rest. Keep every rep above 85 form — fatigue is not an excuse.";
  } else if (focus === "COMPETITION") {
    nextSession = { sets: 6, reps: 10, restSec: 30 };
    sessionRationale = "6x10 with 30s rest: race rhythm training. Front-load speed, hold form through the end.";
  }

  if (wantRest) {
    nextSession = { sets: 2, reps: 10, restSec: 120 };
    sessionRationale = "You trained yesterday — today is light (2x10) or a full rest day. Recovery drives growth.";
  }

  const highlights = [
    ctx.formTrend !== "NO_DATA" ? `Form trend: ${ctx.formTrend.toLowerCase()}` : null,
    o.rating.rating > 0 ? `Competitive rating ${o.rating.rating}` : null,
    o.quests[0] ? `Quest "${o.quests[0].title}" ${o.quests[0].progress}/${o.quests[0].target}` : null,
    o.bestSessionReps > 0 ? `Best session ${o.bestSessionReps} reps` : null,
  ].filter((x): x is string => x !== null);

  const headline = pickHeadline(ctx.personality, focus, o.totalWorkouts === 0 ? "FIRST" : "GENERAL");

  return {
    focus,
    focusReason,
    strengths: strengths.slice(0, 3),
    gaps: gaps.slice(0, 3),
    nextSession,
    sessionRationale,
    headline,
    highlights,
    wantRest,
    coherent: true,
  };
}

type HeadlineKey = "FIRST" | "GENERAL";

function pickHeadline(personality: CoachPersonalityId, focus: CoachFocus, key: HeadlineKey): string {
  if (key === "FIRST") return "Welcome to the arena. Let's earn your first rep.";
  const byPersona: Record<CoachPersonalityId, Record<CoachFocus, string>> = {
    SUPPORTIVE: {
      TECHNIQUE: "Good news: your form is the fastest thing to fix. Let's slow it down together.",
      VOLUME: "You're ready to add volume. I believe in this one — rep by rep.",
      CONSISTENCY: "Small steps daily beat big sprints monthly. Today is your small step.",
      RECOVERY: "You've earned your rest. A light session today keeps the engine warm.",
      COMPETITION: "Your momentum is real. Let's sharpen the racing edge gently.",
    },
    DRILL_SERGEANT: {
      TECHNIQUE: "Your form is slipping, soldier. We fix it with SLOW reps, not excuses.",
      VOLUME: "Comfort zone detected. We're blowing it up — more reps, same perfect form.",
      CONSISTENCY: "You missed days, recruit. Lace up, show up, put in work TODAY.",
      RECOVERY: "REST IS ORDERS. Light session or none, that arm needs repairs.",
      COMPETITION: "Half-fights don't win wars. Train speed with zero form cowardice.",
    },
    SCIENTIST: {
      TECHNIQUE: "Form trend down 3+ points over recent sessions — corrective action indicated.",
      VOLUME: "Form within tolerance; volume can be increased per progressive-overload model.",
      CONSISTENCY: "Data shows inconsistency this week. A regular schedule maximizes adaptation.",
      RECOVERY: "Recovery gap detected. Suggests deload with sustained active recovery.",
      COMPETITION: "Win rate positive. Train pacing vectors to dominate early race phases.",
    },
  };
  return byPersona[personality]?.[focus] ?? "Let's get to work.";
}

/** Persona-flavored closing action line. */
export function closingLine(personality: CoachPersonalityId, focus: CoachFocus): string {
  const map: Record<CoachPersonalityId, Record<CoachFocus, string>> = {
    SUPPORTIVE: {
      TECHNIQUE: "Next session: precise, patient, kind to your joints.",
      VOLUME: "Add a set, keep the form, feel the growth.",
      CONSISTENCY: "One session today. That's the whole mission.",
      RECOVERY: "Rest up — I'll be right here when you're ready.",
      COMPETITION: "Sharpen the start, keep the finish proud.",
    },
    DRILL_SERGEANT: {
      TECHNIQUE: "SLOW DOWN. FEEL IT. REP IT. DROP AND GIVE ME 8.",
      VOLUME: "ADD A SET. NO EXCUSES. DROP AND GIVE ME 15.",
      CONSISTENCY: "SHOW UP. THAT'S THE ENTIRE DRILL. DROP AND GIVE ME 10.",
      RECOVERY: "HEAL UP, THEN GIVE ME THE SESSION YOU OWE ME.",
      COMPETITION: "REPS FAST, FORM TRUE. DROP AND GO.",
    },
    SCIENTIST: {
      TECHNIQUE: "Prescribe 4x8 controlled reps, 90s rest.",
      VOLUME: "Prescribe 5x15 with 45s rest, form floor 85.",
      CONSISTENCY: "Prescribe daily 3x10 moderate reps this week.",
      RECOVERY: "Prescribe 2x10 light or full rest. Track next session.",
      COMPETITION: "Prescribe 6x10 tempo sets targeting race pace.",
    },
  };
  return map[personality]?.[focus] ?? "Keep showing up.";
}

/** One-sentence persona reaction to a user question/statement (skip if empty). */
export function reactToUserText(personality: CoachPersonalityId, text: string): string {
  const t = text.toLowerCase();
  if (/(exhausted|tired|sore|pain|hurt)/.test(t) && personality === "DRILL_SERGEANT") {
    return "Pain talk gets my full attention — we stop or go light. That's an order, and it's for YOU.";
  }
  if (/(motivat|cant|can't|give up)/.test(t) && personality === "SUPPORTIVE") {
    return "You don't need to be perfect today. You just need to start. I'll count with you.";
  }
  return "";
}

// ────────────────────────────────────────────
// Conversational intent routing — small talk gets real replies instead of the
// full numbers dump every time.
// ────────────────────────────────────────────

export type CoachIntent =
  | "GREETING"
  | "HOW_AM_I"
  | "TRAINING_PLAN"
  | "MOTIVATION"
  | "PAIN"
  | "THANKS"
  | "FAREWELL"
  | "DEFAULT";

export function detectIntent(text: string): CoachIntent {
  const t = text.toLowerCase().trim();
  if (!t) return "DEFAULT";
  if (/(pain|hurt|injured|injur|sore|aching|exhausted|tired)/.test(t)) return "PAIN";
  if (/^(hi|hello|hey|yo|sup|wassup|namaste|good (morning|afternoon|evening))\b/.test(t) || /^(hi|hello|hey|yo|sup)[!.,\s]*$/.test(t)) return "GREETING";
  if (/(how am i|how.*(doing|going|performance|form|progress)|am i (doing|improving)|status|check.?in|review|streak)/.test(t)) return "HOW_AM_I";
  if (/(plan|schedule|routine|program|should i|what.*(do|train|workout|session)s?\b|give me|next session|suggest|workout (today|now|for)|how much|how many)/.test(t)) return "TRAINING_PLAN";
  if (/(motivat|cant'?t|give up|worth it|keep going|struggl|hard|difficult|discourag|unmotivated|tired of)/.test(t)) return "MOTIVATION";
  if (/(thanks|thank you|thx|cheers|appreciate|nice)/.test(t)) return "THANKS";
  if (/(bye|goodbye|see (you|ya)|talk later|gtg|gotta go|going now|good night|gn|peace out)/.test(t)) return "FAREWELL";
  return "DEFAULT";
}

const PERSONA_LINES: Record<CoachPersonalityId, { greet: string; motivate: string; thanks: string; farewell: string; pain: string }> = {
  SUPPORTIVE: {
    greet: "Hey! Good to see you in the arena. 👋",
    motivate: "You don't have to be perfect — you just have to start. One clean set beats wondering about the rest.",
    thanks: "Anytime. That's what I'm here for — right beside you, rep by rep.",
    farewell: "Go crush that session. I'll be here when you're back.",
    pain: "Take this seriously: if something hurts, rest it. Listen to your body over your ego — tomorrow you'll be glad you did.",
  },
  DRILL_SERGEANT: {
    greet: "Recruit. Good of you to show up.",
    motivate: "Comfort is a liar. You don't need feelings — you need three more sets with clean form. MOVE.",
    thanks: "Don't thank me. Pay me back with reps.",
    farewell: "Disappear until your session is done. Then you may return.",
    pain: "STOP. Pain is a STOP ORDER, recruit — not a challenge. Rest, ice, and come back strong tomorrow.",
  },
  SCIENTIST: {
    greet: "Greetings. Session data collected — 0 minutes elapsed today.",
    motivate: "Adaptation happens in the work you do when motivation is nil. A short session still adds a data point.",
    thanks: "Acknowledged. Positive reinforcement correlates with adherence.",
    farewell: "Recording session end. See you at the next training load.",
    pain: "Pain is a signal, not a badge. Recommend rest and a check-in with a professional before resuming load.",
  },
};

/**
 * Compose the full coach reply. Casual intents (hi / plan / motivation / pain)
 * get short, persona-flavored answers. "How am I doing" and everything else
 * get the real assessment grounded in the player's data.
 */
export function composeCoachReply(_ctx: CoachContext, a: CoachAssessment, personality: CoachPersonalityId, userText: string, personName: string): string {
  const lines = PERSONA_LINES[personality] ?? PERSONA_LINES.SUPPORTIVE;
  const custom = reactToUserText(personality, userText);
  const intent = detectIntent(userText);

  const parts: string[] = [];
  if (custom) parts.push(custom);

  switch (intent) {
    case "PAIN":
      parts.push(lines.pain);
      parts.push(a.headline);
      parts.push(
        a.wantRest
          ? "Take today off — your body literally asked for it. Tomorrow we rebuild."
          : "Keep it light, and if it still hurts, a professional should take a look. No rep is worth a season off."
      );
      break;

    case "GREETING":
      parts.push(lines.greet);
      parts.push(a.headline);
      parts.push(`Ask me "how am I doing" for a progress check, "what should I train?" for your next session, or just tell me how you feel.`);
      break;

    case "HOW_AM_I":
      parts.push(`Here's your check-in, ${personName} said it straight: ${a.focusReason}`);
      if (a.strengths.length > 0) parts.push(`Going well: ${a.strengths.join(" • ")}.`);
      if (a.gaps.length > 0) parts.push(`Keep an eye on: ${a.gaps.join(" • ")}.`);
      if (a.nextSession) parts.push(`Next session: ${a.nextSession.sets} sets × ${a.nextSession.reps} reps, ${a.nextSession.restSec}s rest — ${a.sessionRationale}`);
      parts.push(closingLine(personality, a.focus));
      break;

    case "TRAINING_PLAN":
      parts.push(a.headline);
      if (a.nextSession) parts.push(`Your next session: ${a.nextSession.sets} sets × ${a.nextSession.reps} reps, ${a.nextSession.restSec}s rest. ${a.sessionRationale}`);
      parts.push(closingLine(personality, a.focus));
      break;

    case "MOTIVATION":
      parts.push(lines.motivate);
      if (a.nextSession) parts.push(`Keep it simple today: ${a.nextSession.sets}×${a.nextSession.reps} with ${a.nextSession.restSec}s rest. That's the whole mission.`);
      parts.push(closingLine(personality, a.focus));
      break;

    case "THANKS":
      parts.push(lines.thanks);
      parts.push(a.headline);
      break;

    case "FAREWELL":
      parts.push(lines.farewell);
      break;

    default:
      parts.push(a.headline);
      parts.push(`${personName} saw your numbers: ${a.focusReason}`);
      if (a.strengths.length > 0) parts.push(`Strengths: ${a.strengths.join(" • ")}.`);
      if (a.gaps.length > 0) parts.push(`Watch out: ${a.gaps.join(" • ")}.`);
      if (a.nextSession) parts.push(`Next session: ${a.nextSession.sets} sets × ${a.nextSession.reps} reps, ${a.nextSession.restSec}s rest — ${a.sessionRationale}`);
      parts.push(closingLine(personality, a.focus));
      break;
  }

  return parts.filter(Boolean).join("\n\n");
}