---
concept_id: 75
slug: managed-orchestration
title: "Managed orchestration: Astronomer vs Dagster Cloud vs Prefect Cloud"
tease: "You can run Airflow yourself. Most teams shouldn't."
section: "Cloud Comparisons"
status: draft
---

Running Airflow on Kubernetes is a project. So is running Dagster, Prefect, or any other orchestrator at production scale. Managed orchestration services take the platform team off the critical path: they run the scheduler, the metadata DB, the workers, the upgrades. You write DAGs; they keep the runtime alive.

| | Astronomer (Airflow) | Dagster Cloud | Prefect Cloud | Cloud-native (MWAA, Composer) |
|---|---|---|---|---|
| **What you get** | Managed Airflow, support | Managed Dagster, Cloud-native UI | Managed Prefect | AWS / GCP / Azure managed services |
| **Cost** | High | Medium | Medium | Variable |
| **Best at** | Enterprise Airflow + support | Asset-graph teams, dbt-heavy | Python-first pipelines | Already-on-cloud teams |
| **Lock-in** | Low (it is Airflow) | Medium | Medium | Medium-high |

```mermaid
flowchart LR
    Self["Self-host Airflow on K8s"]:::r --> Cost1["Platform team: 1 FTE+"]:::bad
    Mng["Managed (Astronomer / Dagster / Prefect Cloud)"]:::g --> Cost2["Platform team: 0 FTE,<br/>$ per seat or per run"]:::ok

    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef ok fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- The break-even cost: when paying for managed orchestration is cheaper than a platform engineer's salary.
- MWAA, Cloud Composer, Azure Data Factory: the cloud-native managed Airflows.
- Astronomer vs MWAA: support, upgrade cadence, deployment model.
- Dagster Cloud and Prefect Cloud's hybrid model (control plane managed, workers self-hosted).
- The honest 2026 take: small teams should always be on a managed service.
- The exit story: leaving each platform without rewriting every DAG.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
