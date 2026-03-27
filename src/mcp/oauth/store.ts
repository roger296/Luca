// src/mcp/oauth/store.ts
// Storage for OAuth clients, auth codes, and refresh tokens.
//
// Client registrations are persisted to ./data/oauth-clients.json so that
// Cowork does not need to re-register after a server restart.
//
// Auth codes are in-memory only — they expire in 60 seconds and are single-use.
// Refresh tokens are in-memory only — users re-authenticate after a server restart,
// which is a reasonable trade-off for a local dev installation.

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { OAuthClient, AuthCode, RefreshTokenRecord } from "./types";

const CLIENT_STORE_PATH = path.join(process.cwd(), "data", "oauth-clients.json");
const AUTH_CODE_TTL_MS  = 60 * 1000;        // 60 seconds
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Client store (persisted) ────────────────────────────────────────────────

function loadClients(): Map<string, OAuthClient> {
  try {
    if (fs.existsSync(CLIENT_STORE_PATH)) {
      const raw = fs.readFileSync(CLIENT_STORE_PATH, "utf-8");
      const arr: OAuthClient[] = JSON.parse(raw);
      return new Map(arr.map(c => [c.client_id, c]));
    }
  } catch {
    console.warn("[oauth] Could not load client store — starting fresh.");
  }
  return new Map();
}

function saveClients(clients: Map<string, OAuthClient>): void {
  try {
    const dir = path.dirname(CLIENT_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CLIENT_STORE_PATH, JSON.stringify([...clients.values()], null, 2));
  } catch (err) {
    console.error("[oauth] Failed to persist client store:", err);
  }
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

const clients       = loadClients();
const authCodes     = new Map<string, AuthCode>();
const refreshTokens = new Map<string, RefreshTokenRecord>();

// ─── Client operations ────────────────────────────────────────────────────────

export function registerClient(params: {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}): OAuthClient {
  const client: OAuthClient = {
    client_id:                  uuidv4(),
    client_secret:              uuidv4(),
    client_name:                params.client_name || "Unknown Client",
    redirect_uris:              params.redirect_uris,
    grant_types:                params.grant_types     || ["authorization_code", "refresh_token"],
    response_types:             params.response_types  || ["code"],
    token_endpoint_auth_method: params.token_endpoint_auth_method || "client_secret_basic",
    registered_at:              new Date().toISOString(),
  };
  clients.set(client.client_id, client);
  saveClients(clients);
  console.log(`[oauth] Registered client: ${client.client_name} (${client.client_id})`);
  return client;
}

export function getClient(client_id: string): OAuthClient | undefined {
  return clients.get(client_id);
}

export function validateClientSecret(client_id: string, client_secret: string): boolean {
  const client = clients.get(client_id);
  return client !== undefined && client.client_secret === client_secret;
}

// ─── Auth code operations ─────────────────────────────────────────────────────

export function createAuthCode(params: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  user_id: string;
}): string {
  const code = uuidv4();
  authCodes.set(code, {
    code,
    ...params,
    expires_at: Date.now() + AUTH_CODE_TTL_MS,
  });
  // Auto-cleanup expired codes periodically
  setTimeout(() => authCodes.delete(code), AUTH_CODE_TTL_MS + 1000);
  return code;
}

export function consumeAuthCode(code: string): AuthCode | undefined {
  const entry = authCodes.get(code);
  if (!entry) return undefined;
  authCodes.delete(code); // single-use
  if (Date.now() > entry.expires_at) return undefined;
  return entry;
}

// ─── Default Cowork client ────────────────────────────────────────────────────
// Pre-registers a stable client for Cowork so the user can paste the credentials
// into Cowork's Advanced Settings (OAuth ID / OAuth Secret) when adding the connector.
// redirect_uris is empty — the router treats an empty list as "accept any redirect URI",
// because Cowork's redirect URI contains the user's org ID which we can't know in advance.

export function ensureCoworkClient(): OAuthClient {
  // Return existing Cowork client if already registered
  for (const client of clients.values()) {
    if (client.client_name === "Cowork") {
      return client;
    }
  }
  // First run — create and persist a new Cowork client
  return registerClient({
    client_name:                "Cowork",
    redirect_uris:              [], // empty = accept any redirect URI
    grant_types:                ["authorization_code", "refresh_token"],
    response_types:             ["code"],
    token_endpoint_auth_method: "client_secret_basic",
  });
}

// ─── Refresh token operations ─────────────────────────────────────────────────

export function createRefreshToken(client_id: string, user_id: string): string {
  const token = uuidv4();
  refreshTokens.set(token, {
    token,
    client_id,
    user_id,
    expires_at: Date.now() + REFRESH_TOKEN_TTL_MS,
  });
  return token;
}

export function consumeRefreshToken(token: string): RefreshTokenRecord | undefined {
  const entry = refreshTokens.get(token);
  if (!entry) return undefined;
  refreshTokens.delete(token); // rotate on use
  if (Date.now() > entry.expires_at) return undefined;
  return entry;
}
