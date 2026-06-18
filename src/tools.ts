import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PearClient } from "./client.js";
import { PearApiError } from "./client.js";
import type { PearConfig } from "./config.js";
import { pairStats } from "./analytics.js";
import { analyzeDrift, fetchRebalancePlan } from "./rebalance.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof PearApiError) {
      return fail(`Pear API error ${err.status} on ${err.endpoint}: ${JSON.stringify(err.body)}`);
    }
    return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Shared zod fragments mirroring the Pear OpenAPI schemas.
const pairAsset = z.object({
  asset: z.string().describe("Asset symbol, e.g. BTC, ETH, NEAR"),
  weight: z.number().min(0.0001).max(1).optional().describe("Allocation 0.0001-1.0; omitted = even split"),
});

const tpSl = z
  .object({
    type: z.enum(["PERCENTAGE", "DOLLAR", "POSITION_VALUE", "PRICE", "PRICE_RATIO", "WEIGHTED_RATIO"]),
    value: z.number().optional(),
    isTrailing: z.boolean().optional(),
    trailingDeltaValue: z.number().optional(),
    trailingActivationValue: z.number().optional(),
  })
  .describe("Take-profit / stop-loss threshold. WEIGHTED_RATIO works for baskets; supports trailing.");

export function registerTools(server: McpServer, client: PearClient, cfg: PearConfig): void {
  const guardWrite = (confirm: boolean): string | null => {
    if (cfg.readOnly) {
      return "Server is in READ-ONLY mode (PEAR_READ_ONLY=true). Refusing to place/modify orders. Set PEAR_READ_ONLY=false to enable trading.";
    }
    if (!confirm) {
      return "This action moves real funds. Re-call with confirm=true to execute.";
    }
    return null;
  };

  // ---------------------------------------------------------------- read: market data
  server.registerTool(
    "pear_health",
    { title: "Health check", description: "Check Pear API availability for the configured engine.", inputSchema: {} },
    () => run(() => client.get("/health")),
  );

  server.registerTool(
    "pear_get_markets",
    {
      title: "Browse markets",
      description:
        "List tradable pair/basket markets with open interest, 24h volume, long/short ratio, weighted ratio and net funding. Supports filtering and sorting.",
      inputSchema: {
        searchText: z.string().optional(),
        engine: z.string().optional().describe("Filter by engine type"),
        minVolume: z.number().optional(),
        netFunding: z.string().optional().describe("Filter by positive/negative funding"),
        sort: z.string().optional().describe("e.g. 'volume:desc'"),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
    },
    (args) =>
      run(() =>
        client.get("/markets", {
          searchText: args.searchText,
          engine: args.engine,
          minVolume: args.minVolume,
          netFunding: args.netFunding,
          sort: args.sort,
          page: args.page,
          pageSize: args.pageSize,
        }),
      ),
  );

  server.registerTool(
    "pear_active_markets",
    {
      title: "Active markets & movers",
      description: "Actively traded pairs plus top gainers, top losers, highlighted pairs and the user watchlist.",
      inputSchema: {},
    },
    () => run(() => client.get("/markets/active")),
  );

  server.registerTool(
    "pear_trade_ideas",
    {
      title: "Trade ideas (incl. AI picks)",
      description:
        "Pair/basket trade ideas from three sources: 'active' (platform activity), 'watchlist' (user), and 'ai-picks' (Pear's statistical-arbitrage engine).",
      inputSchema: {
        category: z.enum(["active", "watchlist", "ai-picks"]).optional().describe("Filter returned baskets by category"),
      },
    },
    (args) =>
      run(async () => {
        const data = (await client.get("/markets/v2")) as { baskets?: { category?: string }[] };
        if (args.category && Array.isArray(data?.baskets)) {
          return { baskets: data.baskets.filter((b) => b.category === args.category) };
        }
        return data;
      }),
  );

  server.registerTool(
    "pear_address_stats",
    {
      title: "Address fee & volume stats",
      description: "Public stats: external fee paid, builder fee paid and total volume for one or more addresses.",
      inputSchema: {
        addresses: z.array(z.string()).min(1).describe("Wallet addresses"),
        startFrom: z.string().optional().describe("ISO timestamp filter (inclusive)"),
      },
    },
    (args) => run(() => client.get("/public-stats/address", { addresses: args.addresses.join(","), startFrom: args.startFrom })),
  );

  // ---------------------------------------------------------------- read: account
  server.registerTool(
    "pear_list_positions",
    {
      title: "List open positions",
      description:
        "Processed open pair/basket positions: entry/mark ratio, position value, margin, unrealized PnL, per-leg detail and TP/SL.",
      inputSchema: {},
    },
    () => run(() => client.request("GET", "/positions")),
  );

  server.registerTool(
    "pear_list_open_orders",
    { title: "List open orders", description: "Open orders (market, trigger, TWAP, TP/SL, ladder).", inputSchema: {} },
    () => run(() => client.request("GET", "/orders/open")),
  );

  server.registerTool(
    "pear_trade_history",
    {
      title: "Trade history",
      description: "Trade history with fees, PnL and asset-level data.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
        startDate: z.string().optional().describe("ISO date"),
        endDate: z.string().optional().describe("ISO date"),
      },
    },
    (args) => run(() => client.request("GET", "/trade-history", { query: { limit: args.limit, startDate: args.startDate, endDate: args.endDate } })),
  );

  server.registerTool(
    "pear_agent_wallet_status",
    {
      title: "Agent wallet status",
      description: "Check whether an agent wallet exists for the authenticated user and its status.",
      inputSchema: {},
    },
    () => run(() => client.request("GET", "/agentWallet")),
  );

  // ---------------------------------------------------------------- rebalance: preview (non-mutating)
  server.registerTool(
    "pear_rebalance_plan",
    {
      title: "Preview rebalance plan",
      description:
        "Compute weight deltas and what WOULD be traded to reach target weights, without placing any orders. Safe to call anytime.",
      inputSchema: {
        positionId: z.string().describe("Position identifier"),
        targetWeights: z
          .record(z.string(), z.number())
          .optional()
          .describe("Optional per-asset target weights (decimals summing to 1.0 per side). Omit to use the position's stored targets."),
      },
    },
    (args) =>
      run(() => client.request("POST", `/positions/${args.positionId}/rebalance/plan`, { body: { targetWeights: args.targetWeights ?? {} } })),
  );

  server.registerTool(
    "pear_rebalance_check",
    {
      title: "Check rebalance drift",
      description:
        "Analyze how far a position's leg weights have drifted from target. Returns max drift %, per-asset trim/add actions and a recommendation. Read-only (uses the non-mutating plan endpoint) — safe to call anytime, including on a schedule.",
      inputSchema: {
        positionId: z.string(),
        driftThreshold: z.number().min(0).max(1).default(0.05).describe("Drift fraction that triggers a recommendation (0.05 = 5%)"),
        targetWeights: z.record(z.string(), z.number()).optional().describe("Optional target overrides; omit to use the position's stored targets"),
      },
    },
    (args) =>
      run(async () => {
        const plan = await fetchRebalancePlan(client, args.positionId, args.targetWeights);
        return analyzeDrift(plan, args.driftThreshold);
      }),
  );

  // ---------------------------------------------------------------- write: trading (guarded)
  server.registerTool(
    "pear_open_position",
    {
      title: "Open pair/basket position",
      description:
        "Open a pair or basket trade. longAssets/shortAssets accept multiple weighted legs. Managed afterwards as a single consolidated position. Guarded by read-only mode + confirm.",
      inputSchema: {
        usdValue: z.number().min(1).describe("Position size in USD"),
        leverage: z.number().min(1).max(100).default(1),
        slippage: z.number().min(0.001).max(0.1).default(0.01).describe("0.01 = 1%"),
        executionType: z.enum(["SYNC", "MARKET", "TRIGGER", "TWAP", "LADDER"]).default("MARKET"),
        longAssets: z.array(pairAsset).default([]),
        shortAssets: z.array(pairAsset).default([]),
        triggerType: z
          .enum(["PRICE", "PRICE_LIMIT", "PRICE_RATIO", "WEIGHTED_RATIO", "BTC_DOM", "CROSS_ASSET_PRICE", "PREDICTION_MARKET_OUTCOME"])
          .optional(),
        triggerValue: z.string().optional(),
        direction: z.enum(["MORE_THAN", "LESS_THAN"]).optional(),
        twapDuration: z.number().optional().describe("Minutes (TWAP only)"),
        twapIntervalSeconds: z.number().min(1).max(3600).optional(),
        stopLoss: tpSl.optional(),
        takeProfit: tpSl.optional(),
        confirm: z.boolean().default(false).describe("Must be true to actually execute"),
      },
    },
    (args) => {
      const blocked = guardWrite(args.confirm);
      if (blocked) return Promise.resolve(fail(blocked));
      if (args.longAssets.length === 0 && args.shortAssets.length === 0) {
        return Promise.resolve(fail("Provide at least one asset in longAssets or shortAssets."));
      }
      const { confirm, ...body } = args;
      return run(() => client.request("POST", "/positions", { body }));
    },
  );

  server.registerTool(
    "pear_set_risk",
    {
      title: "Set/Update TP & SL",
      description:
        "Set or update take-profit and stop-loss on a position. Supports notional ($), percentage, position-value, price, price-ratio, weighted-ratio and trailing variants. Pass null to remove.",
      inputSchema: {
        positionId: z.string(),
        stopLoss: tpSl.nullable().optional(),
        takeProfit: tpSl.nullable().optional(),
        confirm: z.boolean().default(false),
      },
    },
    (args) => {
      const blocked = guardWrite(args.confirm);
      if (blocked) return Promise.resolve(fail(blocked));
      return run(() =>
        client.request("PUT", `/positions/${args.positionId}/riskParameters`, {
          body: { stopLoss: args.stopLoss ?? null, takeProfit: args.takeProfit ?? null },
        }),
      );
    },
  );

  server.registerTool(
    "pear_adjust_position",
    {
      title: "Adjust position size",
      description: "Increase or reduce a position by a percentage (1-100%).",
      inputSchema: {
        positionId: z.string(),
        adjustmentType: z.enum(["REDUCE", "INCREASE"]).default("REDUCE"),
        adjustmentSize: z.number().min(1).max(100),
        executionType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
        limitRatio: z.number().optional().describe("Required if executionType=LIMIT"),
        confirm: z.boolean().default(false),
      },
    },
    (args) => {
      const blocked = guardWrite(args.confirm);
      if (blocked) return Promise.resolve(fail(blocked));
      const { positionId, confirm, ...body } = args;
      return run(() => client.request("POST", `/positions/${positionId}/adjust`, { body }));
    },
  );

  server.registerTool(
    "pear_rebalance_execute",
    {
      title: "Execute rebalance",
      description: "Rebalance a position's legs to target weights (executes trades). Preview first with pear_rebalance_plan.",
      inputSchema: {
        positionId: z.string(),
        targetWeights: z.record(z.string(), z.number()).optional(),
        confirm: z.boolean().default(false),
      },
    },
    (args) => {
      const blocked = guardWrite(args.confirm);
      if (blocked) return Promise.resolve(fail(blocked));
      return run(() => client.request("POST", `/positions/${args.positionId}/rebalance`, { body: { targetWeights: args.targetWeights ?? {} } }));
    },
  );

  server.registerTool(
    "pear_close_position",
    {
      title: "Close position",
      description: "Close a single position via MARKET, TWAP or TRIGGER execution.",
      inputSchema: {
        positionId: z.string(),
        executionType: z.enum(["MARKET", "TWAP", "TRIGGER"]).default("MARKET"),
        twapDuration: z.number().optional(),
        triggerType: z.enum(["PRICE", "PRICE_RATIO", "WEIGHTED_RATIO", "PERCENTAGE", "DOLLAR", "POSITION_VALUE"]).optional(),
        triggerValue: z.string().optional(),
        direction: z.enum(["MORE_THAN", "LESS_THAN"]).optional(),
        confirm: z.boolean().default(false),
      },
    },
    (args) => {
      const blocked = guardWrite(args.confirm);
      if (blocked) return Promise.resolve(fail(blocked));
      const { positionId, confirm, ...body } = args;
      return run(() => client.request("POST", `/positions/${positionId}/close`, { body }));
    },
  );

  server.registerTool(
    "pear_close_all_positions",
    {
      title: "Close all positions",
      description: "Close every open position sequentially via MARKET or TWAP.",
      inputSchema: {
        executionType: z.enum(["MARKET", "TWAP"]).default("MARKET"),
        twapDuration: z.number().optional(),
        confirm: z.boolean().default(false),
      },
    },
    (args) => {
      const blocked = guardWrite(args.confirm);
      if (blocked) return Promise.resolve(fail(blocked));
      const { confirm, ...body } = args;
      return run(() => client.request("POST", "/positions/close-all", { body }));
    },
  );

  server.registerTool(
    "pear_cancel_order",
    {
      title: "Cancel order",
      description: "Cancel an open order by id.",
      inputSchema: { orderId: z.string(), confirm: z.boolean().default(false) },
    },
    (args) => {
      const blocked = guardWrite(args.confirm);
      if (blocked) return Promise.resolve(fail(blocked));
      return run(() => client.request("DELETE", `/orders/${args.orderId}/cancel`));
    },
  );

  // ---------------------------------------------------------------- local quant (no API)
  server.registerTool(
    "pear_pair_analytics",
    {
      title: "Pair analytics (local quant)",
      description:
        "Compute correlation, beta (hedge ratio), spread z-score, rolling z-score and annualized vol from two aligned price series (oldest -> newest). Mirrors the stats Pear's 'Agent Pair' reasons over, fully offline.",
      inputSchema: {
        pricesA: z.array(z.number()).min(3).describe("Long-leg prices, oldest -> newest"),
        pricesB: z.array(z.number()).min(3).describe("Short-leg prices, same length & alignment"),
        window: z.number().int().positive().optional().describe("Z-score lookback (default 30)"),
        periodsPerYear: z.number().positive().optional().describe("Annualization factor: 365 daily, 8760 hourly (default 365)"),
      },
    },
    (args) => {
      if (args.pricesA.length !== args.pricesB.length) {
        return Promise.resolve(fail("pricesA and pricesB must be the same length and aligned by time."));
      }
      return Promise.resolve(ok(pairStats(args.pricesA, args.pricesB, { window: args.window, periodsPerYear: args.periodsPerYear })));
    },
  );
}
