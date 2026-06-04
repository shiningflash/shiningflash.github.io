---
concept_id: 68
slug: data-mesh
title: "Data mesh: when it works and when it doesn't"
tease: "Domain teams own their data as products. Central platform team owns the rails."
section: "Architecture Patterns"
status: draft
---

Data mesh is an organisational pattern, not a technology stack. Each domain team (orders, payments, marketing) owns its own data as a product: clean, documented, tested, contract-backed. A central platform team provides the rails (warehouse, orchestrator, observability). The mesh works when teams are big enough to actually own data. It fails when small teams are forced to do platform work they cannot staff.

```mermaid
flowchart TB
    P[/"Central platform team<br/>(rails: warehouse, dbt, observability)"/]:::p
    P --> D1[("Orders domain<br/>(owns orders dataset)")]:::d
    P --> D2[("Payments domain<br/>(owns payments dataset)")]:::d
    P --> D3[("Marketing domain<br/>(owns campaigns dataset)")]:::d
    D1 -.->|"contract"| D2
    D1 -.->|"contract"| D3

    classDef p fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef d fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The four data mesh principles (Zhamak Dehghani, 2019).
- Domain-oriented ownership: who owns what dataset.
- Data as a product: SLAs, contracts, discoverability, documentation as first-class.
- Self-serve platform: the central team's job.
- Federated governance: shared standards without a central bottleneck.
- The honest take: data mesh is for organisations of 500+ engineers; smaller teams should stay centralised.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
