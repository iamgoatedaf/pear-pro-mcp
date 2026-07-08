import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config.js";
import { PearClient } from "./client.js";
import { registerTools } from "./tools.js";
import type { PearConfig } from "./config.js";

export function createMcpServer(): { server: McpServer; cfg: PearConfig } {
  const cfg = loadConfig();
  const client = new PearClient(cfg);

  const server = new McpServer({
    name: "pear-pro-mcp",
    version: "0.1.0",
  });

  registerTools(server, client, cfg);
  return { server, cfg };
}
