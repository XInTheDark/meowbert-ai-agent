import { clamp } from './numbers.js';

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

/**
 * Smooth-ish, math-based scaling without lookup tables.
 *
 * Geometric interpolation is nice for "log-scale knobs":
 * - t=0 -> min
 * - t=1 -> max
 * - values grow multiplicatively in-between
 *
 * `exponent` controls curvature:
 * - exponent > 1: slower early, faster late
 * - exponent < 1: faster early, slower late
 */
export function scaleGeometric(min: number, max: number, t01: number, exponent = 1): number {
  if (!(min > 0) || !(max > 0)) {
    throw new Error(`scaleGeometric requires min/max > 0. Got min=${min}, max=${max}`);
  }
  if (min === max) return min;

  const t = clamp01(t01);
  const e = exponent <= 0 ? 1 : exponent;
  const eased = Math.pow(t, e);

  // min * (max/min)^(eased)
  return min * Math.pow(max / min, eased);
}

export function scaleGeometricInt(min: number, max: number, t01: number, exponent = 1): number {
  return Math.round(scaleGeometric(min, max, t01, exponent));
}

