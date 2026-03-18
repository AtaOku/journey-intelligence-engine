/**
 * Anomaly Scoring — Step-Type Aware (TypeScript)
 * 
 * Mirrors Python compute_anomaly_scores() exactly.
 * Each step's drop-off is scored within its funnel zone peers.
 * 
 * Zones:
 *   navigation: homepage, landing, category, search
 *   engagement: view, pdp, review, size_guide, filter, wishlist
 *   commitment: add_to_cart, cart, checkout, payment, purchase
 */

import type { ProcessedSession } from './csvParser';
import type { FrictionScore, FrictionLevel, FunnelZone, SankeyData, SankeyLink } from '../api/types';
import { getZone } from '../config/zoneClassification';

interface StepStats {
  total: number;
  exits: number;
  transitions: Record<string, number>;
}

/**
 * Compute step-type aware anomaly scores.
 */
export function computeAnomalyScores(sessions: ProcessedSession[]): FrictionScore[] {
  // Count transitions and exits per step
  const stepStats: Record<string, StepStats> = {};

  for (const session of sessions) {
    const steps = session.events;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!stepStats[step]) {
        stepStats[step] = { total: 0, exits: 0, transitions: {} };
      }
      stepStats[step].total++;

      if (i === steps.length - 1 && step !== 'purchase') {
        stepStats[step].exits++;
      } else if (i < steps.length - 1) {
        const next = steps[i + 1];
        stepStats[step].transitions[next] = (stepStats[step].transitions[next] || 0) + 1;
      }
    }
  }

  // Compute drop-off rates
  const dropOffRates: Record<string, number> = {};
  for (const [step, stats] of Object.entries(stepStats)) {
    if (stats.total > 0) {
      dropOffRates[step] = stats.exits / stats.total;
    }
  }

  // Group by zone
  const zoneRates: Record<string, { step: string; rate: number }[]> = {};
  for (const [step, rate] of Object.entries(dropOffRates)) {
    const zone = getZone(step);
    if (!zoneRates[zone]) zoneRates[zone] = [];
    zoneRates[zone].push({ step, rate });
  }

  // Compute zone-level stats
  const zoneStats: Record<string, { mean: number; std: number }> = {};
  for (const [zone, rates] of Object.entries(zoneRates)) {
    const values = rates.map((r) => r.rate);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.length > 1
        ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
        : 0.01; // minimum variance
    zoneStats[zone] = {
      mean,
      std: Math.max(Math.sqrt(variance), 0.01),
    };
  }

  // Score each step
  const scores: FrictionScore[] = [];
  for (const [step, rate] of Object.entries(dropOffRates)) {
    const zone = getZone(step) as FunnelZone;
    const stats = zoneStats[zone] || { mean: 0.3, std: 0.1 };
    const zScore = Math.round(((rate - stats.mean) / stats.std) * 100) / 100;

    let frictionLevel: FrictionLevel = 'normal';
    if (zScore > 2.0) frictionLevel = 'high';
    else if (zScore > 1.5) frictionLevel = 'medium';

    scores.push({
      step,
      drop_off: Math.round(rate * 10000) / 10000,
      zone,
      zone_baseline: Math.round(stats.mean * 10000) / 10000,
      z_score: zScore,
      friction_level: frictionLevel,
      sessions_at_step: stepStats[step].total,
      sessions_exiting: stepStats[step].exits,
    });
  }

  // Sort by z_score descending
  scores.sort((a, b) => b.z_score - a.z_score);

  return scores;
}

/**
 * Enrich Sankey links with anomaly data from friction scores.
 */
export function enrichSankeyWithFriction(
  sankey: SankeyData,
  scores: FrictionScore[]
): SankeyData {
  const scoreLookup = new Map<string, FrictionScore>();
  for (const score of scores) {
    scoreLookup.set(score.step, score);
  }

  const enrichedLinks: SankeyLink[] = sankey.links.map((link) => {
    const sourceNode = sankey.nodes[link.source];
    if (!sourceNode) return link;

    const score = scoreLookup.get(sourceNode.name);
    if (!score) return link;

    return {
      ...link,
      drop_off_rate: score.drop_off,
      anomaly_score: score.z_score,
      zone: score.zone,
      friction_level: score.friction_level,
    };
  });

  return { nodes: sankey.nodes, links: enrichedLinks };
}
