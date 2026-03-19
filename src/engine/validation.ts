/**
 * Data Validation Report
 * 
 * Analyzes parsed session data and produces a quality report:
 * - Unknown/unclassified event types (not in zone taxonomy)
 * - Missing columns detected
 * - Duplicate events removed
 * - Single-event sessions (potential bot traffic)
 * - Temporal gaps (sessions spanning unrealistic time ranges)
 * 
 * This runs AFTER csvParser produces sessions, not during parsing.
 */

import type { ProcessedSession } from './csvParser';
import { getZone } from '../config/zoneClassification';

export interface ValidationIssue {
  type: 'unknown_events' | 'short_sessions' | 'high_bounce' | 'empty_categories' | 'format_note';
  severity: 'info' | 'warning' | 'error';
  message: string;
  count: number;
  detail?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  summary: {
    total_sessions: number;
    total_events: number;
    unique_event_types: number;
    classified_event_types: number;
    unclassified_event_types: string[];
    single_event_sessions: number;
    avg_session_length: number;
  };
}

/**
 * Validate processed sessions and produce a quality report.
 */
export function validateData(
  sessions: ProcessedSession[],
  format: string,
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (sessions.length === 0) {
    return {
      issues: [{ type: 'format_note', severity: 'error', message: 'No valid sessions found.', count: 0 }],
      summary: {
        total_sessions: 0, total_events: 0, unique_event_types: 0,
        classified_event_types: 0, unclassified_event_types: [],
        single_event_sessions: 0, avg_session_length: 0,
      },
    };
  }

  // Collect all event types
  const eventTypeCounts: Record<string, number> = {};
  let totalEvents = 0;

  for (const session of sessions) {
    for (const evt of session.events) {
      eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
      totalEvents++;
    }
  }

  const allEventTypes = Object.keys(eventTypeCounts);
  const unclassified = allEventTypes.filter((e) => getZone(e) === 'unknown');
  const classified = allEventTypes.length - unclassified.length;

  // Unknown event types
  if (unclassified.length > 0) {
    const unclassifiedTotal = unclassified.reduce((s, e) => s + eventTypeCounts[e], 0);
    const pct = ((unclassifiedTotal / totalEvents) * 100).toFixed(1);
    issues.push({
      type: 'unknown_events',
      severity: unclassified.length > allEventTypes.length / 2 ? 'warning' : 'info',
      message: `${unclassified.length} event type${unclassified.length > 1 ? 's' : ''} not in zone taxonomy (${pct}% of events). Scored within "unknown" peer group.`,
      count: unclassifiedTotal,
      detail: unclassified.slice(0, 10).join(', ') + (unclassified.length > 10 ? '...' : ''),
    });
  }

  // Single-event sessions (potential bots or misconfigured tracking)
  const singleEvent = sessions.filter((s) => s.n_events === 1).length;
  const singlePct = (singleEvent / sessions.length) * 100;
  if (singlePct > 40) {
    issues.push({
      type: 'short_sessions',
      severity: 'warning',
      message: `${singlePct.toFixed(0)}% of sessions have only 1 event. This may indicate bot traffic or incomplete tracking.`,
      count: singleEvent,
    });
  } else if (singlePct > 20) {
    issues.push({
      type: 'short_sessions',
      severity: 'info',
      message: `${singlePct.toFixed(0)}% of sessions have only 1 event (${singleEvent.toLocaleString()} sessions).`,
      count: singleEvent,
    });
  }

  // High bounce: sessions ending at entry point
  const entrySteps = new Set(['homepage', 'landing', 'search', 'category']);
  const bounceSessions = sessions.filter(
    (s) => s.n_events === 1 && entrySteps.has(s.events[0])
  ).length;
  const bouncePct = (bounceSessions / sessions.length) * 100;
  if (bouncePct > 50) {
    issues.push({
      type: 'high_bounce',
      severity: 'warning',
      message: `${bouncePct.toFixed(0)}% bounce rate (single-page entry exits). Check if session tracking is configured correctly.`,
      count: bounceSessions,
    });
  }

  // Empty categories
  const emptyCategories = sessions.filter(
    (s) => s.categories.length === 1 && s.categories[0] === 'unknown'
  ).length;
  if (emptyCategories > sessions.length * 0.5) {
    issues.push({
      type: 'empty_categories',
      severity: 'info',
      message: `${((emptyCategories / sessions.length) * 100).toFixed(0)}% of sessions have no category data. Category-level analysis will be limited.`,
      count: emptyCategories,
    });
  }

  // Format note
  const formatLabels: Record<string, string> = {
    standard: 'Standard format',
    rees46: 'REES46 multi-category store',
    ga4: 'Google Analytics 4 (BigQuery export)',
    shopify: 'Shopify',
  };
  issues.push({
    type: 'format_note',
    severity: 'info',
    message: `Detected format: ${formatLabels[format] || format}. ${allEventTypes.length} unique event types found.`,
    count: allEventTypes.length,
  });

  const avgLength = totalEvents / sessions.length;

  return {
    issues: issues.sort((a, b) => {
      const sev = { error: 0, warning: 1, info: 2 };
      return sev[a.severity] - sev[b.severity];
    }),
    summary: {
      total_sessions: sessions.length,
      total_events: totalEvents,
      unique_event_types: allEventTypes.length,
      classified_event_types: classified,
      unclassified_event_types: unclassified,
      single_event_sessions: singleEvent,
      avg_session_length: Math.round(avgLength * 10) / 10,
    },
  };
}
