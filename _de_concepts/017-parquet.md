---
concept_id: 17
slug: parquet
title: "Parquet, deeply"
tease: "The columnar file format every analytics tool reads. What's inside it."
section: "File Formats & Storage"
status: draft
---

Parquet is the default analytics file format in 2026. Spark reads it. DuckDB reads it. Snowflake imports from it. BigQuery exports to it. Every lakehouse table format (Delta, Iceberg, Hudi) wraps Parquet files. Knowing what is inside a Parquet file explains 90% of why one query is fast and another is slow.

```mermaid
flowchart TB
    F[("Parquet file")]:::f
    F --> RG1["Row group 1<br/>(50-500 MB)"]
    F --> RG2["Row group 2"]
    F --> RG3["Row group N"]
    RG1 --> CC1["Column chunk: id"]
    RG1 --> CC2["Column chunk: name"]
    RG1 --> CC3["Column chunk: amount"]
    CC1 --> P["Pages (8 KB)<br/>encoded + compressed"]
    F --> FT["Footer<br/>schema + row group stats"]

    classDef f fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- Row groups, column chunks, pages — what each level holds.
- The footer: schema, min/max per column per row group, where the predicate pushdown lives.
- Encoding: dictionary, RLE, bit-packing. Why "low-cardinality string" is the cheapest column you can store.
- Compression on top of encoding: Snappy by default, Zstd when storage matters.
- Why row group size of 128-512 MB hits the sweet spot for most engines.
- Reading a single column without touching the rest. The killer feature.

*Page coming soon. Until then, see [#012 Parquet vs CSV vs JSON](/practice/data-engineering/012-parquet-vs-csv-vs-json/) for the practice problem.*

This concept sits in **Stage 5 (Storage and file formats)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
