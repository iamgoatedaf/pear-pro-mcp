#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const { server, cfg } = createMcpServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr is safe for logs (stdout is reserved for the MCP protocol).
  console.error(
    `pear-pro-mcp ready | base=${cfg.baseUrl} | clientId=${cfg.clientId} | mode=${cfg.readOnly ? "READ-ONLY" : "TRADING ENABLED"}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
