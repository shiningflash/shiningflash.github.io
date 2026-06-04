---
concept_id: 51
slug: data-observability
title: "What data observability means"
tease: "The five signals that tell you the data is healthy. The vocabulary the field landed on."
section: "Observability & SLOs"
status: draft
---

Data observability is the practice of monitoring five things automatically: freshness, volume, schema, distribution, and lineage. Together they answer "is the data healthy?" without anyone running a query. Originally framed by Monte Carlo, now industry-standard vocabulary.

```mermaid
flowchart LR
    DO["Data observability"]:::a
    DO --> F["Freshness<br/>(is it new enough?)"]:::g
    DO --> V["Volume<br/>(is the row count expected?)"]:::g
    DO --> S["Schema<br/>(have the columns changed?)"]:::g
    DO --> D["Distribution<br/>(are values within range?)"]:::g
    DO --> L["Lineage<br/>(where did it come from?)"]:::g

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The five signals in detail with one example each.
- Tooling landscape: Monte Carlo, Anomalo, Datafold, Soda, Bigeye, Elementary (open source).
- DIY data observability with dbt + Elementary + Slack alerts.
- Why "alert on every anomaly" is the wrong default; alert on tested invariants.
- Connecting to incident response: a data alert should produce a ticket, not a Slack ping.
- The honest take: start with freshness + volume + schema. Distribution and lineage come later.

*Page coming soon. Until then, see [#084 Data observability: freshness, volume, drift](/practice/data-engineering/084-data-observability-freshness-volume-drift/) for the practice problem.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
