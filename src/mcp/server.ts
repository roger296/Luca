// ---------------------------------------------------------------------------
// mcp/server.ts — HTTP MCP server using StreamableHTTPServerTransport
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router, type Request, type Response } from 'express';
import { validateAccessToken } from '../engine/oauth';
import { registerTools } from './tools';

export function createMcpRouter(): Router {
  const router = Router();

  // The MCP endpoint handles all methods (GET for SSE stream, POST for messages)
  // StreamableHTTPServerTransport in stateless mode: sessionIdGenerator = undefined
  router.all('/', async (req: Request, res: Response): Promise<void> => {
    // ── Authenticate via Bearer token ────────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'unauthorized',
        error_description: 'Bearer token required. Connect via /connect-claude.',
      });
      return;
    }

    const raw_token = authHeader.slice(7);
    const tokenData = await validateAccessToken(raw_token).catch(() => null);
    if (!tokenData) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token is invalid, expired, or revoked.',
      });
      return;
    }

    // ── Create a fresh McpServer + transport for each stateless request ───────
    const server = new McpServer({
      name: 'luca-general-ledger',
      version: '1.0.0',
    });

    // Register all GL tools (cast to any because our tool handlers
    // use Record<string, unknown> args which is compatible at runtime
    // with the SDK's typed ShapeOutput<Args> — the zod schemas match)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTools(server as any);

    // Stateless mode: no session ID, no in-memory state between requests
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } finally {
      // Clean up after each request in stateless mode
      await server.close().catch(() => {});
    }
  });

  return router;
}
