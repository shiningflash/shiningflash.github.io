---
concept_id: 73
slug: managed-etl-comparison
title: "Managed ETL: Fivetran vs Airbyte vs Stitch"
tease: "Don't build your own Salesforce connector. Pay someone, or use the open-source one."
section: "Cloud Comparisons"
status: draft
---

Extracting from Salesforce, Stripe, HubSpot, NetSuite, and 200 other SaaS APIs is undifferentiated work. Managed ETL tools (Fivetran, Stitch) and the open-source alternative (Airbyte) handle the connectors. They land raw data in your warehouse; you transform it with dbt. The decision is "paid managed vs open source vs build your own", almost never "build the connector yourself."

| | Fivetran | Airbyte | Stitch |
|---|---|---|---|
| **Model** | Managed, per-connector pricing | Open source + Cloud option | Managed, simpler |
| **Connector count** | 500+ | 350+ | 130+ |
| **Cost** | Higher, by Monthly Active Rows | Free self-hosted; Cloud is similar to Fivetran | Lower, by rows |
| **Best at** | Enterprise, lots of sources | Cost-sensitive teams, niche sources | Simpler use cases |

```mermaid
flowchart LR
    SaaS[("SaaS APIs<br/>(Salesforce, Stripe, HubSpot, ...)")]:::a --> Tool[/"ETL tool"/]:::g
    Tool --> WH[("Warehouse raw layer")]:::w
    WH --> dbt[/"dbt transforms"/]:::g
    dbt --> Marts[("Warehouse marts")]:::m

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef w fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef m fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- Why "build the Salesforce connector ourselves" is one of the most expensive decisions a team makes.
- Fivetran's MAR (Monthly Active Rows) pricing and how to forecast it.
- Airbyte self-hosted: real operations cost, not free in practice.
- Stitch as the "Fivetran-lite" option, owned by Talend.
- The Sling and dlt newer entrants and where they fit.
- The 2026 honest take: pay for it unless you have a real cost or compliance reason not to.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
