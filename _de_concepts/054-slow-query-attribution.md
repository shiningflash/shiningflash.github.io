---
concept_id: 54
slug: slow-query-attribution
title: "Slow query attribution"
tease: "When the warehouse is slow, finding the one query that did it."
section: "Observability & SLOs"
status: draft
---

The whole warehouse is slow. Dashboards lag. Pipelines miss SLA. The reason is almost always one or two queries that drank all the compute. Finding them in under five minutes is a real skill that separates seniors from juniors when the on-call phone rings.

```mermaid
flowchart LR
    Pain["Warehouse slow"]:::r --> Look["Query history<br/>last 1 hour"]:::a
    Look --> Sort["Sort by:<br/>bytes scanned, time, credits"]:::s
    Sort --> Top[("Top 3 offenders")]:::g
    Top --> Action["Kill / refactor / partition"]:::done

    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef s fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef g fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef done fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The 3 queries to memorise: top by bytes scanned, top by total time, top by credits / DBU.
- The "scan less" principle: partition pruning, columnar projection, filter pushdown.
- Recognising the patterns: cartesian join, missing `WHERE`, `SELECT *` in a 100-column table.
- Concurrency vs query cost: sometimes the fix is a separate warehouse, not query tuning.
- The 80/20 rule: 5% of queries usually account for 80% of cost. Find those 5%.
- The honest 2026 take: a weekly slow-query review session pays for itself in a month.

*Page coming soon. Until then, see [#096 The twenty-minute query that should be two seconds](/practice/data-engineering/096-the-twenty-minute-query-that-should-be-two-seconds/) for the practice problem.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
