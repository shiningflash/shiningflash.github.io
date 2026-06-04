---
concept_id: 31
slug: udf-costs
title: "UDFs: the hidden costs in Spark and SQL warehouses"
tease: "User-defined functions look free. They are not."
section: "Batch Processing"
status: draft
---

A UDF (user-defined function) lets you call your own code from SQL or Spark. It feels like a free upgrade: write Python or Java, plug it in, done. But UDFs break the engine's ability to optimise: no predicate pushdown, no vectorised execution, often a row-by-row Python interpreter loop. The same job in pure SQL can be 10-100x faster.

```mermaid
flowchart LR
    subgraph N["Native SQL / built-in"]
        N1[("Columnar input")] --> N2[/"Vectorised, batched<br/>(100x faster)"/]:::g
    end
    subgraph U["UDF (Python row-by-row)"]
        U1[("Row")] --> U2[/"Serialise → Python → deserialise"/]:::r
        U2 --> U3[("Row")]
        U3 -.->|"repeat 1 billion times"| U2
    end

    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Why a Python UDF in Spark serialises every row through PySpark, killing throughput.
- Pandas UDFs (vectorised UDFs) as the middle ground: 10-50x faster than row UDFs.
- Native SQL alternatives: regex functions, `transform`, `array_*` functions, JSON helpers.
- BigQuery JavaScript UDFs vs SQL UDFs vs `REMOTE FUNCTION` (Cloud Function).
- Snowflake's Java / Python / SQL UDF tiers and the cost difference.
- The rule of thumb: if a native SQL function can do it, never reach for a UDF.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
