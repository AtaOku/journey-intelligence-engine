import React from 'react';
import type { Metadata, FrictionData } from '../api/types';

interface Props {
  metadata: Metadata;
  friction: FrictionData;
}

export function SummaryStats({ metadata, friction }: Props) {
  const frictionPoints = friction.scores.filter(
    (s) => s.friction_level === 'high' || s.friction_level === 'medium'
  );

  const topFriction = friction.scores[0];
  const topPattern = friction.patterns_detected[0];

  // Business impact estimation
  // If top friction point's drop-off were reduced to zone baseline:
  // rescued sessions × downstream CR × AOV × 12 months
  const downstreamCR = metadata.conversion_rate; // simplified
  const aov = metadata.avg_session_value > 0 ? metadata.avg_session_value / metadata.avg_events_per_session : 65; // rough AOV estimate
  const rescuedSessions = topFriction
    ? Math.round(topFriction.sessions_at_step * (topFriction.drop_off - topFriction.zone_baseline))
    : 0;
  const monthlyImpact = Math.round(rescuedSessions * downstreamCR * aov);
  const annualImpact = monthlyImpact * 12;

  const percentWorse = topFriction && topFriction.zone_baseline > 0
    ? Math.round(((topFriction.drop_off / topFriction.zone_baseline) - 1) * 100)
    : 0;

  return (
    <div className="space-y-3">
      {/* Main metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Journeys analyzed"
          value={metadata.total_sessions.toLocaleString()}
          detail={`${metadata.converting_sessions.toLocaleString()} converted (${(metadata.conversion_rate * 100).toFixed(1)}%)`}
        />
        <MetricCard
          label="Avg journey length"
          value={`${metadata.avg_events_per_session} steps`}
          detail={`${metadata.data_source === 'user_upload' ? 'Your data' : 'Showcase data'}`}
        />
        <MetricCard
          label="Friction points detected"
          value={String(frictionPoints.length)}
          detail={
            topFriction
              ? `Worst: ${topFriction.step.replace(/_/g, ' ')} (${percentWorse}% worse than avg)`
              : 'No anomalies found'
          }
          variant={frictionPoints.length > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          label="Estimated opportunity"
          value={annualImpact > 0 ? `€${(annualImpact / 1000).toFixed(0)}K/yr` : '—'}
          detail={
            annualImpact > 0
              ? `If top friction point fixed to zone avg`
              : 'No significant friction detected'
          }
          variant={annualImpact > 1000 ? 'highlight' : 'default'}
        />
      </div>

      {/* Top insight callout */}
      {topPattern && topPattern.sessions_affected > 50 && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-4 py-3 flex items-start gap-3">
          <span className="text-indigo-500 dark:text-indigo-400 text-lg mt-0.5">
            &#x26A0;&#xFE0F;
          </span>
          <div>
            <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
              Top friction pattern: {topPattern.type.replace(/_/g, ' ')}
            </p>
            <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-0.5">
              {topPattern.sessions_affected.toLocaleString()} sessions ({topPattern.pct_of_total}% of all journeys)
              {topPattern.conversion_rate > 0
                ? ` · ${(topPattern.conversion_rate * 100).toFixed(1)}% convert (vs ${(metadata.conversion_rate * 100).toFixed(1)}% overall)`
                : ` · 0% conversion rate`
              }
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MetricCard ──

function MetricCard({
  label,
  value,
  detail,
  variant = 'default',
}: {
  label: string;
  value: string;
  detail: string;
  variant?: 'default' | 'warning' | 'highlight';
}) {
  const borderColor = {
    default: 'border-gray-200 dark:border-gray-800',
    warning: 'border-amber-300 dark:border-amber-700',
    highlight: 'border-emerald-300 dark:border-emerald-700',
  }[variant];

  const bgColor = {
    default: 'bg-white dark:bg-gray-900',
    warning: 'bg-amber-50 dark:bg-amber-950/20',
    highlight: 'bg-emerald-50 dark:bg-emerald-950/20',
  }[variant];

  return (
    <div className={`rounded-xl border p-4 ${borderColor} ${bgColor}`}>
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-2xl font-bold mt-1.5 tracking-tight">{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{detail}</p>
    </div>
  );
}
