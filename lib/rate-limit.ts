/**
 * Rate limiting for API endpoints.
 * Uses Upstash Redis if configured, falls back to in-memory for development.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Use Upstash Redis if configured, otherwise use in-memory ephemeral store
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : undefined;

/**
 * Chat endpoint rate limiter: 30 requests per 60 seconds per user.
 * Prevents runaway token costs from automated or abusive requests.
 */
export const chatRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "ratelimit:chat",
    })
  : null;

/**
 * Webhook endpoint rate limiter: 100 requests per 60 seconds per source.
 */
export const webhookRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(100, "60 s"),
      prefix: "ratelimit:webhook",
    })
  : null;

/**
 * Check rate limit. Returns { limited: true } if the request should be rejected.
 * Falls back to allowing all requests if Redis is not configured (dev mode).
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<{ limited: boolean; remaining?: number; resetMs?: number }> {
  if (!limiter) {
    // No Redis configured — allow all requests (development mode)
    return { limited: false };
  }

  try {
    const result = await limiter.limit(identifier);
    return {
      limited: !result.success,
      remaining: result.remaining,
      resetMs: result.reset,
    };
  } catch (err) {
    // If Redis is down, fail open (allow the request)
    console.error("[rate-limit] Redis error, failing open:", err);
    return { limited: false };
  }
}

/**
 * Returns a 429 Response for rate-limited requests.
 */
export function rateLimitResponse(resetMs?: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please slow down." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...(resetMs ? { "Retry-After": String(Math.ceil((resetMs - Date.now()) / 1000)) } : {}),
      },
    }
  );
}
