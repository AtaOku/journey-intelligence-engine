/**
 * ClientSideDataSource — processes uploaded CSV in the browser.
 * 
 * Computes transition matrix, anomaly scores, friction patterns client-side.
 * Pattern mining (Seq2Pat DPM) is NOT available in this mode.
 * Sankey data is generated from the transition matrix.
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

export class ClientSideDataSource implements JourneyDataSource {
  private sessions: ProcessedSession[] = [];
  private matrices: TransitionMatrices | null = null;
  private frictionScores: ReturnType<typeof computeAnomalyScores> | null = null;
  private frictionPatterns: ReturnType<typeof detectFrictionPatterns> | null = null;
  private _metadata: Metadata | null = null;
  private _sankey: SankeyData | null = null;

  public warnings: string[] = [];
  public format: string = 'unknown';

  /**
   * Load and process a CSV string.
   * Call this once, then use the getter methods.
   */
  process(csvText: string): void {
    const result = processUploadedCSV(csvText);
    this.sessions = result.sessions;
    this.format = result.format;
    this.warnings = result.warnings;

    if (this.sessions.length === 0) {
      this.warnings.push('No valid sessions found in the uploaded file.');
      return;
    }

    // Compute everything
    this.matrices = computeAllTransitionMatrices(this.sessions);
    this.frictionScores = computeAnomalyScores(this.sessions);
    this.frictionPatterns = detectFrictionPatterns(this.sessions);
    this._sankey = this.buildSankey();
    this._metadata = this.buildMetadata(result.totalEvents);
  }

  private buildMetadata(totalEvents: number): Metadata {
    const converting = this.sessions.filter((s) => s.converted).length;
    const avgEvents =
      this.sessions.reduce((s, sess) => s + sess.n_events, 0) / this.sessions.length;
    const values = this.sessions.filter((s) => s.total_value > 0).map((s) => s.total_value);
    const avgValue = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;

    const frictionCount = (this.frictionScores || []).filter(
      (s) => s.friction_level === 'high' || s.friction_level === 'medium'
    ).length;
    const topFriction = (this.frictionScores || [])[0];

    return {
      total_sessions: this.sessions.length,
      converting_sessions: converting,
      conversion_rate: Math.round((converting / this.sessions.length) * 10000) / 10000,
      avg_events_per_session: Math.round(avgEvents * 10) / 10,
      avg_session_value: Math.round(avgValue * 100) / 100,
      data_source: 'user_upload',
      generated_at: new Date().toISOString(),
      n_friction_points: frictionCount,
      top_friction_step: topFriction?.step ?? null,
    };
  }

  private buildSankey(): SankeyData {
    // Count transitions for Sankey links
    const transitionCounts: Record<string, number> = {};
    const stepSet = new Set<string>();

    for (const session of this.sessions) {
      for (const step of session.events) stepSet.add(step);
      for (let i = 0; i < session.events.length - 1; i++) {
        const key = `${session.events[i]}→${session.events[i + 1]}`;
        transitionCounts[key] = (transitionCounts[key] || 0) + 1;
      }
    }

    // Order steps by funnel position
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

    // Enrich with friction data
    const baseSankey = { nodes, links };
    if (this.frictionScores) {
      return enrichSankeyWithFriction(baseSankey, this.frictionScores);
    }
    return baseSankey;
  }

  // ---- JourneyDataSource interface ----

  async getMetadata(): Promise<Metadata> {
    if (!this._metadata) throw new Error('No data processed. Call process() first.');
    return this._metadata;
  }

  async getSankeyData(): Promise<SankeyData> {
    if (!this._sankey) throw new Error('No data processed. Call process() first.');
    return this._sankey;
  }

  async getPatterns(): Promise<PatternData | null> {
    // Pattern mining not available in client-side mode
    return null;
  }

  async getFrictionData(): Promise<FrictionData> {
    return {
      scores: this.frictionScores || [],
      patterns_detected: this.frictionPatterns || [],
    };
  }

  async getTransitionMatrices(): Promise<TransitionMatrices> {
    if (!this.matrices) throw new Error('No data processed. Call process() first.');
    return this.matrices;
  }
}
