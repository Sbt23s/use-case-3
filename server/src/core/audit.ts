import { db } from './db.js';
import type { Request } from 'express';
import type { AuthUser } from './auth.js';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: number;
  petitionId?: number;
  oldValue?: unknown;
  newValue?: unknown;
}

const stmt = db.prepare(`
  INSERT INTO audit_log
    (action, entity_type, entity_id, petition_id, actor_id, actor_role,
     old_value, new_value, ip_address, user_agent)
  VALUES (@action, @entityType, @entityId, @petitionId, @actorId, @actorRole,
          @oldValue, @newValue, @ip, @ua)
`);

const ser = (v: unknown): string | null =>
  v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v);

/**
 * Append an immutable audit record. Audit writes must never throw into the
 * caller's path in a way that hides the business action, but a failure to
 * audit is itself significant, so it is logged loudly.
 */
export function audit(req: Request | null, user: AuthUser | null, e: AuditEntry): void {
  try {
    stmt.run({
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      petitionId: e.petitionId ?? null,
      actorId: user?.id ?? null,
      actorRole: user?.roles?.join(',') ?? null,
      oldValue: ser(e.oldValue),
      newValue: ser(e.newValue),
      ip: req?.ip ?? null,
      ua: req?.get?.('user-agent') ?? null,
    });
  } catch (err) {
    console.error('[audit] FAILED to write audit record', e.action, err);
  }
}
