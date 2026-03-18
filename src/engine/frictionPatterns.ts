/**
 * Friction Pattern Detection (TypeScript)
 * 
 * Detects predefined behavioral signatures from session sequences.
 * These are HEURISTIC pattern matches, not causal diagnoses.
 */

import type { ProcessedSession } from './csvParser';
import type { FrictionPattern } from '../api/types';

type PatternDetector = (events: string[]) => boolean;

const PATTERN_DEFINITIONS: {
  type: string;
  description: string;
  detect: PatternDetector;
}[] = [
  {
    type: 'search_frustration_loop',
    description: "User searches 3+ times in a session — likely can't find what they want",
    detect: (events) => events.filter((e) => e === 'search').length >= 3,
  },
  {
    type: 'cart_hesitation',
    description: 'User adds to cart but returns to viewing — price or size uncertainty',
    detect: (events) =>
      events.includes('add_to_cart') &&
      events.some(
        (e, i) => e === 'add_to_cart' && i + 1 < events.length && events[i + 1] === 'view'
      ),
  },
  {
    type: 'bounce_back_browse',
    description: 'User goes category → product → category → product — browsing without conviction',
    detect: (events) =>
      events.filter(
        (e, i) => e === 'view' && i + 1 < events.length && events[i + 1] === 'category'
      ).length >= 2,
  },
  {
    type: 'checkout_abandonment',
    description: 'User reaches checkout but does not purchase — payment or shipping friction',
    detect: (events) => events.includes('checkout') && !events.includes('purchase'),
  },
  {
    type: 'single_page_exit',
    description: 'User views only one page and leaves — content or relevance mismatch',
    detect: (events) => events.length === 1,
  },
  {
    type: 'deep_browse_no_action',
    description: 'User views 5+ pages but never adds to cart — engaged but no intent signal',
    detect: (events) => events.length >= 5 && !events.includes('add_to_cart'),
  },
];

/**
 * Detect friction patterns across all sessions.
 */
export function detectFrictionPatterns(sessions: ProcessedSession[]): FrictionPattern[] {
  const results: {
    type: string;
    description: string;
    matchingSessions: ProcessedSession[];
  }[] = PATTERN_DEFINITIONS.map((p) => ({
    type: p.type,
    description: p.description,
    matchingSessions: [],
  }));

  for (const session of sessions) {
    for (let i = 0; i < PATTERN_DEFINITIONS.length; i++) {
      if (PATTERN_DEFINITIONS[i].detect(session.events)) {
        results[i].matchingSessions.push(session);
      }
    }
  }

  const totalSessions = sessions.length;

  return results
    .filter((r) => r.matchingSessions.length > 0)
    .map((r) => ({
      type: r.type,
      description: r.description,
      sessions_affected: r.matchingSessions.length,
      pct_of_total:
        Math.round((r.matchingSessions.length / totalSessions) * 1000) / 10,
      conversion_rate:
        Math.round(
          (r.matchingSessions.filter((s) => s.converted).length /
            Math.max(r.matchingSessions.length, 1)) *
            10000
        ) / 10000,
    }))
    .sort((a, b) => b.sessions_affected - a.sessions_affected);
}
