---
concept_id: 33
slug: watermarks
title: "Watermarks: the unintuitive part of streaming"
tease: "How a streaming system decides it has 'seen enough' of a time window to compute a result."
section: "Stream Processing"
status: draft
---

A watermark is the streaming system's bet that no events older than time `T` will arrive any more. It is what lets the system close a window and emit a result instead of waiting forever. Pick a watermark that is too aggressive and you drop late events. Pick one too conservative and your dashboards lag.

```mermaid
flowchart LR
    Events["Events arrive<br/>(out of order)"]:::e --> Stream[/"Stream"/]:::p
    Stream --> WM["Watermark =<br/>max(event_time) - delay"]:::w
    WM --> Decide{"event_time < WM?"}:::q
    Decide -->|"yes"| Late["Late: dropped or<br/>routed to side output"]:::r
    Decide -->|"no"| Buffer["Buffer until<br/>window closes"]:::g

    classDef e fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef p fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef w fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef q fill:#e9d5ff,stroke:#7e22ce,color:#581c87
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- The watermark formula: `max event_time seen` minus a delay.
- Why a 5-second delay drops most mobile events and a 5-minute delay is more honest.
- Bounded-out-of-orderness in Flink vs the watermark generator in Kafka Streams.
- The trade between dashboard freshness and capturing late stragglers.
- The "allowed lateness" setting: emit a result, then update it when late events arrive.
- The side output for events past the cut-off, so you never lose them entirely.

*Page coming soon. Until then, see [#092 Late events after the partition closed](/practice/data-engineering/092-late-events-after-the-partition-closed/) for the practice problem.*

This concept sits in **Stage 4 (Streaming and event-driven)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
