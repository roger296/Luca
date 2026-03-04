import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { apiRouter } from './api/routes';
import { errorHandler } from './api/middleware/errors';
import { config } from './config';

// ---------------------------------------------------------------------------
// server.ts — Express application entry point
// ---------------------------------------------------------------------------

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
app.listen(config.port, () => {
  console.log(`GL MVP server running on port ${config.port} [${config.nodeEnv}]`);
});

export { app };
