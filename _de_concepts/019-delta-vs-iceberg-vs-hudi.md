---
concept_id: 19
slug: delta-vs-iceberg-vs-hudi
title: "Delta Lake vs Apache Iceberg vs Apache Hudi"
tease: "Three table formats over Parquet files. They give you transactions, time travel, and schema evolution."
section: "File Formats & Storage"
status: draft
---

Raw Parquet on S3 is fast to read but cannot do updates, deletes, transactions, or time travel. A table format adds a layer of metadata on top of Parquet so you can. Delta Lake (Databricks), Apache Iceberg (Netflix, now everywhere), and Apache Hudi (Uber) all solve the same problem. They picked different trade-offs.

```mermaid
flowchart TB
    subgraph T["Table format layer"]
        M[("Metadata: snapshots, schema,<br/>partition spec, file list")]:::m
    end
    subgraph P["Parquet files (S3 / GCS / ADLS)"]
        F1[("part-001.parquet")]:::f
        F2[("part-002.parquet")]:::f
        F3[("part-003.parquet")]:::f
    end
    M --> F1
    M --> F2
    M --> F3
    Q[/"Query engine<br/>(Spark, DuckDB, Trino...)"/]:::q --> M

    classDef m fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef f fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef q fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

**What this page will cover.**

- ACID on top of object storage: how each one does it without a database.
- Time travel: query a table as of a previous version or timestamp.
- Schema evolution: add, drop, rename columns without rewriting files.
- Partition evolution: change the partition column without breaking history.
- Delta vs Iceberg vs Hudi: who is best at what (Delta = Databricks, Iceberg = open ecosystem, Hudi = write-heavy / CDC).
- The 2026 honest take: pick Iceberg unless you are on Databricks.

*Page coming soon. Until then, see [#013 Data lake vs warehouse vs lakehouse](/practice/data-engineering/013-data-lake-vs-warehouse-vs-lakehouse/) for the practice problem.*

This concept sits in **Stage 5 (Storage and file formats)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
