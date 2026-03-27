// src/mcp/oauth/types.ts
// Type definitions for the local OAuth 2.1 server used by the MCP HTTPS endpoint.
// This server exists solely to satisfy Cowork's requirement that remote MCP connectors
// use OAuth 2.1. Since this is a single-user local installation, the flow is simplified:
// any client that registers is accepted, and the approval page auto-submits after one click.

export interface OAuthClient {
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  registered_at: string; // ISO timestamp
}

export interface AuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;          // PKCE — SHA-256 hash of the verifier
  code_challenge_method: string;   // always "S256"
  expires_at: number;              // Unix ms
  user_id: string;
}

export interface RefreshTokenRecord {
  token: string;
  client_id: string;
  user_id: string;
  expires_at: number; // Unix ms
}
