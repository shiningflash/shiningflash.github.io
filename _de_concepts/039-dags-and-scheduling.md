---
concept_id: 39
slug: dags-and-scheduling
title: "DAGs and scheduling 101"
tease: "Directed Acyclic Graph. Tasks with dependencies, run in order, no cycles allowed."
section: "Orchestration"
status: draft
---

A DAG (directed acyclic graph) is the shape of every modern orchestrator: tasks connected by arrows, no loops, runs in order. The orchestrator's job is to look at the DAG, figure out which tasks are ready, run them, and not break when one fails. Airflow, Dagster, Prefect, Argo — they all do this. The differences are in how they express the DAG and how they handle failures.

```mermaid
flowchart LR
    Ext["extract_orders"]:::a --> T1["transform_orders"]:::b
    Ext2["extract_customers"]:::a --> T2["transform_customers"]:::b
    T1 --> J["join_orders_customers"]:::g
    T2 --> J
    J --> P["publish_to_warehouse"]:::g
    P --> N["notify_team"]:::n

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef n fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- The five concepts behind every orchestrator: task, dependency, schedule, run, status.
- Why a DAG must be acyclic (otherwise the scheduler does not terminate).
- Time-based schedules vs event-based triggers vs sensor-based waits.
- The execution date / logical date distinction that confuses everyone for their first month.
- Retries, retry delay, max retries, alert-on-failure — the boring settings that prevent 3 a.m. pages.
- Why "the DAG is code" beats "the DAG is YAML" for everything except platform teams.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
