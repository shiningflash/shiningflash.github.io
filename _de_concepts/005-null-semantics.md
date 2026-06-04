---
concept_id: 5
slug: null-semantics
title: "NULL semantics: three-valued logic"
tease: "NULL is not 'nothing'. It is 'unknown'. The bugs that follow."
section: "SQL Foundations"
status: draft
---

In most programming languages, `NULL` means "no value" and behaves like one. In SQL, `NULL` means "unknown" and follows three-valued logic: every comparison can be true, false, or NULL. Most data bugs in SQL trace back to forgetting that.

```mermaid
flowchart LR
    A["NULL = NULL"]:::r --> R1["→ NULL (not true!)"]:::out
    B["NULL <> 5"]:::r --> R2["→ NULL"]:::out
    C["WHERE x = NULL"]:::r --> R3["→ matches nothing"]:::out
    D["WHERE x IS NULL"]:::g --> R4["→ correct"]:::out

    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef out fill:#fef3c7,stroke:#a16207,color:#713f12
```

**What this page will cover.**

- Three-valued logic explained in one paragraph.
- `IS NULL` vs `= NULL`. Why one works and the other never does.
- `COUNT(*)` vs `COUNT(col)`: the difference that bites every junior.
- `NULL` in aggregations (SUM, AVG): silently ignored, sometimes wrong.
- `NOT IN` with a NULL on the right side: returns zero rows. Always.
- `COALESCE`, `NULLIF`, `IS DISTINCT FROM`: the three tools that make NULL safe.

*Page coming soon.*

This concept sits in **Stage 1 (SQL fundamentals)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
