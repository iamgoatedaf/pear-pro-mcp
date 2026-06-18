import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], {
  env: { ...process.env, PEAR_READ_ONLY: "true" },
  stdio: ["pipe", "pipe", "inherit"],
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
let buf = "";
const seen = [];

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) seen.push(JSON.parse(line));
  }
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/initialized" }), 150);
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 300);
setTimeout(
  () =>
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "pear_pair_analytics",
        arguments: {
          pricesA: [100, 102, 101, 105, 110, 108, 112, 115, 113, 120],
          pricesB: [50, 51, 50.5, 52, 54, 53, 55, 56, 55.5, 58],
          window: 5,
          periodsPerYear: 365,
        },
      },
    }),
  500,
);

setTimeout(() => send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "pear_active_markets", arguments: {} } }), 700);

setTimeout(() => {
  const toolsList = seen.find((m) => m.id === 2);
  const call = seen.find((m) => m.id === 3);
  const live = seen.find((m) => m.id === 4);
  console.log("TOOLS_COUNT:", toolsList?.result?.tools?.length);
  console.log("TOOL_NAMES:", toolsList?.result?.tools?.map((t) => t.name).join(", "));
  console.log("ANALYTICS_RESULT:", call?.result?.content?.[0]?.text);
  console.log("LIVE_MARKETS (first 200 chars):", (live?.result?.content?.[0]?.text ?? "").slice(0, 200));
  child.kill();
  process.exit(0);
}, 3000);
