import { rateLimitMax, rateLimitWindowMs } from "@/lib/env";

/**
 * A minimal in-memory fixed-window rate limiter, keyed by an arbitrary string
 * (API token prefix, IP, ...). Suitable for a single-process deployment and as
 * a first line of defence against API abuse. For a multi-replica deployment,
 * swap the backing store for Redis behind the same interface.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms timestamp when the current window resets. */
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = rateLimitMax(),
  windowMs: number = rateLimitWindowMs(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, limit: max, remaining: max - 1, resetAt };
  }

  if (existing.count >= max) {
    return { allowed: false, limit: max, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit: max,
    remaining: max - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Test helper: clear all rate-limit state. */
export function resetRateLimits(): void {
  buckets.clear();
}
