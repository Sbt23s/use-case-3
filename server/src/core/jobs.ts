/**
 * Background job runner.
 *
 * Long operations (OCR, transcription) must not block the request path, and the
 * UI must never show a fake completion. Every job has a real row whose status
 * the UI polls: QUEUED -> PROCESSING -> COMPLETED | FAILED, with retries.
 *
 * This is an in-process runner suited to a single-node POC. The job table and
 * status model are the production seam: swapping in BullMQ/pg-boss means
 * replacing the loop, not the callers or the schema.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { audit } from './audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = resolve(__dirname, '../../data/uploads');

export type JobType = 'DOCUMENT_EXTRACT';

export function enqueue(
  jobType: JobType,
  payload: Record<string, unknown>,
  opts: { petitionId?: number; userId?: number } = {},
): number {
  const r = db.prepare(
    'INSERT INTO job (job_type, petition_id, payload, status, created_by) VALUES (?, ?, ?, ?, ?)',
  ).run(jobType, opts.petitionId ?? null, JSON.stringify(payload), 'QUEUED', opts.userId ?? null);
  const id = Number(r.lastInsertRowid);
  setImmediate(() => { void tick(); });
  return id;
}

export function getJob(id: number) {
  return db.prepare('SELECT * FROM job WHERE id = ?').get(id) as any;
}

export function jobsForPetition(petitionId: number) {
  return db.prepare(
    'SELECT id, job_type, status, attempts, error, result, created_at, updated_at ' +
    'FROM job WHERE petition_id = ? ORDER BY id DESC',
  ).all(petitionId);
}

let running = false;

/** Drain the queue. Safe to call concurrently; only one drain runs at a time. */
export async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = db.prepare(
        "SELECT * FROM job WHERE status = 'QUEUED' AND attempts < max_attempts ORDER BY id LIMIT 1",
      ).get() as any;
      if (!job) break;

      db.prepare(
        "UPDATE job SET status = 'PROCESSING', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?",
      ).run(job.id);

      try {
        const result = await runJob(job);
        db.prepare(
          "UPDATE job SET status = 'COMPLETED', result = ?, error = NULL, updated_at = datetime('now') WHERE id = ?",
        ).run(JSON.stringify(result), job.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const attempts = job.attempts + 1;
        const exhausted = attempts >= job.max_attempts;
        db.prepare(
          `UPDATE job SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(exhausted ? 'FAILED' : 'QUEUED', msg, job.id);
        if (exhausted) console.error(`[jobs] ${job.job_type} #${job.id} failed after ${attempts} attempts:`, msg);
      }
    }
  } finally {
    running = false;
  }
}

async function runJob(job: any): Promise<unknown> {
  /*
   * The POC performs document text extraction inline in the upload route, so
   * no job type is registered here yet. The queue, its status lifecycle and the
   * retry behaviour remain in place as the seam for work that must not block a
   * request - registering a handler is all that is needed.
   */
  throw new Error(`No handler is registered for job type ${job.job_type}`);
}
