interface QueueState {
  tail: Promise<void>;
  pending: number;
  active: boolean;
}

const queues = new Map<string, QueueState>();
export const MAX_INTEGRATION_QUEUE_DEPTH = 16;

export function enqueueIntegration<T>(integration: string, fn: () => Promise<T>): Promise<T> {
  const state = queues.get(integration) ?? {
    tail: Promise.resolve(),
    pending: 0,
    active: false,
  } satisfies QueueState;
  const depth = state.pending + (state.active ? 1 : 0);
  if (depth >= MAX_INTEGRATION_QUEUE_DEPTH) {
    throw new Error(
      `${integration} integration queue is full (max ${MAX_INTEGRATION_QUEUE_DEPTH}). Wait for the active operation before retrying.`,
    );
  }
  state.pending += 1;
  queues.set(integration, state);

  const previous = state.tail.catch(() => undefined);
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => { release = resolve; });

  return previous.then(async () => {
    state.pending -= 1;
    state.active = true;
    try {
      return await fn();
    } finally {
      state.active = false;
      release();
      if (state.pending === 0 && queues.get(integration) === state) {
        queues.delete(integration);
      }
    }
  });
}

export function getQueueDiagnostics(): Record<string, { active: boolean; pending: number }> {
  const result: Record<string, { active: boolean; pending: number }> = {};
  for (const [integration, state] of queues) {
    result[integration] = { active: state.active, pending: state.pending };
  }
  return result;
}

export function clearIntegrationQueue(integration: string): void {
  const state = queues.get(integration);
  if (state?.active || (state?.pending ?? 0) > 0) {
    throw new Error(`Cannot clear active integration queue: ${integration}`);
  }
  queues.delete(integration);
}
