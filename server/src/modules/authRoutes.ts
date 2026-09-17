import { Router } from 'express';
import { z } from 'zod';
import { db } from '../core/db.js';
import { audit } from '../core/audit.js';
import { authenticate, loadUser, signToken, verifyPassword } from '../core/auth.js';

export const authRouter = Router();

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Simple in-memory rate limit on login attempts (per username+IP).
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function isLockedOut(key: string): boolean {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else rec.count++;
}

authRouter.post('/login', (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Username and password are required' }); return; }

  const { username, password } = parsed.data;
  const key = `${username}:${req.ip}`;
  if (isLockedOut(key)) {
    res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
    return;
  }

  const row = db.prepare(
    'SELECT id, password_hash, password_salt FROM app_user WHERE username = ? AND active = 1',
  ).get(username) as any;

  // Uniform failure response - no distinction between unknown user and bad password.
  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    recordFailure(key);
    audit(req, null, { action: 'LOGIN_FAILED', entityType: 'app_user', newValue: { username } });
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Only failures count toward the lockout, so a correct password always works.
  attempts.delete(key);
  const user = loadUser(row.id)!;
  const token = signToken(row.id);

  audit(req, user, { action: 'LOGIN_SUCCESS', entityType: 'app_user', entityId: row.id });

  res.cookie?.('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });
  res.json({ token, user });
});

authRouter.post('/logout', authenticate, (req, res) => {
  audit(req, req.user!, { action: 'LOGOUT', entityType: 'app_user', entityId: req.user!.id });
  res.clearCookie?.('token');
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

/** Demo credentials, exposed only while DEMO_MODE is on. */
authRouter.get('/demo-users', (_req, res) => {
  const demo = db.prepare("SELECT value FROM system_config WHERE key = 'DEMO_MODE'").get() as any;
  if (demo?.value !== 'true') { res.status(404).json({ error: 'Not available' }); return; }

  const rows = db.prepare(
    'SELECT u.username, u.full_name, GROUP_CONCAT(r.code) AS roles ' +
    'FROM app_user u LEFT JOIN user_role ur ON ur.user_id = u.id ' +
    'LEFT JOIN role r ON r.id = ur.role_id ' +
    'WHERE u.active = 1 GROUP BY u.id ORDER BY u.id',
  ).all() as any[];

  /*
   * Demo passwords are listed explicitly rather than derived from the username.
   * Deriving them once produced "Gro@123" for an account whose real password is
   * "Officer@123" - a sign-in screen that shows a password which does not work
   * is worse than showing none.
   */
  const DEMO_PASSWORDS: Record<string, string> = {
    citizen1: 'Citizen@123',
    gro: 'Officer@123',
  };

  res.json({
    note: 'DEMO CREDENTIALS - POC ONLY',
    users: rows
      .filter((r) => DEMO_PASSWORDS[r.username])
      .map((r) => ({
        username: r.username,
        password: DEMO_PASSWORDS[r.username],
        full_name: r.full_name,
        roles: r.roles,
      })),
  });
});
