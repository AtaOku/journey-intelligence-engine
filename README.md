# 🔍 Fashion E-Commerce Return Root Cause Diagnosis

**Bayesian Network Backward Inference for Diagnosing Hidden Return Reasons**

> Course: Introduction to Artificial Intelligence (IN2062) · TUM · Prof. Dr.-Ing. Matthias Althoff  
> Author: Ata Okuzcuoglu · MSc Management & Technology (Marketing + CS)

[![Streamlit App](https://static.streamlit.io/badges/streamlit_badge_black_white.svg)](https://bayesian-marketing-attribution-model.streamlit.app)

---

## The Problem

Fashion e-commerce suffers from return rates of **25-40%**, costing the industry **$218 billion globally** (Radial, 2024). Analytics dashboards show *which* items are returned — but cannot answer **why**.

Customer-reported reasons are unreliable: surveys show only 30-40% completion, and customers frequently misreport the true reason. Meanwhile, the actual breakdown (Coresight, 2023; Rocket Returns, 2025):

| Root Cause | Share of Returns |
|---|---|
| Size / Fit Mismatch | 53–70% |
| Style / Expectation Gap | 16–23% |
| Quality / Damage | 10–13% |
| Impulse / Buyer's Regret | 8–15% |
| Intentional Bracketing | ~15% (multi-brand) |

## The Solution: Backward Inference

This tool uses a **Bayesian Network** to reason *backward* from observed signals to hidden causes:

```
Given: returned = Yes + observable order signals
Infer: P(root_cause | evidence) for 5 competing causes
Find:  Which cause has the highest diagnostic lift?
```

**Why BN and not regression?** Regression predicts *P(returned | features)* — whether a return happens. A BN computes *P(cause | returned=Yes, signals)* — **why** it happened. This is the information merchandising teams need.

## Network Architecture

```
OBSERVABLE (12 nodes)              ROOT CAUSES (5)              OUTCOME
═══════════════════════            ═══════════════              ═══════

size_sensitive_category ──┐
is_first_purchase ────────┼──→ 👗 SIZE_MISMATCH ─────────┐
viewed_size_guide ────────┤                               │
mobile_purchase ──────────┘                               │
                                                          │
premium_price ────────────┐                               │
is_first_purchase ────────┼──→ 📸 EXPECTATION_GAP ───────┤
mobile_purchase ──────────┘                               ├──→ RETURNED
                                                          │    (Noisy-OR)
purchased_on_discount ────┐                               │
social_media_referral ────┼──→ 💸 IMPULSE_REGRET ────────┤
mobile_purchase ──────────┤                               │
young_customer ───────────┘                               │
                                                          │
multi_size_order ─────────┐                               │
young_customer ───────────┼──→ 🔄 BRACKETING ────────────┤
high_return_history ──────┘                               │
                                                          │
slow_delivery ────────────┐                               │
multiple_items_in_order ──┼──→ 📦 QUALITY/DAMAGE ────────┘
premium_price ────────────┘
```

**18 nodes · 22 edges · All binary · 2¹⁸ = 262,144 states · Exact inference**

## Key Features

- **Root Cause Diagnosis** — Set evidence, see which of 5 causes has the highest posterior probability
- **Diagnostic Lift** — P(cause|evidence) / P(cause) reveals which cause the evidence supports most
- **What-If Simulation** — Change one signal and see how return probability shifts
- **Academic Methodology Tab** — Full formal definition, CPT calibration, Noisy-OR model
- **17 Research Citations** — Every CPT parameter grounded in industry data
- **Quick Presets** — 5 realistic scenarios to demonstrate different diagnosis patterns

## Example Diagnoses

| Scenario | Top Diagnosis | Lift |
|---|---|---|
| Dress + New Customer + Mobile + No Size Guide | 👗 Size Mismatch | 3.42x |
| Multi-Size Order + Young Customer | 🔄 Bracketing | 12.05x |
| Instagram + Discount + Mobile + Young | 💸 Impulse Regret | 3.62x |
| Slow Delivery + Premium + Multi-Item | 📦 Quality/Damage | 5.56x |

## Tech Stack

- **Engine:** Custom BayesNet class with exact enumeration inference (Russell & Norvig Fig. 14.9)
- **Frontend:** Streamlit
- **No external ML libraries** — Built from first principles to demonstrate understanding

## Running Locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

## References

See the full References tab in the app for 17 citations. Key sources:

1. Coresight Research (2023). "The True Cost of Apparel Returns"
2. Radial (2024). "Tech Takes on E-Commerce's $218 Billion Returns Problem"
3. Rocket Returns (2025). "Ecommerce Return Rates: Complete Industry Analysis"
4. AfterShip (2024). "Returns: Fashion's $218 Billion Problem"
5. Landmark Global (2025). "Wardrobing & Bracketing: Serial Returners"
6. Russell & Norvig (2021). *AI: A Modern Approach*, 4th ed., Ch. 13-14

## Part of the MarTech × AI Portfolio

This is **Project 2** in a portfolio demonstrating AI techniques applied to marketing:
- Project 1: CSP-Based Campaign & Budget Planner
- **Project 2: BN Return Root Cause Diagnosis** ← You are here
- Project 3: HMM-Based Customer Lifecycle Segmentation (planned)
- Project 4: MDP for Dynamic Pricing Strategy (planned)

---

*Built by Ata Okuzcuoglu · TUM MSc Management & Technology · 2025*
