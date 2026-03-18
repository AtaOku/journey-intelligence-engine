import type { FunnelZone } from '../api/types';

/**
 * Step-type zone classification for anomaly scoring.
 * 
 * Each step belongs to one of three funnel zones.
 * Anomaly scores are computed within zones, not globally.
 * This prevents comparing homepage bounce (normal in navigation)
 * with checkout abandonment (critical in commitment).
 */
export const ZONE_DEFINITIONS: Record<FunnelZone, string[]> = {
  navigation: ['homepage', 'landing', 'category', 'search'],
  engagement: ['view', 'pdp', 'review', 'size_guide', 'filter', 'wishlist', 'compare'],
  commitment: ['add_to_cart', 'cart', 'cart_edit', 'checkout', 'payment', 'purchase'],
  unknown: [],
};

/**
 * Classify a step into its funnel zone.
 * Matches against zone keyword substrings.
 */
export function getZone(step: string): FunnelZone {
  const s = step.toLowerCase();
  for (const [zone, keywords] of Object.entries(ZONE_DEFINITIONS)) {
    if (zone === 'unknown') continue;
    if (keywords.some((k) => s.includes(k))) {
      return zone as FunnelZone;
    }
  }
  return 'navigation'; // default for unknown steps
}

/**
 * Step display names for the UI.
 * Maps internal step names to human-readable labels.
 */
export const STEP_LABELS: Record<string, string> = {
  homepage: 'Homepage',
  landing: 'Landing page',
  category: 'Category browse',
  search: 'Search',
  view: 'Product view',
  pdp: 'Product detail',
  review: 'Read reviews',
  size_guide: 'Size guide',
  filter: 'Apply filter',
  wishlist: 'Add to wishlist',
  compare: 'Compare products',
  add_to_cart: 'Add to cart',
  cart: 'View cart',
  cart_edit: 'Edit cart',
  checkout: 'Checkout',
  payment: 'Payment',
  purchase: 'Purchase',
};

export function getStepLabel(step: string): string {
  return STEP_LABELS[step] ?? step.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Zone colors for the Sankey visualization.
 * Maps zones to color classes.
 */
export const ZONE_COLORS: Record<FunnelZone, string> = {
  navigation: '#6366f1',   // indigo
  engagement: '#8b5cf6',   // violet  
  commitment: '#10b981',   // emerald
  unknown: '#6b7280',      // gray
};

/**
 * Friction level colors for overlay.
 */
export const FRICTION_COLORS: Record<string, string> = {
  high: '#ef4444',    // red
  medium: '#f59e0b',  // amber
  normal: '#6b7280',  // gray (default link color)
};
