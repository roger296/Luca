// src/mcp/auth.ts
// Authentication context bridge for the MCP server.
//
// In HTTP/OAuth mode, userId is extracted from the validated Bearer token by
// requireMcpAuth middleware and passed in explicitly.
//
// In stdio mode (or when no token userId is available), falls back to the
// MCP_USER_ID environment variable so existing behaviour is unchanged.

export interface McpContext {
  userId: string;
  sourceModule: string; // always 'mcp-agent' for MCP-originated actions
}

export function getContext(tokenUserId?: string): McpContext {
  const userId = tokenUserId || process.env.MCP_USER_ID;
  if (!userId) {
    throw new Error("No user identity available. Set MCP_USER_ID or authenticate via OAuth.");
  }
  return {
    userId,
    sourceModule: "mcp-agent",
  };
}
