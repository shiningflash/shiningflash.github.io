---
concept_id: 3
slug: ctes-vs-subqueries
title: "CTEs vs subqueries vs temp tables"
tease: "Three ways to split a query. Picking the right one."
section: "SQL Foundations"
status: draft
---

A CTE is the `WITH x AS (...)` block at the top of a query. A subquery is the same thing tucked inside the `FROM`. A temp table is the same query result persisted for a session. They look almost identical. They behave very differently at scale.

```mermaid
flowchart LR
    CTE["CTE<br/>(named, scoped to one query)"]:::a
    SUB["Subquery<br/>(inline, anonymous)"]:::b
    TMP["Temp table<br/>(persisted, indexable)"]:::c
    CTE --> Use["Where each one wins"]
    SUB --> Use
    TMP --> Use

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef c fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- Readability vs performance: which one each format actually wins.
- Why a CTE used five times in a query is sometimes computed five times.
- When the planner inlines a CTE (modern Postgres) and when it doesn't.
- Materialised CTEs in Postgres 12+ (`WITH x AS MATERIALIZED`).
- Temp tables: when you need an index on intermediate results.
- The decision tree: readability first, then check the plan.

*Page coming soon. Until then, see [#018 CTE vs subquery](/practice/data-engineering/018-cte-vs-subquery/) for the practice problem with side-by-side examples.*

This concept sits in **Stage 1 (SQL fundamentals)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
