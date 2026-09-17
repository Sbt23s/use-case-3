import type { Request, Response, NextFunction } from 'express';

/**
 * Security middleware.
 *
 * In-process rate limiting is appropriate for a single-node POC. A multi-node
 * deployment needs a shared store (Redis) or an edge limiter - the shape of the
 * check stays the same, only the counter moves.
 */

interface Bucket { count: number; resetAt: number }

function limiter(windowMs: number, max: number, keyOf: (req: Request) => string) {
  const buckets = new Map<string, Bucket>();

  // Expired buckets would otherwise accumulate for every IP ever seen.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, windowMs);
  sweep.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyOf(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;

    const remaining = Math.max(0, max - b.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((b.resetAt - now) / 1000)));

    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
      return;
    }
    next();
  };
}

const ipOf = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

/** General API budget. Generous enough not to impede ordinary casework. */
export const apiRateLimit = limiter(60_000, 600, ipOf);

/** Writes are scarcer and more consequential than reads. */
export const writeRateLimit = limiter(60_000, 120, (req) => `w:${ipOf(req)}`);

/** AI tasks are the most expensive operations in the system. */
export const aiRateLimit = limiter(60_000, 150, (req) => `ai:${ipOf(req)}`);

/**
 * Uploads are bandwidth- and CPU-heavy (OCR follows), but this router also
 * serves document reads, downloads and job-status polling. The budget covers
 * an officer working a case at pace; the real protection against upload abuse
 * is the 15 MB per-file cap and the per-file validation, not this counter.
 */
export const uploadRateLimit = limiter(60_000, 240, (req) => `up:${ipOf(req)}`);

/**
 * Baseline response headers. The API serves JSON to a same-origin SPA, so the
 * CSP can be restrictive.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), payment=(), usb=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Case data must never be cached by an intermediary.
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Reject a cross-site state-changing request that carries no Authorization
 * header. Bearer tokens are not sent automatically by browsers, so the
 * token-authenticated path is inherently CSRF-resistant; this guards the
 * cookie fallback, which is not.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') { next(); return; }
  if (req.get('authorization')?.startsWith('Bearer ')) { next(); return; }

  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
    res.status(403).json({ error: 'Cross-site request rejected' });
    return;
  }
  next();
}
