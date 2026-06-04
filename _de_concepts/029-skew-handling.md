---
concept_id: 29
slug: skew-handling
title: "Skew handling in distributed batch"
tease: "One key has 90% of the rows. The job waits on one executor while the rest idle."
section: "Batch Processing"
status: draft
---

A skewed key dominates a distributed job. Think of an `events` table where one customer has 100x more rows than any other. When the job shuffles by `customer_id`, that one executor processes 100x the work while the others finish in seconds. The job takes as long as the slowest executor.

```mermaid
flowchart TB
    Job["Distributed job"]:::a
    Job --> E1["Executor 1: 10K rows<br/>(done in 5s)"]:::ok
    Job --> E2["Executor 2: 10K rows<br/>(done in 5s)"]:::ok
    Job --> E3["Executor 3: 10K rows<br/>(done in 5s)"]:::ok
    Job --> E4["Executor 4: 1M rows<br/>(takes 8 minutes)"]:::bad
    E4 --> Wait["Whole job blocked"]:::bad

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Spotting skew in the Spark UI: one task takes 100x longer than the median.
- Salting: appending a random prefix to skewed keys, joining, then aggregating.
- Adaptive Query Execution (AQE) in Spark 3+ and what it does for skew automatically.
- Broadcast joins as a way to avoid shuffle entirely for the skewed side.
- Pre-aggregating before joining to reduce the row count per skewed key.
- The honest take: salting is the universal fix; the others are nice when they apply.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
