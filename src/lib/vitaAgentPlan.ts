import type { VitaState } from './vitaTools';

export type VitaPlanStep = {
  action: string;
  reason: string;
  durationMinutes?: number;
};

export type VitaDailyPlan = {
  objective: string;
  currentSteps: number;
  targetSteps: number;
  remainingSteps: number;
  completionPercent: number;
  activity: string;
  intensity: 'easy' | 'moderate' | 'hard';
  workoutMinutes: number;
  steps: VitaPlanStep[];
};

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function buildDailyPlan(
  state: VitaState,
  args: Record<string, unknown>,
): VitaDailyPlan {
  const currentSteps = Math.max(0, Math.round(finite(state.steps, 0)));
  const targetSteps = Math.min(
    Math.max(Math.round(finite(args.targetSteps, 10000)), 1000),
    50000,
  );
  const remainingSteps = Math.max(targetSteps - currentSteps, 0);
  const completionPercent = Math.min((currentSteps / targetSteps) * 100, 100);
  const workoutMinutes = Math.min(
    Math.max(Math.round(finite(args.workoutMinutes, 25)), 10),
    60,
  );

  const activity = String(state.activity ?? 'IDLE').toUpperCase();
  const requestedIntensity = String(args.intensity ?? '').toLowerCase();
  const intensity: VitaDailyPlan['intensity'] = ['easy', 'moderate', 'hard'].includes(requestedIntensity)
    ? (requestedIntensity as VitaDailyPlan['intensity'])
    : activity === 'RUNNING'
      ? 'easy'
      : remainingSteps > targetSteps * 0.65
        ? 'moderate'
        : 'easy';

  const steps: VitaPlanStep[] = [];

  if (remainingSteps > 0) {
    steps.push({
      action: 'close-step-gap',
      reason: `${remainingSteps.toLocaleString()} steps remain to reach today's target`,
    });
  }

  steps.push({
    action: 'workout',
    reason: `Use a ${intensity} session based on current activity (${activity})`,
    durationMinutes: workoutMinutes,
  });

  steps.push({
    action: 'reassess',
    reason: 'Re-check activity metrics after the session before recommending more work',
  });

  return {
    objective: remainingSteps > 0
      ? `Close the remaining ${remainingSteps.toLocaleString()}-step gap without overtraining.`
      : 'Maintain the current target and reassess recovery before adding workload.',
    currentSteps,
    targetSteps,
    remainingSteps,
    completionPercent,
    activity,
    intensity,
    workoutMinutes,
    steps,
  };
}
