---
concept_id: 15
slug: data-vault
title: "Data Vault modeling"
tease: "Hubs, links, and satellites. When dimensional modeling is not enough."
section: "Data Modeling"
status: draft
---

Data Vault is a modeling approach that separates business keys, relationships, and changing attributes into three table types. It is built for warehouses that ingest from many source systems, need full audit trails, and expect the schema to keep changing. The cost is more tables and more joins. The win is a model that absorbs change instead of breaking under it.

```mermaid
flowchart LR
    H1[("Hub customer<br/>business key only")]:::h
    H2[("Hub order<br/>business key only")]:::h
    L1[("Link<br/>customer ↔ order")]:::l
    S1[("Satellite customer<br/>attributes + load_dt")]:::s
    S2[("Satellite order<br/>attributes + load_dt")]:::s

    H1 --- L1 --- H2
    H1 --- S1
    H2 --- S2

    classDef h fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef l fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- The three table types: hubs, links, satellites — what each holds.
- Why every satellite is append-only and includes a `load_dt`.
- How Data Vault handles multiple source systems for the same entity.
- When Data Vault makes sense: regulated industries, M&A-heavy companies, source systems that change often.
- The "Raw Vault" and "Business Vault" layers.
- Why most teams don't need Data Vault and a star schema fits better.

*Page coming soon.*

This concept sits in **Stage 2 (Data modeling and warehousing)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
