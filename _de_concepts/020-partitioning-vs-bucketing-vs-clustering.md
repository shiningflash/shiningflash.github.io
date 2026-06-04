---
concept_id: 20
slug: partitioning-vs-bucketing-vs-clustering
title: "Partitioning vs bucketing vs clustering"
tease: "Three ways to organise files so queries scan less."
section: "File Formats & Storage"
status: draft
---

A query that filters by date is fast when the data is partitioned by date — the engine can skip every other folder. Bucketing groups rows into a fixed number of files by a hash. Clustering (Z-ordering, sort-keys) physically sorts rows so range scans stay tight. All three move the same lever: read fewer bytes per query.

```mermaid
flowchart TB
    subgraph P["Partitioning"]
        P1["/year=2026/month=06/"]
        P2["/year=2026/month=07/"]
        P3["/year=2026/month=08/"]
    end
    subgraph B["Bucketing (16 buckets by customer_id hash)"]
        B1["bucket_00.parquet"]
        B2["bucket_01.parquet"]
        Bdots["..."]
        B16["bucket_15.parquet"]
    end
    subgraph C["Clustering (sorted within files)"]
        C1["rows sorted by (date, region)<br/>→ range scans stay tight"]
    end
```

**What this page will cover.**

- When to partition (and when over-partitioning makes things worse).
- The "10x rule": each partition should hold roughly 1 GB+ of data.
- Bucketing in Hive/Spark vs Snowflake's automatic clustering.
- Z-ordering in Delta and Iceberg's sort-order spec.
- BigQuery's clustering (free, automatic, up to 4 columns).
- The decision tree: partition by the column you filter on, cluster by what you join on.

*Page coming soon. Until then, see [#006 Partitioning vs clustering in BigQuery](/practice/data-engineering/006-partitioning-vs-clustering-in-bigquery/) for the practice problem.*

This concept sits in **Stage 5 (Storage and file formats)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
