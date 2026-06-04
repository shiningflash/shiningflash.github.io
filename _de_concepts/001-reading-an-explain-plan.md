---
concept_id: 1
slug: reading-an-explain-plan
title: "Reading an EXPLAIN plan"
tease: "The fastest way to know why your query is slow."
section: "SQL Foundations"
status: draft
---

When a query is slow, you do not guess. You ask the database what it is doing. `EXPLAIN` shows the plan the database is about to use. `EXPLAIN ANALYZE` runs the query and shows what really happened. Reading these well is the single most useful SQL skill on a data team.

```mermaid
flowchart TB
    Q["SELECT * FROM orders<br/>JOIN customers ON ..."]:::q
    Q --> P[/"Planner"/]:::p
    P --> Plan["Plan: scan or index?<br/>hash join or nested loop?"]:::plan
    Plan --> Run[/"Execute"/]:::r
    Run --> Out[("Result")]:::out

    classDef q fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef p fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef plan fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef r fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef out fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The three things to look at first: scan type, join type, estimated vs actual rows.
- Why `seq scan` is sometimes right and sometimes a disaster.
- Hash join vs nested loop vs merge join, and when each one fits.
- The cost number is not seconds. What it actually means.
- How `EXPLAIN ANALYZE BUFFERS` exposes hidden I/O.
- The five queries that go from 60 seconds to 60 milliseconds after one well-chosen index.

*Page coming soon. Until then, see [#017 Reading an EXPLAIN plan](/practice/data-engineering/017-reading-an-explain-plan/) for the practice problem with a full walkthrough.*

This concept sits in **Stage 1 (SQL fundamentals)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
