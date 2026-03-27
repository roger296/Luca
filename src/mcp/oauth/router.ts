// src/mcp/oauth/router.ts
// OAuth 2.1 server endpoints for the MCP HTTPS transport.
//
// Implements the minimal surface Cowork requires to connect to a remote MCP server:
//
//   GET  /.well-known/oauth-protected-resource   — resource server metadata (RFC 9728)
//   GET  /.well-known/oauth-authorization-server — auth server metadata (RFC 8414)
//   POST /register                               — Dynamic Client Registration (RFC 7591)
//   GET  /authorize                              — authorization endpoint
//   POST /authorize                              — approval form submission
//   POST /token                                  — token endpoint (code + refresh_token)
//
// IMPORTANT: Cowork ignores the authorization_endpoint and token_endpoint values in
// the discovery metadata and constructs hardcoded paths /authorize and /token at the
// server root. Endpoints must live there, not under /oauth/*.
//
// IMPORTANT: The OAuth callback to Cowork must use a POST form auto-submit, not a
// GET redirect. Cowork's callback endpoint returns 405 on GET requests.

import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config/index";
import {
  registerClient,
  getClient,
  validateClientSecret,
  createAuthCode,
  consumeAuthCode,
  createRefreshToken,
  consumeRefreshToken,
} from "./store";

const ACCESS_TOKEN_TTL_SECS = 3600; // 1 hour

export const oauthRouter = Router();

// ─── Discovery endpoints ──────────────────────────────────────────────────────

// RFC 9728 — OAuth 2.0 Protected Resource Metadata
// Cowork fetches this first to discover which auth server to use.
oauthRouter.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
  const base = `https://${req.headers.host}`;
  res.json({
    resource:              `${base}/mcp`,
    authorization_servers: [base],
  });
});

// RFC 8414 — OAuth 2.0 Authorization Server Metadata
// NOTE: authorization_endpoint and token_endpoint are provided here for spec compliance,
// but Cowork ignores these values and hardcodes /authorize and /token at the root.
oauthRouter.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
  const base = `https://${req.headers.host}`;
  res.json({
    issuer:                                base,
    authorization_endpoint:               `${base}/authorize`,
    token_endpoint:                        `${base}/token`,
    registration_endpoint:                 `${base}/register`,
    response_types_supported:             ["code"],
    grant_types_supported:                ["authorization_code", "refresh_token"],
    code_challenge_methods_supported:     ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
  });
});

// ─── Dynamic Client Registration (RFC 7591) ───────────────────────────────────

oauthRouter.post("/register", (req: Request, res: Response) => {
  const {
    client_name,
    redirect_uris,
    grant_types,
    response_types,
    token_endpoint_auth_method,
  } = req.body;

  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" });
    return;
  }

  const client = registerClient({
    client_name: client_name || "Cowork",
    redirect_uris,
    grant_types,
    response_types,
    token_endpoint_auth_method,
  });

  // RFC 7591 response — include all registered metadata
  res.status(201).json({
    client_id:                  client.client_id,
    client_secret:              client.client_secret,
    client_name:                client.client_name,
    redirect_uris:              client.redirect_uris,
    grant_types:                client.grant_types,
    response_types:             client.response_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
    client_id_issued_at:        Math.floor(new Date(client.registered_at).getTime() / 1000),
  });
});

// ─── Authorization endpoint ───────────────────────────────────────────────────

oauthRouter.get("/authorize", (req: Request, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    state,
  } = req.query as Record<string, string>;

  // Validate required parameters
  if (response_type !== "code") {
    res.status(400).send(errorPage("unsupported_response_type", "Only response_type=code is supported."));
    return;
  }
  if (!client_id || !getClient(client_id)) {
    res.status(400).send(errorPage("invalid_client", "Unknown client_id."));
    return;
  }
  if (!redirect_uri) {
    res.status(400).send(errorPage("invalid_request", "redirect_uri is required."));
    return;
  }

  // Validate redirect_uri against registered list — but if the client registered
  // with an empty list (e.g. the pre-registered Cowork client), accept any URI.
  const registeredClient = getClient(client_id)!;
  if (
    registeredClient.redirect_uris.length > 0 &&
    !registeredClient.redirect_uris.includes(redirect_uri)
  ) {
    res.status(400).send(errorPage("invalid_request", "redirect_uri is not registered for this client."));
    return;
  }

  if (!code_challenge || code_challenge_method !== "S256") {
    res.status(400).send(errorPage("invalid_request", "PKCE with code_challenge_method=S256 is required."));
    return;
  }

  // Render the one-click approval page.
  // All parameters are passed through hidden form fields — no server-side session needed.
  res.send(approvalPage({ client_id, redirect_uri, code_challenge, code_challenge_method, state }));
});

// Handle form submission from the approval page.
// On approval, renders an auto-submitting POST form back to the redirect_uri.
// This is required because Cowork's callback endpoint returns 405 on GET requests.
oauthRouter.post("/authorize", (req: Request, res: Response) => {
  const {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    state,
    action,
  } = req.body as Record<string, string>;

  if (action === "deny") {
    // Denial can use a GET redirect since it's just an error — no sensitive code in URL
    const denyUrl = new URL(redirect_uri);
    denyUrl.searchParams.set("error", "access_denied");
    if (state) denyUrl.searchParams.set("state", state);
    res.redirect(denyUrl.toString());
    return;
  }

  // User approved — generate auth code and redirect back to the redirect_uri
  const userId = process.env.MCP_USER_ID || "local-user";
  const code = createAuthCode({
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    user_id: userId,
  });

  // Standard OAuth 2.0: GET redirect with code and state as query parameters.
  // claude.ai/api/mcp/auth_callback expects this standard approach.
  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);
  res.redirect(callbackUrl.toString());
});

// ─── Token endpoint ───────────────────────────────────────────────────────────

oauthRouter.post("/token", (req: Request, res: Response) => {
  const { grant_type } = req.body as Record<string, string>;

  if (grant_type === "authorization_code") {
    handleAuthCodeExchange(req, res);
  } else if (grant_type === "refresh_token") {
    handleRefreshTokenExchange(req, res);
  } else {
    res.status(400).json({ error: "unsupported_grant_type" });
  }
});

function handleAuthCodeExchange(req: Request, res: Response): void {
  const { code, redirect_uri, code_verifier, client_id, client_secret } = req.body as Record<string, string>;

  if (!code || !code_verifier || !client_id) {
    res.status(400).json({ error: "invalid_request", error_description: "code, code_verifier, and client_id are required" });
    return;
  }

  // Validate client identity (support both client_secret_post and none for public clients)
  const client = getClient(client_id);
  if (!client) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }
  if (client.token_endpoint_auth_method !== "none" && client_secret) {
    if (!validateClientSecret(client_id, client_secret)) {
      res.status(401).json({ error: "invalid_client", error_description: "Invalid client_secret" });
      return;
    }
  }

  // Consume the auth code
  const authCode = consumeAuthCode(code);
  if (!authCode) {
    res.status(400).json({ error: "invalid_grant", error_description: "Auth code is invalid or expired" });
    return;
  }
  if (authCode.client_id !== client_id) {
    res.status(400).json({ error: "invalid_grant", error_description: "client_id mismatch" });
    return;
  }

  // Only enforce redirect_uri match if the client has a registered list
  const tokenClient = getClient(client_id)!;
  if (redirect_uri && tokenClient.redirect_uris.length > 0 && authCode.redirect_uri !== redirect_uri) {
    res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
    return;
  }

  // Verify PKCE: SHA-256(code_verifier) must equal code_challenge
  const expectedChallenge = crypto
    .createHash("sha256")
    .update(code_verifier)
    .digest("base64url");
  if (expectedChallenge !== authCode.code_challenge) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  const accessToken  = issueAccessToken(authCode.user_id, client_id);
  const refreshToken = createRefreshToken(client_id, authCode.user_id);

  res.json({
    access_token:  accessToken,
    token_type:    "Bearer",
    expires_in:    ACCESS_TOKEN_TTL_SECS,
    refresh_token: refreshToken,
  });
}

function handleRefreshTokenExchange(req: Request, res: Response): void {
  const { refresh_token, client_id, client_secret } = req.body as Record<string, string>;

  if (!refresh_token || !client_id) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const client = getClient(client_id);
  if (!client) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }
  if (client.token_endpoint_auth_method !== "none" && client_secret) {
    if (!validateClientSecret(client_id, client_secret)) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
  }

  const record = consumeRefreshToken(refresh_token);
  if (!record || record.client_id !== client_id) {
    res.status(400).json({ error: "invalid_grant", error_description: "Refresh token is invalid, expired, or belongs to a different client" });
    return;
  }

  const accessToken     = issueAccessToken(record.user_id, client_id);
  const newRefreshToken = createRefreshToken(client_id, record.user_id);

  res.json({
    access_token:  accessToken,
    token_type:    "Bearer",
    expires_in:    ACCESS_TOKEN_TTL_SECS,
    refresh_token: newRefreshToken,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function issueAccessToken(userId: string, clientId: string): string {
  return jwt.sign(
    {
      sub:       userId,
      client_id: clientId,
      roles:     ["ADMIN", "FINANCE_MANAGER"],
    },
    config.jwt.secret,
    { expiresIn: ACCESS_TOKEN_TTL_SECS }
  );
}

// Renders the approval page — user clicks "Allow Access" to approve.
function approvalPage(params: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
}): string {
  const client = getClient(params.client_id);
  const clientName = client?.client_name || "An application";
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorise — Luca's General Ledger</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f5f5f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: white; border-radius: 12px; padding: 40px;
            max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.1); }
    .logo { font-size: 28px; font-weight: 700; color: #1a1a2e; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 32px; font-size: 14px; }
    h2 { font-size: 18px; color: #1a1a2e; margin: 0 0 12px; }
    .scope-list { background: #f9f9f9; border-radius: 8px; padding: 16px;
                  margin-bottom: 28px; font-size: 14px; color: #444; }
    .scope-list li { margin: 6px 0; list-style: none; padding-left: 20px; position: relative; }
    .scope-list li::before { content: "✓"; position: absolute; left: 0; color: #2ecc71; }
    .buttons { display: flex; gap: 12px; }
    .btn { flex: 1; padding: 12px; border: none; border-radius: 8px;
           font-size: 15px; font-weight: 600; cursor: pointer; }
    .btn-approve { background: #1a1a2e; color: white; }
    .btn-approve:hover { background: #2d2d4e; }
    .btn-deny { background: #f0f0f0; color: #555; }
    .btn-deny:hover { background: #e0e0e0; }
    .client-name { font-weight: 600; color: #1a1a2e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Luca's General Ledger</div>
    <div class="subtitle">Accounting &amp; CFO Intelligence</div>
    <h2><span class="client-name">${escape(clientName)}</span> wants access</h2>
    <ul class="scope-list">
      <li>Read and post ledger transactions</li>
      <li>View account balances and reports</li>
      <li>Access the approval queue</li>
    </ul>
    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id"             value="${escape(params.client_id)}">
      <input type="hidden" name="redirect_uri"          value="${escape(params.redirect_uri)}">
      <input type="hidden" name="code_challenge"        value="${escape(params.code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${escape(params.code_challenge_method)}">
      <input type="hidden" name="state"                 value="${escape(params.state || "")}">
      <div class="buttons">
        <button class="btn btn-deny"    type="submit" name="action" value="deny">Deny</button>
        <button class="btn btn-approve" type="submit" name="action" value="approve">Allow Access</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

// Renders a self-submitting POST form that sends the auth code back to Cowork.
// A GET redirect would return 405 from Cowork's callback endpoint.
function callbackPage(params: { redirect_uri: string; code: string; state?: string }): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Completing authorisation…</title>
</head>
<body>
  <p>Completing authorisation, please wait…</p>
  <form id="cb" method="POST" action="${escape(params.redirect_uri)}">
    <input type="hidden" name="code"  value="${escape(params.code)}">
    <input type="hidden" name="state" value="${escape(params.state || "")}">
  </form>
  <script>document.getElementById("cb").submit();</script>
</body>
</html>`;
}

function errorPage(error: string, description: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Error — Luca's General Ledger</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f5f5f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: white; border-radius: 12px; padding: 40px;
            max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.1); }
    h2 { color: #c0392b; }
    p  { color: #555; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Authorisation Error</h2>
    <p><strong>${error}</strong></p>
    <p>${description}</p>
  </div>
</body>
</html>`;
}
