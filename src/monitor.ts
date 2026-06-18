import { exec } from "node:child_process";
import { loadConfig } from "./config.js";
import { PearClient, PearApiError } from "./client.js";
import { analyzeDrift, fetchRebalancePlan, type DriftReport } from "./rebalance.js";

interface MonitorOptions {
  positionId?: string;
  intervalMs: number;
  threshold: number;
  autoRebalance: boolean;
}

function loadMonitorOptions(): MonitorOptions {
  const intervalMs = Number(process.env.PEAR_POLL_INTERVAL_MS ?? 300_000);
  const threshold = Number(process.env.PEAR_DRIFT_THRESHOLD ?? 0.05);
  const autoRebalance = ["1", "true", "yes", "on"].includes((process.env.PEAR_AUTO_REBALANCE ?? "").toLowerCase());
  return {
    positionId: process.env.PEAR_POSITION_ID || undefined,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 5_000 ? intervalMs : 300_000,
    threshold: Number.isFinite(threshold) ? threshold : 0.05,
    autoRebalance,
  };
}

/** Fire a native macOS notification (no-op / console fallback elsewhere). */
function notify(title: string, message: string): void {
  const safe = (s: string) => s.replace(/["\\]/g, "\\$&");
  const script = `display notification "${safe(message)}" with title "${safe(title)}" sound name "Glass"`;
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) log(`(notification skipped: ${err.message})`);
  });
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function listPositionIds(client: PearClient, only?: string): Promise<string[]> {
  if (only) return [only];
  const positions = (await client.request("GET", "/positions")) as { positionId?: string }[];
  return (positions ?? []).map((p) => p.positionId).filter((id): id is string => Boolean(id));
}

async function checkPosition(client: PearClient, positionId: string, opts: MonitorOptions, readOnly: boolean): Promise<void> {
  let report: DriftReport;
  try {
    const plan = await fetchRebalancePlan(client, positionId);
    report = analyzeDrift(plan, opts.threshold);
  } catch (err) {
    log(`position ${positionId}: plan failed — ${err instanceof PearApiError ? err.message : String(err)}`);
    return;
  }

  if (!report.rebalanceRecommended) {
    log(`position ${positionId}: OK (max drift ${report.maxDriftPct}% < ${Math.round(opts.threshold * 100)}%)`);
    return;
  }

  log(`position ${positionId}: ${report.summary}`);

  if (opts.autoRebalance && !readOnly) {
    try {
      await client.request("POST", `/positions/${positionId}/rebalance`, { body: { targetWeights: {} } });
      notify("Pear: auto-rebalanced", `Position ${short(positionId)} rebalanced (drift was ${report.maxDriftPct}%).`);
      log(`position ${positionId}: AUTO-REBALANCED.`);
    } catch (err) {
      notify("Pear: rebalance FAILED", `Position ${short(positionId)} — ${err instanceof Error ? err.message : String(err)}`);
      log(`position ${positionId}: auto-rebalance failed — ${String(err)}`);
    }
  } else {
    // Human-in-the-loop: alert, then YOU approve by telling the agent to rebalance.
    notify(
      "Pear: rebalance recommended",
      `Position ${short(positionId)} drift ${report.maxDriftPct}%. Say "rebalance ${short(positionId)}" in chat to execute.`,
    );
  }
}

async function tick(client: PearClient, opts: MonitorOptions, readOnly: boolean): Promise<void> {
  try {
    const ids = await listPositionIds(client, opts.positionId);
    if (ids.length === 0) {
      log("no open positions.");
      return;
    }
    for (const id of ids) await checkPosition(client, id, opts, readOnly);
  } catch (err) {
    if (err instanceof PearApiError && err.status === 401) {
      log("auth failed — set PEAR_API_KEY (or PEAR_ACCESS_TOKEN) + PEAR_ADDRESS to monitor positions.");
    } else {
      log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const opts = loadMonitorOptions();
  const client = new PearClient(cfg);

  const mode = opts.autoRebalance && !cfg.readOnly ? "AUTO-REBALANCE" : "ALERT-ONLY";
  log(
    `Pear rebalance monitor started | every ${Math.round(opts.intervalMs / 1000)}s | drift>=${Math.round(opts.threshold * 100)}% | ${mode}` +
      (opts.positionId ? ` | position=${opts.positionId}` : " | all positions"),
  );
  if (opts.autoRebalance && cfg.readOnly) {
    log("NOTE: PEAR_AUTO_REBALANCE=true but PEAR_READ_ONLY=true → staying ALERT-ONLY. Set PEAR_READ_ONLY=false to let it trade.");
  }

  await tick(client, opts, cfg.readOnly);
  setInterval(() => void tick(client, opts, cfg.readOnly), opts.intervalMs);
}

function short(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
