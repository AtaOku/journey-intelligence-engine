/**
 * Markov Chain Analytics
 * 
 * This is where the transition matrix becomes an actual AI technique,
 * not just a stored artifact. Three computations:
 * 
 * 1. Path probability: P(reaches purchase | current step)
 *    Uses the Markov chain's absorbing state properties.
 * 
 * 2. Matrix divergence: Where do converting vs non-converting paths split?
 *    Compares P(next | current) for converters vs non-converters.
 * 
 * 3. Expected path length: From any step, how many steps to purchase (or exit)?
 *    Uses fundamental matrix of absorbing Markov chain: N = (I - Q)^{-1}.
 */

import type { TransitionMatrix, TransitionMatrices } from '../api/types';

// ============================================================
// 1. PATH PROBABILITY — P(reaches purchase | at step X)
// ============================================================

/**
 * Compute P(eventually reaches 'purchase' | currently at step X)
 * for every step in the transition matrix.
 * 
 * Method: Set up system of linear equations.
 * For absorbing states: P(purchase | purchase) = 1, P(purchase | [exit]) = 0
 * For transient states: P(purchase | X) = Σ_Y P(Y|X) × P(purchase | Y)
 * 
 * Solve iteratively (value iteration) since matrix inversion in JS
 * without numpy is fragile. Converges in ~20 iterations for typical funnels.
 */
export function computePathProbabilities(
  matrix: TransitionMatrix
): Record<string, number> {
  const steps = new Set<string>();
  for (const from of Object.keys(matrix)) {
    steps.add(from);
    for (const to of Object.keys(matrix[from])) {
      steps.add(to);
    }
  }

  // Initialize: purchase = 1.0, [exit] = 0.0, everything else = 0.5
  const prob: Record<string, number> = {};
  for (const step of steps) {
    if (step === 'purchase') prob[step] = 1.0;
    else if (step === '[exit]') prob[step] = 0.0;
    else prob[step] = 0.5;
  }

  // Value iteration
  const MAX_ITER = 50;
  const TOLERANCE = 1e-6;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let maxDelta = 0;

    for (const step of steps) {
      if (step === 'purchase' || step === '[exit]') continue;

      const transitions = matrix[step];
      if (!transitions) {
        prob[step] = 0; // no outgoing transitions = dead end
        continue;
      }

      let newProb = 0;
      for (const [next, p] of Object.entries(transitions)) {
        newProb += p * (prob[next] ?? 0);
      }

      const delta = Math.abs(newProb - prob[step]);
      if (delta > maxDelta) maxDelta = delta;
      prob[step] = newProb;
    }

    if (maxDelta < TOLERANCE) break;
  }

  // Round and clean
  const result: Record<string, number> = {};
  for (const [step, p] of Object.entries(prob)) {
    if (step === '[start]' || step === '[exit]') continue;
    result[step] = Math.round(p * 10000) / 10000;
  }

  return result;
}


// ============================================================
// 2. MATRIX DIVERGENCE — Where do converters and non-converters split?
// ============================================================

export interface DivergencePoint {
  from_step: string;
  to_step: string;
  converting_prob: number;
  non_converting_prob: number;
  delta: number;          // absolute difference
  direction: 'converters_more' | 'non_converters_more';
  interpretation: string; // human-readable insight
}

/**
 * Compare converting vs non-converting transition matrices.
 * Find the transitions where behavior diverges most.
 * 
 * This answers: "At which step do converters start behaving differently
 * from non-converters?"
 */
export function computeMatrixDivergence(
  matrices: TransitionMatrices
): DivergencePoint[] {
  const { converting, non_converting } = matrices;
  const points: DivergencePoint[] = [];

  // Collect all from→to pairs across both matrices
  const allFromSteps = new Set([
    ...Object.keys(converting),
    ...Object.keys(non_converting),
  ]);

  for (const from of allFromSteps) {
    if (from === '[start]' || from === '[exit]') continue;

    const convTargets = converting[from] || {};
    const nonConvTargets = non_converting[from] || {};

    const allTargets = new Set([
      ...Object.keys(convTargets),
      ...Object.keys(nonConvTargets),
    ]);

    for (const to of allTargets) {
      if (to === '[start]') continue;

      const cp = convTargets[to] || 0;
      const ncp = nonConvTargets[to] || 0;
      const delta = Math.abs(cp - ncp);

      // Only report meaningful divergences (> 5 percentage points)
      if (delta < 0.05) continue;

      const direction: DivergencePoint['direction'] =
        cp > ncp ? 'converters_more' : 'non_converters_more';

      let interpretation: string;
      if (to === 'purchase') {
        interpretation = `Converters complete purchase from ${from} at ${(cp * 100).toFixed(0)}% vs ${(ncp * 100).toFixed(0)}% for non-converters.`;
      } else if (to === '[exit]') {
        interpretation = direction === 'non_converters_more'
          ? `Non-converters exit at ${from} ${(delta * 100).toFixed(0)}pp more often — this is a key drop-off point.`
          : `Converters exit at ${from} more — unusual, may indicate confident quick-buyers.`;
      } else if (direction === 'converters_more') {
        interpretation = `Converters are ${(delta * 100).toFixed(0)}pp more likely to go from ${from} to ${to} — this transition signals purchase intent.`;
      } else {
        interpretation = `Non-converters are ${(delta * 100).toFixed(0)}pp more likely to go from ${from} to ${to} — this path leads away from conversion.`;
      }

      points.push({
        from_step: from,
        to_step: to,
        converting_prob: Math.round(cp * 10000) / 10000,
        non_converting_prob: Math.round(ncp * 10000) / 10000,
        delta: Math.round(delta * 10000) / 10000,
        direction,
        interpretation,
      });
    }
  }

  // Sort by divergence magnitude
  points.sort((a, b) => b.delta - a.delta);

  return points;
}


// ============================================================
// 3. EXPECTED PATH LENGTH — Steps to purchase or exit
// ============================================================

export interface ExpectedSteps {
  step: string;
  to_purchase: number | null;  // null if unreachable
  to_exit: number | null;
}

/**
 * Compute expected number of steps from each state to purchase (or exit).
 * 
 * Uses absorbing Markov chain theory:
 * For transient states: E[steps to absorbing | X] = 1 + Σ_Y P(Y|X) × E[steps | Y]
 * 
 * Solved via value iteration (same approach as path probabilities).
 */
export function computeExpectedSteps(
  matrix: TransitionMatrix
): ExpectedSteps[] {
  const steps = new Set<string>();
  for (const from of Object.keys(matrix)) {
    steps.add(from);
    for (const to of Object.keys(matrix[from])) {
      steps.add(to);
    }
  }

  // Expected steps to purchase
  const toPurchase: Record<string, number> = {};
  for (const step of steps) {
    if (step === 'purchase') toPurchase[step] = 0;
    else if (step === '[exit]') toPurchase[step] = Infinity;
    else toPurchase[step] = 10; // initial guess
  }

  // Value iteration for expected steps to purchase
  for (let iter = 0; iter < 100; iter++) {
    let maxDelta = 0;
    for (const step of steps) {
      if (step === 'purchase' || step === '[exit]') continue;
      const transitions = matrix[step];
      if (!transitions) { toPurchase[step] = Infinity; continue; }

      let expected = 1; // one step from current
      for (const [next, p] of Object.entries(transitions)) {
        const nextVal = toPurchase[next] ?? Infinity;
        expected += p * (nextVal === Infinity ? 100 : nextVal); // cap Infinity contribution
      }
      const delta = Math.abs(expected - toPurchase[step]);
      if (delta > maxDelta) maxDelta = delta;
      toPurchase[step] = expected;
    }
    if (maxDelta < 0.001) break;
  }

  // Expected steps to exit (same logic, exit is the absorbing state)
  const toExit: Record<string, number> = {};
  for (const step of steps) {
    if (step === '[exit]') toExit[step] = 0;
    else if (step === 'purchase') toExit[step] = 0; // purchase is also terminal
    else toExit[step] = 5;
  }

  for (let iter = 0; iter < 100; iter++) {
    let maxDelta = 0;
    for (const step of steps) {
      if (step === '[exit]' || step === 'purchase') continue;
      const transitions = matrix[step];
      if (!transitions) { toExit[step] = 1; continue; }

      let expected = 1;
      for (const [next, p] of Object.entries(transitions)) {
        expected += p * (toExit[next] ?? 0);
      }
      const delta = Math.abs(expected - toExit[step]);
      if (delta > maxDelta) maxDelta = delta;
      toExit[step] = expected;
    }
    if (maxDelta < 0.001) break;
  }

  const result: ExpectedSteps[] = [];
  for (const step of steps) {
    if (step === '[start]' || step === '[exit]') continue;
    result.push({
      step,
      to_purchase: toPurchase[step] === Infinity || toPurchase[step] > 50
        ? null
        : Math.round(toPurchase[step] * 10) / 10,
      to_exit: Math.round((toExit[step] ?? 0) * 10) / 10,
    });
  }

  // Sort by proximity to purchase (closest first)
  result.sort((a, b) => (a.to_purchase ?? 999) - (b.to_purchase ?? 999));

  return result;
}


// ============================================================
// BUNDLE — Run all Markov analytics at once
// ============================================================

export interface MarkovAnalytics {
  path_probabilities: Record<string, number>;
  divergence_points: DivergencePoint[];
  expected_steps: ExpectedSteps[];
}

export function computeMarkovAnalytics(matrices: TransitionMatrices): MarkovAnalytics {
  return {
    path_probabilities: computePathProbabilities(matrices.all),
    divergence_points: computeMatrixDivergence(matrices),
    expected_steps: computeExpectedSteps(matrices.all),
  };
}
