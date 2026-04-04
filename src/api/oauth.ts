// ---------------------------------------------------------------------------
// api/oauth.ts — OAuth 2.0 authorization code flow endpoints + HTML login page
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { findUserByEmail, findUserById, recordLogin } from '../db/queries/users';
import {
  getClient,
  validateClient,
  createAuthorizationCode,
  exchangeCodeForToken,
  validateAccessToken,
} from '../engine/oauth';

const oauthRouter = Router();

// ── GET /oauth/authorize ───────────────────────────────────────────────────────
// Claude.ai redirects the user here. We show a login page.
oauthRouter.get('/authorize', async (req: Request, res: Response): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const client_id = q['client_id'] ?? '';
  const redirect_uri = q['redirect_uri'] ?? '';
  const state = q['state'];
  const scope = q['scope'] ?? 'mcp';
  const code_challenge = q['code_challenge'];
  const code_challenge_method = q['code_challenge_method'];
  const response_type = q['response_type'];

  // Validate client
  const client = await getClient(client_id).catch(() => null);
  if (!client) {
    res.status(400).send(errorPage('Invalid client_id'));
    return;
  }

  // Validate redirect_uri — accept pre-registered URIs or any https://claude.ai/* URI
  const isRegistered = client.redirect_uris.includes(redirect_uri);
  const isClaudeUri =
    redirect_uri.startsWith('https://claude.ai/') ||
    redirect_uri.startsWith('https://claudeai.app/') ||
    redirect_uri === 'https://claude.ai';
  if (!redirect_uri || (!isRegistered && !isClaudeUri)) {
    res.status(400).send(errorPage('Invalid redirect_uri'));
    return;
  }

  if (response_type !== 'code') {
    res.status(400).send(errorPage('Only response_type=code is supported'));
    return;
  }

  res.send(
    loginPage({
      client_id,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method,
      client_name: client.name,
    }),
  );
});

// ── POST /oauth/authorize ──────────────────────────────────────────────────────
// User submits the login form. Validate credentials and issue auth code.
oauthRouter.post('/authorize', async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, string | undefined>;
  const email = b['email'] ?? '';
  const password = b['password'] ?? '';
  const client_id = b['client_id'] ?? '';
  const redirect_uri = b['redirect_uri'] ?? '';
  const state = b['state'] || undefined;
  const scope = b['scope'] ?? 'mcp';
  const code_challenge = b['code_challenge'] || undefined;
  const code_challenge_method = b['code_challenge_method'] || undefined;

  // Re-validate client
  const client = await getClient(client_id).catch(() => null);
  if (!client) {
    res.status(400).send(errorPage('Invalid client'));
    return;
  }

  // Validate user credentials
  const user = await findUserByEmail(email).catch(() => null);
  const passwordValid = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !passwordValid || !user.is_active) {
    res.send(
      loginPage({
        client_id,
        redirect_uri,
        state,
        scope,
        code_challenge,
        code_challenge_method,
        client_name: client.name,
        error: 'Invalid email or password. Please try again.',
      }),
    );
    return;
  }

  await recordLogin(user.id).catch(() => {});

  // Issue authorization code
  const code = await createAuthorizationCode({
    client_id,
    user_id: user.id,
    redirect_uri,
    scopes: scope.split(' '),
    code_challenge,
    code_challenge_method,
  });

  // Redirect back to Claude.ai
  const params = new URLSearchParams({ code, ...(state ? { state } : {}) });
  res.redirect(`${redirect_uri}?${params.toString()}`);
});

// ── POST /oauth/token ──────────────────────────────────────────────────────────
// Claude.ai exchanges the authorization code for an access token.
oauthRouter.post('/token', async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, string | undefined>;
  const grant_type = b['grant_type'] ?? '';
  const code = b['code'] ?? '';
  const redirect_uri = b['redirect_uri'] ?? '';
  const client_id = b['client_id'] ?? '';
  const client_secret = b['client_secret'] ?? '';
  const code_verifier = b['code_verifier'] || undefined;

  if (grant_type !== 'authorization_code') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }

  // Validate client
  const client = await validateClient(client_id, client_secret).catch(() => null);
  if (!client) {
    res.status(401).json({ error: 'invalid_client' });
    return;
  }

  // Exchange code for token
  const result = await exchangeCodeForToken({
    code,
    client_id,
    redirect_uri,
    code_verifier,
  }).catch(() => null);

  if (!result) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }

  res.json(result);
});

// ── GET /oauth/userinfo ────────────────────────────────────────────────────────
// Returns basic user info for the token holder (optional, useful for debugging)
oauthRouter.get('/userinfo', async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const token = authHeader.slice(7);
  const tokenData = await validateAccessToken(token).catch(() => null);
  if (!tokenData) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  const user = await findUserById(tokenData.user_id).catch(() => null);
  res.json({
    sub: tokenData.user_id,
    email: user?.email,
    name: user?.display_name,
    scopes: tokenData.scopes,
  });
});

// ── OAuth discovery endpoint ───────────────────────────────────────────────────
// Register /.well-known/oauth-authorization-server on the main app
export function registerOAuthDiscovery(
  app: import('express').Express,
  baseUrl: string,
): void {
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  });
}

export default oauthRouter;

// ── HTML helpers ──────────────────────────────────────────────────────────────

function loginPage(params: {
  client_id: string;
  redirect_uri: string;
  state?: string;
  scope: string;
  code_challenge?: string;
  code_challenge_method?: string;
  client_name: string;
  error?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Claude to Luca</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
      padding: 2.5rem;
      width: 100%;
      max-width: 420px;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 2rem;
    }
    .logo-icon {
      width: 44px;
      height: 44px;
      background: #0066cc;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 1.2rem;
    }
    .logo-text h1 { font-size: 1.2rem; font-weight: 700; color: #111; }
    .logo-text p { font-size: 0.85rem; color: #666; }
    .connecting {
      background: #f0f7ff;
      border: 1px solid #cce0ff;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
      color: #0055aa;
    }
    .error {
      background: #fff0f0;
      border: 1px solid #ffcccc;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
      color: #cc0000;
    }
    label { display: block; font-size: 0.875rem; font-weight: 500; color: #333; margin-bottom: 0.35rem; }
    input[type="email"], input[type="password"] {
      width: 100%;
      padding: 0.65rem 0.85rem;
      border: 1.5px solid #ddd;
      border-radius: 8px;
      font-size: 1rem;
      color: #111;
      margin-bottom: 1rem;
      transition: border-color 0.15s;
      outline: none;
    }
    input:focus { border-color: #0066cc; }
    button[type="submit"] {
      width: 100%;
      padding: 0.75rem;
      background: #0066cc;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      margin-top: 0.5rem;
    }
    button:hover { background: #0052a3; }
    .footer {
      margin-top: 1.5rem;
      font-size: 0.8rem;
      color: #999;
      text-align: center;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">L</div>
      <div class="logo-text">
        <h1>Luca General Ledger</h1>
        <p>Accounting &amp; Finance</p>
      </div>
    </div>

    <div class="connecting">
      <strong>${escHtml(params.client_name)}</strong> is requesting access to your Luca account.
      Sign in to authorise the connection.
    </div>

    ${params.error ? `<div class="error">${escHtml(params.error)}</div>` : ''}

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escHtml(params.client_id)}">
      <input type="hidden" name="redirect_uri" value="${escHtml(params.redirect_uri)}">
      <input type="hidden" name="state" value="${escHtml(params.state ?? '')}">
      <input type="hidden" name="scope" value="${escHtml(params.scope)}">
      <input type="hidden" name="code_challenge" value="${escHtml(params.code_challenge ?? '')}">
      <input type="hidden" name="code_challenge_method" value="${escHtml(params.code_challenge_method ?? '')}">

      <label for="email">Email address</label>
      <input type="email" id="email" name="email" required autocomplete="email" autofocus placeholder="you@yourcompany.com">

      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="Your Luca password">

      <button type="submit">Sign in &amp; Authorise Claude</button>
    </form>

    <div class="footer">
      By signing in, you allow Claude to access your Luca accounting data<br>
      on your behalf. You can revoke access at any time from Luca settings.
    </div>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><body style="font-family:sans-serif;padding:2rem"><h2>Error</h2><p>${escHtml(message)}</p></body></html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
