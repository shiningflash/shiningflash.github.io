---
concept_id: 52
slug: data-lineage
title: "Data lineage and how teams actually use it"
tease: "When a dashboard is wrong, can you trace it back to the source in under 5 minutes?"
section: "Observability & SLOs"
status: draft
---

Data lineage is the directed graph of "this column came from that column, which came from that source." Column-level lineage is the goal because table-level lineage rarely answers the question that broke the dashboard. Good lineage lets a data engineer go from "the revenue number is wrong" to the source row in minutes.

```mermaid
flowchart LR
    Src1[("source.orders<br/>(Postgres)")]:::s --> R1["raw.orders"]:::r
    Src2[("source.events<br/>(Kafka)")]:::s --> R2["raw.events"]:::r
    R1 --> S1["staging.orders_clean"]:::st
    R2 --> S2["staging.events_clean"]:::st
    S1 --> M1["marts.fact_revenue"]:::m
    S2 --> M1
    M1 --> Dash[("Dashboard:<br/>'Weekly revenue'")]:::d

    classDef s fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef r fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef st fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef m fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef d fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- Table-level vs column-level lineage. Why column-level is the only one that fully answers debugging questions.
- dbt's lineage out of the box (table-level).
- OpenLineage, Marquez, DataHub: the open-source standards.
- Commercial catalog options: Atlan, Alation, Castor.
- Impact analysis: "if I change this column, what dashboards break?"
- The honest 2026 take: lineage pays for itself the first time someone uses it during an incident.

*Page coming soon. Until then, see [#090 OpenLineage and data discovery](/practice/data-engineering/090-openlineage-and-data-discovery/) for the practice problem.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
