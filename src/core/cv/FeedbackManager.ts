// FeedbackManager: deduplicates and priority-rates real-time form feedback so
// the UI never spams the user with the same message every frame.

export type FeedbackPriority = "CAMERA_ERROR" | "BODY_NOT_VISIBLE" | "TRACKING_LOST" | "FORM_ERROR" | "FORM_WARNING" | "GENERAL_TIP";

export interface FeedbackMessage {
  id: string;
  code: string;
  message: string;
  priority: FeedbackPriority;
}

interface PendingFeedback extends FeedbackMessage {
  lastShown: number;
}

const COOLDOWN_DEFAULT = 1800;

export class FeedbackManager {
  private current: PendingFeedback | null = null;
  private history = new Map<string, number>();

  constructor(private cooldownMs = COOLDOWN_DEFAULT) {}

  /** Register a candidate; returns the message currently displayed. */
  emit(feedback: Omit<FeedbackMessage, "priority"> & { priority: FeedbackPriority }): FeedbackManager {
    const now = Date.now();
    if (this.current && this.current.id === feedback.id) {
      this.current.lastShown = now;
      return this;
    }
    const last = this.history.get(feedback.id) ?? 0;
    if (now - last < this.cooldownMs) return this;
    this.current = { ...feedback, lastShown: now };
    this.history.set(feedback.id, now);
    return this;
  }

  clear(id?: string): void {
    if (id && this.current?.id === id) {
      this.current = null;
    } else if (!id) {
      this.current = null;
    }
  }

  peek(): FeedbackMessage | null {
    if (!this.current) return null;
    if (this.current.lastShown > 0 && Date.now() - this.current.lastShown < 300) return this.current;
    return this.current;
  }

  expire(): void {
    if (this.current && Date.now() - this.current.lastShown > 2600) {
      this.current = null;
    }
  }

  reset(): void {
    this.current = null;
    this.history.clear();
  }
}

export const FEEDBACK_LIBRARY: Record<string, { message: string; priority: FeedbackPriority }> = {
  GET_LOWER: { message: "Go a little lower", priority: "FORM_WARNING" },
  FULL_EXTENSION: { message: "Finish the rep — extend fully", priority: "FORM_WARNING" },
  KEEP_HIPS_LEVEL: { message: "Keep your hips level", priority: "FORM_WARNING" },
  STRAIGHTEN_BACK: { message: "Straighten your back", priority: "FORM_WARNING" },
  GOOD_REP: { message: "Good rep!", priority: "GENERAL_TIP" },
  PERFECT_FORM: { message: "Perfect form", priority: "GENERAL_TIP" },
  TOO_FAST: { message: "Too fast — control the tempo", priority: "FORM_WARNING" },
  CAMERA_LOST: { message: "Camera lost", priority: "CAMERA_ERROR" },
  BODY_OUT_OF_FRAME: { message: "Move into frame", priority: "BODY_NOT_VISIBLE" },
  REP_INVALID: { message: "Rep not counted", priority: "FORM_ERROR" },
  INSUFFICIENT_DEPTH: { message: "Go a little lower", priority: "FORM_WARNING" },
  INCOMPLETE_EXTENSION: { message: "Finish the rep", priority: "FORM_WARNING" },
  HIP_SAG: { message: "Keep your hips up", priority: "FORM_WARNING" },
  HIP_PIKE: { message: "Keep your body straight", priority: "FORM_WARNING" },
  LOW_CONFIDENCE: { message: "Move into frame", priority: "BODY_NOT_VISIBLE" },
  LOST_TRACKING: { message: "Tracking lost", priority: "TRACKING_LOST" },
  UNSTABLE_POSE: { message: "Hold a steady position", priority: "FORM_WARNING" },
  INCOMPLETE_MOVEMENT: { message: "Complete the full movement", priority: "FORM_WARNING" },
  UNRECOGNIZED_MOVEMENT: { message: "Full push-up only", priority: "FORM_ERROR" },
};