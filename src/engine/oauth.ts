// ---------------------------------------------------------------------------
// engine/oauth.ts — OAuth 2.0 engine (client management + token lifecycle)
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/connection';

export interface OAuthClient {
  client_id: string;
  client_secret_hash: string;
  name: string;
  redirect_uris: string[];
  scopes: string[];
  is_active: boolean;
}

export interface OAuthAccessToken {
  token_hash: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  expires_at: string | null;
  is_revoked: boolean;
}

// Generate a new OAuth client (called by API or setup scripts)
// Returns the plain-text secret ONCE — it is never stored.
export async function createOAuthClient(params: {
  name: string;
  redirect_uris: string[];
  scopes?: string[];
}): Promise<{ client_id: string; client_secret: string; client: OAuthClient }> {
  const client_id = 'luca_' + crypto.randomBytes(16).toString('hex');
  const client_secret = crypto.randomBytes(32).toString('hex');
  const client_secret_hash = await bcrypt.hash(client_secret, 10);

  await db('oauth_clients').insert({
    client_id,
    client_secret_hash,
    name: params.name,
    redirect_uris: params.redirect_uris,
    scopes: params.scopes ?? ['mcp'],
    is_active: true,
  });

  const client = await db('oauth_clients').where('client_id', client_id).first<OAuthClient>();
  return { client_id, client_secret, client: client! };
}

// Validate client credentials (used at /oauth/token)
export async function validateClient(
  client_id: string,
  client_secret: string,
): Promise<OAuthClient | null> {
  const client = await db('oauth_clients')
    .where('client_id', client_id)
    .where('is_active', true)
    .first<OAuthClient>();
  if (!client) return null;
  const valid = await bcrypt.compare(client_secret, client.client_secret_hash);
  return valid ? client : null;
}

export async function getClient(client_id: string): Promise<OAuthClient | null> {
  const client = await db('oauth_clients')
    .where('client_id', client_id)
    .where('is_active', true)
    .first<OAuthClient>();
  return client ?? null;
}

export async function listClients(): Promise<Omit<OAuthClient, 'client_secret_hash'>[]> {
  return db('oauth_clients')
    .select('client_id', 'name', 'redirect_uris', 'scopes', 'is_active', 'created_at')
    .orderBy('created_at', 'desc');
}

export async function deleteClient(client_id: string): Promise<void> {
  await db('oauth_clients').where('client_id', client_id).update({ is_active: false });
}

// Create an authorization code (step 1 of auth code flow)
export async function createAuthorizationCode(params: {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge?: string;
  code_challenge_method?: string;
}): Promise<string> {
  const code = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db('oauth_authorization_codes').insert({
    code,
    client_id: params.client_id,
    user_id: params.user_id,
    redirect_uri: params.redirect_uri,
    scopes: params.scopes,
    code_challenge: params.code_challenge ?? null,
    code_challenge_method: params.code_challenge_method ?? null,
    expires_at: expires_at.toISOString(),
    used: false,
  });

  return code;
}

// Exchange authorization code for access token
export async function exchangeCodeForToken(params: {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier?: string;
}): Promise<{ access_token: string; token_type: string; scope: string } | null> {
  const row = await db('oauth_authorization_codes')
    .where('code', params.code)
    .where('client_id', params.client_id)
    .where('redirect_uri', params.redirect_uri)
    .where('used', false)
    .first<{
      code: string;
      client_id: string;
      user_id: string;
      redirect_uri: string;
      scopes: string[];
      code_challenge: string | null;
      code_challenge_method: string | null;
      expires_at: string;
    }>();

  if (!row) return null;

  // Check expiry
  if (new Date(row.expires_at) < new Date()) return null;

  // PKCE verification
  if (row.code_challenge && params.code_verifier) {
    const challenge = crypto
      .createHash('sha256')
      .update(params.code_verifier)
      .digest('base64url');
    if (challenge !== row.code_challenge) return null;
  }

  // Mark code as used
  await db('oauth_authorization_codes').where('code', params.code).update({ used: true });

  // Generate access token
  const raw_token = crypto.randomBytes(48).toString('hex');
  const token_hash = crypto.createHash('sha256').update(raw_token).digest('hex');

  await db('oauth_access_tokens').insert({
    token_hash,
    client_id: params.client_id,
    user_id: row.user_id,
    scopes: row.scopes,
    expires_at: null, // MCP tokens don't expire — user can revoke
    is_revoked: false,
  });

  return {
    access_token: raw_token,
    token_type: 'Bearer',
    scope: row.scopes.join(' '),
  };
}

// Validate an access token from a Bearer header
export async function validateAccessToken(raw_token: string): Promise<{
  user_id: string;
  client_id: string;
  scopes: string[];
} | null> {
  const token_hash = crypto.createHash('sha256').update(raw_token).digest('hex');

  const token = await db('oauth_access_tokens')
    .where('token_hash', token_hash)
    .where('is_revoked', false)
    .first<OAuthAccessToken>();

  if (!token) return null;
  if (token.expires_at && new Date(token.expires_at) < new Date()) return null;

  // Update last_used_at (fire and forget)
  db('oauth_access_tokens')
    .where('token_hash', token_hash)
    .update({ last_used_at: new Date().toISOString() })
    .catch(() => {});

  return {
    user_id: token.user_id,
    client_id: token.client_id,
    scopes: token.scopes,
  };
}

export async function revokeToken(raw_token: string): Promise<void> {
  const token_hash = crypto.createHash('sha256').update(raw_token).digest('hex');
  await db('oauth_access_tokens').where('token_hash', token_hash).update({ is_revoked: true });
}
