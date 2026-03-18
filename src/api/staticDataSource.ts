import type {
  JourneyDataSource,
  Metadata,
  SankeyData,
  PatternData,
  FrictionData,
  TransitionMatrices,
  ShowcaseData,
} from './types';

/**
 * StaticDataSource — reads from pre-computed showcase_data.json
 * Used in showcase mode. Full analysis including pattern mining.
 */
export class StaticDataSource implements JourneyDataSource {
  private data: ShowcaseData | null = null;
  private loading: Promise<ShowcaseData> | null = null;

  private async load(): Promise<ShowcaseData> {
    if (this.data) return this.data;
    if (this.loading) return this.loading;

    this.loading = fetch('/showcase_data.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load showcase data: ${res.status}`);
        return res.json();
      })
      .then((json: ShowcaseData) => {
        this.data = json;
        return json;
      });

    return this.loading;
  }

  async getMetadata(): Promise<Metadata> {
    const data = await this.load();
    return data.metadata;
  }

  async getSankeyData(): Promise<SankeyData> {
    const data = await this.load();
    return data.sankey;
  }

  async getPatterns(): Promise<PatternData> {
    const data = await this.load();
    return data.patterns;
  }

  async getFrictionData(): Promise<FrictionData> {
    const data = await this.load();
    return data.friction;
  }

  async getTransitionMatrices(): Promise<TransitionMatrices> {
    const data = await this.load();
    return data.transition_matrix;
  }
}
