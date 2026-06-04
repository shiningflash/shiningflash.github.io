---
concept_id: 7
slug: recursive-ctes-lateral-joins
title: "Recursive CTEs and lateral joins"
tease: "Two SQL features that solve problems nothing else can solve cleanly."
section: "SQL Foundations"
status: draft
---

Most queries are flat. A few problems are not: walking a parent-child tree, finding the next event after each event, applying a function row by row. Recursive CTEs handle the hierarchy ones. Lateral joins handle the row-by-row ones. Both replace messy procedural code with one SQL statement.

```mermaid
flowchart TB
    subgraph R["Recursive CTE"]
        R1["Start: root rows"] --> R2["Repeat: join self<br/>until no new rows"]
        R2 --> R3[("Tree / path output")]
    end
    subgraph L["LATERAL JOIN"]
        L1["For each row on the left"] --> L2["Run a small query<br/>using that row's values"]
        L2 --> L3[("Top-N per group, etc.")]
    end

    classDef _ fill:#dcfce7,stroke:#15803d,color:#14532d
    class R1,R2,R3,L1,L2,L3 _
```

**What this page will cover.**

- Recursive CTE shape: anchor query `UNION ALL` recursive query.
- Walking a manager-employee hierarchy in one query.
- Bill-of-materials and category trees with depth limits.
- Lateral joins for top-N per group (faster than window function for big tables).
- `CROSS JOIN LATERAL` and `LEFT JOIN LATERAL`: the two flavours.
- When recursion is too slow and you want a `closure_table` instead.

*Page coming soon.*

This concept sits in **Stage 1 (SQL fundamentals)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
