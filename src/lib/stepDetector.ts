// ── VITA Step Detector ──────────────────────────────────────────────────────
// Uses DeviceMotion accelerometer data to detect steps via
// peak detection on smoothed acceleration magnitude.

export type Activity = 'IDLE' | 'WALKING' | 'RUNNING';

export interface StepData {
  steps:       number;
  cadence:     number;   // steps per minute
  activity:    Activity;
  distance:    number;   // km
  calories:    number;   // kcal
}

export class StepDetector {
  private steps       = 0;
  private smoothMag   = 10;
  private lastPeak    = false;
  private lastStepMs  = 0;
  private stepTimes:  number[] = [];
  private cadence     = 0;

  // Tuning constants
  private readonly THRESHOLD       = 13.0;  // m/s² — tune higher to reduce false steps
  private readonly DEBOUNCE_MS     = 280;   // min ms between steps
  private readonly STRIDE_M        = 0.762; // avg stride length in metres
  private readonly KCAL_PER_STEP   = 0.04;
  private readonly STEP_GOAL       = 10_000;

  onStep?: (data: StepData) => void;

  /** Feed raw accelerometer values from DeviceMotionEvent */
  update(x: number, y: number, z: number): void {
    const mag = Math.sqrt(x * x + y * y + z * z);

    // Low-pass filter to smooth noise
    this.smoothMag = this.smoothMag * 0.8 + mag * 0.2;

    const isPeak = this.smoothMag > this.THRESHOLD && !this.lastPeak;
    this.lastPeak = this.smoothMag > this.THRESHOLD;

    if (!isPeak) return;

    const now = Date.now();
    if (now - this.lastStepMs < this.DEBOUNCE_MS) return; // debounce

    this.lastStepMs = now;
    this.steps++;

    // Cadence: steps per minute from last 8 steps
    this.stepTimes.push(now);
    if (this.stepTimes.length > 8) this.stepTimes.shift();
    if (this.stepTimes.length >= 2) {
      const span = (this.stepTimes[this.stepTimes.length - 1] - this.stepTimes[0]) / 1000;
      this.cadence = Math.round((this.stepTimes.length - 1) / span * 60);
    }

    this.onStep?.(this.getData());
  }

  getData(): StepData {
    return {
      steps:    this.steps,
      cadence:  this.cadence,
      activity: this.getActivity(),
      distance: parseFloat((this.steps * this.STRIDE_M / 1000).toFixed(2)),
      calories: Math.round(this.steps * this.KCAL_PER_STEP),
    };
  }

  getActivity(): Activity {
    if (this.cadence >= 120) return 'RUNNING';
    if (this.cadence >= 60)  return 'WALKING';
    return 'IDLE';
  }

  getGoalPercent(): number {
    return Math.min(this.steps / this.STEP_GOAL, 1);
  }

  reset(): void {
    this.steps      = 0;
    this.smoothMag  = 10;
    this.lastPeak   = false;
    this.lastStepMs = 0;
    this.stepTimes  = [];
    this.cadence    = 0;
  }
}
