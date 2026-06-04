---
concept_id: 22
slug: schema-evolution
title: "Schema evolution in columnar formats"
tease: "Add a column. Rename a column. Drop a column. Without rewriting the world."
section: "File Formats & Storage"
status: draft
---

A table that has lived for a year has been written by different code versions. Some files have a `country` column. Newer files have `country_code` instead. Older files have no `email_verified` flag at all. Schema evolution rules say which of these changes a reader can still handle without rewriting every file in the table.

```mermaid
flowchart LR
    Old[("Old files<br/>id, name, country")]:::o
    New[("New files<br/>id, name, country_code, email_verified")]:::n
    Read[/"Reader<br/>(Spark, DuckDB, Trino)"/]:::r
    Old --> Read
    New --> Read
    Read --> Out[("Unified result<br/>old columns NULL where missing")]:::g

    classDef o fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef n fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef r fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#fef3c7,stroke:#a16207,color:#713f12
```

**What this page will cover.**

- The safe changes: add a column (default NULL), drop a column, widen a numeric type.
- The risky changes: rename a column, narrow a type, change a column's type.
- Why Iceberg's column IDs make renames cheap and Parquet's name-based matching makes them painful.
- How Avro's schema registry handles forward and backward compatibility for streaming.
- Backfill vs evolve: when you have to rewrite the old files anyway.
- The contract: never silently allow a breaking change.

*Page coming soon.*

This concept sits in **Stage 5 (Storage and file formats)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
