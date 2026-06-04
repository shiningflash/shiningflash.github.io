---
concept_id: 59
slug: reserved-vs-on-demand
title: "Reserved vs on-demand pricing for warehouses"
tease: "Commit ahead of time for a discount. The math is real, and so is the lock-in."
section: "Cost & FinOps"
status: draft
---

On-demand pricing charges per query, per second, per byte. Reserved capacity gives you a steep discount in exchange for a commitment (one year, three years). The break-even is usually 60-70% utilisation: if you would use the capacity that much anyway, reserve. If your workload is spiky and unpredictable, on-demand is cheaper.

```mermaid
flowchart LR
    Q1["Steady, predictable<br/>(daily dashboards)"]:::a --> Res["Reserve capacity<br/>(20-40% off)"]:::g
    Q2["Spiky, unpredictable<br/>(ad-hoc analytics)"]:::a --> OD["On-demand<br/>(no commit)"]:::y
    Q3["Mixed"]:::a --> Hybrid["Reserve baseline<br/>+ on-demand burst"]:::b

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef b fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- BigQuery slots vs on-demand, with the 60-70% break-even rule.
- Snowflake's pre-purchased capacity discount tiers.
- The 1-year vs 3-year commitment trade.
- The "right-sizing" question: how much to reserve in year one.
- Flex slots and short-term commitments for predictable seasonal load.
- The lock-in cost: leaving a vendor mid-commitment is expensive.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
