// utils.js — small pure helpers, no DOM.

export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

// min-max normalise a list of {key:value} into [0,1]; flat arrays -> 0.5
export function minMaxMap(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = hi - lo;
  return (v) => (span === 0 ? 0.5 : clamp((v - lo) / span));
}

// standardise to z-scores (mean 0, sd 1), clamped to ±clampZ so single outliers
// can't dominate. This is the correct way to combine features on different scales.
export function zScoreMap(values, clampZ = 3) {
  const nums = values.filter((v) => Number.isFinite(v));
  const mean = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length || 1);
  const sd = Math.sqrt(variance) || 1;
  return (v) => Math.max(-clampZ, Math.min(clampZ, (v - mean) / sd));
}

// weighted average that ignores zero-weight terms; returns 0..1 if metrics are 0..1
export function weightedAverage(pairs) {
  let num = 0, den = 0;
  for (const [metric, weight] of pairs) {
    if (weight > 0) { num += metric * weight; den += weight; }
  }
  return den === 0 ? 0.5 : num / den;
}

// deterministic seeded RNG (mulberry32) so Monte-Carlo + share URLs are reproducible
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// points-per-game from a list of "W"/"D"/"L"
export function ppg(results) {
  if (!results.length) return 0;
  const pts = results.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return pts / (results.length * 3); // 0..1
}
