export const CRASH_RECOVERY_WINDOW_MS = 10 * 60 * 1000;
export const MAX_CRASH_RECOVERY_ATTEMPTS = 5;

export interface CrashRecoveryPlan {
  allowed: boolean;
  attempt: number;
  environment: NodeJS.ProcessEnv;
}

/** Build a bounded restart plan so repeated fatal errors cannot create a fork loop. */
export function planCrashRecovery(
  environment: NodeJS.ProcessEnv,
  now = Date.now(),
): CrashRecoveryPlan {
  const previousWindow = Number(environment.AUVRYNT_CRASH_WINDOW_STARTED_AT);
  const previousAttempts = Number(environment.AUVRYNT_CRASH_RESTART_COUNT);
  const sameWindow = Number.isFinite(previousWindow)
    && previousWindow > 0
    && now - previousWindow < CRASH_RECOVERY_WINDOW_MS;
  const attempt = sameWindow && Number.isInteger(previousAttempts) && previousAttempts >= 0
    ? previousAttempts + 1
    : 1;
  const windowStartedAt = sameWindow ? previousWindow : now;

  return {
    allowed: attempt <= MAX_CRASH_RECOVERY_ATTEMPTS,
    attempt,
    environment: {
      ...environment,
      AUVRYNT_CRASH_WINDOW_STARTED_AT: String(windowStartedAt),
      AUVRYNT_CRASH_RESTART_COUNT: String(attempt),
    },
  };
}
