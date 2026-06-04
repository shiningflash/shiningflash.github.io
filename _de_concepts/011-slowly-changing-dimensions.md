---
concept_id: 11
slug: slowly-changing-dimensions
title: "Slowly Changing Dimensions (Type 1, 2, 3, 4, 6)"
tease: "When a customer moves city, what do old orders say?"
section: "Data Modeling"
status: draft
---

A customer's city used to be Berlin. Now it is Stockholm. Should last year's orders still show Berlin or now show Stockholm? There is no universally right answer — it depends on what people will ask the dashboard. Slowly Changing Dimensions (SCDs) are the named patterns for handling this.

```mermaid
flowchart TB
    T1["Type 1<br/>overwrite<br/>(no history)"]:::a
    T2["Type 2<br/>new row per change<br/>+ valid_from / valid_to"]:::b
    T3["Type 3<br/>previous_value column<br/>(one version of history)"]:::c
    T4["Type 4<br/>history in a side table"]:::d
    T6["Type 6<br/>Type 1 + Type 2 + Type 3<br/>(everything, mostly Type 2)"]:::e

    classDef a fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef b fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef c fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef d fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef e fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- Each SCD type with one concrete question it answers.
- Why Type 2 is the most common in real warehouses.
- The `valid_from`, `valid_to`, `is_current` triple for Type 2.
- The MERGE pattern that loads a Type 2 dimension without breaking history.
- Type 0: the "never change this" version (regulatory data).
- The dbt snapshot pattern for Type 2 the easy way.

*Page coming soon. Until then, see [#010 Slowly Changing Dimensions](/practice/data-engineering/010-slowly-changing-dimensions/) for the practice problem.*

This concept sits in **Stage 2 (Data modeling and warehousing)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
