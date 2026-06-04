---
concept_id: 74
slug: reverse-etl
title: "Reverse ETL: Hightouch vs Census"
tease: "Take the modelled, cleaned warehouse data and push it back into Salesforce, Braze, Intercom, the ad networks."
section: "Cloud Comparisons"
status: draft
---

Regular ETL pulls source data into the warehouse for analytics. Reverse ETL pushes warehouse models back out to operational tools: customer scores into Salesforce, lifecycle stages into Braze, retargeting audiences into Facebook Ads. The warehouse becomes the canonical source for "who is this customer right now?" and reverse ETL is how that truth reaches the tools that use it.

```mermaid
flowchart LR
    Marts[("Warehouse marts<br/>(dim_customer + scores + lifecycle)")]:::m
    Marts --> RETL[/"Reverse ETL<br/>(Hightouch / Census)"/]:::g
    RETL --> SF[("Salesforce")]:::t
    RETL --> Braze[("Braze")]:::t
    RETL --> Ads[("Facebook Ads<br/>audience")]:::t

    classDef m fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef t fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

**What this page will cover.**

- The "data activation" trend: warehouse as the source of truth for operational tools.
- Hightouch vs Census: feature overlap is large, pricing model differs.
- Identity resolution: matching customers across systems before syncing.
- The sync model: append, update, replace, upsert.
- Reverse ETL vs CDP (Customer Data Platform): when each fits.
- The honest take: useful pattern, but only after your warehouse is genuinely the source of truth.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
