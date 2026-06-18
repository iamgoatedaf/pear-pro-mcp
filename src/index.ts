#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { PearClient } from "./client.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const client = new PearClient(cfg);

  const server = new McpServer({
    name: "pear-pro-mcp",
    version: "0.1.0",
  });

  registerTools(server, client, cfg);

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
