---
concept_id: 27
slug: full-vs-incremental-vs-cdc
title: "Full refresh vs incremental vs CDC-driven loads"
tease: "Three ways to keep a table up to date. Each one fits a specific shape of source."
section: "Batch Processing"
status: draft
---

A full refresh rebuilds the whole table every run. An incremental load processes only new rows since the last successful run. A CDC-driven load reads the source database's change log and applies inserts, updates, and deletes. Each one wins in a specific situation. Mixing them up is one of the most common ETL bugs.

```mermaid
flowchart TB
    F["Full refresh"]:::a
    F --> F1["Delete + insert everything<br/>Simple, slow, idempotent"]:::out
    I["Incremental"]:::b
    I --> I1["Process WHERE updated_at > last_watermark<br/>Fast, needs a watermark column"]:::out
    C["CDC-driven"]:::c
    C --> C1["Apply insert / update / delete events<br/>Captures deletes; needs Debezium-style stream"]:::out

    classDef a fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef b fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef c fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef out fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

**What this page will cover.**

- Full refresh: when the table is small or correctness over freshness matters.
- Incremental: the watermark column rules (must be monotonic, must be reliable).
- CDC: when you need to capture deletes or out-of-order updates.
- The hybrid: full refresh on a schedule + incremental between full refreshes.
- The "late-arriving rows" problem and how each strategy handles it.
- Picking the right one with a 4-question decision tree.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
