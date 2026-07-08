module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { PearClient } = await import("../dist/client.js");
  const { registerTools } = await import("../dist/tools.js");
  const { loadConfig } = await import("../dist/config.js");

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const cfg = loadConfig();
  const client = new PearClient(cfg);
  const server = new McpServer({ name: "pear-pro-mcp", version: "0.1.0" });
  registerTools(server, client, cfg);

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
};
