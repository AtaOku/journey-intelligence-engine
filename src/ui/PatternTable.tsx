import React, { useState } from 'react';
import type { PatternData, JourneyPattern } from '../api/types';
import { getStepLabel } from '../config/zoneClassification';

interface Props {
  patterns: PatternData;
}

type PatternView = 'all' | 'converting' | 'non_converting' | 'unique_to_converting' | 'unique_to_non_converting';

const VIEW_LABELS: Record<PatternView, string> = {
  all: 'All paths',
  converting: 'Converting',
  non_converting: 'Non-converting',
  unique_to_converting: 'Only in converting',
  unique_to_non_converting: 'Only in non-converting',
};

function PathDisplay({ path }: { path: string[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {path.map((step, i) => (
        <React.Fragment key={i}>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 whitespace-nowrap">
            {getStepLabel(step)}
          </span>
          {i < path.length - 1 && (
            <span className="text-gray-400 dark:text-gray-600 text-[10px]">→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export function PatternTable({ patterns }: Props) {
  const [view, setView] = useState<PatternView>('all');

  const currentPatterns = patterns[view] ?? [];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-base font-medium">Journey patterns</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Top paths ranked by frequency. Compare converting vs non-converting journeys.
        </p>

        {/* View selector */}
        <div className="flex gap-1 mt-3 flex-wrap">
          {(Object.keys(VIEW_LABELS) as PatternView[]).map((key) => {
            const count = (patterns[key] ?? []).length;
            if (count === 0 && key.startsWith('unique')) return null;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  view === key
                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {VIEW_LABELS[key]} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
              <th className="px-4 py-2 font-medium text-xs text-gray-500 dark:text-gray-400 w-12">#</th>
              <th className="px-4 py-2 font-medium text-xs text-gray-500 dark:text-gray-400">Path</th>
              <th className="px-4 py-2 font-medium text-xs text-gray-500 dark:text-gray-400 text-right">Sessions</th>
              <th className="px-4 py-2 font-medium text-xs text-gray-500 dark:text-gray-400 text-right">Support</th>
              <th className="px-4 py-2 font-medium text-xs text-gray-500 dark:text-gray-400 text-right">Conv. rate</th>
              <th className="px-4 py-2 font-medium text-xs text-gray-500 dark:text-gray-400 text-right">Avg steps</th>
            </tr>
          </thead>
          <tbody>
            {currentPatterns.map((pattern, i) => (
              <tr
                key={i}
                className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                <td className="px-4 py-3">
                  <PathDisplay path={pattern.path} />
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {pattern.count.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {(pattern.support * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`font-mono text-xs font-medium ${
                      pattern.conversion_rate > 0.05
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : pattern.conversion_rate > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-gray-400 dark:text-gray-600'
                    }`}
                  >
                    {(pattern.conversion_rate * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {pattern.avg_events}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {currentPatterns.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-600">
          No patterns found for this view.
        </div>
      )}
    </div>
  );
}
