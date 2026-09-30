export declare function clamp01(n: number): number;
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
export declare function scaleGeometric(min: number, max: number, t01: number, exponent?: number): number;
export declare function scaleGeometricInt(min: number, max: number, t01: number, exponent?: number): number;
