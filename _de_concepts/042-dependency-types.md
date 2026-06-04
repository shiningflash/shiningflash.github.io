---
concept_id: 42
slug: dependency-types
title: "Dependency types: data, time, external"
tease: "Three reasons one task waits for another."
section: "Orchestration"
status: draft
---

A task can wait on three different things: another task in the same DAG (control dependency), a piece of data being ready (data dependency), or an external event from outside the orchestrator (event dependency). Modeling the right type makes the DAG truthful. Modeling the wrong one creates phantom failures.

```mermaid
flowchart LR
    Ctrl["Control: 'task B runs after task A'"]:::a
    Data["Data: 'wait for the upstream table'"]:::b
    Ext["External: 'wait for the partner CSV'"]:::c

    Ctrl --> Use1["Most common, the default"]
    Data --> Use2["Asset-based orchestration (Dagster, dbt)"]
    Ext --> Use3["Sensors, file watchers, API polls"]

    classDef a fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef b fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef c fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- Control dependencies (Airflow's `>>` / `set_downstream`).
- Data / asset dependencies (Dagster's asset graph, dbt's `ref()` and `source()`).
- External dependencies (Airflow Sensors, FileSensor, S3KeySensor).
- The honest critique of sensors: they hold a worker slot while polling.
- Event-driven alternative: a small webhook or a Kafka topic that triggers a DAG.
- Why "data dependencies" are slowly winning over "control dependencies" as the right default.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
