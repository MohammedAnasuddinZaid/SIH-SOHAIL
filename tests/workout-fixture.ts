import type { WorkoutResult } from "../src/types";

export function grantRandomSession(playerId: string, validReps: number, form: number): WorkoutResult {
  const now = Date.now();
  const repTimeline: WorkoutResult["repTimeline"] = Array.from({ length: validReps }, (_, i) => ({
    repNumber: i + 1,
    timestamp: now - (validReps - i) * 800,
    duration: 700,
    formScore: form,
    validity: "VALID",
    confidence: 0.95,
  }));
  return {
    sessionId: `ws_${now}_${Math.random().toString(36).slice(2)}`,
    playerId,
    mode: "FREE_TRAINING",
    startedAt: now - validReps * 1000,
    endedAt: now,
    durationSec: validReps * 2 + 30,
    validReps,
    invalidReps: 0,
    formAccuracy: form,
    averageFormScore: form,
    bestFormScore: form,
    averageRepDuration: 700,
    fastestRep: 650,
    slowestRep: 800,
    bestCombo: validReps,
    repTimeline,
    invalidReasonCounts: {},
    confidenceSummary: 0.95,
    xpEarned: 0,
    isPersonalRecord: false,
  };
}