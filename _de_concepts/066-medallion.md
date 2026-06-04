---
concept_id: 66
slug: medallion
title: "Medallion architecture: bronze, silver, gold"
tease: "Three layers, each one cleaner and more refined than the last."
section: "Architecture Patterns"
status: draft
---

The medallion architecture organises a lakehouse into three layers. **Bronze** holds raw data, exactly as it arrived. **Silver** holds cleaned, deduplicated, validated data. **Gold** holds the business-level marts that dashboards and ML models read. Each layer has different freshness, quality, and access requirements. The pattern came from Databricks and is now standard.

```mermaid
flowchart LR
    Src[("Sources<br/>(APIs, CDC, files)")]:::s
    Src --> B[("Bronze<br/>raw, append-only<br/>full fidelity")]:::b
    B --> S[("Silver<br/>cleaned, typed,<br/>deduplicated")]:::sv
    S --> G[("Gold<br/>business marts,<br/>denormalised, aggregated")]:::g
    G --> Use[("Dashboards, ML, exports")]:::u

    classDef s fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef sv fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef g fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef u fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- What each layer holds, in one sentence.
- The "raw is the source of truth" principle: bronze is never modified.
- The dbt convention: `staging` (silver-ish), `intermediate`, `marts` (gold).
- Freshness expectations: bronze is real-time, gold is daily, intermediate is whatever.
- Why "skip silver and go straight to gold" is the most common medallion sin.
- Access patterns: who reads which layer, and the security implications.

*Page coming soon. Until then, see [#099 No staging layer: everything touches raw](/practice/data-engineering/099-no-staging-layer-everything-touches-raw/) for the practice problem.*

This concept sits in **Stage 2 (Data modeling and warehousing)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
