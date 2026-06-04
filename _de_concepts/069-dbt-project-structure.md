---
concept_id: 69
slug: dbt-project-structure
title: "dbt project structure that scales"
tease: "How to lay out 500 models so people can still find anything."
section: "Architecture Patterns"
status: draft
---

A small dbt project can put every model in one folder and still ship. A 500-model project cannot. The structure that has emerged from real teams: source-aligned `staging`, business-aligned `intermediate`, consumer-facing `marts`. Inside each, group by domain. The naming convention is half the value: when you read a model name, you should know which layer and which domain it belongs to.

```mermaid
flowchart LR
    Src[("Sources<br/>(Fivetran, CDC, files)")]:::s
    Src --> Stg["staging/<br/>stg_<source>__<entity>"]:::st
    Stg --> Int["intermediate/<br/>int_<entity>__<verb>"]:::int
    Int --> Marts["marts/<br/>fct_<entity> / dim_<entity>"]:::m
    Marts --> Use[("Dashboards, ML, exports")]:::u

    classDef s fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef st fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef int fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef m fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef u fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The three folders and what each layer is allowed to do.
- The naming convention: `stg_stripe__customers`, `int_orders__joined`, `fct_orders`, `dim_customer`.
- One staging model per source table. The "lift, type-cast, rename" rule.
- The intermediate layer as the "transformation thinking" layer.
- The marts layer as the only place dashboards can read.
- Why everyone should follow [dbt Labs' best practices guide](https://docs.getdbt.com/best-practices) the first month, then earn the right to deviate.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
