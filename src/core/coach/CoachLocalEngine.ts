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
  let focusReason = "Build consistency first - regular sessions beat heroic one-offs.";

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
    if (lastForm >= 85) strengths.push(`Last session form averaged ${lastForm} - clean, controlled reps`);
    else if (lastForm < 70) gaps.push(`Form dipped to ${lastForm} last session - likely rushing the descent`);
  }

  if (o.streak.current >= 3) strengths.push(`On a ${o.streak.current}-day streak (best ${o.streak.best})`);
  if (ctx.missedDays >= 3 && o.totalWorkouts > 0) gaps.push(`Only ${ctx.daysThisWeek} active day(s) this week`);

  if (ctx.formTrend === "DECLINING") {
    focus = "TECHNIQUE";
    focusReason = "Your form trend is declining - reassure it: slower, deeper, controlled reps.";
    gaps.push("Form trend angled down; reduce pace and lower volume this week");
  } else if (ctx.lastWorkoutDaysAgo !== null && ctx.lastWorkoutDaysAgo >= 5) {
    focus = "RECOVERY";
    focusReason = "It's been a few days. Rest isn't the enemy - returning gently is the plan.";
    gaps.push(`${ctx.lastWorkoutDaysAgo} days since last session`);
  } else if (o.todayReps === 0 && ctx.daysThisWeek >= 1) {
    focus = "CONSISTENCY";
    focusReason = "Solid week, but today is still zero. One session keeps the streak alive.";
  } else if (lastForm !== undefined && lastForm >= 87) {
    focus = "VOLUME";
    focusReason = "Your form is locked. Now push volume without sacrificing technique.";
    strengths.push("Form quality is consistent - volume can grow");
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
    sessionRationale = "5x15 with 45s rest. Keep every rep above 85 form - fatigue is not an excuse.";
  } else if (focus === "COMPETITION") {
    nextSession = { sets: 6, reps: 10, restSec: 30 };
    sessionRationale = "6x10 with 30s rest: race rhythm training. Front-load speed, hold form through the end.";
  }

  if (wantRest) {
    nextSession = { sets: 2, reps: 10, restSec: 120 };
    sessionRationale = "You trained yesterday - today is light (2x10) or a full rest day. Recovery drives growth.";
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
      VOLUME: "You're ready to add volume. I believe in this one - rep by rep.",
      CONSISTENCY: "Small steps daily beat big sprints monthly. Today is your small step.",
      RECOVERY: "You've earned your rest. A light session today keeps the engine warm.",
      COMPETITION: "Your momentum is real. Let's sharpen the racing edge gently.",
    },
    DRILL_SERGEANT: {
      TECHNIQUE: "Your form is slipping, soldier. We fix it with SLOW reps, not excuses.",
      VOLUME: "Comfort zone detected. We're blowing it up - more reps, same perfect form.",
      CONSISTENCY: "You missed days, recruit. Lace up, show up, put in work TODAY.",
      RECOVERY: "REST IS ORDERS. Light session or none, that arm needs repairs.",
      COMPETITION: "Half-fights don't win wars. Train speed with zero form cowardice.",
    },
    SCIENTIST: {
      TECHNIQUE: "Form trend down 3+ points over recent sessions - corrective action indicated.",
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
      RECOVERY: "Rest up - I'll be right here when you're ready.",
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
    return "Pain talk gets my full attention. We stop or go light. That's an order, and it's for YOU.";
  }
  if (/(motivat|cant|can't|give up)/.test(t) && personality === "SUPPORTIVE") {
    return "You don't need to be perfect today. You just need to start. I'll count with you.";
  }
  return "";
}

// ────────────────────────────────────────────
// Conversational intent routing - small talk gets real replies instead of the
// full numbers dump every time.
// ────────────────────────────────────────────

export type CoachIntent =
  | "GREETING"
  | "HOW_ARE_YOU"
  | "FAREWELL"
  | "HOW_AM_I"
  | "IMPROVE"
  | "TRAINING_PLAN"
  | "MOTIVATION"
  | "PAIN"
  | "WELLNESS"
  | "BODY_ANALYSIS"
  | "EXERCISE_SUGGEST"
  | "NUTRITION"
  | "RECOVERY"
  | "PERSONAL_RECORD"
  | "THANKS"
  | "IDENTITY"
  | "EXERCISE_EXPLAIN"
  | "HOW_TO"
  | "FREQUENCY"
  | "WARM_UP"
  | "STRETCH"
  | "EQUIPMENT"
  | "AGE_FITNESS"
  | "BODY_METRICS"
  | "SLEEP"
  | "STRESS"
  | "COMPARISON"
  | "MEDICAL_GENERAL"
  | "SPECIFIC_WORKOUT"
  | "MILESTONE"
  | "REST_DAY"
  | "DEFAULT";

const RE = {
  pain: /(pain|hurt|injured|injur|sore|aching|exhausted|tired|my (back|knee|shoulder|wrist|ankle|neck|hip)s? (hurts?|is? sore|feels? (bad|off)))/,
  wellness: /(doctor|see a (doctor|professional|physio|therapist|medical)|hospital|medical|diagnos|prescription|medication|medicine|abnormal|numb|dizzy|chest pain|heart|breath)/,
  bodyAnalysis: /(analy[sz]e (my )?(body|form|posture|movement)|body analysis|form analysis|posture (check|analysis)|scan me|measure me|tell me about my body)/,
  howAmI: /(how am i|how (have i )?(been )?(doing|going|performing)|am i (doing|improving|good|ok|okay|getting better)|check.?in|status check|review my|where do i stand|rank check|streak check|progress)/,
  improve: /(how (can|do|should) i (improve|get better|level up|progress)|improve|tips|advice|better (form|at|than)|good form|form tips|master|sharp)/,
  personalRecord: /(personal record|new (best|record|high)|beat my (best|record|high)|pr\b|high score|all.?time best)/,
  exerciseSuggest: /(what (exercises?|movements?|stretches?)|which (exercises?|movements?|stretches?)|exercises? (for|to|good)|stretch|stretching|warm ?up|cool ?down|mobility|flexib|shoulders?|wrists?|core workout|abs|back (workout|exercises))/,
  trainingPlan: /(plan|schedule|routine|program|regimen|next session|workout (today|tomorrow|now|for me)|should i|give me|suggest|recommend|how (much|many|long)|sets|reps plan)/,
  recovery: /(rest (day|up|time|period|off|today|week)|recovery|recover|sleep|overtrain|deload|too sore|muscles? (sore|recover|resting))/,
  nutrition: /(eat|eating|nutrition|diet|protein|food|calorie|calories|drink|drinking|hydrat|meal|meals|supplement|protein shake|fatigue from food)/,
  motivation: /(motivat|cant|can't|give up|worth it|keep going|struggl|hard|difficult|discourag|unmotivated|tired of|no energy|anxious)/,
  howAreYou: /(how are you|how is it going|how r u|u good|you good|you okay|you ok|are you (ok|okay|fine|good|alright|cool)|all good|u awake)/,
  thanks: /(thanks|thank you|thx|cheers|appreciate|awesome reply|great (answer|advice|tips))/,
  farewell: /(bye|goodbye|see (you|ya)|talk later|gtg|gotta go|going to sleep|going now|good night|gn|peace out|laters|later friend)/,
  greetingHead: /^(hi|hello|hey|yo|hiya|namaste|good (morning|afternoon|evening))\b/,
  greetingOnly: /^(hi|hello|hey|yo|hiya|namaste|sup|wassup|whats up|what's up|good (morning|afternoon|evening))[!.,\s]*$/,
  // anything content-bearing overrides a leading greeting
  content: /(how am i|how are|train|plan|exercise|stretch|doctor|pain|hurt|eat|improve|better|rest|sleep|rank|streak|give|should|suggest|routine|program|schedule|what|which|nutrition|protein|motivat|record|analy|posture)/,

  identity: /(who are you|what are you|what can you do|your name|what do you know|introduce yourself|tell me about yourself)/,
  exerciseExplain: /(what is a |how to do |explain |proper form for |correct form for |technique for |what does a .*(work|target)|benefits? of )/,
  howTo: /(how do i start|how does (this|it) work|how to use|getting started|start using|begin using|how to begin)/,
  frequency: /(how often|how many times|how many days|weekly|daily|per week|per day|times a week|every day)/,
  warmUp: /(warm ?up|warmup|before workout|pre-workout|pre workout|before i start|getting warm)/,
  stretch: /(stretch|stretching|flexibility|cool ?down|cooldown|after workout|post workout)/,
  equipment: /(equipment|gear|dumbbell|weights|mat|shoes|gym|band|resistance)/,
  ageFitness: /(age|am i too old|old enough|young|teen|over \d+|under \d+)/,
  bodyMetrics: /(bmi|body fat|weight loss|muscle gain|how much should i|lose weight|gain weight|calori)/,
  sleep: /(sleep|rest|tired|energy|fatigue|exhausted|worn out|no energy)/,
  stress: /(stress|anxiety|mental|depress|overwhelm|burnout|pressure)/,
  comparison: /(am i good|compared to|average|normal|typical|standard|better than|worse than)/,
  medicalGeneral: /(is it normal to|should i worry|is this bad|is that bad|should i be concerned|is that normal)/,
  specificWorkout: /(push up routine|squat program|daily plan|5 minute|10 minute|quick workout|short workout|workout plan)/,
  milestone: /(first time|beginner|starting out|new to fitness|new to exercise|just started|never done)/,
  restDay: /(rest day|off day|recovery day|take a break|skip a day|day off)/,
};

export function detectIntent(text: string): CoachIntent {
  const t = text.toLowerCase().trim();
  if (!t) return "DEFAULT";

  if (RE.pain.test(t)) return "PAIN";
  if (RE.wellness.test(t)) return "WELLNESS";
  if (RE.greetingOnly.test(t) || (RE.greetingHead.test(t) && !RE.content.test(t))) return "GREETING";
  if (RE.howAreYou.test(t)) return "HOW_ARE_YOU";
  if (RE.bodyAnalysis.test(t)) return "BODY_ANALYSIS";
  if (RE.howAmI.test(t)) return "HOW_AM_I";
  if (RE.improve.test(t)) return "IMPROVE";
  if (RE.motivation.test(t)) return "MOTIVATION";
  if (RE.personalRecord.test(t)) return "PERSONAL_RECORD";
  if (RE.recovery.test(t)) return "RECOVERY";
  if (RE.exerciseSuggest.test(t)) return "EXERCISE_SUGGEST";
  if (RE.nutrition.test(t)) return "NUTRITION";
  if (RE.trainingPlan.test(t)) return "TRAINING_PLAN";
  if (RE.identity.test(t)) return "IDENTITY";
  if (RE.exerciseExplain.test(t)) return "EXERCISE_EXPLAIN";
  if (RE.howTo.test(t)) return "HOW_TO";
  if (RE.frequency.test(t)) return "FREQUENCY";
  if (RE.warmUp.test(t)) return "WARM_UP";
  if (RE.stretch.test(t)) return "STRETCH";
  if (RE.equipment.test(t)) return "EQUIPMENT";
  if (RE.ageFitness.test(t)) return "AGE_FITNESS";
  if (RE.bodyMetrics.test(t)) return "BODY_METRICS";
  if (RE.sleep.test(t)) return "SLEEP";
  if (RE.stress.test(t)) return "STRESS";
  if (RE.comparison.test(t)) return "COMPARISON";
  if (RE.medicalGeneral.test(t)) return "MEDICAL_GENERAL";
  if (RE.specificWorkout.test(t)) return "SPECIFIC_WORKOUT";
  if (RE.milestone.test(t)) return "MILESTONE";
  if (RE.restDay.test(t)) return "REST_DAY";
  if (RE.thanks.test(t)) return "THANKS";
  if (RE.farewell.test(t)) return "FAREWELL";
  return "DEFAULT";
}

interface PersonaLines {
  greet: string;
  status: string;
  motivate: string;
  thanks: string;
  farewell: string;
  pain: string;
  doctor: string;
  identity: string;
  exerciseExplain: string;
  howTo: string;
  frequency: string;
  warmUp: string;
  stretch: string;
  equipment: string;
  ageFitness: string;
  bodyMetrics: string;
  sleep: string;
  stress: string;
  comparison: string;
  medicalGeneral: string;
  specificWorkout: string;
  milestone: string;
  restDay: string;
}

const PERSONA_LINES: Record<CoachPersonalityId, PersonaLines> = {
  SUPPORTIVE: {
    greet: "Hey, good to see you in the arena. How are you feeling today?",
    status: "All good on my side, just reading your numbers. More importantly, how are YOU feeling?",
    motivate: "You don't need to be perfect today, you just need to start. One clean set beats wondering about the rest.",
    thanks: "Anytime. That's what I'm here for, right beside you, rep by rep.",
    farewell: "Go get the session. I'll be here when you're back.",
    pain: "Take this seriously: if something hurts, rest it. Listen to your body over your ego. Tomorrow you will be glad you did.",
    doctor: "I am a coaching tool, not a doctor. If you are hurt or worried about your health, see a real professional first. Nothing I say changes that.",
    identity: "I'm your personal coach, built right into ZELUX. I watch your form, count your reps, and help you get better. No gym required.",
    exerciseExplain: "That is a great exercise to learn. Focus on form over speed: controlled movement through a full range of motion is what builds strength safely.",
    howTo: "Getting started is the easiest part. Open a live session, pick an exercise, and follow the on-screen cues. I will count your reps and check your form in real time.",
    frequency: "For most people, 3 to 5 days per week works well. Start with 3 days, give yourself rest between sessions. Consistency beats intensity.",
    warmUp: "A good warm-up makes a real difference. Spend 3 to 5 minutes doing arm circles, wrist rolls, shoulder rolls, and a few slow partial squats before your first set.",
    stretch: "Stretching after your session helps recovery and flexibility. Hold each stretch for 20 to 30 seconds without bouncing. Focus on chest, shoulders, hips and calves.",
    equipment: "You do not need much. A clear floor space, comfortable clothes, and a phone with a camera. A yoga mat is nice for planks but not required.",
    ageFitness: "Fitness has no age limit. Start wherever you are, move at your own pace, and let your body adapt gradually. Every age benefits from regular movement.",
    bodyMetrics: "Focus on how you feel and perform rather than a single number. Strength gains, better form, and more energy are the real metrics that matter.",
    sleep: "Sleep is when your body rebuilds muscle. Aim for 7 to 9 hours, keep a consistent schedule, and avoid screens right before bed. Good sleep makes every rep count.",
    stress: "Exercise is one of the best stress reliefs there is. Even a short session of 10 minutes can shift your mood. You do not have to crush it every time to benefit.",
    comparison: "The only comparison that matters is you versus your last session. If you showed up and put in honest work, you are ahead of most people.",
    medicalGeneral: "I can help with training, but I cannot diagnose anything. If something feels wrong or unusual, a professional is always the right call. Your health comes first.",
    specificWorkout: "Here is a solid quick session: 3 rounds of push-ups, bodyweight squats, and a 30-second plank. Rest 60 seconds between rounds. Focus on form, not speed.",
    milestone: "Welcome. Everyone starts somewhere, and starting is the hardest part. I will keep things simple, track your progress, and help you build from here.",
    restDay: "Rest days are part of the program. Your muscles grow during recovery, not during the workout. Take the day, stretch lightly, eat well, and come back ready.",
  },
  DRILL_SERGEANT: {
    greet: "Recruit. Good of you to show up. Ready to work?",
    status: "Standing at attention and reading your file. The question is, are you ready?",
    motivate: "Comfort is a liar. You don't need feelings right now, you need three more clean sets. MOVE.",
    thanks: "Don't thank me. Pay me back with reps.",
    farewell: "Disappear until your session is done. Then you may return.",
    pain: "STOP. Pain is a stop order, recruit, not a challenge. Rest, ice, and come back strong tomorrow.",
    doctor: "Listen up. I'm a coach, not a medic. If you think something is wrong, get to a real professional. Then come back and we resume.",
    identity: "I am your drill sergeant. I yell so you get stronger. That is the entire job description. Now what do you need?",
    exerciseExplain: "It is a bodyweight exercise. Straight body, full range, controlled tempo. The form is non-negotiable. Do it right or do not do it at all.",
    howTo: "You open the session, you pick the exercise, and you do what I tell you. The camera watches your form. The only thing you bring is effort.",
    frequency: "Four to five days. Rest days are earned, not given. Show up.",
    warmUp: "Warm up or get injured. Your choice. Five minutes of movement before you touch the first set. That is an order.",
    stretch: "Cool down after every session. Stretch what you worked. Hold each stretch 30 seconds. Skipping this is how you get stiff and slow.",
    equipment: "Your body is the equipment. Floor space and discipline. That is all a soldier needs.",
    ageFitness: "Age is not an excuse. Modified movements exist for a reason. Start where you are and push from there. No exemptions.",
    bodyMetrics: "Numbers do not fight for you, reps do. Focus on your performance and the body follows.",
    sleep: "Sleep is recovery, and recovery is part of the mission. Seven to nine hours. Lights out, no excuses.",
    stress: "Physical work clears the mind faster than thinking about it. Ten hard minutes can reset your whole day. Get moving.",
    comparison: "Comparing yourself to others is a trap. The only person you compete against is who you were last week. Beat that recruit.",
    medicalGeneral: "If something is wrong, get it checked. I cannot clear you medically. A professional can, and then we get back to work.",
    specificWorkout: "Listen up. Three rounds: push-ups, squats, 30-second plank. Sixty seconds rest between rounds. Move with purpose. Go.",
    milestone: "You showed up. That is step one. Everything after this is earned through work. I will hold you to a high standard from here.",
    restDay: "Rest is tactical, not lazy. Your body rebuilds on off days. Take it seriously, eat clean, and come back ready to work.",
  },
  SCIENTIST: {
    greet: "Greetings. Session window opened, zero minutes elapsed. Shall we begin?",
    status: "Operating at nominal capacity. Recording: all systems green. Status?",
    motivate: "Adaptation happens in the work you do when motivation is nil. A short session still adds a useful data point.",
    thanks: "Acknowledged. Positive reinforcement correlates with adherence.",
    farewell: "Recording session end. See you at the next training load.",
    pain: "Pain is a signal, not a badge. I recommend rest and a check-in with a professional before resuming load.",
    doctor: "For medical questions I am out of scope. Consult a qualified professional. When they clear you, I will adjust your load accordingly.",
    identity: "I am an algorithmic training coach. I analyze your movement data, detect patterns in your performance, and prescribe evidence-based sessions.",
    exerciseExplain: "That exercise involves multiple muscle groups working in coordination. Proper biomechanical alignment through the full range of motion is the priority.",
    howTo: "Initiate a live session through the main interface. The camera-based tracking system captures joint angles and movement velocity. Your form score is computed in real time.",
    frequency: "Research suggests 3 to 5 sessions per week for bodyweight training, with 48 hours between sessions targeting the same muscle groups for optimal recovery.",
    warmUp: "A 3 to 5 minute dynamic warm-up increases synovial fluid production in joints and raises core temperature. Arm circles, wrist rotations, and bodyweight squats are effective.",
    stretch: "Post-session static stretching for 20 to 30 seconds per muscle group improves long-term flexibility and reduces delayed onset muscle soreness. Prioritize worked muscle groups.",
    equipment: "Bodyweight training requires minimal equipment. A clear floor, a camera-capable device, and optionally a yoga mat for floor exercises.",
    ageFitness: "Physiological adaptation to resistance training is documented across all adult age groups. Modified progressions allow safe entry at any fitness level.",
    bodyMetrics: "Performance metrics like form consistency, rep count progression, and session frequency are more informative than weight alone. Track trends over time for meaningful insight.",
    sleep: "Sleep duration of 7 to 9 hours supports muscle protein synthesis and cognitive recovery. Consistent sleep timing improves circadian regulation and training performance.",
    stress: "Moderate-intensity exercise has documented effects on cortisol regulation and mood. A brief 10 to 15 minute session can measurably reduce perceived stress.",
    comparison: "Individual baselines vary significantly. The most valid comparison is longitudinal, your current performance against your own historical data.",
    medicalGeneral: "That is outside my training scope. I recommend consulting a qualified professional for any health concerns. I can resume load management after clearance.",
    specificWorkout: "A compact session: 3 rounds of push-ups, bodyweight squats, and a 30-second plank hold. Rest 60 seconds between rounds. Total duration approximately 10 minutes.",
    milestone: "All high performers started with a single session. The system will calibrate to your current baseline and progressively increase difficulty based on your form and volume data.",
    restDay: "Recovery sessions are a component of any evidence-based program. Muscular adaptation occurs during rest. A light day or full rest is recommended based on your recent load.",
  },
};

function sessionLine(a: CoachAssessment): string {
  if (!a.nextSession) return "";
  return `${a.nextSession.sets} sets x ${a.nextSession.reps} reps, ${a.nextSession.restSec}s rest.`;
}

/**
 * Compose the full coach reply. Casual and health intents get short,
 * persona-flavored answers. Performance questions get the real assessment
 * grounded in the player's verified data.
 */
export function composeCoachReply(_ctx: CoachContext, a: CoachAssessment, personality: CoachPersonalityId, userText: string, _personName: string): string {
  const lines = PERSONA_LINES[personality] ?? PERSONA_LINES.SUPPORTIVE;
  const custom = reactToUserText(personality, userText);
  const intent = detectIntent(userText);
  const parts: string[] = [];
  if (custom) parts.push(custom);

  switch (intent) {
    case "PAIN": {
      parts.push(lines.pain);
      parts.push(
        a.wantRest
          ? "Take today off. Your body asked for it, so tomorrow we rebuild."
          : "Keep it light. If it still hurts, a professional should take a look. No rep is worth a season off.",
      );
      parts.push("Tell me 'should I see a doctor?' if you want help deciding how serious this is.");
      break;
    }

    case "WELLNESS":
      parts.push(lines.doctor);
      parts.push("What I can do: adjust your training load, check your form, and plan around what a professional clears you for. Ask me 'how am I doing?' or 'what should I train?' any time.");
      break;

    case "BODY_ANALYSIS":
      parts.push("A live workout reads joint angles from your camera. For push-ups that is elbow depth and hip alignment. For squats it is knee bend, knee-over-toe alignment and torso angle. Those feed your form score and rep validity.");
      parts.push("That is movement analysis, not a medical screening. Start one live session and I will walk you through what your numbers mean.");
      break;

    case "GREETING":
      parts.push(lines.greet);
      parts.push(a.headline);
      parts.push('Try "how am I doing?" for a progress check, "what should I train?" for your next session, or "how can I improve?" for form.');
      break;

    case "HOW_ARE_YOU":
      parts.push(lines.status);
      parts.push(a.headline);
      break;

    case "HOW_AM_I":
      parts.push(`Here is your check-in, straight from the numbers: ${a.focusReason}`);
      if (a.strengths.length > 0) parts.push(`Going well: ${a.strengths.join(" \u2022 ")}.`);
      if (a.gaps.length > 0) parts.push(`Keep an eye on: ${a.gaps.join(" \u2022 ")}.`);
      if (a.nextSession) parts.push(`Next session: ${sessionLine(a)} ${a.sessionRationale}`);
      parts.push(closingLine(personality, a.focus));
      break;

    case "IMPROVE":
      parts.push(`Here is exactly how you improve. Your main focus: ${a.focusReason}`);
      if (a.gaps.length > 0) parts.push(`Work on: ${a.gaps.join(" \u2022 ")}.`);
      parts.push(
        a.focus === "TECHNIQUE"
          ? "Best technique drill: slow reps, pause at the bottom, keep your sets short and your form strict. Film one set and review what bends where."
          : a.focus === "VOLUME"
            ? "Add one extra rep or one extra set per session this week, then hold there for two weeks before adding again."
            : "Build a consistent weekly rhythm first. Two solid sessions beat seven half-hearted ones.",
      );
      if (a.nextSession) parts.push(`Next session starts here: ${sessionLine(a)}`);
      break;

    case "PERSONAL_RECORD": {
      const best = _ctx.overview?.bestSessionReps ?? 0;
      if (best > 0) {
        parts.push(`Your best verified session is ${best} reps. Beating it is about process, not hype: warm up clean, keep form strict so every rep counts, and give the final set everything.`);
      } else {
        parts.push("You do not have a verified personal record yet. Your first one is waiting. Finish one clean live session and it becomes your target to beat.");
      }
      if (a.nextSession) parts.push(`The next chance is today: ${sessionLine(a)}`);
      break;
    }

    case "EXERCISE_SUGGEST":
      parts.push("A good base kit, no equipment needed: standard push-ups, knee push-ups, incline push-ups on a table, bodyweight squats, wall sits, planks and glute bridges.");
      parts.push("Warm up for 5 minutes first: arm circles, wrist rolls, shoulder rolls and a few slow partial squats. Form beats height or speed every time.");
      parts.push("Tell me a target area, for example 'core' or 'shoulders', and I will tailor the list.");
      break;

    case "TRAINING_PLAN":
      parts.push(a.headline);
      if (a.nextSession) parts.push(`Your next session: ${sessionLine(a)} ${a.sessionRationale}`);
      parts.push(closingLine(personality, a.focus));
      break;

    case "RECOVERY":
      parts.push(
        a.wantRest
          ? "Rest is a training plan. Your numbers say you worked hard and recovery is due. Light walking and stretching tomorrow, full session after."
          : "Recovery moves training forward. Sleep 7 to 9 hours, drink water through the day, eat protein after sessions, and take one easy day a week.",
      );
      parts.push("Still sore? Keep movement light and see a professional if pain persists.");
      break;

    case "NUTRITION":
      parts.push("General guidance, not a prescription: aim for protein at every meal, roughly a palm-sized serving, and eat most calories around your workouts. Whole foods over packaged when you can.");
      parts.push("Hydration matters as much: water before, during and after a session. If you have goals, allergies or conditions, a dietitian beats any chatbot.");
      break;

    case "MOTIVATION":
      parts.push(lines.motivate);
      if (a.nextSession) parts.push(`Keep it simple today: ${sessionLine(a)} That is the whole mission.`);
      parts.push(closingLine(personality, a.focus));
      break;

    case "IDENTITY":
      parts.push(lines.identity);
      if ((_ctx.overview?.totalWorkouts ?? 0) > 0 || a.strengths.length > 0) {
        parts.push(`Right now I am tracking ${a.strengths.length > 0 ? a.strengths[0].toLowerCase() : "your progress"} and your current focus is ${a.focus.toLowerCase()}. Ask me anything about your training.`);
      } else {
        parts.push("I can help with exercise form, workout plans, recovery advice, and tracking your progress. Just ask.");
      }
      break;

    case "EXERCISE_EXPLAIN": {
      const lowerText = userText.toLowerCase();
      if (/push ?up/.test(lowerText)) {
        parts.push("A push-up works your chest, shoulders, triceps and core. Keep your body in a straight line, lower until your elbows are at 90 degrees, then push back up. Quality beats quantity every time.");
      } else if (/squat/.test(lowerText)) {
        parts.push("Bodyweight squats target your quads, glutes and hamstrings. Stand with feet shoulder-width apart, push your hips back like you are sitting in a chair, lower until your thighs are parallel, then stand back up. Keep your chest up and knees tracking over your toes.");
      } else if (/plank/.test(lowerText)) {
        parts.push("A plank builds core stability. Forearms on the ground, body in a straight line from head to heels, squeeze your glutes and brace your core. Hold for 20 to 30 seconds to start and build from there.");
      } else if (/lunge/.test(lowerText)) {
        parts.push("Lunges work your legs and glutes one side at a time. Step forward, lower your back knee toward the ground, then push back to standing. Keep your front knee over your ankle and your torso upright.");
      } else if (/bridge|glute/.test(lowerText)) {
        parts.push("A glute bridge targets your glutes and lower back. Lie on your back with knees bent, feet flat on the floor, push your hips up until your body forms a straight line from shoulders to knees, then lower slowly.");
      } else if (/dip/.test(lowerText)) {
        parts.push("Tricep dips use a chair or bench. Hands on the edge behind you, lower your body by bending your elbows to about 90 degrees, then push back up. Keep your back close to the surface.");
      } else if (/wall sit/.test(lowerText)) {
        parts.push("A wall sit is an isometric hold for your quads. Slide down a wall until your thighs are parallel to the floor, then hold. Keep your back flat against the wall and breathe.");
      } else if (/mountain climber/.test(lowerText)) {
        parts.push("Mountain climbers combine core work with cardio. Start in a push-up position and alternate driving your knees toward your chest. Keep your hips level and maintain a steady pace.");
      } else {
        parts.push(lines.exerciseExplain);
        parts.push("Tell me the specific exercise name, for example 'how to do push-ups' or 'explain planks', and I will give you the details.");
      }
      parts.push("Start a live session and the camera will check your form on any of these exercises in real time.");
      break;
    }

    case "HOW_TO":
      parts.push(lines.howTo);
      parts.push('Pick an exercise from the menu, start a live session, and follow the on-screen cues. I count your reps and score your form automatically.');
      parts.push('Try "what should I train?" when you are ready for a personalized plan.');
      break;

    case "FREQUENCY":
      parts.push(lines.frequency);
      if (a.focus === "RECOVERY") {
        parts.push("Given where you are right now, start with 3 days this week and see how your body responds before adding more.");
      } else if (a.focus === "VOLUME") {
        parts.push("Your current level can support 4 to 5 days. Listen to your body on the off days and keep at least one full rest day per week.");
      } else {
        parts.push("Quality matters more than frequency. Three sessions with good form will outperform seven sloppy ones.");
      }
      break;

    case "WARM_UP":
      parts.push(lines.warmUp);
      parts.push("A proper warm-up should take 3 to 5 minutes. Start with arm circles forward and backward, wrist rotations, shoulder rolls, then a few slow bodyweight squats. You should feel loose, not tired.");
      parts.push("I factor warm-up time into your session plan. Start a live session and I will guide you through it.");
      break;

    case "STRETCH":
      parts.push(lines.stretch);
      parts.push("Key stretches to hit: chest opener (hands behind your back, squeeze shoulder blades), shoulder cross-body stretch, hip flexor lunge stretch, and standing calf stretch. Hold each 20 to 30 seconds.");
      parts.push("Stretching after a session is ideal. Need a cool-down routine? Just ask for one.");
      break;

    case "EQUIPMENT":
      parts.push(lines.equipment);
      parts.push("ZELUX is built for bodyweight training. The camera on your phone or laptop is the only tool you need for form tracking and rep counting. Everything else is optional.");
      parts.push("If you want to add resistance later, a simple resistance band and a pull-up bar go a long way.");
      break;

    case "AGE_FITNESS":
      parts.push(lines.ageFitness);
      if (a.nextSession) {
        parts.push(`Start where you are: ${sessionLine(a)} Every exercise has a modified version if you need it, and the camera will guide you through proper form.`);
      } else {
        parts.push("Pick an exercise, start a live session, and the form tracker will keep you safe. Modified versions are available for every movement.");
      }
      break;

    case "BODY_METRICS":
      parts.push(lines.bodyMetrics);
      parts.push("What this app tracks well: rep count, form score, session frequency, and your personal records. Those trends tell the real story of your progress.");
      parts.push('Ask "how am I doing?" to see your latest numbers and trends.');
      break;

    case "SLEEP":
      parts.push(lines.sleep);
      parts.push("Practical tips: keep your bedtime consistent, keep the room cool and dark, avoid caffeine after afternoon, and put your phone down 30 minutes before sleep.");
      if (a.wantRest) {
        parts.push("Your numbers suggest a rest day would help. A good night of sleep tonight and a fresh session tomorrow is the play.");
      }
      break;

    case "STRESS":
      parts.push(lines.stress);
      parts.push("You do not need a long session to feel the benefit. Even 10 minutes of focused movement changes your headspace. Pick an exercise, start a session, and let the reps do the work.");
      parts.push("If stress feels persistent or overwhelming, talking to a professional is always the right move. Exercise helps, but it is not a substitute for support.");
      break;

    case "COMPARISON":
      parts.push(lines.comparison);
      if (a.strengths.length > 0) {
        parts.push(`Where you stand right now: ${a.strengths[0]}. That is real progress, and it is yours.`);
      } else if ((_ctx.overview?.totalWorkouts ?? 0) > 0) {
        parts.push(`You have completed ${_ctx.overview?.totalWorkouts ?? 0} sessions. Every single one is a rep in the bank that most people never make.`);
      } else {
        parts.push("You are here and asking questions. That already puts you ahead of most people who never start.");
      }
      break;

    case "MEDICAL_GENERAL":
      parts.push(lines.medicalGeneral);
      parts.push("I can adjust your workouts around any limitation, but I cannot tell you whether something is medically okay. A healthcare professional is the right call for that.");
      parts.push("Once you are cleared, tell me what happened and I will work around it in your plan.");
      break;

    case "SPECIFIC_WORKOUT":
      parts.push(lines.specificWorkout);
      if (a.nextSession) {
        parts.push(`For something tailored to you right now: ${sessionLine(a)} ${a.sessionRationale}`);
      }
      parts.push("Start a live session and I will walk you through it step by step, counting reps and checking form the whole way.");
      break;

    case "MILESTONE":
      parts.push(lines.milestone);
      if (a.nextSession) {
        parts.push(`Here is a good place to start: ${sessionLine(a)} ${a.sessionRationale}`);
      }
      parts.push('When you are ready, say "how am I doing?" and I will give you a full breakdown of your progress.');
      break;

    case "REST_DAY":
      parts.push(lines.restDay);
      if (a.wantRest) {
        parts.push("Your numbers agree: today is a good day to rest. Light stretching, good food, plenty of water. Come back tomorrow ready to go.");
      } else {
        parts.push("If you feel like you need one, take it. Listen to your body. A planned rest day beats an unplanned injury day.");
      }
      parts.push("When you are ready to come back, I will have your next session waiting.");
      break;

    case "THANKS":
      parts.push(lines.thanks);
      parts.push(a.headline);
      break;

    case "FAREWELL":
      parts.push(lines.farewell);
      break;

    default:
      parts.push(`I can help with your training. ${a.headline}`);
      parts.push(
        'Topics I cover:\n' +
        '- "how am I doing?" (progress check)\n' +
        '- "what should I train?" (next session)\n' +
        '- "how can I improve?" (form tips)\n' +
        '- "explain push-ups" (exercise details)\n' +
        '- "how often should I train?" (frequency)\n' +
        '- "warm up" or "stretch" (preparation and recovery)\n' +
        '- "rest day" (recovery)\n' +
        '- "quick workout" (short session)\n' +
        '- "I feel tired" (sleep and energy)\n' +
        '- "should I see a doctor?" (health)',
      );
      break;
  }

  return parts.filter(Boolean).join("\n\n");
}
