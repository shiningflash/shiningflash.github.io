---
concept_id: 67
slug: warehouse-redshift-bigquery-synapse
title: "Data warehouses: Redshift vs BigQuery vs Synapse"
tease: "Storage model, pricing, concurrency."
section: "Cloud Comparisons"
status: live
---

A cloud data warehouse runs SQL across huge analytical datasets, fast, at a price-per-byte-scanned that would have been impossible ten years ago. Redshift, BigQuery, and Synapse are the major-cloud answers. They all expose SQL, all use columnar storage, and all scale horizontally. The big difference is the pricing model (which shapes how you use it), the separation of storage and compute (which affects performance and cost), and the surrounding ecosystem. The right answer depends as much on how you want to be billed as on raw capability.

## The three at a glance

```mermaid
flowchart TB
    subgraph RS["AWS Redshift"]
        direction LR
        R1[("Postgres-flavoured SQL")]:::server
        R2[("provisioned (RA3) or serverless")]:::server
        R3[("storage + compute now separable<br/>(RA3 nodes, RMS storage)")]:::server
    end

    subgraph BQ["GCP BigQuery"]
        direction LR
        B1[("standard SQL")]:::server
        B2[("fully serverless from day one")]:::server
        B3[("storage and compute decoupled by design")]:::server
    end

    subgraph SY["Azure Synapse / Microsoft Fabric"]
        direction LR
        SY1[("T-SQL based")]:::server
        SY2[("dedicated SQL pools (provisioned)<br/>or serverless")]:::server
        SY3[("integrates with Data Lake Gen2,<br/>Spark, Power BI")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## Pricing: the biggest practical difference

The pricing model shapes how the warehouse feels to use.

```mermaid
flowchart TB
    subgraph PROV["Provisioned (pay for nodes/hours regardless of usage)"]
        direction LR
        P1["Redshift provisioned (RA3 nodes)"]:::infra
        P2["Synapse dedicated SQL pools"]:::infra
    end

    subgraph SERV["Serverless / on-demand (pay per query)"]
        direction LR
        S1["BigQuery on-demand: $X per TB scanned"]:::strong
        S2["Redshift Serverless: pay per RPU-hour"]:::strong
        S3["Synapse Serverless: pay per TB processed"]:::strong
    end

    subgraph FLAT["Flat-rate / reservation (predictable monthly)"]
        direction LR
        F1["BigQuery editions (Standard, Enterprise, Enterprise Plus)<br/>buy slots, predictable bill"]:::infra
        F2["Redshift reserved nodes"]:::infra
    end

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

The headline change of the last few years is that all three offer **serverless** modes now. BigQuery was always serverless; Redshift Serverless and Synapse Serverless caught up.

**Cost intuition:** at low query volumes, serverless is cheapest. At sustained high volumes, provisioned/reservation tiers win. The crossover happens at the "is this our main analytics engine running all day?" point.

## Storage vs compute: the architectural divide

```mermaid
flowchart TB
    subgraph COUPLED["Old: storage and compute together"]
        direction LR
        OLD1[("Redshift dense storage nodes<br/>(historical model)")]:::store
        OLD2["scale up = bigger node, more storage AND compute"]:::weak
    end

    subgraph DECOUPLED["New: storage and compute separate"]
        direction LR
        NEW1[("storage: cheap, durable, separate")]:::store
        NEW2[("compute: scales independently,<br/>can shrink to zero")]:::strong
        NEW3["BigQuery, Redshift RA3 + RMS,<br/>Synapse serverless"]:::strong
    end

    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

Modern data warehouses all separate storage from compute. Storage is cheap and grows; compute scales up and down per workload. The whole industry converged on this around 2020.

## What actually differs

```mermaid
flowchart TB
    F1["Concurrency<br/>BigQuery: implicit, effectively unlimited<br/>Redshift: limited by cluster size or concurrency scaling<br/>Synapse: depends on DWU/SLO"]:::infra
    F2["Streaming ingest<br/>BigQuery: streaming inserts, native<br/>Redshift: federated queries on Kinesis, less native<br/>Synapse: integrates with Event Hubs"]:::infra
    F3["External tables / lake-querying<br/>BigQuery: native (external tables on GCS, BigLake)<br/>Redshift: Spectrum (queries S3 directly)<br/>Synapse: serverless pools query Data Lake directly"]:::infra
    F4["ML integration<br/>BigQuery: BQML built-in<br/>Redshift: Redshift ML (SageMaker integration)<br/>Synapse: tied to Azure ML"]:::infra
    F5["Ecosystem tools (dbt, Looker, Metabase, Tableau)<br/>All three are well-supported; BigQuery has historically been the most-loved by data engineers"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

## When to pick which

```mermaid
flowchart TB
    Q1{"Which cloud?"}:::query
    Q2{"Steady-state heavy use<br/>or spiky low-volume?"}:::query

    A1["BigQuery.<br/>Serverless by default. Lowest operational burden.<br/>BQML for in-warehouse ML."]:::strong
    A2["Redshift Serverless.<br/>If you are on AWS and want serverless with deep AWS integration."]:::strong
    A3["Redshift provisioned.<br/>Sustained high volume, predictable workload."]:::mid
    A4["Synapse / Fabric.<br/>Microsoft ecosystem, T-SQL, Power BI."]:::strong

    Q1 -->|"GCP"| A1
    Q1 -->|"AWS"| Q2
    Q2 -->|"spiky"| A2
    Q2 -->|"steady"| A3
    Q1 -->|"Azure / Microsoft"| A4

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

For new projects on any cloud, the serverless tiers are usually the right starting point. Move to provisioned only when sustained costs justify the commitment.

## Snowflake: the cross-cloud option

Snowflake (the company) runs on all three clouds and is many teams' answer when they want a warehouse that does not lock them in. The performance is competitive with the native services; the pricing is usually higher; the operational simplicity and feature consistency across clouds is the win.

## Common mistakes

- **Querying the warehouse like an OLTP database.** Joins on terabyte tables are expensive; pay for the query plan you actually wrote.
- **No partitioning / clustering.** Both clustering (Redshift, Snowflake) and partitioning (BigQuery, Synapse) drastically reduce scanned bytes. Always design for it.
- **SELECT * on a wide table.** Columnar storage means you pay for the columns you read. Be specific.
- **Warehouse for transactional workloads.** Warehouses are OLAP. Use a proper OLTP database (see [OLTP vs OLAP](/practice/system-design/concepts/014-oltp-vs-olap/)).
- **Streaming small inserts.** Warehouses prefer batches. Either use the streaming API (BigQuery streaming inserts) or batch into reasonable chunks.
- **Cost surprises.** BigQuery's per-TB-scanned model can produce surprising bills if dashboards are inefficient. Set query cost limits.
- **One warehouse for everything.** Production analytics, ad-hoc exploration, and ML feature pipelines have different access patterns. Often separate workloads or workspaces are right.

## Quick recap

- All three offer columnar SQL warehouses with separated storage and compute and serverless options.
- BigQuery: serverless from day one, lowest operational burden, per-TB pricing.
- Redshift: deepest AWS integration, both serverless and provisioned tiers.
- Synapse / Fabric: Microsoft ecosystem, T-SQL, Power BI integration.
- Pick by cloud first, by usage pattern (steady vs spiky) second.
- Partitioning, clustering, and column selection are the universal "make queries cheap" levers.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
