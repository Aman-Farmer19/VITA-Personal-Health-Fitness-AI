export type VitaState = {
  steps?: number | null;
  cadence?: number | null;
  activity?: string | null;
  distance?: number | null;
  calories?: number | null;
  mood?: string | null;
  expression?: string | null;
  heartRate?: number | null;
  micOn?: boolean;
  camOn?: boolean;
  stepsOn?: boolean;
  phoneLinked?: boolean;
};

export type VitaToolResult = {
  ok: boolean;
  tool: string;
  data: Record<string, unknown>;
};

function n(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function executeVitaTool(
  name: string,
  args: Record<string, unknown>,
  state: VitaState,
): VitaToolResult {
  switch (name) {
    case 'get_activity': {
      return {
        ok: true,
        tool: name,
        data: {
          steps: n(state.steps),
          cadence: n(state.cadence),
          activity: state.activity ?? null,
          distanceKm: n(state.distance),
          calories: n(state.calories),
          trackingEnabled: Boolean(state.stepsOn),
          phoneLinked: Boolean(state.phoneLinked),
        },
      };
    }

    case 'get_current_state': {
      return {
        ok: true,
        tool: name,
        data: {
          mood: state.mood ?? null,
          expression: state.expression ?? null,
          heartRate: n(state.heartRate),
          cameraEnabled: Boolean(state.camOn),
          microphoneEnabled: Boolean(state.micOn),
          stepsEnabled: Boolean(state.stepsOn),
          phoneLinked: Boolean(state.phoneLinked),
        },
      };
    }

    case 'create_workout': {
      const duration = Math.min(
        Math.max(Number(args.durationMinutes ?? 20) || 20, 10),
        60,
      );
      const intensity = String(args.intensity ?? 'moderate').toLowerCase();
      const activity = String(state.activity ?? 'IDLE').toUpperCase();
      const steps = n(state.steps) ?? 0;

      let plan: string[];
      if (intensity === 'easy' || activity === 'RUNNING') {
        plan = [
          '5 min warm-up walk',
          `${Math.max(duration - 10, 5)} min easy steady-state cardio`,
          '5 min cool-down + mobility',
        ];
      } else if (intensity === 'hard') {
        plan = [
          '5 min warm-up',
          `${Math.max(duration - 15, 10)} min intervals (1 min hard / 2 min easy)`,
          '5 min cool-down',
        ];
      } else {
        plan = [
          '5 min warm-up',
          `${Math.max(duration - 15, 10)} min brisk walk or light jog`,
          '5 min cool-down + mobility',
        ];
      }

      return {
        ok: true,
        tool: name,
        data: {
          durationMinutes: duration,
          intensity,
          basedOnActivity: activity,
          currentSteps: steps,
          plan,
        },
      };
    }

    case 'estimate_goal_gap': {
      const target = Math.min(
        Math.max(Number(args.targetSteps ?? 10000) || 10000, 1000),
        50000,
      );
      const steps = n(state.steps) ?? 0;

      return {
        ok: true,
        tool: name,
        data: {
          targetSteps: target,
          currentSteps: steps,
          remainingSteps: Math.max(target - steps, 0),
          completionPercent: Math.min((steps / target) * 100, 100),
        },
      };
    }

    default:
      return {
        ok: false,
        tool: name,
        data: { error: `Unknown tool: ${name}` },
      };
  }
}
