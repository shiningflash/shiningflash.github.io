---
concept_id: 60
slug: scan-less-rule
title: "The 'scan less' rule"
tease: "Every byte you don't scan is a byte you don't pay for. The whole cost game in one sentence."
section: "Cost & FinOps"
status: draft
---

In a per-byte-scanned warehouse (BigQuery), or a per-second-of-compute warehouse (Snowflake, Databricks), the cost equation is the same: scan less, pay less. Every cost optimisation is a variation on this single rule. Partition pruning, column projection, filter pushdown, materialised aggregates, sampling — all of them are ways to make the engine read fewer bytes.

```mermaid
flowchart LR
    Bill["Cost"]:::r
    Bill --> A["Partition pruning<br/>(read fewer days)"]:::g
    Bill --> B["Column projection<br/>(SELECT only what you need)"]:::g
    Bill --> C["Predicate pushdown<br/>(filter before scan)"]:::g
    Bill --> D["Materialised aggregates<br/>(read pre-computed)"]:::g
    Bill --> E["Sampling<br/>(scan 1%, infer the rest)"]:::g

    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The five levers and what each one is worth.
- `SELECT *` as the most expensive habit in analytics.
- Why a `LIMIT 10` in BigQuery scans the same as `LIMIT 10000000` if you don't filter.
- Materialised views as pre-computed scans (the cross-link to [SD #080](/practice/system-design/concepts/080-materialized-views/)).
- BigQuery's table sampling clause and Snowflake's `TABLESAMPLE`.
- The team habit that drops cost 30% in 90 days: a weekly "top query review" session.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
