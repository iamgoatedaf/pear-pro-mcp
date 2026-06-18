/**
 * Local statistical-arbitrage helpers for pair / basket trading.
 *
 * These run entirely on price series you pass in (no API round-trip), so an
 * agent can reason about entry quality the same way Pear's "Agent Pair" does:
 * correlation, beta (hedge ratio), spread z-score and rolling z-score.
 *
 * All inputs are aligned, equal-length arrays of prices ordered oldest -> newest.
 */

export function logReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0 && series[i] > 0) out.push(Math.log(series[i] / series[i - 1]));
  }
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(xs: number[], sample = true): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (sample ? n - 1 : n));
}

export function covariance(xs: number[], ys: number[], sample = true): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (sample ? n - 1 : n);
}

export function correlation(xs: number[], ys: number[]): number {
  const sx = std(xs);
  const sy = std(ys);
  if (!sx || !sy) return NaN;
  return covariance(xs, ys) / (sx * sy);
}

/**
 * Beta of `a` relative to `b` (OLS hedge ratio on returns): cov(a,b)/var(b).
 * This is the weighting Pear suggests when sizing a pair so the legs are
 * roughly market-neutral.
 */
export function beta(pricesA: number[], pricesB: number[]): number {
  const ra = logReturns(pricesA);
  const rb = logReturns(pricesB);
  const varB = std(rb) ** 2;
  if (!varB) return NaN;
  return covariance(ra, rb) / varB;
}

/** Price ratio series A/B (the "spread" Pear charts for a 1x1 pair). */
export function ratioSeries(pricesA: number[], pricesB: number[]): number[] {
  const n = Math.min(pricesA.length, pricesB.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (pricesB[i] !== 0) out.push(pricesA[i] / pricesB[i]);
  }
  return out;
}

/**
 * Z-score of the latest spread value vs a trailing window.
 * z = (last - mean_window) / std_window. |z| >= 2 is a common mean-reversion entry.
 */
export function zScore(spread: number[], window?: number): number {
  const w = window && window > 0 ? Math.min(window, spread.length) : spread.length;
  const slice = spread.slice(spread.length - w);
  const s = std(slice);
  if (!s) return NaN;
  return (slice[slice.length - 1] - mean(slice)) / s;
}

/** Rolling z-score across the series for a given lookback window. */
export function rollingZScore(spread: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < spread.length; i++) {
    if (i + 1 < window) {
      out.push(NaN);
      continue;
    }
    const slice = spread.slice(i + 1 - window, i + 1);
    const s = std(slice);
    out.push(s ? (slice[slice.length - 1] - mean(slice)) / s : NaN);
  }
  return out;
}

export interface PairStats {
  n: number;
  correlationOfReturns: number;
  beta: number;
  spreadMean: number;
  spreadStd: number;
  latestSpread: number;
  zScore: number;
  rollingWindow: number;
  rollingZScoreTail: number[];
  annualizedVolA: number;
  annualizedVolB: number;
  signal: "extended_long_spread" | "extended_short_spread" | "neutral";
}

/**
 * One-shot pair analysis from two aligned price series.
 * `periodsPerYear` annualizes vol (e.g. 365 for daily, 8760 for hourly candles).
 */
export function pairStats(
  pricesA: number[],
  pricesB: number[],
  opts: { window?: number; periodsPerYear?: number } = {},
): PairStats {
  const window = opts.window && opts.window > 0 ? opts.window : 30;
  const ppy = opts.periodsPerYear ?? 365;
  const spread = ratioSeries(pricesA, pricesB);
  const z = zScore(spread, window);
  const rz = rollingZScore(spread, Math.min(window, spread.length));
  const annualize = (s: number) => s * Math.sqrt(ppy);

  let signal: PairStats["signal"] = "neutral";
  if (z >= 2) signal = "extended_long_spread";
  else if (z <= -2) signal = "extended_short_spread";

  return {
    n: Math.min(pricesA.length, pricesB.length),
    correlationOfReturns: correlation(logReturns(pricesA), logReturns(pricesB)),
    beta: beta(pricesA, pricesB),
    spreadMean: mean(spread),
    spreadStd: std(spread),
    latestSpread: spread[spread.length - 1],
    zScore: z,
    rollingWindow: Math.min(window, spread.length),
    rollingZScoreTail: rz.slice(-10),
    annualizedVolA: annualize(std(logReturns(pricesA))),
    annualizedVolB: annualize(std(logReturns(pricesB))),
    signal,
  };
}
