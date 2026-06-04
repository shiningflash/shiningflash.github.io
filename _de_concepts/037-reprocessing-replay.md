---
concept_id: 37
slug: reprocessing-replay
title: "Reprocessing and replay"
tease: "Re-running a stream against history, without breaking the live one."
section: "Stream Processing"
status: draft
---

A bug ships in your streaming job. You fix it. Now you need to re-run the last 7 days of events with the new code. Replay is the streaming version of backfill: rewind the Kafka offsets, run the job on history, write to a new output, then cut over. The shape is the same; the operational care is harder because you have a live consumer to protect.

```mermaid
flowchart LR
    K[("Kafka topic<br/>(retention: 7 days)")]:::k
    K --> Live[/"Live job<br/>(reading latest offsets)"/]:::l
    K --> Replay[/"Replay job<br/>(starts from 7 days ago)"/]:::r
    Live --> Out1[("Sink: prod_table")]:::out
    Replay --> Out2[("Sink: prod_table_v2<br/>(separate)")]:::out
    Out2 --> Cutover[/"Cut over<br/>when caught up"/]:::cut
    Cutover --> Out1

    classDef k fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef l fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef r fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef out fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cut fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The Kappa architecture: replay-as-a-feature, no separate batch layer.
- Required for replay: a Kafka topic with enough retention or a re-readable source.
- The "new consumer group, new sink table" pattern that keeps live untouched.
- Throttling replay so it does not blow the Kafka egress budget.
- Verification before cut-over: do the row counts match? Do the spot checks line up?
- The cost: replay is expensive; rebuild only what you have to.

*Page coming soon.*

This concept sits in **Stage 4 (Streaming and event-driven)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
