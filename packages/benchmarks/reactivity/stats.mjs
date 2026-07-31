// Sample statistics for the reactivity benchmark's timing loop.
//
// A benchmark that reports only a median hides the thing regression detection
// actually needs: whether the numbers are trustworthy at all. A small-N
// wall-clock measurement bounces with GC and OS scheduling, so the median is
// reported next to the tail (p90), the spread (stddev) and the extremes — a
// real regression moves the median and the tail together, while a busy machine
// moves only the tail.
//
// Every function here is pure and total: an empty sample throws rather than
// returning a silent NaN that would print as `NaN` in the report.

/** @param {number[]} xs */
function sortedCopy(xs) {
  if (xs.length === 0) throw new Error("statistics require a non-empty sample");
  return [...xs].sort((a, b) => a - b);
}

/** @param {number[]} s ascending */
function medianOfSorted(s) {
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {number[]} s ascending
 * @param {number} p fraction in (0, 1]
 */
function percentileOfSorted(s, p) {
  // `p > 0` makes the rank at least 1, so only the upper bound needs clamping.
  const rank = Math.ceil(p * s.length);
  return s[Math.min(s.length - 1, rank - 1)];
}

/**
 * Median — middle value, or the mean of the two middle values for an even
 * sample. Non-destructive: the caller's array keeps its order.
 * @param {number[]} xs
 */
export function median(xs) {
  return medianOfSorted(sortedCopy(xs));
}

/**
 * Percentile by **nearest rank**: the smallest observed sample that is greater
 * than or equal to `p` of the data. No interpolation, so every reported value
 * is a measurement that actually happened and the rank is hand-checkable
 * (p90 of 200 samples is literally the 180th smallest).
 * @param {number[]} xs
 * @param {number} p fraction in (0, 1]
 */
export function percentile(xs, p) {
  if (!(p > 0 && p <= 1)) throw new Error(`percentile p must be in (0, 1], got ${p}`);
  return percentileOfSorted(sortedCopy(xs), p);
}

/** @param {number[]} s ascending */
function stddevOfSorted(s) {
  if (s.length < 2) return 0;
  const mean = s.reduce((sum, x) => sum + x, 0) / s.length;
  const ss = s.reduce((sum, x) => sum + (x - mean) ** 2, 0);
  return Math.sqrt(ss / (s.length - 1));
}

/**
 * Sample standard deviation (Bessel-corrected, `n - 1`). The samples are one
 * run's worth of observations of an underlying distribution, not the whole
 * population, so the corrected estimator is the right one. A single sample has
 * no spread to estimate and reports 0.
 *
 * Summed over the *sorted* sample: floating-point addition is not associative,
 * so summing in arrival order would make the reported spread depend on the
 * order the timings happened to come out in — accumulating smallest-first is
 * both deterministic and the more numerically stable of the two.
 * @param {number[]} xs
 */
export function stddev(xs) {
  return stddevOfSorted(sortedCopy(xs));
}

/**
 * The full summary one benchmark row reports, sorting the sample once.
 * @param {number[]} xs
 * @returns {{count: number, min: number, max: number, median: number, p90: number, stddev: number}}
 */
export function summarize(xs) {
  const s = sortedCopy(xs);
  return {
    count: s.length,
    min: s[0],
    max: s[s.length - 1],
    median: medianOfSorted(s),
    p90: percentileOfSorted(s, 0.9),
    stddev: stddevOfSorted(s),
  };
}

/**
 * Whether a sample's timings are too unstable to read: its p90 is more than
 * `factor`× its median, i.e. the tail has detached from the body.
 *
 * The obvious test — `stddev / median` over some threshold — does not work on
 * this data. One GC pause of 5 ms among 200 samples of 0.04 ms drags the
 * standard deviation to ~0.35 (a ratio of ~9) while leaving the median and p90
 * untouched, so a stddev rule fires on every run of a perfectly healthy
 * benchmark and stops meaning anything. The tail-vs-body comparison ignores
 * isolated pauses and only fires when a large share of the updates were slow —
 * which is what "re-run this, the machine was busy" actually looks like.
 *
 * The default factor is calibrated against observed runs: healthy rows sit at a
 * p90/median of roughly 1.5–2 (the smallest app size, where one update costs
 * tens of microseconds, sits at the top of that band), while a row from a run
 * whose median had itself doubled measured 4.3.
 * @param {{median: number, p90: number}} timing
 * @param {number} factor
 */
export function isUnstable(timing, factor = 3) {
  return timing.p90 > factor * timing.median;
}
