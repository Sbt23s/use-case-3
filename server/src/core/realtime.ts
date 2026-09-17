import type { AuthUser } from './auth.js';

/**
 * Real-time event fan-out.
 *
 * An in-process publisher feeding server-sent event streams. Suited to a
 * single-node POC; a multi-node deployment replaces the bus with Redis pub/sub
 * without changing publish() or subscribe().
 *
 * Events are scoped on delivery, not on publish: a subscriber only receives
 * what their role is entitled to see. Scoping here rather than at the call site
 * means a new publisher cannot accidentally leak to the wrong audience.
 */

export type EventName =
  | 'petition:new'
  | 'petition:update'
  | 'document:ocr'
  // Knowledge-base verification progress. Officer-only: the default branch of
  // mayReceive() returns false, so a citizen never receives these.
  | 'kb:verify-progress'
  | 'kb:verify-done'
  // e-Gov Copilot document analysis progress. Officer-only, like the KB events.
  | 'copilot:progress';

type Listener = (event: EventName, data: any) => void;

interface Subscriber {
  user: AuthUser;
  listener: Listener;
}

const subscribers = new Set<Subscriber>();

/** Officers see every petition; a citizen sees only their own. */
function mayReceive(user: AuthUser, event: EventName, data: any): boolean {
  const isOfficer = user.permissions.includes('AI_ANALYZE');
  if (isOfficer) return true;

  // A citizen is told about their own petition only, and only about state the
  // citizen view already exposes.
  if (event === 'petition:new' || event === 'petition:update') {
    return data?.citizen_user_id === user.id;
  }
  if (event === 'document:ocr') {
    return data?.citizen_user_id === user.id;
  }
  return false;
}

export function subscribe(user: AuthUser, listener: Listener): () => void {
  const sub: Subscriber = { user, listener };
  subscribers.add(sub);
  return () => { subscribers.delete(sub); };
}

export function publish(event: EventName, data: any): void {
  for (const sub of subscribers) {
    if (!mayReceive(sub.user, event, data)) continue;
    try {
      sub.listener(event, data);
    } catch {
      // A broken connection must not stop delivery to everyone else.
      subscribers.delete(sub);
    }
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}
