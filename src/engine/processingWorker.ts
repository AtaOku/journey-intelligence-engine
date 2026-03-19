/**
 * Journey Processing Web Worker
 * 
 * Runs CSV parse → sessionize → anomaly score → friction detect
 * off the main thread to prevent UI freezing on large files.
 * 
 * Messages:
 *   IN:  { type: 'process', csvText: string }
 *   OUT: { type: 'progress', stage: string, pct: number }
 *   OUT: { type: 'result', data: WorkerResult }
 *   OUT: { type: 'error', message: string }
 */

import { processUploadedCSV, type ProcessedSession } from './csvParser';
import { computeAnomalyScores, enrichSankeyWithFriction } from './anomalyScoring';
import { detectFrictionPatterns } from './frictionPatterns';
import { computeAllTransitionMatrices } from './transitionMatrix';
import { computeMarkovAnalytics } from './markovAnalytics';
import { validateData } from './validation';
import type {
  Metadata,
  SankeyData,
  SankeyNode,
  SankeyLink,
  FrictionData,
  FunnelZone,
} from '../api/types';

function postProgress(stage: string, pct: number) {
  self.postMessage({ type: 'progress', stage, pct });
}

function buildSankey(sessions: ProcessedSession[], frictionScores: ReturnType<typeof computeAnomalyScores>): SankeyData {
  const transitionCounts: Record<string, number> = {};
  const stepSet = new Set<string>();

  for (const session of sessions) {
    for (const step of session.events) stepSet.add(step);
    for (let i = 0; i < session.events.length - 1; i++) {
      const key = `${session.events[i]}→${session.events[i + 1]}`;
      transitionCounts[key] = (transitionCounts[key] || 0) + 1;
    }
  }

  const STEP_ORDER: Record<string, number> = {
    homepage: 1, landing: 1, search: 2, category: 2, filter: 3,
    view: 3, pdp: 3, compare: 4, wishlist: 4, review: 4, size_guide: 4,
    add_to_cart: 5, cart: 5, cart_edit: 6, checkout: 7, payment: 8, purchase: 9,
  };

  const sortedSteps = [...stepSet].sort(
    (a, b) => (STEP_ORDER[a] ?? 5) - (STEP_ORDER[b] ?? 5)
  );
  const nodeIndex = new Map(sortedSteps.map((s, i) => [s, i]));

  const nodes: SankeyNode[] = sortedSteps.map((s, i) => ({ id: i, name: s }));
  const links: SankeyLink[] = [];

  for (const [key, value] of Object.entries(transitionCounts)) {
    const [source, target] = key.split('→');
    const srcIdx = nodeIndex.get(source);
    const tgtIdx = nodeIndex.get(target);
    if (srcIdx === undefined || tgtIdx === undefined) continue;

    links.push({
      source: srcIdx,
      target: tgtIdx,
      value,
      drop_off_rate: 0,
      anomaly_score: 0,
      zone: 'unknown' as FunnelZone,
      friction_level: 'normal',
    });
  }

  return enrichSankeyWithFriction({ nodes, links }, frictionScores);
}

function buildMetadata(sessions: ProcessedSession[], totalEvents: number, frictionScores: ReturnType<typeof computeAnomalyScores>): Metadata {
  const converting = sessions.filter((s) => s.converted).length;
  const avgEvents = sessions.reduce((s, sess) => s + sess.n_events, 0) / sessions.length;
  const values = sessions.filter((s) => s.total_value > 0).map((s) => s.total_value);
  const avgValue = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  const frictionCount = frictionScores.filter(
    (s) => s.friction_level === 'high' || s.friction_level === 'medium'
  ).length;
  const topFriction = frictionScores[0];

  return {
    total_sessions: sessions.length,
    converting_sessions: converting,
    conversion_rate: Math.round((converting / sessions.length) * 10000) / 10000,
    avg_events_per_session: Math.round(avgEvents * 10) / 10,
    avg_session_value: Math.round(avgValue * 100) / 100,
    data_source: 'user_upload',
    generated_at: new Date().toISOString(),
    n_friction_points: frictionCount,
    top_friction_step: topFriction?.step ?? null,
  };
}

self.onmessage = (e: MessageEvent) => {
  const { type, csvText } = e.data;
  if (type !== 'process') return;

  try {
    // Stage 1: Parse CSV
    postProgress('Parsing CSV...', 10);
    const result = processUploadedCSV(csvText);

    if (result.sessions.length === 0) {
      self.postMessage({
        type: 'error',
        message: result.warnings.join('. ') || 'No valid sessions found.',
      });
      return;
    }

    // Stage 2: Transition matrices
    postProgress('Computing transitions...', 30);
    const matrices = computeAllTransitionMatrices(result.sessions);

    // Stage 3: Anomaly scoring
    postProgress('Scoring anomalies...', 50);
    const frictionScores = computeAnomalyScores(result.sessions);

    // Stage 4: Friction patterns
    postProgress('Detecting friction patterns...', 70);
    const frictionPatterns = detectFrictionPatterns(result.sessions);

    // Stage 5: Build Sankey
    postProgress('Building visualization...', 85);
    const sankey = buildSankey(result.sessions, frictionScores);

    // Stage 6: Markov chain analytics
    postProgress('Computing Markov analytics...', 88);
    const markov = computeMarkovAnalytics(matrices);

    // Stage 7: Metadata + Validation
    postProgress('Validating data quality...', 94);
    const metadata = buildMetadata(result.sessions, result.totalEvents, frictionScores);
    const validation = validateData(result.sessions, result.format);

    postProgress('Finalizing...', 98);

    self.postMessage({
      type: 'result',
      data: {
        metadata,
        sankey,
        patterns: null,
        friction: {
          scores: frictionScores,
          patterns_detected: frictionPatterns,
        },
        matrices,
        markov,
        format: result.format,
        warnings: result.warnings,
        validation,
      },
    });
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      message: err?.message || 'Processing failed.',
    });
  }
};
