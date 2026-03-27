// src/mcp/auth.ts
// Authentication context bridge for the MCP server.
// Reads user identity from environment variables.

export interface McpContext {
  userId: string;
  sourceModule: string; // always 'mcp-agent' for MCP-originated actions
}

export function getContext(): McpContext {
  const userId = process.env.MCP_USER_ID;
  if (!userId) {
    throw new Error("MCP_USER_ID environment variable is required");
  }
  return {
    userId,
    sourceModule: "mcp-agent",
  };
}
