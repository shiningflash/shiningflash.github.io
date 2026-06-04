---
concept_id: 28
slug: shuffle
title: "Shuffle: why it dominates your job runtime"
tease: "When data crosses the network between executors, you are paying for it."
section: "Batch Processing"
status: draft
---

A Spark or Hive job spreads work across many executors. Sometimes the work needs to be regrouped — all rows with the same `customer_id` need to land on the same executor. That regrouping is a shuffle: every executor writes its share to disk, then every executor reads back the parts it now owns. Shuffles cost network, disk, and time.

```mermaid
flowchart LR
    subgraph Before["Before shuffle"]
        E1["Executor 1<br/>(rows: A, B, C, A)"]:::e
        E2["Executor 2<br/>(rows: B, A, C, B)"]:::e
        E3["Executor 3<br/>(rows: C, C, A, B)"]:::e
    end
    Before --> Net[/"Shuffle: write + read<br/>(disk + network)"/]:::net
    Net --> After
    subgraph After["After shuffle"]
        F1["Executor 1<br/>(all A)"]:::e
        F2["Executor 2<br/>(all B)"]:::e
        F3["Executor 3<br/>(all C)"]:::e
    end

    classDef e fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef net fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- The operations that trigger a shuffle: `groupBy`, `join` (without broadcast), `distinct`, `repartition`, window functions.
- Why a shuffle is often the most expensive step in the whole job.
- Reducing shuffle: filter early, project columns early, use broadcast joins where possible.
- Skew during shuffle: one executor gets 10x the rows and stalls the job.
- Shuffle service tuning in Spark (spill threshold, partition count).
- Reading the Spark UI to find the shuffle that is killing your job.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
