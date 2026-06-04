---
concept_id: 6
slug: set-operations
title: "Set operations: UNION, INTERSECT, EXCEPT"
tease: "Stacking results vertically when JOIN is the wrong tool."
section: "SQL Foundations"
status: draft
---

A JOIN matches rows across two tables side by side. A set operation stacks two query results on top of each other. When you find yourself joining on a fake key just to combine two result sets, you wanted a set operation.

```mermaid
flowchart LR
    A[("Query A<br/>rows")]:::a
    B[("Query B<br/>rows")]:::b
    A --> U[/"UNION<br/>(A or B, deduped)"/]:::g
    A --> UA[/"UNION ALL<br/>(every row, fast)"/]:::g
    A --> I[/"INTERSECT<br/>(in both)"/]:::y
    A --> E[/"EXCEPT<br/>(A minus B)"/]:::r
    B --> U
    B --> UA
    B --> I
    B --> E

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef g fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef y fill:#e9d5ff,stroke:#7e22ce,color:#581c87
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- `UNION` vs `UNION ALL`: when the dedup is hiding a row-count bug.
- Why `UNION ALL` is almost always what you want for performance.
- `INTERSECT` as the cleaner version of "exists in both".
- `EXCEPT` (or `MINUS` in Oracle) as the cleaner version of anti-join.
- Column compatibility rules: same count, same types, same order.
- The diff-two-tables trick: `(A EXCEPT B) UNION ALL (B EXCEPT A)`.

*Page coming soon.*

This concept sits in **Stage 1 (SQL fundamentals)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
