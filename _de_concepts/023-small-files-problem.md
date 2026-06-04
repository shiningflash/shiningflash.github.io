---
concept_id: 23
slug: small-files-problem
title: "The small-files problem"
tease: "Ten thousand tiny Parquet files will outscore your query even if the data is tiny."
section: "File Formats & Storage"
status: draft
---

Object stores charge per file operation and metadata lookup. Query engines spend more time opening 10,000 1-MB files than 100 100-MB files, even though the total bytes are identical. This is the small-files problem. Every streaming pipeline produces it. Every analyst notices it. The fix is compaction.

```mermaid
flowchart LR
    subgraph S["Small files (bad)"]
        F1[("1 MB")]
        F2[("1 MB")]
        F3[("1 MB")]
        Fdots["... × 10,000"]
    end
    subgraph M["After compaction (good)"]
        G1[("256 MB")]
        G2[("256 MB")]
        G3[("256 MB")]
        Gdots["... × 40"]
    end
    S --> C[/"Compaction job"/]:::c --> M

    classDef c fill:#fef3c7,stroke:#a16207,color:#713f12
```

**What this page will cover.**

- Where small files come from: streaming, partitioned writes, every-row inserts.
- The 128 MB to 512 MB sweet spot per file for most engines.
- Manual compaction: rewrite a partition's files into fewer larger ones.
- Auto-compaction: Delta's `OPTIMIZE`, Iceberg's rewrite_data_files, Hudi's clustering.
- Why partitioning too aggressively guarantees small files.
- The "10x bytes scanned for 0.1x rows returned" debug signature.

*Page coming soon.*

This concept sits in **Stage 5 (Storage and file formats)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
