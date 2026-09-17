/**
 * API client for the Citizen Petition POC.
 *
 * Uses its own token key so a POC session and a Collector-app session can
 * coexist in the same browser without signing each other out.
 */
export interface PocUser {
  id: number;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

const KEY = 'poc_token';

export const getPocToken = () => localStorage.getItem(KEY);
export const setPocToken = (t: string) => localStorage.setItem(KEY, t);
export const clearPocToken = () => localStorage.removeItem(KEY);

export class PocApiError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const token = getPocToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(form ? {} : body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });

  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    throw new PocApiError(data?.error ?? `Request failed (${res.status})`, res.status, data);
  }
  return data as T;
}

export const pocApi = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => request<T>('POST', p, undefined, form),
};

/*
 * Dates follow the console's language.
 *
 * These were pinned to 'en-GB', which printed "16 Sept 2026" on a Tamil screen
 * and in a Tamil report - an English month name is exactly the mixing this
 * console must not do. The locale is now passed in, and defaults to English so
 * a caller that has no language to hand behaves as before.
 */
type Lang = 'ta' | 'en';
const locale = (lang?: Lang) => (lang === 'ta' ? 'ta-IN' : 'en-GB');

export function fmtTime(s?: string | null, lang?: Lang): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(locale(lang), {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtDay(s?: string | null, lang?: Lang): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(locale(lang), { day: '2-digit', month: 'short', year: 'numeric' });
}

export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`;

export const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Submitted',
  ANALYSING: 'AI analysing',
  ANALYSED: 'Analysed',
  UNDER_REVIEW: 'Under review',
  ACTIONED: 'Actioned',
  CLOSED: 'Closed',
};
