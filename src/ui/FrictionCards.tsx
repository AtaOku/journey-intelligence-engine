import React from 'react';
import type { FrictionData } from '../api/types';

interface Props {
  friction: FrictionData;
}

const PATTERN_ICONS: Record<string, string> = {
  search_frustration_loop: '🔍',
  cart_hesitation: '🛒',
  bounce_back_browse: '↩️',
  checkout_abandonment: '💳',
  single_page_exit: '⏏️',
  deep_browse_no_action: '👀',
};

export function FrictionCards({ friction }: Props) {
  const { patterns_detected, scores } = friction;

  if (!patterns_detected.length) return null;

  // Top friction steps (medium + high only)
  const frictionSteps = scores.filter(
    (s) => s.friction_level === 'high' || s.friction_level === 'medium'
  );

  return (
    <div className="space-y-4">
      {/* Friction steps summary */}
      {frictionSteps.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h2 className="text-base font-medium mb-3">Friction points</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {frictionSteps.map((step, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 ${
                  step.friction_level === 'high'
                    ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20'
                    : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">
                    {step.step.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      step.friction_level === 'high'
                        ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                        : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {step.friction_level}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <p>
                    Drop-off: <span className="font-mono font-medium">{(step.drop_off * 100).toFixed(1)}%</span>
                    <span className="text-gray-400 dark:text-gray-600"> (zone avg: {(step.zone_baseline * 100).toFixed(1)}%)</span>
                  </p>
                  <p>
                    {((step.drop_off / Math.max(step.zone_baseline, 0.01) - 1) * 100).toFixed(0)}% worse than {step.zone} zone average
                  </p>
                  <p className="text-gray-400 dark:text-gray-600">
                    {step.sessions_exiting.toLocaleString()} of {step.sessions_at_step.toLocaleString()} sessions exit here
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Behavioral patterns */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <h2 className="text-base font-medium mb-1">Detected friction patterns</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Behavioral signatures detected from journey sequences. These are pattern classifications, not causal diagnoses.
        </p>

        <div className="space-y-3">
          {patterns_detected.map((pattern, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <span className="text-lg mt-0.5">
                {PATTERN_ICONS[pattern.type] || '⚠️'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium capitalize">
                    {pattern.type.replace(/_/g, ' ')}
                  </h3>
                  <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">
                    {pattern.sessions_affected.toLocaleString()} sessions ({pattern.pct_of_total}%)
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {pattern.description}
                </p>
                <div className="flex items-center gap-4 mt-2">
                  <span className="text-xs">
                    Conversion rate:{' '}
                    <span
                      className={`font-mono font-medium ${
                        pattern.conversion_rate > 0.02
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : pattern.conversion_rate > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-500 dark:text-red-400'
                      }`}
                    >
                      {(pattern.conversion_rate * 100).toFixed(1)}%
                    </span>
                  </span>
                  {/* Impact bar */}
                  <div className="flex-1 max-w-32">
                    <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400 dark:bg-red-500 rounded-full transition-all"
                        style={{ width: `${Math.min(pattern.pct_of_total * 3, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
