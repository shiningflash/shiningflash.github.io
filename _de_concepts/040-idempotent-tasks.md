---
concept_id: 40
slug: idempotent-tasks
title: "Idempotent tasks in orchestration"
tease: "The same property as idempotent batch jobs, applied per orchestrator task."
section: "Orchestration"
status: draft
---

An idempotent task can be re-run safely without changing the result beyond the first successful run. In an orchestrator, this matters because retries are inevitable: a task fails, the scheduler retries it, and your data must not double up or partially apply. Idempotency at the task level is what makes a DAG repair itself instead of needing a human at 3 a.m.

```mermaid
flowchart LR
    Run1["Run #1<br/>(fails halfway)"]:::r --> Retry["Retry"]:::y
    Retry --> Run2["Run #2<br/>(completes)"]:::g
    Run2 --> Result["Result: same as if Run #1 had succeeded"]:::done

    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef done fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- The pattern: delete + insert by partition, or merge by natural key.
- Task-level retries (3 with exponential backoff) as the cheap safety net.
- Why "INSERT" without a deduplication step makes retries dangerous.
- Tracking what was already processed: filenames, offsets, hashes — and where to store that state.
- The "logical date" trick: every task knows which partition it owns, even on retry.
- The audit table that lets you answer "did this partition load successfully?" without grepping logs.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
