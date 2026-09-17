/*
 * Load .env before anything else imports the AI gateway.
 *
 * The gateway decides at module load whether a live provider exists, so the
 * environment has to be populated first - otherwise GEMINI_API_KEY is read as
 * undefined and the system silently falls back to the local provider.
 *
 * Node 20+ can do this without a dependency.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __envDir = dirname(fileURLToPath(import.meta.url));
for (const candidate of [resolve(__envDir, '../.env'), resolve(__envDir, '../../.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile?.(candidate);
    break;
  }
}

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initSchema, db } from './core/db.js';
import { initTranslationCache } from './core/translate.js';
import { authRouter } from './modules/authRoutes.js';
import { kbRouter } from './modules/knowledgeConfig.js';
import { cpRouter } from './modules/citizenPetitions.js';
import {
  securityHeaders, csrfGuard, apiRateLimit, writeRateLimit, aiRateLimit,
} from './core/security.js';
import { tick } from './core/jobs.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

initSchema();
initTranslationCache();

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(securityHeaders);
app.use('/api', apiRateLimit);
app.use('/api', csrfGuard);

app.get('/api/health', (_req, res) => {
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n;
  res.json({
    ok: true,
    service: 'Citizen Petition AI POC',
    counts: {
      users: n('app_user'),
      petitions: n('cp_petition'),
      acts: n('kb_act'),
      departments: n('kb_department'),
      authorities: n('kb_authority'),
    },
  });
});

// The real-time stream authenticates from a query parameter (EventSource
// cannot set headers), so it is mounted before header-only authentication.
app.use('/api/cp', writeRateLimit, cpRouter);
app.use('/api/auth', authRouter);
app.use('/api/kb', aiRateLimit, kbRouter);

// Multer and other upload errors arrive here.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is too large (maximum 15 MB)' });
    return;
  }
  if (err?.message?.includes('not permitted')) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Citizen Petition AI POC - API on http://localhost:${PORT}`);
  void tick();
});
