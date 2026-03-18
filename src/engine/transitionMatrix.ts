/**
 * Transition Matrix (Markov Chain) — TypeScript Implementation
 * 
 * Mirrors the Python compute_transition_matrix() exactly.
 * Both implementations must produce identical results on the same input.
 * Validated via shared mini test dataset (tests/fixtures/mini_dataset.json).
 */

import type { ProcessedSession } from './csvParser';
import type { TransitionMatrix, TransitionMatrices } from '../api/types';

/**
 * Compute first-order Markov transition matrix.
 * P(next_step | current_step) from session sequences.
 * 
 * @param sessions - processed session objects
 * @param filterConverted - null=all, true=only converting, false=only non-converting
 * @returns {from_step: {to_step: probability}}
 */
export function computeTransitionMatrix(
  sessions: ProcessedSession[],
  filterConverted: boolean | null = null
): TransitionMatrix {
  const transitionCounts: Record<string, Record<string, number>> = {};

  for (const session of sessions) {
    if (filterConverted !== null && session.converted !== filterConverted) {
      continue;
    }

    const steps = ['[start]', ...session.events, '[exit]'];

    for (let i = 0; i < steps.length - 1; i++) {
      const from = steps[i];
      const to = steps[i + 1];

      if (!transitionCounts[from]) transitionCounts[from] = {};
      transitionCounts[from][to] = (transitionCounts[from][to] || 0) + 1;
    }
  }

  // Normalize to probabilities
  const matrix: TransitionMatrix = {};

  for (const [from, targets] of Object.entries(transitionCounts)) {
    const total = Object.values(targets).reduce((sum, c) => sum + c, 0);
    matrix[from] = {};

    // Sort by count descending (matches Python Counter.most_common())
    const sorted = Object.entries(targets).sort((a, b) => b[1] - a[1]);

    for (const [to, count] of sorted) {
      matrix[from][to] = Math.round((count / total) * 10000) / 10000;
    }
  }

  return matrix;
}

/**
 * Compute all three transition matrices (all, converting, non-converting).
 */
export function computeAllTransitionMatrices(
  sessions: ProcessedSession[]
): TransitionMatrices {
  return {
    all: computeTransitionMatrix(sessions, null),
    converting: computeTransitionMatrix(sessions, true),
    non_converting: computeTransitionMatrix(sessions, false),
  };
}
