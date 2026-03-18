# Journey Intelligence Engine

**Path-level customer journey analysis with friction detection.**

Which customer paths convert, which don't, and what's the single highest-impact friction point to fix?

![React](https://img.shields.io/badge/React_18-61DAFB?style=flat&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![D3](https://img.shields.io/badge/D3.js-F9A03C?style=flat&logo=d3.js&logoColor=black)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

## What it does

E-commerce teams know their overall conversion rate but have no idea *which journey paths* are broken. GA4 shows funnel stages in isolation. This tool shows the full picture:

- **Interactive Sankey diagram** showing all journey paths with friction highlighting
- **Step-type aware anomaly scoring** — detects friction points relative to their funnel zone (navigation / engagement / commitment), not a global average
- **Friction pattern detection** — identifies behavioral signatures like search frustration loops, cart hesitation, checkout abandonment
- **Pattern mining** — discovers which journey paths convert and which don't (showcase mode)
- **CSV upload** — analyze your own clickstream data entirely client-side (no data leaves your browser)

## Two modes

**Showcase mode** — Pre-loaded with real e-commerce data. Full analysis including sequential pattern mining. Zero setup.

**Upload mode** — Upload your own CSV. Transition matrix, anomaly scoring, and friction patterns computed client-side in TypeScript. Pattern mining requires server-side computation (coming in v2).

## Quick start

```bash
git clone https://github.com/AtaOku/journey-intelligence-engine.git
cd journey-intelligence-engine
npm install
npm run dev
```

Open `http://localhost:5173` — showcase data loads automatically.

## CSV format

The upload parser auto-detects two formats:

**Standard format:**
```csv
session_id,timestamp,event_type,category,product_id,price
s_001,2024-01-15 10:23:01,homepage,,,
s_001,2024-01-15 10:23:45,category,clothing,,
s_001,2024-01-15 10:24:12,view,clothing,p_1234,49.99
```

**REES46 format** (from [Kaggle](https://www.kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store)):
```csv
event_time,event_type,product_id,category_code,brand,price,user_id,user_session
2019-10-01 00:00:04,view,1005115,electronics.smartphone,samsung,162.31,513903572,26dd...
```

Minimum required columns: `session_id` + `event_type` (standard) or `user_session` + `event_type` (REES46).

## Technical approach

| Layer | Technique | Purpose |
|---|---|---|
| Pattern mining | Seq2Pat DPM (offline) + frequency analysis | Discover converting vs non-converting journey patterns |
| Flow modeling | First-order Markov Chain (transition matrix) | Model journey flow for Sankey + anomaly baseline |
| Friction detection | Step-type aware z-score | Score each step's drop-off against its funnel zone peers |
| Pattern classification | Heuristic behavioral signatures | Detect search loops, cart hesitation, checkout abandonment |

Anomaly scores are computed within three funnel zones (navigation, engagement, commitment) — not globally. A 40% drop-off at homepage is normal; 40% at checkout is critical. Zone-aware scoring catches the difference.

Friction pattern detection is heuristic-based, not causal. The system flags behavioral signatures and their frequency — it does not claim to know *why* users behave that way. See the [spec](./PROJECT5_JOURNEY_INTELLIGENCE_ENGINE_SPEC.md) for full methodology.

## Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS
- **Visualization:** D3.js (`d3-sankey`)
- **Offline analysis:** Python (Seq2Pat, pandas, numpy)
- **Deploy:** Vercel

## Project structure

```
src/
├── api/          Data sources (showcase JSON, client-side CSV)
├── engine/       Analysis engine (transition matrix, anomaly scoring, friction patterns)
├── ui/           React components (Sankey, pattern table, friction cards)
├── config/       Zone classification, event taxonomy
└── App.tsx       Root layout with showcase/upload toggle

analysis/         Python offline pipeline (not deployed)
```

## Part of the MarTech × AI Portfolio

This is Project 5 in a portfolio of AI-powered marketing tools:

1. **ContentEngine AI** — Content operations system (React, Vercel)
2. **CSP Campaign Planner** — Constraint satisfaction campaign scheduling (Streamlit)
3. **Bayesian Return Diagnosis** — 18-node BN for return root cause (Streamlit)
4. **Competitor Intel Monitor** — Multi-source competitive intelligence (React, Netlify)
5. **Journey Intelligence Engine** — This project
6. *MDP Contact Policy* — Planned
7. *Logic Compliance Engine* — Planned

Each project applies a specific AI technique to a real marketing problem.

## License

MIT

---

Built by [Ata Okuzcuoglu](https://linkedin.com/in/ataokuzcuoglu) · MSc Management & Technology @ TU Munich
