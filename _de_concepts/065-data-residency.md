---
concept_id: 65
slug: data-residency
title: "Data residency in multi-region warehouses"
tease: "EU data stays in the EU. US data stays in the US. The warehouse must enforce it."
section: "Security & Privacy"
status: draft
---

Data residency is the legal requirement that personal data stay in a specific geographic region. EU citizens' data, by GDPR, must be processed and stored in the EU (with narrow exceptions). The warehouse has to enforce this: separate accounts per region, replication boundaries, query routing.

```mermaid
flowchart LR
    subgraph EU["EU region (eu-west-1)"]
        EUWH[("Warehouse: EU")]:::eu
        EUDash[("EU dashboards")]:::eu
    end
    subgraph US["US region (us-east-1)"]
        USWH[("Warehouse: US")]:::us
        USDash[("US dashboards")]:::us
    end
    Block[/"Block: no cross-region join<br/>that mixes personal data"/]:::r

    EUWH -.->|"x"| Block -.->|"x"| USWH

    classDef eu fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef us fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Snowflake / BigQuery / Databricks region selection at account or dataset level.
- The Schrems II ruling and what it means for US warehouses holding EU data.
- Standard Contractual Clauses and supplementary measures.
- Aggregation across regions: yes for non-PII metrics, no for personal-level joins.
- The architecture decision: regional warehouses + a global metrics layer with no PII.
- The honest take: data residency is a compliance and architecture problem, not just a button.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
