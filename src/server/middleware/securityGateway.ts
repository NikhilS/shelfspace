import type express from 'express';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const SENSITIVE_QUERY_PARAM_REGEX =
  /([?&](?:token|key|api_key|access_token|secret|authorization)=)([^&#\s]*)/gi;

function stripControlCharacters(str: string, replacement = ''): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      if (replacement && !out.endsWith(replacement)) {
        out += replacement;
      }
    } else {
      out += str[i];
    }
  }
  return out;
}

/**
 * Redacts sensitive query string parameters (e.g. ?token=eyJ...) and strips control characters
 * before writing URLs to server access logs.
 */
export function redactUrlForLog(rawUrl: string): string {
  if (!rawUrl) {
    return '';
  }
  return stripControlCharacters(rawUrl, '').replace(
    SENSITIVE_QUERY_PARAM_REGEX,
    '$1[REDACTED]',
  );
}

/**
 * Sanitizes untrusted client strings before writing to server logs.
 * Strips CR/LF, null bytes, and ANSI escape sequences, and truncates to maxLength.
 */
export function sanitizeLogField(input: unknown, maxLength = 1000): string {
  if (input === null || input === undefined) {
    return '';
  }
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  const cleaned = stripControlCharacters(raw, ' ').trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength)}...[truncated]`;
}

/**
 * Standard HTTP security response headers middleware.
 */
export function securityHeadersMiddleware(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
}

/**
 * Extracts a stable caller identifier for rate limiting (authenticated UID or client IP).
 */
export function resolveCallerRateLimitKey(
  req: express.Request,
  keyPrefix = 'global',
): string {
  const authedUser = (req as {user?: {uid?: string}}).user;
  if (authedUser?.uid) {
    return `${keyPrefix}:uid:${authedUser.uid}`;
  }

  const forwarded = req.headers?.['x-forwarded-for'];
  const forwardedIp =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : undefined;
  const ip = forwardedIp || req.ip || req.socket?.remoteAddress || 'unknown';
  return `${keyPrefix}:ip:${ip}`;
}

/**
 * Sliding-window HTTP rate limiter middleware emitting X-RateLimit-Limit,
 * X-RateLimit-Remaining, and Retry-After headers.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const {windowMs, maxRequests, keyPrefix = 'rl'} = options;
  const buckets = new Map<string, RateLimitBucket>();

  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void => {
    const now = Date.now();

    // Opportunistically prune expired buckets when map grows
    if (buckets.size > 5000) {
      for (const [k, b] of buckets.entries()) {
        if (b.resetAt <= now) {
          buckets.delete(k);
        }
      }
    }

    const key = resolveCallerRateLimitKey(req, keyPrefix);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too Many Requests: Rate limit exceeded',
        retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

/**
 * Tracks active Server-Sent Events (SSE) connections per user to prevent connection exhaustion.
 */
export class SseConcurrencyTracker {
  private activeCounts = new Map<string, number>();
  private readonly maxPerUser: number;

  constructor(maxPerUser = 5) {
    this.maxPerUser = maxPerUser;
  }

  tryAcquire(userId: string): (() => void) | null {
    const current = this.activeCounts.get(userId) || 0;
    if (current >= this.maxPerUser) {
      return null;
    }
    this.activeCounts.set(userId, current + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const nextCount = (this.activeCounts.get(userId) || 1) - 1;
      if (nextCount <= 0) {
        this.activeCounts.delete(userId);
      } else {
        this.activeCounts.set(userId, nextCount);
      }
    };
  }

  getActiveCount(userId: string): number {
    return this.activeCounts.get(userId) || 0;
  }
}
