---
concept_id: 35
slug: exactly-once-streaming
title: "Exactly-once in streaming: what it actually means"
tease: "The phrase is a marketing word until you read the fine print."
section: "Stream Processing"
status: draft
---

"Exactly-once" is the most over-claimed phrase in streaming. What it actually means: the side effects of processing an event happen exactly once, even if the system retries the event many times under the hood. Which is real, useful, and very different from "no event is ever processed twice."

```mermaid
flowchart LR
    E[("Event")] --> P[/"Stream processor<br/>(may retry internally)"/]:::p
    P -.->|"at-least-once delivery"| Out[("Sink with<br/>transactional commit")]:::g
    Out --> Effect["Side effect happens<br/>EXACTLY once"]:::done

    classDef p fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef g fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef done fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- The honest definition: exactly-once effects, not exactly-once delivery.
- Kafka transactions: how the producer writes atomic batches the consumer reads atomically.
- Flink's checkpoints + transactional sinks: the canonical exactly-once setup.
- Spark Structured Streaming's idempotent sink + checkpoint pattern.
- The two-generals fundamental limit: across network boundaries, exactly-once is built, not given.
- When at-least-once + idempotency is the simpler, often better answer.

*Page coming soon. Until then, see [#014 Exactly-once delivery](/practice/data-engineering/014-exactly-once-delivery/) for the practice problem.*

This concept sits in **Stage 4 (Streaming and event-driven)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
