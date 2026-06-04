---
concept_id: 53
slug: cost-per-query-attribution
title: "Cost-per-query attribution"
tease: "Knowing which team, which dashboard, which model is burning the budget."
section: "Observability & SLOs"
status: draft
---

The warehouse bill at the end of the month is one number. Splitting that number across teams, dashboards, and models is cost attribution. Without it, no one knows which query to kill. With it, you have a leaderboard of the top 10 cost offenders updated every morning.

```mermaid
flowchart LR
    Bill[("$42,000 warehouse bill")]:::a
    Bill --> Q["Query history"]:::q
    Q --> Tag1["Tag by user / role"]:::g
    Q --> Tag2["Tag by query label"]:::g
    Q --> Tag3["Tag by dbt model"]:::g
    Tag1 --> Dash[("Cost-per-team dashboard")]:::d
    Tag2 --> Dash
    Tag3 --> Dash

    classDef a fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef q fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef d fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- Where the data lives: `INFORMATION_SCHEMA.JOBS` (BigQuery), `QUERY_HISTORY` (Snowflake), Databricks system tables.
- Tagging queries with `query_tag` / labels so attribution survives the SQL.
- The dbt-warehouse cost integration (job timing + bytes scanned per model).
- Per-user, per-dashboard, per-pipeline rollups.
- The "top 10 offenders" daily report that tightens the feedback loop.
- The chargeback model: when finance wants the cost split by team, what do you give them?

*Page coming soon. Until then, see [#030 Warehouse cost doubled in two months](/practice/data-engineering/030-warehouse-cost-doubled-in-two-months/) for the practice scenario.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
