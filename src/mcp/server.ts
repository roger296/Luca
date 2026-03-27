// src/mcp/server.ts
// MCP server entry point (stdio transport).
// Start with: npm run mcp
// Requires environment variable: MCP_USER_ID

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools";
import { registerResources } from "./resources";
import { getContext } from "./auth";

export function createMcpServer(context: { userId: string; sourceModule: string }) {
  const server = new McpServer({
    name: "gl-ledger",
    version: "1.0.0",
  });
  registerTools(server, context);
  registerResources(server, context);
  return server;
}

async function main() {
  const context = getContext();
  const server = createMcpServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

// Only run the stdio server when this file is executed directly.
// When imported by server-http.ts to get createMcpServer, we must not start stdio.
if (require.main === module) {
  main().catch((err) => {
    console.error("MCP server failed to start:", err);
    process.exit(1);
  });
}
