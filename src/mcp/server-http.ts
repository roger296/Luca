// src/mcp/server-http.ts
// MCP server entry point — HTTP/HTTPS (Streamable HTTP) transport.
// Use this when registering as a remote MCP connector in Claude / Cowork.
// Start with: npm run mcp:http
//
// LOCAL DEV (TLS enabled, default):
//   Requires TLS certificate files (generate once with setup-certs.bat):
//   MCP_TLS_CERT  — path to certificate file  (default: ./certs/localhost.pem)
//   MCP_TLS_KEY   — path to private key file   (default: ./certs/localhost-key.pem)
//   Exposes endpoint at: https://localhost:<MCP_HTTP_PORT>/mcp
//
// VPS / BEHIND NGINX (TLS disabled):
//   Set MCP_TLS_DISABLE=true — the server runs plain HTTP; nginx handles TLS.
//   Exposes endpoint at: http://0.0.0.0:<MCP_HTTP_PORT>/mcp

import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server";
import { getContext } from "./auth";
import { oauthRouter } from "./oauth/router";
import { requireMcpAuth } from "./oauth/middleware";
import { ensureCoworkClient } from "./oauth/store";

const PORT        = parseInt(process.env.MCP_HTTP_PORT || "3002", 10);
const TLS_DISABLED = process.env.MCP_TLS_DISABLE === "true";

const certPath = process.env.MCP_TLS_CERT || path.join(process.cwd(), "certs", "localhost.pem");
const keyPath  = process.env.MCP_TLS_KEY  || path.join(process.cwd(), "certs", "localhost-key.pem");

// Verify certificate files exist before starting (skip when TLS is disabled, e.g. behind nginx)
if (!TLS_DISABLED) {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error("TLS certificate files not found.");
    console.error(`  Expected cert: ${certPath}`);
    console.error(`  Expected key:  ${keyPath}`);
    console.error("");
    console.error("  Run setup-certs.bat to generate them.");
    console.error("  Or set MCP_TLS_DISABLE=true to run in plain HTTP mode behind a reverse proxy.");
    process.exit(1);
  }
}

// Plain Express app — we skip createMcpExpressApp's DNS rebinding protection
// because it rejects Host headers that include the port number (e.g. localhost:3002),
// which is exactly what Cowork sends. TLS on localhost is already secure.
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // needed for OAuth approval form POST

// CORS — Cowork and claude.ai make cross-origin requests to the MCP endpoint.
// We must allow preflight (OPTIONS) and the actual request with Authorization headers.
const ALLOWED_ORIGINS = new Set([
  "https://claude.ai",
  "https://app.claude.ai",
  "https://claude.com",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  // Allow Cowork (which sends no Origin) and the listed claude.ai/claude.com origins
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Session-Id");
  res.set("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Log every incoming request so we can see what Cowork sends
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} — Host: ${req.headers.host}`);
  next();
});

// OAuth 2.1 endpoints (unauthenticated — these ARE the auth layer)
app.use(oauthRouter);

// MCP endpoint — POST only in stateless mode, protected by Bearer token
app.post("/mcp", requireMcpAuth, async (req, res) => {
  console.log("  MCP request body type:", req.body?.method ?? "(no method)");
  const context = getContext(req.mcpUserId);
  const server = createMcpServer(context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
  });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    console.log("  MCP request handled OK");
  } catch (err) {
    console.error("  MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Return 200 for GET /mcp so Cowork's connectivity check doesn't mistake
// a 405 for the server being down
app.get("/mcp", (_req, res) => {
  res.status(200).json({ server: "gl-ledger-mcp", transport: "streamable-http", mode: "stateless" });
});

app.delete("/mcp", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "gl-ledger-mcp-https", port: PORT });
});

// Start server — plain HTTP when behind a reverse proxy, HTTPS for local dev
const listenHost = TLS_DISABLED ? "0.0.0.0" : "127.0.0.1";
const protocol   = TLS_DISABLED ? "http"     : "https";

const server = TLS_DISABLED
  ? http.createServer(app)
  : https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app);

server.listen(PORT, listenHost, () => {
  const coworkClient = ensureCoworkClient();
  console.log(`GL MCP server listening on ${protocol}://localhost:${PORT}/mcp`);
  if (TLS_DISABLED) {
    console.log(`  (HTTP mode — TLS handled by reverse proxy)`);
  }
  console.log(`Health check: ${protocol}://localhost:${PORT}/health`);
  console.log(``);
  console.log(`┌─────────────────────────────────────────────────────┐`);
  console.log(`│         Cowork Connector Credentials                │`);
  console.log(`│                                                      │`);
  console.log(`│  URL:           https://localhost:${PORT}/mcp        │`);
  console.log(`│  OAuth ID:      ${coworkClient.client_id}  │`);
  console.log(`│  OAuth Secret:  ${coworkClient.client_secret}  │`);
  console.log(`│                                                      │`);
  console.log(`│  Paste the ID and Secret into Cowork's              │`);
  console.log(`│  Advanced Settings when adding the connector.        │`);
  console.log(`└─────────────────────────────────────────────────────┘`);
  console.log(``);
  console.log(`--- Waiting for requests ---`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
