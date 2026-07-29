import type { RequestHandler } from "express";
import { requestIp } from "../logger.js";

interface FixedWindowBucket {
  count: number;
  resetAt: number;
}

export interface FixedWindowRateLimitOptions {
  windowMs: number;
  maxRequests: number;
  maxClients?: number;
  message?: string;
}

/** Small in-memory limiter for Auvrynt's single-process OAuth endpoints. */
export function createFixedWindowRateLimiter(options: FixedWindowRateLimitOptions): RequestHandler {
  const maxClients = options.maxClients ?? 10_000;
  const buckets = new Map<string, FixedWindowBucket>();
  let requestCounter = 0;

  const prune = (now: number): void => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    while (buckets.size >= maxClients) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      buckets.delete(oldestKey);
    }
  };

  return (req, res, next) => {
    const now = Date.now();
    requestCounter++;
    if (requestCounter % 100 === 0 || buckets.size >= maxClients) prune(now);

    const key = requestIp(req) ?? "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= maxClients) prune(now);
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= options.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: options.message ?? "Too many requests. Try again later." });
      return;
    }

    bucket.count++;
    next();
  };
}
