---
concept_id: 18
slug: orc-vs-parquet-vs-avro
title: "ORC vs Parquet vs Avro"
tease: "Three binary formats. Each one wins in a specific job."
section: "File Formats & Storage"
status: draft
---

Parquet and ORC are columnar formats for analytics reads. Avro is row-oriented and built for streaming and message bus payloads. All three are binary, all three carry their own schema, and all three are still everywhere. Picking the right one per job is a five-minute decision that saves teams from a year of avoidable pain.

| Format | Layout | Best at | Compression | Where it lives |
|---|---|---|---|---|
| **Parquet** | Columnar | Analytics, lakehouse tables | Snappy / Zstd | S3, GCS, every warehouse |
| **ORC** | Columnar | Hive, large-scale Hadoop | Zlib / Snappy | HDFS, mostly legacy |
| **Avro** | Row-oriented | Kafka payloads, write-heavy logs | Snappy / Deflate | Kafka topics, schema registry |

```mermaid
flowchart LR
    K[("Kafka topic<br/>Avro")]:::a --> LZ[("Landing zone<br/>Avro or JSON")]:::a
    LZ --> Curate[/"Batch job"/]:::p
    Curate --> P[("Parquet<br/>analytics")]:::p
    P --> WH[("Warehouse / lake")]:::p

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef p fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The columnar vs row layout decision in one sentence.
- Why Avro dominates streaming pipelines and Parquet dominates the analytical end.
- ORC's schema evolution rules and why Parquet is catching up.
- Bloom filters in ORC and Parquet (and when they matter).
- Schema-on-write (these three) vs schema-on-read (JSON, CSV).
- The honest take: in 2026, default to Avro on the bus, Parquet at rest, ORC only if you already have it.

*Page coming soon.*

This concept sits in **Stage 5 (Storage and file formats)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
