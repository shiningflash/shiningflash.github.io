---
concept_id: 14
slug: one-big-table-vs-normalised
title: "One Big Table vs normalised"
tease: "The pattern modern warehouses keep nudging you toward."
section: "Data Modeling"
status: draft
---

A normalised star schema joins a fact table to several dimension tables at query time. One Big Table (OBT) flattens all of that into a single wide table, with denormalised dimension columns repeated on every fact row. Columnar warehouses make this cheap, and BI tools love it.

```mermaid
flowchart LR
    subgraph N["Normalised (star)"]
        F1[("fact_sales")] --- D1[("dim_customer")]
        F1 --- D2[("dim_product")]
        F1 --- D3[("dim_date")]
    end
    subgraph OBT["One Big Table"]
        T1[("sales_obt<br/>order_id, customer_name, customer_region,<br/>product_name, product_category,<br/>date, year, month, amount, ...")]
    end

    classDef _ fill:#dcfce7,stroke:#15803d,color:#14532d
    class F1,D1,D2,D3,T1 _
```

**What this page will cover.**

- Why columnar storage flips the cost of denormalisation (you only read the columns you query).
- The dbt + Looker / Mode workflow that defaults to OBT.
- When OBT wins: dashboards, exports, BI tools, anything column-oriented.
- When normalisation still wins: large dimensions that change often, source-of-truth tables.
- The middle ground: a star at the bronze/silver layer, OBT at the gold layer.
- The cost: storage and rebuild time grow with every column.

*Page coming soon.*

This concept sits in **Stage 2 (Data modeling and warehousing)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
