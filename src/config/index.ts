// ---------------------------------------------------------------------------
// config/index.ts — centralised environment configuration
// ---------------------------------------------------------------------------

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  chainDir: process.env['CHAIN_DIR'] ?? 'chains/default',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
} as const;
