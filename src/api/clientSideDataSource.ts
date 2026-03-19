/**
 * ClientSideDataSource — processes uploaded CSV in the browser.
 * 
 * Uses a Web Worker for heavy computation (CSV parse, anomaly scoring,
 * friction detection) to keep the main thread responsive.
 * Falls back to main-thread processing if Worker is unavailable.
 */

import type {
  JourneyDataSource,
  Metadata,
  SankeyData,
  SankeyNode,
  SankeyLink,
  PatternData,
  FrictionData,
  TransitionMatrices,
  FunnelZone,
} from './types';
import { processUploadedCSV, type ProcessedSession } from '../engine/csvParser';
import { computeAllTransitionMatrices } from '../engine/transitionMatrix';
import { computeAnomalyScores, enrichSankeyWithFriction } from '../engine/anomalyScoring';
import { detectFrictionPatterns } from '../engine/frictionPatterns';
import { validateData, type ValidationReport } from '../engine/validation';
import { computeMarkovAnalytics, type MarkovAnalytics } from '../engine/markovAnalytics';

export type ProgressCallback = (stage: string, pct: number) => void;

export class ClientSideDataSource implements JourneyDataSource {
  private _metadata: Metadata | null = null;
  private _sankey: SankeyData | null = null;
  private _friction: FrictionData | null = null;
  private _matrices: TransitionMatrices | null = null;
  private _validation: ValidationReport | null = null;
  private _markov: MarkovAnalytics | null = null;

  public warnings: string[] = [];
  public format: string = 'unknown';

  /**
   * Process a CSV string. Attempts Web Worker first, falls back to main thread.
   */
  async processAsync(csvText: string, onProgress?: ProgressCallback): Promise<void> {
    try {
      await this.processInWorker(csvText, onProgress);
    } catch {
      // Worker unavailable or failed — fall back to main thread
      onProgress?.('Processing (main thread)...', 20);
      this.processSync(csvText);
      onProgress?.('Done', 100);
    }
  }

  /**
   * Synchronous main-thread fallback (original behavior).
   */
  processSync(csvText: string): void {
    const result = processUploadedCSV(csvText);
    this.format = result.format;
    this.warnings = result.warnings;

    if (result.sessions.length === 0) {
      this.warnings.push('No valid sessions found in the uploaded file.');
      return;
    }

    const frictionScores = computeAnomalyScores(result.sessions);
    const frictionPatterns = detectFrictionPatterns(result.sessions);
    this._matrices = computeAllTransitionMatrices(result.sessions);
    this._sankey = this.buildSankey(result.sessions, frictionScores);
    this._friction = { scores: frictionScores, patterns_detected: frictionPatterns };
    this._metadata = this.buildMetadata(result.sessions, result.totalEvents, frictionScores);
    this._validation = validateData(result.sessions, result.format);
    this._markov = computeMarkovAnalytics(this._matrices);
  }

  /**
   * Legacy sync API (keeps backward compat with App.tsx).
   */
  process(csvText: string): void {
    this.processSync(csvText);
  }

  private processInWorker(csvText: string, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(
          new URL('../engine/processingWorker.ts', import.meta.url),
          { type: 'module' }
        );
      } catch {
        reject(new Error('Worker not supported'));
        return;
      }

      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Worker timeout'));
      }, 60_000); // 60s timeout

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          onProgress?.(msg.stage, msg.pct);
        } else if (msg.type === 'result') {
          clearTimeout(timeout);
          const d = msg.data;
          this._metadata = d.metadata;
          this._sankey = d.sankey;
          this._friction = d.friction;
          this._matrices = d.matrices;
          this._validation = d.validation || null;
          this._markov = d.markov || null;
          this.format = d.format;
          this.warnings = d.warnings;
          worker.terminate();
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          this.warnings = [msg.message];
          worker.terminate();
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(err);
      };

      worker.postMessage({ type: 'process', csvText });
    });
  }

  private buildMetadata(
    sessions: ProcessedSession[],
    totalEvents: number,
    frictionScores: ReturnType<typeof computeAnomalyScores>
  ): Metadata {
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

  private buildSankey(
    sessions: ProcessedSession[],
    frictionScores: ReturnType<typeof computeAnomalyScores>
  ): SankeyData {
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
        source: srcIdx, target: tgtIdx, value,
        drop_off_rate: 0, anomaly_score: 0,
        zone: 'unknown' as FunnelZone, friction_level: 'normal',
      });
    }

    return enrichSankeyWithFriction({ nodes, links }, frictionScores);
  }

  // ---- JourneyDataSource interface ----

  async getMetadata(): Promise<Metadata> {
    if (!this._metadata) throw new Error('No data processed.');
    return this._metadata;
  }

  async getSankeyData(): Promise<SankeyData> {
    if (!this._sankey) throw new Error('No data processed.');
    return this._sankey;
  }

  async getPatterns(): Promise<PatternData | null> {
    return null; // pattern mining not available in upload mode
  }

  async getFrictionData(): Promise<FrictionData> {
    return this._friction || { scores: [], patterns_detected: [] };
  }

  async getTransitionMatrices(): Promise<TransitionMatrices> {
    if (!this._matrices) throw new Error('No data processed.');
    return this._matrices;
  }

  getValidation(): ValidationReport | null {
    return this._validation;
  }

  getMarkov(): MarkovAnalytics | null {
    return this._markov;
  }
}
