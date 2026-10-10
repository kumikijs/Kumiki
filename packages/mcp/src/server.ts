#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.ts";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the MCP protocol; log to stderr.
  console.error("Kumiki MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting Kumiki MCP server:", err);
  process.exit(1);
});
