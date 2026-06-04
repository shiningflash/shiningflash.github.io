---
concept_id: 30
slug: broadcast-vs-shuffle-joins
title: "Broadcast joins vs shuffle joins"
tease: "Send a small table to every executor. Avoid the shuffle entirely."
section: "Batch Processing"
status: draft
---

A shuffle join regroups both sides of a join across the cluster so matching keys land on the same executor. A broadcast join skips that: it ships the smaller table to every executor in full, and the larger table never moves. When the smaller table fits in memory, broadcast wins by a wide margin.

```mermaid
flowchart LR
    subgraph S["Shuffle join (both sides move)"]
        L1[("Large table<br/>partitioned by key")] --> Sh[/"Shuffle"/]:::n
        R1[("Small table<br/>partitioned by key")] --> Sh
        Sh --> J1[/"Join per executor"/]:::g
    end
    subgraph B["Broadcast join (small side shipped to all)"]
        L2[("Large table<br/>stays put")] --> J2[/"Join per executor<br/>using broadcast copy"/]:::g
        R2[("Small table<br/>broadcast to all")] --> J2
    end

    classDef n fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The Spark threshold (`spark.sql.autoBroadcastJoinThreshold`, default ~10 MB) and when to raise it.
- Manually hinting a broadcast: `broadcast(df)` in PySpark, `BROADCAST` hint in SQL.
- When broadcast goes wrong: small table is actually 2 GB after decompression, executors OOM.
- Cross-join with broadcast as the deliberate way to enumerate combinations.
- Sort-merge join vs shuffle hash join: the two non-broadcast options.
- Why dimension tables on the broadcast side is the default for star-schema queries.

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
