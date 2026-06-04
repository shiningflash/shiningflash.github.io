---
concept_id: 9
slug: fact-vs-dimension
title: "Fact tables and dimension tables"
tease: "Things that happen, vs things that describe them."
section: "Data Modeling"
status: draft
---

A fact table holds events: orders placed, clicks, sensor readings, payments. A dimension table describes the actors and things involved: which customer, which product, which day. Facts grow forever and are mostly numbers. Dimensions are mostly text and grow slowly.

```mermaid
flowchart LR
    F[("fact_sales<br/>order_id, customer_id, product_id, date_id, amount, quantity<br/>(many rows, mostly numbers)")]:::f
    D1[("dim_customer<br/>customer_id, name, email, region")]:::d
    D2[("dim_product<br/>product_id, name, category, price")]:::d
    D3[("dim_date<br/>date_id, year, month, weekday")]:::d
    F --- D1
    F --- D2
    F --- D3

    classDef f fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef d fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The three types of fact tables: transaction, periodic snapshot, accumulating snapshot.
- Additive, semi-additive, and non-additive measures.
- Why a `dim_date` table beats `date_trunc` everywhere.
- Degenerate dimensions (order number on the fact row, no dim table).
- Junk dimensions for the leftover flags.
- The bridge table when a fact has a many-to-many with a dimension.

*Page coming soon.*

This concept sits in **Stage 2 (Data modeling and warehousing)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
