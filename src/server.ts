import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ChainWriter } from './chain/writer';
import { ChainFileExistsError } from './chain/types';
import { apiRouter } from './api/routes';
import { errorHandler } from './api/middleware/errors';
import { config } from './config';
import { db } from './db/connection';

// ---------------------------------------------------------------------------
// server.ts — Express application entry point
// ---------------------------------------------------------------------------

/**
 * Bootstrap chain files for any period that has a DB row but no chain file.
 * This handles the case where periods were created by the seed script without
 * a corresponding chain file (e.g., the initial period on first startup).
 */
async function bootstrapChainFiles(): Promise<void> {
  const writer = new ChainWriter({
    chainDir: config.chainDir,
    getPeriodStatus: async (periodId: string) => {
      const row = await db('periods')
        .where('period_id', periodId)
        .select('status')
        .first<{ status: string } | undefined>();
      return (row?.status as 'OPEN' | 'SOFT_CLOSE' | 'HARD_CLOSE' | null) ?? null;
    },
  });

  const periods = await db('periods').orderBy('period_id', 'asc');

  for (const period of periods) {
    const chainFilePath = path.join(config.chainDir, `${period.period_id}.chain.jsonl`);
    const fileExists = await fs.access(chainFilePath).then(() => true).catch(() => false);
    if (!fileExists) {
      // Find the most recent preceding period that has a HARD_CLOSE status.
      const prevPeriod = await db('periods')
        .where('period_id', '<', period.period_id)
        .where('status', 'HARD_CLOSE')
        .orderBy('period_id', 'desc')
        .first<{ period_id: string } | undefined>();

      try {
        await writer.createPeriodFile(
          period.period_id,
          prevPeriod?.period_id ?? null,
          {},
        );
        console.log(`Bootstrapped chain file for period ${period.period_id}`);
      } catch (err) {
        if (err instanceof ChainFileExistsError) {
          // Race condition — another startup already created it; that's fine.
        } else {
          console.error(`Failed to bootstrap chain file for ${period.period_id}:`, err);
        }
      }
    }
  }
}

const app = express();

// ── Security and parsing middleware ─────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  }),
);
app.use(cors());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json());

// ── API routes ───────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: config.nodeEnv });
});

// ── Serve React frontend (static build) ──────────────────────────────────────
// In production/Docker the frontend is pre-built into src/web/dist.
// In development, the Vite dev server handles this separately.
const webDistPath = path.join(__dirname, '..', 'src', 'web', 'dist');

app.use(express.static(webDistPath));

// SPA fallback — serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(webDistPath, 'index.html'));
});

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

// ── Start server ─────────────────────────────────────────────────────────────
bootstrapChainFiles()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`GL MVP server running on port ${config.port} [${config.nodeEnv}]`);
    });
  })
  .catch((err: unknown) => {
    console.error('Fatal: chain bootstrap failed:', err);
    process.exit(1);
  });

export { app };
