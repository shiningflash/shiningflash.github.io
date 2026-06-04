---
concept_id: 45
slug: schema-tests
title: "Schema tests: not null, unique, FK, accepted values"
tease: "The four tests that catch 80% of data bugs before a dashboard sees them."
section: "Data Quality & Contracts"
status: draft
---

Schema tests run after every model load and assert the shape of the data: this column is never null, this column is unique, this column only contains values from a known set, and this foreign key always matches a row in the parent table. They are cheap, fast, and catch most pipeline bugs.

```mermaid
flowchart LR
    Load[/"Model loads"/]:::a --> Tests
    subgraph Tests["Schema tests"]
        T1["not_null(id)"]:::g
        T2["unique(order_id)"]:::g
        T3["accepted_values(status: ['new','done'])"]:::g
        T4["relationships(customer_id → dim_customer)"]:::g
    end
    Tests --> Result{"All pass?"}:::q
    Result -->|"yes"| Pass[("Publish")]:::done
    Result -->|"no"| Fail[("Block + alert")]:::bad

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef q fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef done fill:#bbf7d0,stroke:#16a34a,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- The four canonical tests: `not_null`, `unique`, `accepted_values`, `relationships`.
- The dbt YAML where they live and the SQL they compile to.
- Why these four catch 80% of upstream bugs before any user is affected.
- Severity levels: warn vs fail vs error. When to use each.
- The "test on every model" rule and the cost trade-off it sets.
- The CI hook that runs them on every PR.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
