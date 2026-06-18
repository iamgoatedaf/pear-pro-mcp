import type { PearClient } from "./client.js";

/** Per-asset row returned by POST /positions/{id}/rebalance/plan. */
export interface RebalanceAssetPlan {
  coin: string;
  side: "long" | "short";
  currentWeight: number;
  targetWeight: number;
  currentValue: number;
  targetValue: number;
  deltaValue: number;
  currentSize: number;
  newSize: number;
  deltaSize: number;
  skipped: boolean;
  skipReason?: string;
}

export interface RebalancePlan {
  positionId: string;
  assets: RebalanceAssetPlan[];
  canExecute: boolean;
}

export interface DriftReport {
  positionId: string;
  maxDriftPct: number;
  /** True when drift breaches the threshold and there is something to trade. */
  rebalanceRecommended: boolean;
  threshold: number;
  canExecute: boolean;
  assets: {
    coin: string;
    side: "long" | "short";
    currentWeightPct: number;
    targetWeightPct: number;
    driftPct: number;
    deltaValueUsd: number;
    action: "trim" | "add" | "hold";
    skipped: boolean;
    skipReason?: string;
  }[];
  summary: string;
}

/** Fetch the (non-mutating) rebalance plan for a position. */
export async function fetchRebalancePlan(
  client: PearClient,
  positionId: string,
  targetWeights?: Record<string, number>,
): Promise<RebalancePlan> {
  return (await client.request("POST", `/positions/${positionId}/rebalance/plan`, {
    body: { targetWeights: targetWeights ?? {} },
  })) as RebalancePlan;
}

/**
 * Turn a rebalance plan into a drift report.
 * drift = |currentWeight - targetWeight| per asset; maxDrift drives the recommendation.
 */
export function analyzeDrift(plan: RebalancePlan, threshold = 0.05): DriftReport {
  const assets = (plan.assets ?? []).map((a) => {
    const drift = Math.abs(a.currentWeight - a.targetWeight);
    let action: "trim" | "add" | "hold" = "hold";
    if (a.deltaValue < 0) action = "trim";
    else if (a.deltaValue > 0) action = "add";
    return {
      coin: a.coin,
      side: a.side,
      currentWeightPct: round(a.currentWeight * 100),
      targetWeightPct: round(a.targetWeight * 100),
      driftPct: round(drift * 100),
      deltaValueUsd: round(a.deltaValue),
      action,
      skipped: a.skipped,
      skipReason: a.skipReason,
    };
  });

  const maxDrift = assets.reduce((m, a) => Math.max(m, a.driftPct / 100), 0);
  const rebalanceRecommended = maxDrift >= threshold && plan.canExecute;

  const worst = [...assets].sort((a, b) => b.driftPct - a.driftPct)[0];
  const summary = rebalanceRecommended
    ? `Rebalance recommended: max drift ${round(maxDrift * 100)}% (threshold ${round(threshold * 100)}%). Worst leg ${worst?.coin} ${worst?.currentWeightPct}%→${worst?.targetWeightPct}%.`
    : `No rebalance needed: max drift ${round(maxDrift * 100)}% < threshold ${round(threshold * 100)}%.`;

  return {
    positionId: plan.positionId,
    maxDriftPct: round(maxDrift * 100),
    rebalanceRecommended,
    threshold,
    canExecute: plan.canExecute,
    assets,
    summary,
  };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
