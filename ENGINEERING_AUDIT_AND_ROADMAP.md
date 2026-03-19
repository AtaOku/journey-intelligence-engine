# Journey Intelligence Engine — Engineering Audit & Roadmap

**Audit date:** March 19, 2026  
**Codebase version:** v1.0.0 (current `main`)  
**Reviewed by:** Ata Okuzcuoglu  
**Perspectives:** Software Engineering, Knowledge Engineering, Computer Engineering, Data Engineering

---

## Executive Summary

JIE is a client-side e-commerce journey analysis tool: CSV upload → sessionization → Sankey visualization + friction scoring. The architecture is clean (modular `engine/`, `api/`, `ui/`, `config/` separation, proper DataSource interface abstraction). The core anomaly scoring concept — zone-relative z-scores — is statistically sound. However, 12 concrete issues were identified across 4 engineering perspectives, ranging from a wrong README (critical, immediate fix) to statistical corrections and scalability gaps.

**Current strengths:**
- Modular architecture: `JourneyDataSource` interface cleanly separates showcase vs upload data
- D3 ↔ React lifecycle handled correctly (D3 computes layout in `useEffect`, React owns tooltip state)
- Zone-relative anomaly scoring: comparing drop-off rates *within* funnel zones, not globally
- Auto-format detection for uploaded CSVs (REES46 + standard format)
- Pre-aggregated showcase data for instant demo (no API key needed)

**Priority issues (by severity):**
1. README.md contains Bayesian Return Diagnosis content — wrong project entirely
2. Statistical errors in z-score computation (population vs sample variance, arbitrary min variance)
3. Showcase data produces only linear funnels — doesn't exercise the system's loop/backtrack capabilities
4. No file size guard on CSV upload — browser crash risk on large files
5. No Web Worker — CSV parsing blocks main thread

---

## 1. Software Engineering Perspective

### 1.1 Architecture — What's Good

The codebase follows the portfolio's modular architecture principle (`config/`, `engine/`, `ui/`, `api/`). Key design decisions are sound:

```
src/
├── api/           # Data source abstraction layer
│   ├── types.ts              # Shared contract (Python ↔ React ↔ TS engine)
│   ├── staticDataSource.ts   # Reads pre-generated showcase_data.json
│   └── clientSideDataSource.ts # Processes uploaded CSV via TS engine
├── config/        # Domain knowledge (zone classification, step labels, colors)
│   └── zoneClassification.ts
├── engine/        # Pure computation (no UI dependencies)
│   ├── csvParser.ts
│   ├── anomalyScoring.ts
│   ├── frictionPatterns.ts
│   └── transitionMatrix.ts
└── ui/            # React components (presentation only)
    ├── SankeyCanvas.tsx
    ├── SummaryStats.tsx
    ├── FrictionCards.tsx
    ├── PatternTable.tsx
    └── DataToggle.tsx
```

The `JourneyDataSource` interface (`types.ts:109-115`) is the right abstraction — both `StaticDataSource` and `ClientSideDataSource` implement it, making future sources (API, WebSocket) pluggable without touching UI code.

### 1.2 D3 ↔ React Lifecycle

The current approach in `SankeyCanvas.tsx`:
- D3 runs inside `useEffect` and owns the SVG DOM (`svg.selectAll('*').remove()` → full rebuild)
- React owns tooltip state via `useState`
- D3 event handlers call `setTooltip()` to bridge into React state

**Issue:** `svg.selectAll('*').remove()` on every render destroys and rebuilds the entire Sankey SVG. This works correctly but is wasteful — any change to `showFriction` toggle re-triggers the full D3 layout computation + DOM rebuild + link entrance animation.

**Fix:** Split the D3 effect into two:
1. Layout effect (runs only when `data` changes): compute `sankeyGen()`, create nodes/links
2. Style effect (runs when `showFriction` changes): update `stroke` and `stroke-opacity` on existing elements

### 1.3 README.md — Wrong Content (Critical)

The current `README.md` is a copy of the Bayesian Return Diagnosis project's README. It references "Fashion E-Commerce Return Root Cause Diagnosis", Streamlit, `app.py`, and "Project 2" in the portfolio. This is the first thing a recruiter sees on GitHub.

**Action:** Replace with JIE-specific README (see Section 6 below).

### 1.4 Duplicate showcase_data.json

`showcase_data.json` exists at both `/` (49KB) and `/public/` (31KB). The root copy is the `analysis_pipeline.py` output; the public copy is what the React app reads. They may diverge if regenerated.

**Action:** Delete root copy, keep only `public/showcase_data.json`. Add root to `.gitignore`. Update `generate_showcase.py` to write directly to `public/`.

---

## 2. Knowledge Engineering Perspective

### 2.1 Zone Classification — Sound Design, Edge Case Gap

The three-zone taxonomy (`navigation`, `engagement`, `commitment`) is the right granularity for e-commerce. The z-score approach — comparing each step's drop-off rate against its zone peers — correctly prevents comparing homepage bounce (normal in navigation) with checkout abandonment (critical in commitment).

**Issue:** The fallback in `getZone()` defaults unknown steps to `'navigation'`:

```typescript
// zoneClassification.ts:29
return 'navigation'; // default for unknown steps
```

This silently misclassifies any unrecognized step type. If a user uploads data with `event_type = "product_detail"` (not in the keyword list), it gets lumped into navigation and scored against homepage/landing/category/search baselines — producing meaningless z-scores.

**Fix:** Default to `'unknown'` zone. Score unknown-zone steps against their own peer group (other unknowns), or flag them in the UI as "unclassified" so the user knows the scoring may be unreliable. Add a diagnostic row in SummaryStats showing how many events fell into the unknown zone.

### 2.2 Statistical Errors in Anomaly Scoring

**Issue 1: Population vs sample variance.**

In `anomalyScoring.ts:69-71`:
```typescript
const variance =
  values.length > 1
    ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length  // ÷ n
    : 0.01;
```

This computes population variance (÷ n). For zone-level statistics where n is small (3-7 step types per zone), Bessel's correction (÷ n-1) is important. With n=3, population variance underestimates by 33%, which deflates the standard deviation and inflates z-scores — leading to more false-positive "high friction" flags.

**Fix:** Use `/ (values.length - 1)` for n > 1. The Python pipeline (`analysis_pipeline.py:568`) uses `np.std()` which defaults to population std (ddof=0) — fix both to `ddof=1` for consistency.

**Issue 2: Arbitrary minimum variance.**

When a zone has only one step type (or all step types have identical drop-off rates), variance is 0. The code uses `Math.max(Math.sqrt(variance), 0.01)` as a floor. This means any step with drop-off more than 0.02 above its zone mean gets z > 2.0 (flagged as high friction), regardless of whether the difference is practically meaningful.

**Fix:** Use a minimum standard deviation derived from the data, e.g. `Math.max(std, overall_std * 0.25)` where `overall_std` is the cross-zone pooled standard deviation. This anchors the floor to actual data variability rather than an arbitrary constant.

### 2.3 Showcase Data Quality

`generate_showcase.py` produces strictly linear funnel paths: entry → view → add_to_cart → checkout → purchase. No loops (view → category → view), no backtracking (add_to_cart → view → add_to_cart), no search frustration loops.

This means the showcase demo doesn't exercise several friction patterns:
- `bounce_back_browse` (requires category → view → category → view)
- `cart_hesitation` (requires add_to_cart → view)
- `search_frustration_loop` (requires 3+ search events)

The showcase data only triggers `single_page_exit` and `deep_browse_no_action` (from the multi-view branches added by random variation).

**Fix:** `generate_showcase.py` must include template paths with loops and backtracks. The `analysis_pipeline.py` synthetic generator (Section 3, line 235+) already does this correctly — it has `search_frustration_loop`, `cart_hesitation`, `bounce_back_browse` templates. Either:
- (a) Replace `generate_showcase.py` with `analysis_pipeline.py --source synthetic` output, or
- (b) Add the missing path templates to `generate_showcase.py`

Option (a) is cleaner — one source of truth for showcase data.

### 2.4 €-Impact Calculation

`SummaryStats.tsx:21-26` estimates annual revenue impact:
```typescript
const aov = metadata.avg_session_value > 0 
  ? metadata.avg_session_value / metadata.avg_events_per_session 
  : 65; // rough AOV estimate
```

This divides total session value by events-per-session, which gives price-per-event, not average order value. AOV should be: `total revenue / total converting sessions`. Also, the × 12 monthly extrapolation assumes showcase data represents exactly one month, which isn't documented.

**Fix:** Pass explicit AOV in metadata, or calculate as `sum(session.total_value for converted) / converting_sessions`. Document the time window assumption.

---

## 3. Computer Engineering Perspective

### 3.1 File Size Guard (Missing)

`DataToggle.tsx` calls `FileReader.readAsText(file)` on any CSV the user selects. No size check. A 500MB REES46 export would:
1. Allocate 500MB as a JavaScript string
2. `parseCSV()` allocates another ~500MB+ for row objects
3. Session processing adds another ~200MB for grouped data
4. Total: ~1.2GB+ → exceeds Chrome's heap limit → tab crash

**Fix:** Add a guard in `handleFileChange()`:

```typescript
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
if (file.size > MAX_FILE_SIZE) {
  setError(`File too large (${(file.size/1024/1024).toFixed(0)}MB). Maximum: 50MB. 
    Pre-aggregate your data or sample sessions before uploading.`);
  return;
}
```

Display the limit in the upload UI so users know before selecting a file.

### 3.2 Main Thread Blocking

CSV parse + session processing + anomaly scoring + Sankey build all run on the main thread (the `setTimeout(, 50)` in `App.tsx:68` yields once but doesn't help during processing). For 100K+ rows, the browser freezes for 5-30 seconds.

**Fix (staged):**
- **Phase 1 (quick):** Add a progress indicator that shows before processing starts, so users know the app hasn't crashed
- **Phase 2 (proper):** Move `processUploadedCSV()` + `computeAnomalyScores()` + `detectFrictionPatterns()` into a Web Worker. The `ClientSideDataSource.process()` method becomes async and posts messages to the worker.

### 3.3 Sankey SVG Performance

The Sankey uses `viewBox="0 0 1600 700"` with `minWidth: 1000px`. On mobile, this renders a 1600-unit-wide SVG into a ~375px viewport — every element is computed but most are offscreen during horizontal scroll. For showcase data (8 nodes, ~15 links), this is fine. For uploaded data with 20+ step types, the gradient `<defs>` section alone creates one `<linearGradient>` per link — potentially 200+ gradient definitions.

**Fix:** Cap Sankey display at top-N transitions (e.g. top 50 by volume). Group remaining into an "other" aggregate link. This is both a performance and readability improvement.

---

## 4. Data Engineering Perspective

### 4.1 REES46 Enrichment — Stochastic, Not Signal-Based

`analysis_pipeline.py:146-199` enriches REES46's 3 event types (view/cart/purchase) into 10+ types by randomly assigning:
- First view → homepage (55%) | category (25%) | search (20%)
- Category change → category (60%) | search (40%)
- 5+ views without cart → wishlist (50%) | size_guide (50%) at 15% probability

These enriched labels have no relationship to actual user behavior. A recruiter or data scientist reviewing the pipeline will immediately question: "How do you know the first view was a homepage visit?"

**Fix:** Two options:
- (a) **Honest enrichment:** Keep enrichment but document it explicitly as "inferred behavioral archetypes" with a disclaimer that these are probabilistic labels, not ground truth. Add a `data_quality: 'enriched_inferred'` flag to metadata.
- (b) **Raw-only mode:** For REES46, only use the 3 native event types. The Sankey and scoring still work — the zones just collapse to `engagement: [view]` and `commitment: [cart, purchase]`. Simpler but honest.

Recommendation: Option (a) for showcase (richer demo), option (b) for upload mode (don't invent labels for user data).

### 4.2 Category Granularity Loss

`csvParser.ts:172`:
```typescript
category: category.split('.')[0], // REES46: "electronics.smartphone" → "electronics"
```

This discards subcategory. For fashion e-commerce (the stated target), `clothing.shoes.sneakers` becomes just `clothing` — losing the signal that sneakers have different return patterns than dresses. This matters for the friction pattern descriptions ("price or size uncertainty" is very different for shoes vs accessories).

**Fix:** Keep at least 2 levels: `category.split('.').slice(0, 2).join('.')`. Make the depth configurable in the upload UI.

### 4.3 Missing Deduplication

No dedup check for identical events (same session_id + timestamp + event_type). REES46 data sometimes contains duplicate rows from logging artifacts. These inflate transition counts and distort drop-off rates.

**Fix:** Add dedup in `processUploadedCSV()` after parsing:
```typescript
// Dedup by session_id + timestamp + event_type
const seen = new Set<string>();
events = events.filter(e => {
  const key = `${e.session_id}|${e.timestamp}|${e.event_type}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

### 4.4 GA4 Format Not Supported

The CSV parser detects 'standard' and 'rees46' formats. GA4 BigQuery exports (the most common enterprise format) use different column names: `event_name` (not `event_type`), `ga_session_id`, `event_timestamp` (microseconds), `page_location`. Adding GA4 support makes the tool immediately useful for the target audience (performance marketers).

**Fix:** Add GA4 detection to `detectFormat()` and a mapping in `COLUMN_MAPS`:
```typescript
ga4: {
  session_id: 'ga_session_id',
  timestamp: 'event_timestamp',
  event_type: 'event_name',
  category: 'page_location',  // derive from URL path
  product_id: 'item_id',
  price: 'value',
}
```

---

## 5. Roadmap — Phased Implementation

### Phase 1: Foundation Fixes (1-2 days)

These are prerequisite for showing the project to anyone. No feature additions — just correctness.

| # | Task | Perspective | File(s) | Impact |
|---|------|-------------|---------|--------|
| 1.1 | Replace README.md with JIE content | SW | `README.md` | Critical — first thing recruiters see |
| 1.2 | Delete root `showcase_data.json`, keep only `public/` | SW | root, `.gitignore` | Clean repo |
| 1.3 | Fix variance to sample variance (n-1) in both TS + Python | KE | `anomalyScoring.ts`, `analysis_pipeline.py` | Statistical correctness |
| 1.4 | Fix min variance to data-derived floor | KE | `anomalyScoring.ts`, `analysis_pipeline.py` | Reduce false positives |
| 1.5 | Change unknown zone default from 'navigation' to 'unknown' | KE | `zoneClassification.ts` | Prevent silent misclassification |
| 1.6 | Fix AOV calculation in SummaryStats | KE | `SummaryStats.tsx` | Correct €-impact number |
| 1.7 | Add file size guard (50MB max) | CE | `DataToggle.tsx` | Prevent browser crash |
| 1.8 | Add dedup in CSV parser | DE | `csvParser.ts` | Data quality |

### Phase 2: Showcase Quality (2-3 days)

Make the demo actually impressive. This is what gets screenshot'd and shared.

| # | Task | Perspective | File(s) | Impact |
|---|------|-------------|---------|--------|
| 2.1 | Replace `generate_showcase.py` with `analysis_pipeline.py --source synthetic` | KE/DE | `generate_showcase.py`, `public/showcase_data.json` | Showcase exercises all friction patterns |
| 2.2 | Add loop/backtrack templates to synthetic generator | KE | `analysis_pipeline.py` | Richer, more realistic journeys |
| 2.3 | Add explicit REES46 enrichment disclaimer to README methodology | DE | `README.md` | Intellectual honesty |
| 2.4 | Keep 2-level category depth (clothing.shoes not just clothing) | DE | `csvParser.ts`, `analysis_pipeline.py` | Richer signals |
| 2.5 | Cap Sankey at top-50 transitions, group rest into "other" | CE/SW | `SankeyCanvas.tsx`, `clientSideDataSource.ts` | Readability + performance |
| 2.6 | Split D3 useEffect into layout + style effects | SW | `SankeyCanvas.tsx` | No full rebuild on toggle |

### Phase 3: Upload Mode Hardening (3-4 days)

Make upload mode actually production-worthy.

| # | Task | Perspective | File(s) | Impact |
|---|------|-------------|---------|--------|
| 3.1 | Add GA4 BigQuery format detection + column mapping | DE | `csvParser.ts` | Most common enterprise format |
| 3.2 | Move CSV processing to Web Worker | CE | new `worker/`, `clientSideDataSource.ts` | No UI freeze |
| 3.3 | Add processing progress indicator | SW | `App.tsx`, `DataToggle.tsx` | UX during heavy computation |
| 3.4 | Add data validation report (unknown events, missing columns, dupes found) | DE | new `engine/validation.ts`, `SummaryStats.tsx` | Trust in uploaded data quality |
| 3.5 | Add Shopify export format detection | DE | `csvParser.ts` | Second most common e-commerce format |

### Phase 4: Intelligence Layer (5+ days, post-launch priorities from memory)

| # | Task | Perspective | Notes |
|---|------|-------------|-------|
| 4.1 | €-impact business language throughout | KE | Every metric tied to revenue, not just z-scores |
| 4.2 | Sankey node filtering (click to drill down) | SW | Click a node → show only paths through it |
| 4.3 | Upload-mode pattern mining | KE/CE | Client-side frequent-path extraction |
| 4.4 | What-if simulator | KE | "If we fix checkout drop-off to zone avg, projected impact = X" |
| 4.5 | Methodology collapse (show/hide) | SW | Technical details visible on demand, not by default |

---

## 6. New README.md Template

```markdown
# Journey Intelligence Engine

**Path-level e-commerce journey analysis with friction detection**

Upload any e-commerce clickstream CSV → automatic journey flow visualization, 
zone-relative anomaly scoring, and friction pattern detection. 
All computation runs client-side — your data never leaves the browser.

## The Problem

E-commerce teams see aggregate conversion rates but can't answer path-level 
questions: Where exactly do users drop off? Is this drop-off rate abnormal 
for this funnel stage? Which behavioral patterns predict non-conversion?

GA4 shows what happened. This tool shows where the friction is and why it matters.

## How It Works

**Zone-relative anomaly scoring:** Each step's drop-off rate is scored against 
its funnel zone peers (navigation, engagement, commitment), not the global average. 
A 40% bounce on the homepage is normal; a 40% exit at checkout is a five-alarm fire. 
The system uses z-scores within zones to surface genuinely anomalous friction points.

**Friction pattern detection:** Six behavioral signatures are detected from session 
sequences: search frustration loops, cart hesitation, bounce-back browsing, checkout 
abandonment, single-page exits, and deep-browse-no-action.

**Business impact estimation:** Top friction points are translated to projected 
annual revenue impact based on rescueable sessions × downstream conversion rate × AOV.

## Features

- **Sankey journey canvas** — D3-powered flow visualization with friction overlay
- **Showcase mode** — 10K synthetic sessions with embedded friction points, instant demo
- **Upload mode** — Drop in a CSV (REES46, GA4, standard format), auto-detected
- **Pattern intelligence** — Converting vs non-converting path comparison
- **Zero backend** — All computation in TypeScript, client-side

## Architecture

```
engine/              Pure computation (no UI deps)
├── csvParser.ts         Format detection, sessionization
├── anomalyScoring.ts    Zone-relative z-score friction scoring
├── frictionPatterns.ts  Behavioral pattern detectors
└── transitionMatrix.ts  Markov transition probabilities

api/                 Data source abstraction
├── types.ts             Shared contract (Python ↔ TS ↔ React)
├── staticDataSource.ts  Pre-generated showcase data
└── clientSideDataSource.ts  CSV → full analysis pipeline

config/              Domain knowledge
└── zoneClassification.ts  Zone taxonomy, step labels, colors

ui/                  React presentation
├── SankeyCanvas.tsx     D3 Sankey + friction overlay + tooltips
├── SummaryStats.tsx     Hero metrics + impact estimation
├── FrictionCards.tsx    Anomaly cards + pattern list
├── PatternTable.tsx     Journey pattern comparison
└── DataToggle.tsx       Showcase/upload mode switcher
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

## Methodology Notes

**Showcase data:** 10,000 synthetic sessions generated from probabilistic journey 
templates with deliberate friction points embedded (search frustration loops, cart 
hesitation, checkout abandonment). Distributions calibrated against Baymard Institute 
benchmarks and Contentsquare 2024 Digital Experience data.

**REES46 enrichment:** When processing real REES46 data, the pipeline enriches the 
3 native event types (view/cart/purchase) into 10+ behavioral step types using 
probabilistic inference from session context (position, category changes, session 
depth). These are inferred archetypes, not ground truth — flagged as 
`data_quality: enriched_inferred` in metadata.

## Part of the MarTech × AI Portfolio

| # | Project | AI Technique | Status |
|---|---------|-------------|--------|
| 1 | ContentEngine AI | LLM batch pipeline | ✅ Live |
| 2 | CSP Campaign Planner | Constraint satisfaction | ✅ Live |
| 3 | Bayesian Return Diagnosis | Bayesian Networks | ✅ Live |
| 4 | Competitor Intel Monitor | NLP + sentiment scoring | ✅ Live |
| 5 | **Journey Intelligence Engine** | Markov chains + anomaly scoring | ← You are here |
| 6 | MDP Optimal Contact Policy | Markov Decision Process | Planned |
| 7 | Logic Compliance Engine | Propositional/FOL logic | Planned |

---

*Built by Ata Okuzcuoglu · TUM MSc Management & Technology · 2026*
```

---

## 7. Files Changed Checklist

When implementing this roadmap, track changes here:

### Phase 1 ✅ COMPLETE
- [x] `README.md` — Replace with JIE content (Section 6)
- [x] `/showcase_data.json` — Delete, add to `.gitignore`
- [x] `src/engine/anomalyScoring.ts` — Fix variance (n-1), data-derived min std, absolute-ratio fallback
- [x] `analysis_pipeline.py` — Fix `np.std()` to `ddof=1`, data-derived min std
- [x] `src/config/zoneClassification.ts` — Change default return to `'unknown'`
- [x] `src/ui/SummaryStats.tsx` — Fix AOV calculation
- [x] `src/ui/DataToggle.tsx` — Add 50MB file size guard with error UI
- [x] `src/engine/csvParser.ts` — Add dedup after parse

### Phase 2 ✅ COMPLETE
- [x] `generate_showcase.py` — Rewritten with template-based paths (loops, backtracks, all 6 friction patterns)
- [x] `public/showcase_data.json` — Regenerated: 3.3% CR, 6/6 patterns, 1 friction point
- [x] `src/engine/csvParser.ts` — 2-level category depth
- [x] `src/engine/anomalyScoring.ts` — Absolute-ratio fallback for small-n zones
- [x] `src/ui/SankeyCanvas.tsx` — Top-50 link cap, split useEffect (layout vs style), showFrictionRef for stale closure fix

### Phase 3
- [ ] `src/engine/csvParser.ts` — GA4 format detection + mapping
- [ ] New: `src/engine/worker.ts` — Web Worker for processing
- [ ] `src/api/clientSideDataSource.ts` — Async worker communication
- [ ] New: `src/engine/validation.ts` — Data quality report
