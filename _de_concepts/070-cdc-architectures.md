---
concept_id: 70
slug: cdc-architectures
title: "CDC-driven architectures"
tease: "When the warehouse mirrors the production database, change for change, in seconds."
section: "Architecture Patterns"
status: draft
---

Change Data Capture (CDC) streams every insert, update, and delete from a production database into the warehouse or a stream. Done well, it gives near-real-time replication without dual writes and without the source database noticing. Done badly, it falls behind and silently drops history. CDC is the foundation of every modern "real-time analytics" architecture.

```mermaid
flowchart LR
    Pg[("Postgres<br/>(production)")]:::p
    Pg -->|"WAL / logical replication"| Deb[/"Debezium / Fivetran HVR"/]:::d
    Deb --> K[("Kafka topic<br/>(one per table)")]:::k
    K --> Sink[/"Sink"/]:::s
    Sink --> WH[("Warehouse<br/>(mirrored tables)")]:::wh

    classDef p fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef d fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef k fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef s fill:#e9d5ff,stroke:#7e22ce,color:#581c87
    classDef wh fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The three implementations: Debezium (open source), Fivetran HVR (managed), database-native (Snowflake Streams).
- WAL / binlog reading: the path that does not pressure the source database.
- The outbox pattern: producing CDC events from your application without a separate logical replication slot.
- Sinks: writing into the warehouse vs into Iceberg / Delta tables.
- The operational concerns: replication slot bloat, schema change handling, replay capability.
- The cross-link to [SD #076 CDC](/practice/system-design/concepts/076-change-data-capture/) for the system-design framing.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
