---
concept_id: 66
slug: messaging-sqs-pubsub-servicebus
title: "Managed messaging: SQS/SNS vs Pub/Sub vs Service Bus"
tease: "Throughput, semantics, ordering."
section: "Cloud Comparisons"
status: live
---

Every cloud has a managed messaging service. AWS splits it into SQS (queue) and SNS (topic / fan-out). GCP has Pub/Sub that does both natively. Azure has Service Bus (broker with rich routing) and Event Grid (event-driven fan-out). The choice mostly tracks your cloud, but the semantics differ in delivery guarantees, ordering, and what scales naturally.

## The three at a glance

```mermaid
flowchart TB
    subgraph AWS["AWS — split: SQS + SNS"]
        direction LR
        S1[("SQS: point-to-point queue,<br/>at-least-once, FIFO option")]:::server
        S2[("SNS: pub/sub topic,<br/>fan-out to SQS / Lambda / HTTP")]:::server
        S3[("standard pattern:<br/>SNS → many SQS queues")]:::server
    end

    subgraph GCP["GCP Pub/Sub"]
        direction LR
        G1[("one service: pub/sub + queue semantics")]:::server
        G2[("global by default,<br/>strong scaling story")]:::server
        G3[("at-least-once with deduplication option;<br/>ordering keys for per-key order")]:::server
    end

    subgraph AZ["Azure"]
        direction LR
        A1[("Service Bus: broker with rich routing,<br/>queues + topics + subscriptions")]:::server
        A2[("Event Grid: lightweight event fan-out")]:::server
        A3[("Event Hubs: high-throughput stream<br/>(Kafka-like)")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## How each handles the two shapes

The two recurring shapes (see [Pub/sub vs point-to-point queue](/practice/system-design/concepts/035-pubsub-vs-queue/)) map to the cloud offerings differently:

```mermaid
flowchart TB
    subgraph WORK["Work distribution (queue — one consumer per message)"]
        direction LR
        W1["AWS: SQS"]:::strong
        W2["GCP: Pub/Sub with a single subscription, shared consumers"]:::strong
        W3["Azure: Service Bus queue"]:::strong
    end

    subgraph FANOUT["Fan-out (pub/sub — many consumers, one message each)"]
        direction LR
        F1["AWS: SNS to many SQS queues<br/>(the classic SNS+SQS pattern)"]:::mid
        F2["GCP: Pub/Sub topic with many subscriptions"]:::strong
        F3["Azure: Service Bus topic + subscriptions,<br/>or Event Grid"]:::strong
    end

    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

GCP Pub/Sub does both natively in one product, which is the cleanest mental model. AWS makes you compose SNS and SQS, which works but requires understanding both. Azure has three different services depending on shape, which is more flexible but more decisions upfront.

## What actually differs

```mermaid
flowchart TB
    F1["Throughput<br/>SQS Standard: unlimited<br/>SNS: unlimited<br/>GCP Pub/Sub: very high, global<br/>Service Bus: ~2,000 messages/sec/queue (Premium higher)<br/>Event Hubs: Kafka-class"]:::infra
    F2["Ordering<br/>SQS FIFO: per message-group<br/>GCP Pub/Sub: per ordering-key<br/>Service Bus: per session<br/>Standard / non-FIFO: best-effort only"]:::infra
    F3["Delivery semantics<br/>All offer at-least-once<br/>SQS FIFO and Pub/Sub Exactly-Once (regional) approximate exactly-once<br/>Build idempotent consumers regardless"]:::infra
    F4["Retention<br/>SQS: up to 14 days<br/>Pub/Sub: up to 31 days (acked) / 7 days (unacked)<br/>Service Bus: unlimited up to size cap"]:::infra
    F5["Dead-letter queues<br/>All three support DLQs natively<br/>Configure max-receive-count before DLQ"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

## Where Kafka fits in (a fourth option)

When the workload is a high-throughput event log with multiple independent consumers (analytics, ETL, ML feature pipelines, audit), managed Kafka (MSK, Confluent Cloud, GCP Managed Kafka, Azure Event Hubs) is often the right answer rather than any of the queue services above. See [Kafka vs RabbitMQ vs SQS](/practice/system-design/concepts/033-kafka-vs-rabbitmq-vs-sqs/) for the broader context.

The clouds blur this line: Event Hubs is Kafka-compatible. Pub/Sub overlaps significantly with Kafka use cases. AWS keeps Kafka (MSK) and SQS firmly separate.

## When to pick which

```mermaid
flowchart TB
    Q1{"Which cloud?"}:::query
    Q2{"What is the shape?"}:::query

    A1["AWS: SQS for queues, SNS+SQS for fan-out,<br/>MSK for high-throughput streams."]:::strong
    A2["GCP: Pub/Sub for almost everything;<br/>Managed Kafka or Pub/Sub Lite for cost-sensitive streams."]:::strong
    A3["Azure: Service Bus for transactional messaging,<br/>Event Grid for events, Event Hubs for streams."]:::strong

    Q1 -->|"AWS"| A1
    Q1 -->|"GCP"| A2
    Q1 -->|"Azure"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

The honest answer: the right managed messaging service is the one in the cloud you are already in. Cross-cloud messaging is rarely worth the complexity.

## Common mistakes

- **Choosing exactly-once based on the brand name.** "Exactly-once" in any cloud is at-least-once + dedup. Always make consumers idempotent. See [Idempotency](/practice/system-design/concepts/021-idempotency/).
- **No DLQ.** Failed messages either loop forever or vanish. Configure a DLQ on every consumer.
- **One queue for everything.** Mixed-purpose queues complicate observability and scaling. One queue per logical job type.
- **Ordering when you do not need it.** FIFO queues are slower and have lower throughput. Use them only where order genuinely matters.
- **Polling SQS too aggressively.** Long polling (waitTimeSeconds=20) reduces cost and latency simultaneously.
- **No monitoring on queue depth.** A growing queue is a leading indicator of a consumer problem. Alert on it.
- **Pub/Sub without ack deadlines tuned.** Default ack deadline is short; long-running consumers get redelivered duplicates.

## Quick recap

- AWS splits messaging into SQS (queue) and SNS (topic); Kafka is a separate product (MSK).
- GCP Pub/Sub does both queue and pub/sub semantics in one service.
- Azure has Service Bus (rich), Event Grid (lightweight), and Event Hubs (Kafka-like).
- All offer at-least-once delivery; idempotent consumers are mandatory.
- Pick the service that matches the shape (queue vs pub/sub vs stream), in the cloud you are already on.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
