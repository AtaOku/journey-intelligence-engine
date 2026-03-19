# Journey Intelligence Engine

**Path-level e-commerce journey analysis with friction detection**

Upload any e-commerce clickstream CSV → automatic journey flow visualization, zone-relative anomaly scoring, and friction pattern detection. All computation runs client-side — your data never leaves the browser.

---

## The Problem

E-commerce teams see aggregate conversion rates but can't answer path-level questions: *Where exactly do users drop off? Is this drop-off rate abnormal for this funnel stage? Which behavioral patterns predict non-conversion?*

GA4 shows what happened. This tool shows where the friction is and why it matters.

## How It Works

**Zone-relative anomaly scoring:** Each step's drop-off rate is scored against its funnel zone peers (navigation, engagement, commitment), not the global average. A 40% bounce on the homepage is normal; a 40% exit at checkout is a five-alarm fire. The system uses z-scores within zones to surface genuinely anomalous friction points.

**Friction pattern detection:** Six behavioral signatures are detected from session sequences: search frustration loops, cart hesitation, bounce-back browsing, checkout abandonment, single-page exits, and deep-browse-no-action.

**Business impact estimation:** Top friction points are translated to projected annual revenue impact based on rescueable sessions × downstream conversion rate × AOV.

## Features

- **Sankey journey canvas** — D3-powered flow visualization with friction overlay toggle
- **Showcase mode** — 10K synthetic sessions with embedded friction points, instant demo
- **Upload mode** — Drop in a CSV (REES46, standard format), auto-detected
- **Pattern intelligence** — Converting vs non-converting path comparison
- **Zero backend** — All computation in TypeScript, client-side

## Architecture

```
engine/              Pure computation (no UI dependencies)
├── csvParser.ts         Format detection, column mapping, sessionization
├── anomalyScoring.ts    Zone-relative z-score friction scoring
├── frictionPatterns.ts  Behavioral pattern detectors (6 signatures)
└── transitionMatrix.ts  Markov transition probabilities

api/                 Data source abstraction
├── types.ts             Shared contract (Python pipeline ↔ TS engine ↔ React)
├── staticDataSource.ts  Pre-generated showcase data
└── clientSideDataSource.ts  CSV → full analysis pipeline (browser)

config/              Domain knowledge
└── zoneClassification.ts  Zone taxonomy, step labels, colors

ui/                  React presentation layer
├── SankeyCanvas.tsx     D3 Sankey + friction overlay + interactive tooltips
├── SummaryStats.tsx     Hero metrics + €-impact estimation
├── FrictionCards.tsx    Anomaly step cards + behavioral pattern list
├── PatternTable.tsx     Journey pattern comparison table
└── DataToggle.tsx       Showcase / upload mode switcher
```

## Tech Stack

React 19 · TypeScript · D3 + d3-sankey · Tailwind CSS v4 · Vite 8 · Vercel

## Running Locally

```bash
npm install
npm run dev
```

To regenerate showcase data (requires Python 3.8+):

```bash
pip install pandas numpy
python analysis_pipeline.py --source synthetic --sessions 10000 --output public/showcase_data.json
```

## Methodology

**Anomaly scoring:** Drop-off rates are computed per step, then z-scored within their funnel zone (navigation, engagement, commitment). This prevents comparing homepage bounce rates against checkout abandonment — they operate in fundamentally different contexts. Steps scoring z > 2.0 are flagged as high friction; z > 1.5 as medium.

**Friction patterns:** Six heuristic detectors scan session event sequences for known behavioral signatures. Each pattern reports affected session count, percentage of total, and the conversion rate of sessions matching that pattern versus overall.

**Showcase data:** 10,000 synthetic sessions generated from probabilistic journey templates with deliberate friction points embedded. Distributions calibrated against Baymard Institute benchmarks and Contentsquare 2024 Digital Experience data.

## Part of the MarTech × AI Portfolio

| # | Project | AI Technique | Status |
|---|---------|-------------|--------|
| 1 | [ContentEngine AI](https://contentengine-v6.vercel.app) | LLM batch pipeline | ✅ Live |
| 2 | [CSP Campaign Planner](https://csp-campaign-planner.streamlit.app) | Constraint satisfaction | ✅ Live |
| 3 | [Bayesian Return Diagnosis](https://bayesian-marketing-attribution-model.streamlit.app) | Bayesian Networks | ✅ Live |
| 4 | [Competitor Intel Monitor](https://competitor-intel-monitor.netlify.app) | NLP + sentiment | ✅ Live |
| 5 | **Journey Intelligence Engine** | Markov chains + anomaly scoring | ← You are here |
| 6 | MDP Optimal Contact Policy | Markov Decision Process | Planned |
| 7 | Logic Compliance Engine | Propositional/FOL logic | Planned |

---

*Built by Ata Okuzcuoglu · TUM MSc Management & Technology · 2026*
