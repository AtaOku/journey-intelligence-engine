// ============================================================
// Journey Intelligence Engine — Shared Data Types
// ============================================================
// This is the contract between:
//   - Python analysis pipeline (produces JSON)
//   - React app (consumes JSON)
//   - TypeScript engine (produces same shape from uploaded CSV)
// ============================================================

// --- Metadata ---
export interface Metadata {
  total_sessions: number;
  converting_sessions: number;
  conversion_rate: number;
  avg_events_per_session: number;
  avg_session_value: number;
  data_source: 'rees46' | 'synthetic_showcase' | 'user_upload';
  generated_at: string;
  n_friction_points: number;
  top_friction_step: string | null;
}

// --- Sankey ---
export interface SankeyNode {
  id: number;
  name: string;
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
  drop_off_rate: number;
  anomaly_score: number;
  zone: FunnelZone;
  friction_level: FrictionLevel;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

// --- Patterns ---
export interface JourneyPattern {
  path: string[];
  path_string: string;
  count: number;
  support: number;
  conversion_rate: number;
  avg_events: number;
}

export interface PatternData {
  all: JourneyPattern[];
  converting: JourneyPattern[];
  non_converting: JourneyPattern[];
  unique_to_converting: JourneyPattern[];
  unique_to_non_converting: JourneyPattern[];
}

// --- Friction ---
export type FunnelZone = 'navigation' | 'engagement' | 'commitment' | 'unknown';
export type FrictionLevel = 'high' | 'medium' | 'normal';

export interface FrictionScore {
  step: string;
  drop_off: number;
  zone: FunnelZone;
  zone_baseline: number;
  z_score: number;
  friction_level: FrictionLevel;
  sessions_at_step: number;
  sessions_exiting: number;
}

export interface FrictionPattern {
  type: string;
  description: string;
  sessions_affected: number;
  pct_of_total: number;
  conversion_rate: number;
}

export interface FrictionData {
  scores: FrictionScore[];
  patterns_detected: FrictionPattern[];
}

// --- Transition Matrix ---
export type TransitionMatrix = Record<string, Record<string, number>>;

export interface TransitionMatrices {
  all: TransitionMatrix;
  converting: TransitionMatrix;
  non_converting: TransitionMatrix;
}

// --- Complete Showcase Data (what showcase_data.json contains) ---
export interface ShowcaseData {
  metadata: Metadata;
  sankey: SankeyData;
  patterns: PatternData;
  friction: FrictionData;
  transition_matrix: TransitionMatrices;
}

// --- Data Source Interface (abstraction for showcase vs upload vs API) ---
export interface JourneyDataSource {
  getMetadata(): Promise<Metadata>;
  getSankeyData(): Promise<SankeyData>;
  getPatterns(): Promise<PatternData | null>;  // null if not available (upload mode)
  getFrictionData(): Promise<FrictionData>;
  getTransitionMatrices(): Promise<TransitionMatrices>;
}
