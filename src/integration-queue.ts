const queues = new Map<string, Promise<void>>();

export function enqueueIntegration<T>(integration: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(integration) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(integration, next.then(() => {}, () => {}));
  return next;
}

export function clearIntegrationQueue(integration: string): void {
  queues.delete(integration);
}
