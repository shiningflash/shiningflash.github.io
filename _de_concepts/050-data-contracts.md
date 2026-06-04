---
concept_id: 50
slug: data-contracts
title: "Data contracts between teams"
tease: "An agreement, in code, about what a producer promises and what consumers can assume."
section: "Data Quality & Contracts"
status: draft
---

A data contract is a versioned, machine-readable agreement: the schema, the SLA, the freshness target, the allowed-values list, the owner. The producer commits to it. The consumer can read it. Changes to the contract go through a review process, not a Slack message at 4 p.m. on a Friday.

```mermaid
flowchart LR
    Prod[("Producer team<br/>(emits events)")]:::p --> Contract[/"Contract<br/>(schema + SLA + owner)"/]:::c
    Contract --> Cons1[("Consumer A")]:::g
    Contract --> Cons2[("Consumer B")]:::g
    Contract --> Cons3[("Consumer C")]:::g
    Contract -.->|"CI tests every push"| Gate{"Compatible?"}:::q
    Gate -->|"yes"| Pass[("Merge")]
    Gate -->|"no"| Fail[("Block + escalate")]:::r

    classDef p fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef c fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef q fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- What a contract holds: schema, semantics, freshness, ownership, change policy.
- Schema-as-contract: Avro + schema registry as the canonical implementation.
- The "additive change vs breaking change" rule.
- The producer's CI gate: a schema change cannot merge without compatibility checks.
- Why contracts solve the "every team built its own customer model" problem.
- The 2026 ecosystem: dbt's data contracts feature, Apache Iceberg's view definitions, Soda contracts.

*Page coming soon. Until then, see [#011 Data contracts in plain words](/practice/data-engineering/011-data-contracts-in-plain-words/) for the practice problem.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
