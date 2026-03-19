import React, { useState } from 'react';
import type { MarkovAnalytics, DivergencePoint, ExpectedSteps } from '../engine/markovAnalytics';
import { getStepLabel } from '../config/zoneClassification';

interface Props {
  analytics: MarkovAnalytics;
  conversionRate: number;
}

export function MarkovInsights({ analytics, conversionRate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { path_probabilities, divergence_points, expected_steps } = analytics;

  // Sort path probs by funnel order for the mini-funnel display
  const FUNNEL_ORDER = ['homepage', 'landing', 'search', 'category', 'view', 'review', 'size_guide', 'add_to_cart', 'checkout', 'purchase'];
  const funnelProbs = FUNNEL_ORDER
    .filter((s) => path_probabilities[s] !== undefined)
    .map((s) => ({ step: s, prob: path_probabilities[s] }));

  // Top divergence points (most interesting insights)
  const topDivergence = divergence_points.slice(0, 5);

  // Expected steps for key funnel stages
  const keySteps = expected_steps.filter((s) =>
    ['homepage', 'search', 'view', 'add_to_cart', 'checkout'].includes(s.step)
  );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-medium">Markov chain analytics</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Transition probabilities computed via value iteration on the session Markov chain
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
        >
          {expanded ? 'Collapse' : 'Show details'}
        </button>
      </div>

      {/* Path probability funnel — always visible */}
      <div className="mb-4">
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          P(reaches purchase | at step)
        </p>
        <div className="flex items-end gap-1.5 h-20">
          {funnelProbs.map(({ step, prob }) => {
            const height = Math.max(prob * 100 / Math.max(funnelProbs[funnelProbs.length - 1]?.prob || 1, 0.01), 4);
            const isHighlight = prob > conversionRate * 3;
            return (
              <div key={step} className="flex flex-col items-center flex-1 min-w-0">
                <span className={`text-[10px] font-mono mb-1 ${
                  isHighlight ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {(prob * 100).toFixed(0)}%
                </span>
                <div
                  className={`w-full rounded-t transition-all ${
                    isHighlight
                      ? 'bg-emerald-500/80 dark:bg-emerald-500/60'
                      : 'bg-indigo-400/50 dark:bg-indigo-500/40'
                  }`}
                  style={{ height: `${height}%`, minHeight: 3 }}
                />
                <span className="text-[9px] text-gray-400 dark:text-gray-500 mt-1 truncate w-full text-center">
                  {getStepLabel(step).split(' ')[0]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expected steps — always visible */}
      {keySteps.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          {keySteps.map(({ step, to_purchase }) => (
            <div key={step} className="text-center px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <p className="text-lg font-semibold tracking-tight">
                {to_purchase !== null ? to_purchase.toFixed(1) : '—'}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                steps from {getStepLabel(step).toLowerCase()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Divergence points — expanded only */}
      {expanded && topDivergence.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Where converters diverge from non-converters
          </p>
          <div className="space-y-2">
            {topDivergence.map((d, i) => (
              <DivergenceRow key={i} point={d} />
            ))}
          </div>
        </div>
      )}

      {/* Full path probabilities — expanded only */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Full path probabilities
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(path_probabilities)
              .filter(([s]) => s !== 'purchase')
              .sort((a, b) => b[1] - a[1])
              .map(([step, prob]) => (
                <div key={step} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-gray-50 dark:bg-gray-800/50">
                  <span className="text-gray-600 dark:text-gray-400">{getStepLabel(step)}</span>
                  <span className="font-mono font-medium">{(prob * 100).toFixed(1)}%</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DivergenceRow({ point }: { point: DivergencePoint }) {
  const isGood = point.direction === 'converters_more';
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
        isGood ? 'bg-emerald-500' : 'bg-red-500'
      }`} />
      <div className="flex-1">
        <span className="font-medium">
          {getStepLabel(point.from_step)} → {getStepLabel(point.to_step)}
        </span>
        <span className="text-gray-400 dark:text-gray-500 ml-2">
          {(point.converting_prob * 100).toFixed(0)}% converters vs {(point.non_converting_prob * 100).toFixed(0)}% non-converters
        </span>
        <span className={`ml-1 font-mono ${
          isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
        }`}>
          ({(point.delta * 100).toFixed(0)}pp {isGood ? 'more' : 'less'})
        </span>
      </div>
    </div>
  );
}
