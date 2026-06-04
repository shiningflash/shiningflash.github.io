---
concept_id: 36
slug: stateful-vs-stateless-streams
title: "Stateful vs stateless streams"
tease: "Some streaming jobs remember nothing. Others remember everything. The cost is different."
section: "Stream Processing"
status: draft
---

A stateless stream transforms one event at a time and produces one output. Filter, map, parse, format. A stateful stream remembers things across events: counts, joins, windows, dedup sets. State has to live somewhere durable so the job can recover from a crash. State changes everything about how you size, operate, and reason about the pipeline.

```mermaid
flowchart LR
    subgraph SL["Stateless"]
        E1[("Event")] --> M1["Parse / filter / map"]:::g --> O1[("Output")]
    end
    subgraph ST["Stateful"]
        E2[("Event")] --> M2["Update state<br/>(count, join key, window)"]:::w
        M2 --> SS[("State store<br/>RocksDB / changelog topic")]:::s
        SS --> M2
        M2 --> O2[("Output")]
    end

    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef w fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef s fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

**What this page will cover.**

- Examples of stateless: parsing JSON, filtering by region, masking a column.
- Examples of stateful: counts per minute, deduplication, stream-to-stream joins.
- Where state lives: RocksDB on the executor, backed by a Kafka changelog topic.
- Checkpoints: the snapshot that lets the job restart without losing state.
- Why a 30-minute session window for 10 million users needs serious memory planning.
- The "expire old state" rule that every stateful job needs or it OOMs eventually.

*Page coming soon.*

This concept sits in **Stage 4 (Streaming and event-driven)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
