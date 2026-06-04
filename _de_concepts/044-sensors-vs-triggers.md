---
concept_id: 44
slug: sensors-vs-triggers
title: "Sensors vs triggers vs event-driven"
tease: "Three ways to start a job when something arrives, with very different operational costs."
section: "Orchestration"
status: draft
---

A sensor polls: every minute it asks "is the file there yet?" A trigger waits efficiently: it registers interest and is notified when the event happens. Event-driven flips it around: an external system pushes a webhook or a message that fires the DAG. Each of these has a place; sensors are the most abused tool in modern orchestration.

```mermaid
flowchart LR
    Sen["Sensor<br/>(polling, holds a worker)"]:::r --> Cost1["Cost: idle worker, slow detection"]:::bad
    Tri["Trigger<br/>(deferred, async)"]:::y --> Cost2["Cost: same logic, no idle worker"]:::ok
    Evt["Event-driven<br/>(webhook / Kafka / SNS)"]:::g --> Cost3["Cost: external dependency, but real-time"]:::ok

    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef ok fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- Airflow Sensors: the original poller. Worker-slot cost.
- Deferrable operators (Airflow 2.2+) that solve the worker-slot cost.
- Dagster's asset sensors and the asset-graph way of representing "wait for upstream."
- Event-driven: SNS / SQS / Pub/Sub / Kafka triggers, plus webhook receivers.
- The honest decision tree: sensor only when no event is available, deferrable always preferred.
- The "missed event" problem and how to recover (a periodic sanity-check sensor as backup).

*Page coming soon.*

This concept sits in **Stage 3 (Batch pipelines and orchestration)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
