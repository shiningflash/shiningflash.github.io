---
concept_id: 34
slug: windowing
title: "Windowing: tumbling, sliding, session"
tease: "Three ways to chop an unbounded stream into bounded chunks."
section: "Stream Processing"
status: draft
---

A stream is unbounded: it never ends. To compute anything useful, you have to chop it into bounded chunks called windows. Tumbling windows are fixed and non-overlapping. Sliding windows overlap. Session windows close after a gap of inactivity. Each one answers a different question.

```mermaid
flowchart TB
    subgraph T["Tumbling (1 min, non-overlap)"]
        T1["[12:00, 12:01)"]:::a
        T2["[12:01, 12:02)"]:::a
        T3["[12:02, 12:03)"]:::a
    end
    subgraph S["Sliding (5 min window, 1 min step)"]
        S1["[11:56, 12:01)"]:::b
        S2["[11:57, 12:02)"]:::b
        S3["[11:58, 12:03)"]:::b
    end
    subgraph G["Session (gap = 30s)"]
        G1["user A: 12:00 to 12:04<br/>(closes after 30s of silence)"]:::c
    end

    classDef a fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef b fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef c fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- Tumbling: "events per minute" dashboards. Simplest, most common.
- Sliding: "rolling 5-minute average updated every 30 seconds." More state, more cost.
- Session: per-user activity bursts. The window length is data-dependent.
- Custom windowing: "all events for this order ID" or "until the cart closes."
- Window state size and why a 1-day session window can explode memory.
- The Flink and Kafka Streams APIs for each, side by side.

*Page coming soon.*

This concept sits in **Stage 4 (Streaming and event-driven)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
