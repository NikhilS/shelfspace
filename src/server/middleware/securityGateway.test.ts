import {describe, it, expect, vi, beforeEach} from 'vitest';
import type express from 'express';
import {
  createRateLimiter,
  redactUrlForLog,
  sanitizeLogField,
  securityHeadersMiddleware,
  SseConcurrencyTracker,
} from './securityGateway';

describe('securityGateway — Rate Limiting, Security Headers & Log Sanitization (SEC-07, SEC-09, SEC-10, SEC-13, SEC-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Express Gateway Rate Limiter & Security Headers (SEC-10, SEC-13)', () => {
    it('enforces rate limit window and emits X-RateLimit-* and Retry-After headers', () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        maxRequests: 2,
        keyPrefix: 'test-rl',
      });

      const makeMockRes = () => {
        const headers: Record<string, string> = {};
        const res = {
          statusCode: 200,
          headers,
          setHeader: vi.fn((k: string, v: string) => {
            headers[k] = v;
          }),
          status: vi.fn((code: number) => {
            res.statusCode = code;
            return res;
          }),
          json: vi.fn().mockReturnThis(),
        };
        return res;
      };

      const req = {
        ip: '203.0.113.42',
        headers: {},
      } as unknown as express.Request;

      const next1 = vi.fn();
      const res1 = makeMockRes();
      limiter(req, res1 as unknown as express.Response, next1);
      expect(next1).toHaveBeenCalledTimes(1);
      expect(res1.headers['X-RateLimit-Limit']).toBe('2');
      expect(res1.headers['X-RateLimit-Remaining']).toBe('1');

      const next2 = vi.fn();
      const res2 = makeMockRes();
      limiter(req, res2 as unknown as express.Response, next2);
      expect(next2).toHaveBeenCalledTimes(1);
      expect(res2.headers['X-RateLimit-Remaining']).toBe('0');

      const next3 = vi.fn();
      const res3 = makeMockRes();
      limiter(req, res3 as unknown as express.Response, next3);
      expect(next3).not.toHaveBeenCalled();
      expect(res3.statusCode).toBe(429);
      expect(res3.headers['Retry-After']).toBeDefined();
    });

    it('sets standard security headers via securityHeadersMiddleware', () => {
      const headers: Record<string, string> = {};
      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
      } as unknown as express.Response;
      const next = vi.fn();

      securityHeadersMiddleware({} as express.Request, res, next);
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['Referrer-Policy']).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(headers['X-Permitted-Cross-Domain-Policies']).toBe('none');
      expect(headers['Cross-Origin-Opener-Policy']).toBe(
        'same-origin-allow-popups',
      );
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('Query Token Redaction, Log Sanitization & SSE Concurrency (SEC-07, SEC-09, SEC-14)', () => {
    it('redacts sensitive token/key query parameters from logged URLs', () => {
      const rawUrl =
        '/api/enrichment/stream?libraryId=lib_123&token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret';
      const redacted = redactUrlForLog(rawUrl);
      expect(redacted).toBe(
        '/api/enrichment/stream?libraryId=lib_123&token=[REDACTED]',
      );
      expect(redacted).not.toContain('eyJhbGci');
    });

    it('strips newlines and ANSI escape codes in sanitizeLogField to prevent log forging', () => {
      const forged =
        'Normal error\r\n[HTTP 200] GET /admin/secret\x1b[31mFAKE_LOG';
      const sanitized = sanitizeLogField(forged, 200);
      expect(sanitized).not.toContain('\r');
      expect(sanitized).not.toContain('\n');
      expect(sanitized).not.toContain('\x1b');
      expect(sanitized).toContain('Normal error [HTTP 200]');
    });

    it('enforces per-user SSE connection concurrency limits', () => {
      const tracker = new SseConcurrencyTracker(2);
      const release1 = tracker.tryAcquire('user_1');
      const release2 = tracker.tryAcquire('user_1');
      const release3 = tracker.tryAcquire('user_1');

      expect(release1).toBeTypeOf('function');
      expect(release2).toBeTypeOf('function');
      expect(release3).toBeNull();

      release1?.();
      const releaseAfterClose = tracker.tryAcquire('user_1');
      expect(releaseAfterClose).toBeTypeOf('function');
    });
  });
});
