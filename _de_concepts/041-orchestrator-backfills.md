---
concept_id: 41
slug: orchestrator-backfills
title: "Backfills inside an orchestrator"
tease: "Triggering 90 historical runs without breaking the live schedule."
section: "Orchestration"
status: draft
---

A backfill in an orchestrator is a structured set of historical DAG runs, one per missed or re-run period. Done well it picks up where it left off, throttles concurrency, runs in a separate queue, and writes an audit trail. Done badly it shares the live queue, drowns the warehouse, and quietly skips half the partitions.

```mermaid
flowchart LR
    BF["Backfill request<br/>(2026-01-01 to 2026-04-01)"]:::req
    BF --> Plan["Generate 90 runs<br/>(one per day)"]:::plan
    Plan --> Queue["Backfill queue<br/>(separate from live)"]:::q
    Queue --> Limit["Concurrency: 5"]:::l
    Limit --> Run["Run each day's DAG"]:::g
    Run --> Audit[("Audit log")]:::a

    classDef req fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef plan fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef q fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef l fill:#e9d5ff,stroke:#7e22ce,color:#581c87
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef a fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Airflow's `airflow dags backfill` command vs `clear` vs manual triggers.
- Dagster's partition-based backfill (the cleanest model).
- Concurrency pools / queues that isolate backfill from live work.
- Dependency-ordered backfill: upstream models first, downstream after.
- Idempotency as the precondition: a backfill rerun is just retries at scale.
- Tracking progress: what is the cheapest way to know "we are at day 47 of 90"?

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
