import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey';
import type { SankeyData, FrictionData, FrictionLevel, FrictionScore } from '../api/types';
import { getStepLabel, getZone, ZONE_COLORS, FRICTION_COLORS } from '../config/zoneClassification';

interface Props {
  data: SankeyData;
  friction: FrictionData;
}

interface LinkTooltip {
  type: 'link';
  x: number;
  y: number;
  source: string;
  target: string;
  sessions: number;
  dropOff: number;
  zoneBaseline: number;
  percentWorse: number;
  frictionLevel: FrictionLevel;
  zone: string;
}

interface NodeTooltip {
  type: 'node';
  x: number;
  y: number;
  name: string;
  totalSessions: number;
  exitRate: number;
  zone: string;
  frictionLevel: FrictionLevel;
}

type TooltipState = (LinkTooltip | NodeTooltip) & { visible: boolean } | { visible: false };

function buildFrictionMap(friction: FrictionData): Map<string, FrictionScore> {
  const map = new Map<string, FrictionScore>();
  for (const score of friction.scores) {
    map.set(score.step, score);
  }
  return map;
}

export function SankeyCanvas({ data, friction }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [showFriction, setShowFriction] = useState(true);
  const showFrictionRef = useRef(showFriction);
  showFrictionRef.current = showFriction;
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false });

  const frictionMap = useMemo(() => buildFrictionMap(friction), [friction]);

  const WIDTH = 1600;
  const HEIGHT = 700;
  const MARGIN = { top: 24, right: 140, bottom: 24, left: 24 };

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // ── Layout ──
    // Define funnel stage order — links going backward are dropped
    // to prevent circular references that crash d3-sankey.
    const STAGE_ORDER: Record<string, number> = {
      homepage: 0, landing: 0,
      search: 1, category: 1,
      view: 2, size_guide: 2, review: 2, wishlist: 2,
      add_to_cart: 3,
      checkout: 4,
      purchase: 5,
    };

    const nodeMap = new Map(data.nodes.map((n) => [n.id, n.name]));

    const sankeyNodes = data.nodes.map((n) => ({ ...n }));
    const filteredLinks = data.links
      .filter((l) => {
        if (l.value <= 0 || l.source === l.target) return false;
        const srcStage = STAGE_ORDER[nodeMap.get(l.source) ?? ''] ?? -1;
        const tgtStage = STAGE_ORDER[nodeMap.get(l.target) ?? ''] ?? -1;
        return tgtStage > srcStage || (tgtStage === srcStage && l.target > l.source);
      });

    // Cap at top 50 links by volume for performance + readability.
    // For showcase data (~15 links) this is a no-op; for large uploads it prevents
    // 200+ gradient definitions and unreadable spaghetti.
    const MAX_LINKS = 50;
    const sankeyLinks = filteredLinks
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_LINKS)
      .map((l) => ({ ...l }));

    const sankeyGen = sankey<any, any>()
      .nodeId((d: any) => d.id)
      .nodeWidth(20)
      .nodePadding(16)
      .nodeAlign(sankeyLeft)
      .extent([
        [MARGIN.left, MARGIN.top],
        [WIDTH - MARGIN.right, HEIGHT - MARGIN.bottom],
      ]);

    const graph = sankeyGen({ nodes: sankeyNodes, links: sankeyLinks });

    // ── Defs: gradients for links ──
    const defs = svg.append('defs');

    graph.links.forEach((link: any, i: number) => {
      const sourceZone = getZone(link.source.name);
      const targetZone = getZone(link.target.name);
      const sourceColor = ZONE_COLORS[sourceZone] || ZONE_COLORS.unknown;
      const targetColor = ZONE_COLORS[targetZone] || ZONE_COLORS.unknown;

      const gradient = defs
        .append('linearGradient')
        .attr('id', `link-grad-${i}`)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', link.source.x1)
        .attr('x2', link.target.x0);

      gradient.append('stop').attr('offset', '0%').attr('stop-color', sourceColor).attr('stop-opacity', 0.5);
      gradient.append('stop').attr('offset', '100%').attr('stop-color', targetColor).attr('stop-opacity', 0.5);
    });

    // ── Links ──
    const linkGroup = svg.append('g').attr('class', 'links').attr('fill', 'none');

    const linkPaths = linkGroup
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', (d: any, i: number) => {
        if (showFriction) {
          const level = d.friction_level || 'normal';
          if (level !== 'normal') return FRICTION_COLORS[level];
        }
        return `url(#link-grad-${i})`;
      })
      .attr('stroke-width', (d: any) => Math.max(2, d.width))
      .attr('stroke-opacity', (d: any) => {
        if (showFriction) {
          const level = d.friction_level || 'normal';
          if (level === 'high') return 0.75;
          if (level === 'medium') return 0.55;
        }
        return 0.35;
      })
      .style('cursor', 'pointer')
      .style('mix-blend-mode', 'multiply');

    // ── Link entrance animation ──
    linkPaths.each(function (this: any) {
      const el = this as SVGPathElement;
      const len = el.getTotalLength();
      d3.select(el)
        .attr('stroke-dasharray', `${len} ${len}`)
        .attr('stroke-dashoffset', len);
    });

    linkPaths
      .transition()
      .duration(800)
      .delay((_: any, i: number) => i * 15)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // ── Link hover ──
    linkPaths
      .on('mouseenter', function (event: MouseEvent, d: any) {
        const src = d.source?.name ?? '?';
        const tgt = d.target?.name ?? '?';
        const frictionScore = frictionMap.get(src);
        const baseline = frictionScore?.zone_baseline ?? 0;
        const dropOff = d.drop_off_rate || 0;
        const percentWorse = baseline > 0 ? ((dropOff / baseline) - 1) * 100 : 0;

        setTooltip({
          visible: true,
          type: 'link',
          x: event.clientX,
          y: event.clientY,
          source: getStepLabel(src),
          target: getStepLabel(tgt),
          sessions: d.value,
          dropOff,
          zoneBaseline: baseline,
          percentWorse: Math.round(percentWorse),
          frictionLevel: d.friction_level || 'normal',
          zone: frictionScore?.zone || 'unknown',
        });

        // Highlight this link
        d3.select(this)
          .raise()
          .transition()
          .duration(150)
          .attr('stroke-opacity', 0.9)
          .attr('stroke-width', Math.max(4, (d.width || 2) + 3));

        // Dim others
        const currentPath = this;
        linkPaths
          .filter(function (_: any, j: number, nodes: any) { return nodes[j] !== currentPath; })
          .transition()
          .duration(150)
          .attr('stroke-opacity', 0.08);
      })
      .on('mousemove', (event: MouseEvent) => {
        setTooltip((prev) => prev.visible ? { ...prev, x: event.clientX, y: event.clientY } as any : prev);
      })
      .on('mouseleave', function (_: MouseEvent, d: any) {
        setTooltip({ visible: false });

        // Restore all links
        linkPaths
          .transition()
          .duration(300)
          .attr('stroke-opacity', (dd: any) => {
            if (showFrictionRef.current) {
              const level = dd.friction_level || 'normal';
              if (level === 'high') return 0.75;
              if (level === 'medium') return 0.55;
            }
            return 0.35;
          })
          .attr('stroke-width', (dd: any) => Math.max(2, dd.width));
      });

    // ── Nodes ──
    const nodeGroup = svg.append('g').attr('class', 'nodes');

    const nodeRects = nodeGroup
      .selectAll('rect')
      .data(graph.nodes)
      .join('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('height', (d: any) => Math.max(6, d.y1 - d.y0))
      .attr('rx', 4)
      .attr('fill', (d: any) => {
        const zone = getZone(d.name);
        return ZONE_COLORS[zone] || ZONE_COLORS.unknown;
      })
      .attr('stroke', (d: any) => {
        const zone = getZone(d.name);
        return d3.color(ZONE_COLORS[zone] || ZONE_COLORS.unknown)?.darker(0.5)?.toString() || '#666';
      })
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer');

    // ── Node entrance animation ──
    nodeRects
      .attr('opacity', 0)
      .transition()
      .duration(500)
      .delay((_: any, i: number) => 200 + i * 50)
      .attr('opacity', 1);

    // ── Node hover — cascade highlight ──
    nodeRects
      .on('mouseenter', function (event: MouseEvent, d: any) {
        const nodeName = d.name;
        const frictionScore = frictionMap.get(nodeName);

        setTooltip({
          visible: true,
          type: 'node',
          x: event.clientX,
          y: event.clientY,
          name: getStepLabel(nodeName),
          totalSessions: d.value || 0,
          exitRate: frictionScore?.drop_off ?? 0,
          zone: frictionScore?.zone || getZone(nodeName),
          frictionLevel: frictionScore?.friction_level || 'normal',
        });

        setHighlightedNode(nodeName);

        // Highlight connected links
        linkPaths
          .transition()
          .duration(150)
          .attr('stroke-opacity', (l: any) => {
            const connected = l.source.name === nodeName || l.target.name === nodeName;
            return connected ? 0.85 : 0.05;
          });

        // Highlight connected nodes
        nodeRects
          .transition()
          .duration(150)
          .attr('opacity', (n: any) => {
            if (n.name === nodeName) return 1;
            const connected = graph.links.some(
              (l: any) =>
                (l.source.name === nodeName && l.target.name === n.name) ||
                (l.target.name === nodeName && l.source.name === n.name)
            );
            return connected ? 1 : 0.2;
          });
      })
      .on('mousemove', (event: MouseEvent) => {
        setTooltip((prev) => prev.visible ? { ...prev, x: event.clientX, y: event.clientY } as any : prev);
      })
      .on('mouseleave', function () {
        setTooltip({ visible: false });
        setHighlightedNode(null);

        linkPaths
          .transition()
          .duration(300)
          .attr('stroke-opacity', (d: any) => {
            if (showFrictionRef.current) {
              const level = d.friction_level || 'normal';
              if (level === 'high') return 0.75;
              if (level === 'medium') return 0.55;
            }
            return 0.35;
          });

        nodeRects.transition().duration(300).attr('opacity', 1);
      });

    // ── Node labels (two lines: name + count) ──
    const labelGroup = svg.append('g').attr('class', 'labels');

    graph.nodes.forEach((d: any) => {
      const isLeft = d.x0 < WIDTH / 2;
      const x = isLeft ? d.x1 + 10 : d.x0 - 10;
      const anchor = isLeft ? 'start' : 'end';
      const y = (d.y0 + d.y1) / 2;

      // Step name
      labelGroup
        .append('text')
        .attr('x', x)
        .attr('y', y - 6)
        .attr('dy', '0.35em')
        .attr('text-anchor', anchor)
        .attr('font-size', '11px')
        .attr('font-weight', '500')
        .attr('font-family', 'system-ui, -apple-system, sans-serif')
        .attr('fill', 'currentColor')
        .attr('class', 'text-gray-800 dark:text-gray-200')
        .text(getStepLabel(d.name));

      // Session count
      labelGroup
        .append('text')
        .attr('x', x)
        .attr('y', y + 8)
        .attr('dy', '0.35em')
        .attr('text-anchor', anchor)
        .attr('font-size', '10px')
        .attr('font-family', 'system-ui, -apple-system, sans-serif')
        .attr('fill', 'currentColor')
        .attr('class', 'text-gray-400 dark:text-gray-500')
        .text(`${(d.value || 0).toLocaleString()} sessions`);
    });

    // ── Labels entrance ──
    labelGroup.selectAll('text')
      .attr('opacity', 0)
      .transition()
      .duration(400)
      .delay(600)
      .attr('opacity', 1);

  }, [data, friction, frictionMap]);

  // ── Style-only effect: update link colors when friction toggle changes ──
  // Avoids full D3 layout recomputation + DOM rebuild on toggle
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('.links path').each(function (d: any, i: number) {
      const level = d.friction_level || 'normal';
      d3.select(this)
        .attr('stroke', () => {
          if (showFriction && level !== 'normal') return FRICTION_COLORS[level];
          return `url(#link-grad-${i})`;
        })
        .attr('stroke-opacity', () => {
          if (showFriction) {
            if (level === 'high') return 0.75;
            if (level === 'medium') return 0.55;
          }
          return 0.35;
        });
    });
  }, [showFriction]);

  // ── Render ──
  return (
    <div className="relative">
      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">Journey flow</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Hover a node to highlight its connections. Link width = session volume.
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-500 dark:text-gray-400 select-none">
          <div className="relative">
            <input
              type="checkbox"
              checked={showFriction}
              onChange={(e) => setShowFriction(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 peer-checked:bg-red-500 rounded-full transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
          </div>
          Friction overlay
        </label>
      </div>

      {/* SVG */}
      <div className="overflow-x-auto -mx-2 px-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          style={{ minWidth: 1000 }}
        />
      </div>

      {/* Tooltip */}
      {tooltip.visible && 'type' in tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900/95 dark:bg-gray-100/95 backdrop-blur-sm text-white dark:text-gray-900 text-xs rounded-xl px-4 py-3 shadow-2xl max-w-xs border border-gray-700 dark:border-gray-300"
          style={{
            left: Math.min(tooltip.x + 16, window.innerWidth - 280),
            top: tooltip.y - 10,
          }}
        >
          {tooltip.type === 'link' && (
            <>
              <p className="font-semibold text-sm">
                {tooltip.source} → {tooltip.target}
              </p>
              <div className="mt-2 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">Sessions</span>
                  <span className="font-mono font-medium">{tooltip.sessions.toLocaleString()}</span>
                </div>
                {tooltip.dropOff > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-400 dark:text-gray-500">Exit rate at source</span>
                      <span className="font-mono font-medium">{(tooltip.dropOff * 100).toFixed(1)}%</span>
                    </div>
                    {tooltip.zoneBaseline > 0 && tooltip.percentWorse > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-400 dark:text-gray-500">vs zone avg</span>
                        <span className={`font-mono font-medium ${
                          tooltip.percentWorse > 30 ? 'text-red-400 dark:text-red-600' :
                          tooltip.percentWorse > 10 ? 'text-amber-400 dark:text-amber-600' :
                          'text-gray-300 dark:text-gray-600'
                        }`}>
                          {tooltip.percentWorse > 0 ? '+' : ''}{tooltip.percentWorse}% worse
                        </span>
                      </div>
                    )}
                  </>
                )}
                <div className="pt-1 border-t border-gray-700 dark:border-gray-300 flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: FRICTION_COLORS[tooltip.frictionLevel] }}
                  />
                  <span className="capitalize">{tooltip.frictionLevel} friction</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-auto">{tooltip.zone} zone</span>
                </div>
              </div>
            </>
          )}
          {tooltip.type === 'node' && (
            <>
              <p className="font-semibold text-sm">{tooltip.name}</p>
              <div className="mt-2 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">Total sessions</span>
                  <span className="font-mono font-medium">{tooltip.totalSessions.toLocaleString()}</span>
                </div>
                {tooltip.exitRate > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 dark:text-gray-500">Exit rate</span>
                    <span className="font-mono font-medium">{(tooltip.exitRate * 100).toFixed(1)}%</span>
                  </div>
                )}
                <div className="pt-1 border-t border-gray-700 dark:border-gray-300 flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: FRICTION_COLORS[tooltip.frictionLevel] }}
                  />
                  <span className="capitalize">{tooltip.zone} zone</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 mt-4 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
        <span className="font-medium text-gray-600 dark:text-gray-300">Zones:</span>
        {(['navigation', 'engagement', 'commitment'] as const).map((zone) => (
          <span key={zone} className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded"
              style={{ backgroundColor: ZONE_COLORS[zone] }}
            />
            <span className="capitalize">{zone}</span>
          </span>
        ))}
        <span className="w-px h-3 bg-gray-300 dark:bg-gray-700" />
        <span className="font-medium text-gray-600 dark:text-gray-300">Friction:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-1.5 rounded-full bg-red-500" /> High
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-1.5 rounded-full bg-amber-500" /> Medium
        </span>
      </div>
    </div>
  );
}
