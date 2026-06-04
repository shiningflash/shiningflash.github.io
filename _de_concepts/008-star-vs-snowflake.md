---
concept_id: 8
slug: star-vs-snowflake
title: "Star schema vs snowflake schema"
tease: "One fact table in the middle. Dimensions flat or normalised."
section: "Data Modeling"
status: draft
---

A star schema puts one fact table in the middle with denormalised dimension tables hanging off it. A snowflake schema does the same but normalises the dimensions further into smaller tables. Star reads faster. Snowflake stores tighter. Most warehouses pick star and accept the duplication.

```mermaid
flowchart LR
    subgraph S["Star"]
        F1[("fact_sales")]:::f
        D1[("dim_product<br/>(flat)")]:::d
        D2[("dim_customer<br/>(flat)")]:::d
        D3[("dim_date<br/>(flat)")]:::d
        F1 --- D1
        F1 --- D2
        F1 --- D3
    end
    subgraph SN["Snowflake"]
        F2[("fact_sales")]:::f
        DP[("dim_product")]:::d
        DC[("dim_category")]:::d
        DB[("dim_brand")]:::d
        F2 --- DP
        DP --- DC
        DP --- DB
    end

    classDef f fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef d fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- When star wins: fewer joins, simpler dashboards, denormalised by design.
- When snowflake makes sense: regulated industries where dimension truth must be normalised.
- The "galaxy" / fact-constellation when you have multiple fact tables sharing dimensions.
- Why columnar warehouses make the snowflake performance argument almost moot.
- The cost of denormalisation: keeping dimension rebuilds consistent.

*Page coming soon.*

This concept sits in **Stage 2 (Data modeling and warehousing)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
