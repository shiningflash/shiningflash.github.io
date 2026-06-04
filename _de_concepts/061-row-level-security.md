---
concept_id: 61
slug: row-level-security
title: "Row-level security in warehouses"
tease: "Sales people see their own region. Managers see their teams. Same table, different rows per user."
section: "Security & Privacy"
status: draft
---

Row-level security (RLS) is a warehouse feature that filters rows automatically based on who is running the query. A sales rep selecting from `fact_orders` sees their own customers' orders. A manager sees their team's. A leadership user sees everything. The filter is enforced by the warehouse, not the BI tool, so it cannot be bypassed.

```mermaid
flowchart LR
    Q["SELECT * FROM fact_orders"]:::q
    U1["User: alice (region=EU)"]:::u
    U2["User: bob (region=US)"]:::u
    U3["User: cara (manager)"]:::u
    U1 --> WH["Warehouse applies RLS:<br/>WHERE region = 'EU'"]:::wh
    U2 --> WH2["Warehouse applies RLS:<br/>WHERE region = 'US'"]:::wh
    U3 --> WH3["Warehouse applies RLS:<br/>(no filter, manager)"]:::wh

    classDef q fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef u fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef wh fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- Snowflake row access policies, BigQuery row-level security, Databricks dynamic views.
- Defining the policy: a SQL expression evaluated per row at query time.
- The performance cost: filter pushdown, predicate planning, the cost of complex policies.
- Combining RLS with column masking for full data access control.
- The "service account" trap: pipelines run as a robot, RLS must allow that role through.
- Why RLS belongs at the warehouse level, not the BI tool level.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
