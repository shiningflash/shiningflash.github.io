---
concept_id: 26
slug: backfill-strategies
title: "Backfill strategies"
tease: "Reprocessing 90 days of history without melting the warehouse or the budget."
section: "Batch Processing"
status: draft
---

Backfill is rerunning a pipeline for a period in the past: a new column, a fixed bug, a forgotten source. The naive approach (rerun everything at once) costs the most and risks breaking the live pipeline. A real backfill plan picks the chunk size, throttles concurrency, isolates from live traffic, and verifies along the way.

```mermaid
flowchart LR
    P["Plan"]:::a --> Chunk["Chunk: 1 day per task"]:::b
    Chunk --> Limit["Limit: 5 concurrent tasks"]:::b
    Limit --> Isolate["Isolate: separate compute pool"]:::b
    Isolate --> Verify["Verify: row counts per partition"]:::b
    Verify --> Done(["Stable, repeatable"]):::g

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The chunk-size decision: too small = orchestrator overhead, too large = no parallelism.
- The dependency-aware backfill order (upstream first, downstream next).
- Throttling concurrency so the live pipeline still ships its daily job.
- Reading from cold-storage source data without doubling cost.
- Using a separate warehouse compute pool to keep live dashboards fast.
- The cost cap and the kill switch every backfill plan should have.

*Page coming soon. Until then, see [#097 Backfill 90 days without blowing the budget](/practice/data-engineering/097-backfill-ninety-days-without-blowing-the-budget/) for the practice problem.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
