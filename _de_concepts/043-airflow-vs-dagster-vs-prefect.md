---
concept_id: 43
slug: airflow-vs-dagster-vs-prefect
title: "Airflow vs Dagster vs Prefect"
tease: "Three orchestrators. Each one represents a different design philosophy."
section: "Orchestration"
status: draft
---

Airflow is the historical default: tasks as Python functions, schedules as cron strings, the largest community by far. Dagster reframed the world around assets (the things you produce) instead of tasks (the things you run). Prefect leaned into Python-native DSL and managed cloud. None is wrong. They optimise for different things.

| | Airflow | Dagster | Prefect |
|---|---|---|---|
| **Model** | Task DAG | Asset graph | Flow DAG |
| **Sweet spot** | ETL on a schedule | Data products and lineage | Python pipelines that need orchestration |
| **Local dev** | Painful | Excellent | Excellent |
| **Open source** | Mature, big community | Modern, smaller community | Modern, smaller community |
| **Managed** | MWAA, Astronomer, Composer | Dagster Cloud | Prefect Cloud |
| **Learning curve** | Steep | Moderate | Gentle |

```mermaid
flowchart LR
    AF["Airflow<br/>(task-first)"]:::a
    DG["Dagster<br/>(asset-first)"]:::b
    PF["Prefect<br/>(flow-first)"]:::c

    AF --> "Best when you already have it"
    DG --> "Best for a greenfield analytics platform"
    PF --> "Best for embedded Python pipelines"

    classDef a fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef b fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef c fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

**What this page will cover.**

- Why "the orchestrator is code" is more important than which orchestrator.
- The asset-graph model and why it composes better with dbt and warehouses.
- Managed vs self-hosted: the operations cost trade.
- Migration realities: Airflow to Dagster is non-trivial, plan months not weeks.
- The 2026 honest take: pick Dagster for greenfield, keep Airflow if you have it, Prefect for embedded.
- Where Argo, Mage, Kestra fit in (real options worth knowing).

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
