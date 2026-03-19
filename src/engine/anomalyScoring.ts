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

  // Compute zone-level stats (sample variance with Bessel's correction)
  const zoneStats: Record<string, { mean: number; std: number }> = {};

  // First pass: compute all rates for a global pooled std floor
  const allRates = Object.values(zoneRates).flat().map((r) => r.rate);
  const globalMean = allRates.reduce((s, v) => s + v, 0) / allRates.length;
  const globalStd = allRates.length > 1
    ? Math.sqrt(allRates.reduce((s, v) => s + (v - globalMean) ** 2, 0) / (allRates.length - 1))
    : 0.1;
  const minStd = globalStd * 0.25; // data-derived floor, not arbitrary

  for (const [zone, rates] of Object.entries(zoneRates)) {
    const values = rates.map((r) => r.rate);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.length > 1
        ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1) // Bessel's correction
        : 0;
    zoneStats[zone] = {
      mean,
      std: Math.max(Math.sqrt(variance), minStd),
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
    // Absolute-ratio fallback: small-n zones produce wide std that suppresses z-scores.
    // If drop-off is 2.5x+ the zone baseline, flag at least medium.
    if (frictionLevel === 'normal' && stats.mean > 0 && rate / stats.mean >= 2.5) {
      frictionLevel = 'medium';
    }

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
 * 
 * Key distinction: a high-friction step paints its EXIT links (backward
 * or terminal transitions) with friction color, not ALL outgoing links.
 * A link from landing → view is healthy progression even if landing
 * has 100% exit rate for sessions that don't reach view.
 * 
 * Heuristic: if the target step is at a lower or equal funnel stage
 * than the source, or the target is "[exit]", paint with friction.
 * Forward-progression links keep the default zone gradient.
 */
export function enrichSankeyWithFriction(
  sankey: SankeyData,
  scores: FrictionScore[]
): SankeyData {
  const scoreLookup = new Map<string, FrictionScore>();
  for (const score of scores) {
    scoreLookup.set(score.step, score);
  }

  const STAGE_ORDER: Record<string, number> = {
    homepage: 0, landing: 0, search: 1, category: 1,
    view: 2, pdp: 2, review: 2, size_guide: 2, wishlist: 2, compare: 2,
    add_to_cart: 3, cart: 3, cart_edit: 3,
    checkout: 4, payment: 4, purchase: 5,
  };

  const enrichedLinks: SankeyLink[] = sankey.links.map((link) => {
    const sourceNode = sankey.nodes[link.source];
    const targetNode = sankey.nodes[link.target];
    if (!sourceNode || !targetNode) return link;

    const score = scoreLookup.get(sourceNode.name);
    if (!score) return link;

    const srcStage = STAGE_ORDER[sourceNode.name] ?? 2;
    const tgtStage = STAGE_ORDER[targetNode.name] ?? 2;
    const isForwardProgression = tgtStage > srcStage;

    return {
      ...link,
      drop_off_rate: score.drop_off,
      anomaly_score: score.z_score,
      zone: score.zone,
      // Forward-progression links are "normal" even from high-friction steps.
      // Only backward/lateral/exit links carry the friction signal.
      friction_level: isForwardProgression ? 'normal' : score.friction_level,
    };
  });

  return { nodes: sankey.nodes, links: enrichedLinks };
}
