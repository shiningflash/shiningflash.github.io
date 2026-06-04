---
concept_id: 25
slug: idempotent-batch
title: "Idempotent batch jobs"
tease: "Running the same job twice produces the same answer. The whole platform changes when this is true."
section: "Batch Processing"
status: draft
---

A job is idempotent if running it twice produces the same result as running it once. Idempotency is what lets you re-run a failed job at 3 a.m. without worrying. It is what lets you backfill the last 30 days without thinking. It is the most underrated property of a data pipeline.

```mermaid
flowchart LR
    A["Run job once"]:::a --> R1["Result: 1,000 rows in table"]:::g
    B["Run job twice"]:::a --> R2["Result: 1,000 rows<br/>(NOT 2,000)"]:::g
    C["Re-run after a failure"]:::a --> R3["Result: 1,000 rows<br/>(safe)"]:::g

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The two main ways: replace partition (delete + insert) and merge (upsert).
- The natural-key requirement: idempotency needs a deterministic primary key.
- Why "INSERT IGNORE" hides bugs but "MERGE" surfaces them.
- The `dbt run` model: every model is full-replace or incremental-merge by default.
- The state stored outside the warehouse (filenames consumed, offsets processed) that breaks idempotency.
- The "right way to backfill" that falls out of idempotency for free.

*Page coming soon. Until then, see [#009 Idempotency in data pipelines](/practice/data-engineering/009-idempotency-in-data-pipelines/) for the practice problem.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
