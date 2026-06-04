---
concept_id: 58
slug: compute-autoscaling
title: "Compute autoscaling for warehouses"
tease: "Spin up when queries arrive, spin down when they don't. Pay for what you use."
section: "Cost & FinOps"
status: draft
---

Modern warehouses charge per second of compute. Autoscaling spins up additional nodes when query load arrives and spins them down when it drops. Combined with auto-suspend (warehouse sleeps after N minutes idle), this is the difference between paying for a 24×7 cluster and paying for the seconds you actually use.

```mermaid
flowchart LR
    L["Load"]:::a
    L --> L1["09:00 1 query"]:::low
    L --> L2["10:00 50 queries (dashboards)"]:::high
    L --> L3["02:00 0 queries (sleep)"]:::low
    L1 --> WH1["1 cluster"]:::g
    L2 --> WH2["3 clusters (scaled out)"]:::g
    L3 --> WH3["0 clusters (suspended)"]:::g

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef low fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef high fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- Snowflake multi-cluster warehouses: how scale-out concurrency actually works.
- BigQuery slots, on-demand vs reservation, autoscaler.
- Databricks SQL Serverless: auto-start, auto-stop, auto-scale.
- The auto-suspend setting (60 seconds vs 5 minutes vs an hour) and what each costs.
- The "long-running query keeps the warehouse alive" trap.
- The honest take: enable autoscale + auto-suspend on day 1. Tighten later.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
