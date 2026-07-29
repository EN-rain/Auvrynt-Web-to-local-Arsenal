export interface RetryableHttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  body?: { cancel(): Promise<void> | void } | null;
}

export interface ControlRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([409, 429, 502, 503, 504]);

/** Retry transient control-plane responses without retrying validation/auth errors. */
export async function retryControlRequest<T extends RetryableHttpResponse>(
  operation: () => Promise<T>,
  options: ControlRetryOptions = {},
): Promise<T> {
  const maxAttempts = positiveInteger(options.maxAttempts, 8);
  const initialDelayMs = positiveInteger(options.initialDelayMs, 250);
  const maxDelayMs = positiveInteger(options.maxDelayMs, 2_000);
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await operation();
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) return response;

      await Promise.resolve(response.body?.cancel()).catch(() => undefined);
      await sleep(retryDelayMs(response, attempt, initialDelayMs, maxDelayMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await sleep(Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Control request failed after retries.");
}

function retryDelayMs(
  response: RetryableHttpResponse,
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maxDelayMs, Math.max(initialDelayMs, seconds * 1_000));
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      return Math.min(maxDelayMs, Math.max(initialDelayMs, dateMs - Date.now()));
    }
  }
  return Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}
