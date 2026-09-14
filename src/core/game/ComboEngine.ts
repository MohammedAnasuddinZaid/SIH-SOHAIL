// ComboEngine: purely local combo/streak-of-valid-reps tracking.
// The CV engine emits events; this interprets them into combo state.

export interface ComboSnapshot {
  combo: number;
  bestCombo: number;
  totalValid: number;
  totalInvalid: number;
  lastEvent: "VALID" | "INVALID" | "NONE";
}

export class ComboEngine {
  private combo = 0;
  private bestCombo = 0;
  private totalValid = 0;
  private totalInvalid = 0;
  private lastEvent: ComboSnapshot["lastEvent"] = "NONE";

  onValid(perfect = false): ComboSnapshot {
    this.combo += 1;
    void perfect;
    this.totalValid += 1;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.lastEvent = "VALID";
    return this.snapshot();
  }

  onInvalid(): ComboSnapshot {
    this.combo = 0;
    this.totalInvalid += 1;
    this.lastEvent = "INVALID";
    return this.snapshot();
  }

  snapshot(): ComboSnapshot {
    return {
      combo: this.combo,
      bestCombo: this.bestCombo,
      totalValid: this.totalValid,
      totalInvalid: this.totalInvalid,
      lastEvent: this.lastEvent,
    };
  }

  reset(): void {
    this.combo = 0;
    this.bestCombo = 0;
    this.totalValid = 0;
    this.totalInvalid = 0;
    this.lastEvent = "NONE";
  }
}