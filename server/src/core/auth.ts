import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-insecure-secret-change-in-production';
const TOKEN_TTL = '8h';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

// ---------- password hashing (scrypt) ----------
export function hashPassword(plain: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(plain: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------- token ----------
export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/**
 * Verify a token supplied as a query parameter.
 *
 * EventSource cannot set an Authorization header, so an SSE stream must pass
 * its token in the URL. The token is verified exactly as it would be in a
 * header - the only difference is where it was read from.
 */
export function verifyStreamToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const id = Number(payload.sub);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

export function loadUser(userId: number): AuthUser | null {
  const row = db.prepare(
    'SELECT id, username, full_name FROM app_user WHERE id = ? AND active = 1',
  ).get(userId) as any;
  if (!row) return null;

  const roles = db.prepare(`
    SELECT r.code FROM role r
    JOIN user_role ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(userId).map((r: any) => r.code);

  const permissions = db.prepare(`
    SELECT DISTINCT p.code FROM permission p
    JOIN role_permission rp ON rp.permission_id = p.id
    JOIN user_role ur ON ur.role_id = rp.role_id
    WHERE ur.user_id = ?
  `).all(userId).map((r: any) => r.code);

  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    roles,
    permissions,
  };
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return; }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const user = loadUser(Number(payload.sub));
    if (!user) { res.status(401).json({ error: 'User not found or inactive' }); return; }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Require one or more permissions. Server-side only — the UI never decides this. */
export function requirePermission(...codes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const missing = codes.filter((c) => !user.permissions.includes(c));
    if (missing.length) {
      res.status(403).json({ error: 'Permission denied', required: codes, missing });
      return;
    }
    next();
  };
}

export function hasPermission(user: AuthUser, code: string): boolean {
  return user.permissions.includes(code);
}
