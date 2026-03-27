// src/mcp/oauth/middleware.ts
// Bearer token validation middleware for the MCP endpoint.
// Verifies the JWT issued by the local OAuth server and injects userId into the request.

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config/index";

declare global {
  namespace Express {
    interface Request {
      mcpUserId?: string;
    }
  }
}

export function requireMcpAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];

  // Helper: send 401 with WWW-Authenticate header so Cowork knows to start the OAuth flow
  const wwwAuth = (scheme: string) =>
    `Bearer realm="gl-ledger", resource_metadata="https://${req.headers.host}/.well-known/oauth-protected-resource"`;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.set("WWW-Authenticate", wwwAuth("no-token"));
    res.status(401).json({
      error:             "unauthorized",
      error_description: "Bearer token required",
    });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as { sub: string };
    req.mcpUserId = payload.sub;
    next();
  } catch {
    res.set("WWW-Authenticate", wwwAuth("invalid-token"));
    res.status(401).json({
      error:             "invalid_token",
      error_description: "Token is invalid or expired",
    });
  }
}
