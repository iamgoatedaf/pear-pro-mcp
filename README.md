# Pear Pro MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server that turns **Pear Protocol** into an execution + analytics layer any LLM agent (Claude Desktop, Cursor, your own stack) can drive — pair and basket trading on top of Lighter / Hyperliquid.

Built against the public [Pear Trading API](https://docs.pearprotocol.io) (`https://hl-v2.pearprotocol.io`). Point `PEAR_API_BASE_URL` at the Pear Pro x Lighter engine to drive the institutional terminal instead.

## Why this exists

Pear already ships an in-house quant ("Agent Pair"). This MCP exposes the same capability **outbound**: any agent can read pair/basket stats, screen trade ideas, reason over z-scores, and (optionally) execute and manage consolidated positions — making Pear the default execution venue in the agentic-trading meta.

## Tools

**Market data (no auth)**
- `pear_health` — engine health
- `pear_get_markets` — markets with OI, volume, ratio, weighted ratio, net funding (filter/sort)
- `pear_active_markets` — active pairs + gainers/losers/highlighted/watchlist
- `pear_trade_ideas` — `active` / `watchlist` / `ai-picks` baskets
- `pear_address_stats` — fee & volume stats per address

**Account (auth)**
- `pear_list_positions`, `pear_list_open_orders`, `pear_trade_history`, `pear_agent_wallet_status`

**Rebalance preview (non-mutating)**
- `pear_rebalance_plan` — what *would* trade to hit target weights
- `pear_rebalance_check` — drift analysis: max drift %, per-leg trim/add, recommendation (safe to poll)

**Trading (guarded by read-only mode + `confirm: true`)**
- `pear_open_position` — pair/basket, MARKET/TRIGGER/TWAP/LADDER, with TP/SL
- `pear_set_risk` — TP/SL incl. trailing & weighted-ratio
- `pear_adjust_position`, `pear_rebalance_execute`, `pear_close_position`, `pear_close_all_positions`, `pear_cancel_order`

**Local quant (offline, no API)**
- `pear_pair_analytics` — correlation, beta (hedge ratio), spread z-score, rolling z-score, annualized vol

## Setup

```bash
npm install
npm run build
cp .env.example .env   # then fill in values
```

### Auth

Pear uses EIP-712 wallet login → JWT. For an agent/bot you do this once to mint a long-lived API key:

1. Wallet-login in the Pear app / via `POST /auth/authenticate` (method `eip712`).
2. `POST /api-keys` → store the returned `apiKey`.
3. Put it in `.env` as `PEAR_API_KEY` (+ `PEAR_ADDRESS`, `PEAR_CLIENT_ID`).

This server then auto-authenticates (`method: "api_key"`) and refreshes JWTs automatically. Market-data tools work with no auth at all.

### Safety

`PEAR_READ_ONLY=true` (default) blocks every fund-moving tool. Flip to `false` *and* pass `confirm: true` per call to actually trade. Recommended: keep read-only for demos.

## Run with Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "pear-pro": {
      "command": "node",
      "args": ["/absolute/path/to/pear/dist/index.js"],
      "env": {
        "PEAR_API_BASE_URL": "https://hl-v2.pearprotocol.io",
        "PEAR_CLIENT_ID": "APITRADER",
        "PEAR_ADDRESS": "0x...",
        "PEAR_API_KEY": "...",
        "PEAR_READ_ONLY": "true"
      }
    }
  }
}
```

Dev mode (no build): `npm run dev`.

## Auto-rebalance monitor

An MCP server only acts when the agent calls a tool, so scheduled monitoring runs as a **separate background process**:

```bash
npm run monitor          # polls every 5 min, sends macOS notifications
```

Every interval it pulls your open positions, runs the non-mutating rebalance plan, computes weight drift, and:

- **Alert-only (default):** notifies you when drift ≥ `PEAR_DRIFT_THRESHOLD`; you approve by telling the agent `rebalance <positionId>` (→ `pear_rebalance_execute`).
- **Auto:** set `PEAR_AUTO_REBALANCE=true` *and* `PEAR_READ_ONLY=false` to let it rebalance on its own.

Tune via `PEAR_POLL_INTERVAL_MS`, `PEAR_DRIFT_THRESHOLD`, `PEAR_POSITION_ID` (see `.env.example`). Requires auth (`PEAR_API_KEY` + `PEAR_ADDRESS`) since positions are user-specific.

## Notes for the Pear Pro x Lighter engine

The documented endpoints target the Hyperliquid v2 engine. The Lighter engine should expose the same shapes; if base URL / auth differ, only `client.ts` + `PEAR_API_BASE_URL` need changing. A partner `clientId` (instead of `APITRADER`) lets Pear attribute volume/fees from agents routed through this MCP.
