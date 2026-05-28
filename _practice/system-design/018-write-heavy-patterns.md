---
layout: practice-problem
track: system-design
problem_id: 18
title: Write-Heavy System Patterns
slug: 018-write-heavy-patterns
category: Patterns
difficulty: Easy
topics: [batching, async, partitioning, append-only, queues, LSM trees, event sourcing]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/018-write-heavy-patterns"
solution_lang: markdown
---

{% raw %}
## What this is

Write-heavy systems share a small set of problems that show up at nearly every scale: a single node cannot absorb the write rate, per-write overhead kills throughput, or the data layout makes reads expensive later. The same handful of patterns solve these problems every time.

This doc names them, shows how they work, and explains the trade-offs. The patterns are not a checklist to apply all at once. They are a toolkit you reach into as each previous thing breaks.

The seven patterns:

1. **Batching** - amortize fsync and network round-trip cost across many writes
2. **Append-only log** - make every write sequential; never update in place
3. **Queue-based ingestion** - decouple producer speed from storage speed
4. **LSM trees** - a storage engine built for sequential writes
5. **Sharding and partition keys** - spread writes across many nodes
6. **Tiered storage** - match storage cost to access frequency
7. **Event sourcing** - model state as an ordered stream of immutable facts

Each pattern below has a diagram, a "when to use" section, and a "what breaks" section.

---

## The fundamental problem

Before any patterns, picture what write-heavy actually means. Every write is unique. Every write must hit disk. Caching does not help.

```mermaid
flowchart LR
    subgraph ReadHeavy["Read-heavy"]
        R1([Many readers]):::user --> RC[("Cache")]:::cache
        RC -.miss.-> RDB[("One DB")]:::db
    end
    subgraph WriteHeavy["Write-heavy"]
        W1([Many writers]):::user --> WDB[("Every write<br/>hits disk")]:::db
    end

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

A read-heavy system can serve a million reads from one cached copy. A write-heavy system cannot: every write is unique and every write must persist. There are only two levers: **batch** (amortize per-write cost over many writes) and **spread** (route writes to many nodes so no one node melts).

> **Take this with you.** Every pattern in this doc is either batching, spreading, or both.

---

## Pattern 1: Batching

Instead of writing one event per database call, accumulate events in memory and flush them together.

```mermaid
flowchart LR
    subgraph Before["Before: one INSERT per event"]
        P1([Producer]):::user --> I1[INSERT]:::app --> D1[("DB")]:::db
        P2([Producer]):::user --> I2[INSERT]:::app --> D1
        P3([Producer]):::user --> I3[INSERT]:::app --> D1
    end
    subgraph After["After: batched COPY"]
        P4([Producer]):::user --> B["Buffer<br/>(100ms or 1000 events)"]:::app
        P5([Producer]):::user --> B
        P6([Producer]):::user --> B
        B --> C[COPY]:::app --> D2[("DB")]:::db
    end

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app  fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db   fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**When to use.** Any time per-write overhead (network round-trip, TLS handshake, fsync) dominates the actual write cost. Practical threshold: above ~1k events/sec when latency starts climbing.

**What breaks.** Events in the in-memory buffer are lost on a crash. At 100ms flush intervals and 10k events/sec, that is up to 1,000 events. For click tracking this is acceptable. For audit logs it is not. Fix: move the buffer to a durable queue (Pattern 3).

> **Take this with you.** Batching is the first 10x. It costs nothing but a timer and an array. Use it before reaching for Kafka.

---

## Pattern 2: Append-only log

Stop updating rows in place. Only ever append. This is how Kafka, Cassandra's LSM tree, and every good audit log work.

```mermaid
flowchart TB
    subgraph MutableTable["Mutable table (UPDATE in place)"]
        R1["row: {id:1, visits:3}"]:::db
        R1 --> R2["row: {id:1, visits:4}"]:::db
        R2 --> R3["row: {id:1, visits:5}"]:::db
    end
    subgraph AppendLog["Append-only log"]
        L1["event: {id:1, visits:3, ts:10:01}"]:::db
        L2["event: {id:1, visits:4, ts:10:02}"]:::db
        L3["event: {id:1, visits:5, ts:10:03}"]:::db
        L1 -.-> L2 -.-> L3
    end

    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**When to use.** Audit trails where you need the full history. Time-series data where events are immutable facts. Any system where "what happened" matters as much as "what the current state is."

**What breaks.** You cannot undo a row. GDPR deletions need a tombstone approach, not a `DELETE`. Storage grows without bounds until you add retention and compaction. Reads that want current state must aggregate across all events, which is expensive without materialized views.

> **Take this with you.** Sequential disk writes are 10x to 100x faster than random writes on any hardware. An append-only log turns every write into a sequential one.

---

## Pattern 3: Queue-based ingestion

Separate the producer's write speed from the storage layer's write speed. Producers fill a durable queue. Storage drains it at its own pace.

```mermaid
flowchart TB
    subgraph Producers["Producers"]
        P1([Web app]):::user
        P2([Mobile app]):::user
        P3([Server]):::user
    end

    subgraph Ingest["Ingest"]
        GW["API Gateway"]:::edge
        IS["Ingest Service<br/>(stateless)"]:::app
    end

    K{{"Kafka<br/>(durable, partitioned<br/>7-day retention)"}}:::queue

    subgraph Consumers["Consumers (independent)"]
        CW["Hot writer"]:::app
        AR["Archiver"]:::app
        FW["Fraud detector"]:::app
    end

    DB[("Cassandra<br/>hot tier")]:::db
    S3[("S3 Parquet<br/>cold tier")]:::db

    P1 & P2 & P3 --> GW --> IS --> K
    K --> CW --> DB
    K --> AR --> S3
    K --> FW

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

**When to use.** When storage cannot absorb the ingest rate in real time. When multiple consumers (audit archive, fraud detection, analytics) all need the same events. When a downstream service restart should not cause event loss.

**What breaks.** End-to-end lag jumps from milliseconds to seconds. Events are not queryable until the consumer has flushed them to storage. A stuck consumer builds lag. If lag grows past Kafka's retention window (typically 7 days), events are gone.

> **Take this with you.** The queue is the shock absorber. Producers fill it. Storage drains at its own pace. One consumer falling behind does not affect the others.

---

## Pattern 4: LSM trees

Postgres uses a B-tree. Cassandra uses an LSM tree. For write-heavy work, LSM wins consistently. Here is why.

```mermaid
flowchart TB
    subgraph BTree["B-tree insert (Postgres)"]
        BW1["1. Find leaf page<br/>(random disk read)"]:::app
        BW2["2. Insert, maybe split page<br/>(random disk write)"]:::app
        BW3["3. Write WAL<br/>(sequential)"]:::app
        BW4["4. fsync on commit<br/>(blocks until durable)"]:::bad
        BW1 --> BW2 --> BW3 --> BW4
    end

    subgraph LSM["LSM insert (Cassandra, RocksDB)"]
        LW1["1. Append to commit log<br/>(sequential)"]:::app
        LW2["2. Insert into memtable<br/>(in RAM)"]:::app
        LW3["3. Flush to SSTable<br/>(big sequential write)"]:::app
        LW4["4. Compact SSTables<br/>(background, off-peak)"]:::ok
        LW1 --> LW2 --> LW3 --> LW4
    end

    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef ok  fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**When to use LSM.** Write-heavy work, time-series, logs, telemetry. Cassandra, ScyllaDB, RocksDB, LevelDB, HBase, and InfluxDB all use LSM variants. Above ~50k writes/sec on a single node, Cassandra or ScyllaDB are the standard choice.

**What breaks.** Reads are slower because the engine must check the memtable plus several SSTables. Compaction causes write amplification: the same byte may be written 5-10 times over its life. Until compaction runs, you have several copies of the same data on disk (space amplification).

**When B-tree wins.** OLTP with frequent updates to the same rows. Read-heavy workloads. Many secondary indexes. Postgres and MySQL.

> **Take this with you.** LSM turns many random writes into sequential appends. Sequential disk I/O is 10x to 100x faster than random I/O. That is the whole trick.

---

## Pattern 5: Sharding and partition keys

One node cannot absorb 1M writes/sec. You spread writes across many nodes by picking a partition key. The choice determines whether load spreads evenly or whether one node gets 10x the traffic of the rest.

```mermaid
flowchart TD
    A[Pick a partition strategy] --> B{Time-range reads dominate?}
    B -->|Yes| C["Time-based<br/>partition = day or hour"]:::ok
    B -->|No| D{Need even write distribution?}
    D -->|Yes| E["Hash-based<br/>hash(key) mod N"]:::ok
    D -->|No| F{Multi-tenant system?}
    F -->|Yes| G["Tenant-based<br/>partition = tenant_id"]:::ok
    F -->|No| H["Composite key<br/>combine two of the above"]:::ok
    C --> I["Cost: hot partition on writes<br/>all writes hit current hour"]:::bad
    E --> J["Cost: range queries scatter-gather<br/>across all partitions"]:::bad
    G --> K["Cost: one big tenant can overwhelm one node<br/>sub-shard big tenants"]:::bad

    classDef ok  fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**When to use.** Any time one node cannot absorb the write rate, or you need to drop old data cheaply (time-based partitions let you drop whole partitions instead of running deletes).

**What breaks.** Every partition strategy has a failure mode. Time-based: all writes hit the current partition. Hash-based: range queries scatter across all shards. Tenant-based: one large tenant overwhelms one node. The fix is usually a composite key that combines two strategies. For a 1M events/sec audit system: Kafka key `hash(event_type, tenant_id)`, Cassandra primary key `((tenant_id, day), event_id)`, S3 path `date=YYYY-MM-DD/event_type=X/tenant_id=Y/`.

> **Take this with you.** The partition key is the most important design decision in write-heavy storage. A wrong key gives you a hot node. A hot node negates all the scaling work.

---

## Pattern 6: Tiered storage

Not all data is accessed equally. Events from the last hour are read often and must be fast. Events from three years ago are read rarely and must be cheap. Match storage cost to access frequency.

```mermaid
flowchart LR
    K{{"Kafka<br/>(ingest buffer)"}}:::queue --> CS[("Cassandra<br/>hot, 90-day TTL<br/>point reads in 10ms")]:::db
    CS -.nightly archiver.-> S3[("S3 Parquet<br/>cold, 1-7 years<br/>Athena queries in seconds")]:::db
    S3 -.after 1 year.-> GL[("S3 Glacier<br/>deep archive<br/>1/20 the cost, 12-48h retrieval")]:::db

    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

**When to use.** Any system with a retention requirement beyond what fits cheaply in a fast store. The break-even is usually around 30 days: recent data in a fast key-value or columnar store, older data on object storage.

**What breaks.** A query that spans tiers (last 6 months plus the past 2 years) must be split and the results merged at query time. Operational complexity increases: you now run the archiver job, manage Parquet file sizes, and ensure Glacier retrieval SLAs match compliance needs.

> **Take this with you.** Tiered storage matches cost to access frequency. Hot queries pay hot prices. Cold queries pay cold prices. Keeping 7 years of events in Cassandra is structurally wrong, not just expensive.

---

## Pattern 7: Event sourcing

Model the system as an ordered stream of immutable events. Current state is derived by replaying them. The event log is the source of truth; everything else is a projection.

```mermaid
flowchart TB
    subgraph EventLog["Event log (append-only source of truth)"]
        E1["user.signed_up, ts=10:01"]:::queue
        E2["user.email_verified, ts=10:05"]:::queue
        E3["user.plan_upgraded, ts=11:30"]:::queue
        E1 -.-> E2 -.-> E3
    end

    subgraph Projections["Derived projections (rebuilt on demand)"]
        P1[("users table<br/>(current state)")]:::db
        P2[("billing view<br/>(plan history)")]:::db
        P3[("audit log<br/>(compliance export)")]:::db
    end

    E3 --> P1
    E3 --> P2
    E3 --> P3

    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**When to use.** Audit trails where you need to reconstruct any historical state. Systems where the history of changes matters as much as current state. Any domain with complex compliance or replay requirements.

**What breaks.** Replaying millions of events to rebuild a projection is slow without periodic snapshots. GDPR "right to be forgotten" conflicts with append-only: you need tombstone events and projection logic that respects them. Storage grows without tiering. Event schemas evolve, so old projections must handle old event versions.

> **Take this with you.** Event sourcing gives you time travel for free. The cost is that every read becomes a projection. Use it when the audit trail is a first-class requirement, not a side effect.

---

## How the patterns stack as scale grows

These patterns are not applied all at once. Each stage handles roughly 10x the throughput of the one before.

```mermaid
flowchart LR
    S1["Stage 1<br/>100 events/sec<br/>1 Postgres<br/>simple INSERT"]:::s1
    S2["Stage 2<br/>10k events/sec<br/>buffer + batch COPY<br/>same Postgres"]:::s2
    S3["Stage 3<br/>100k events/sec<br/>Kafka + async<br/>Cassandra writer"]:::s3
    S4["Stage 4<br/>1M+ events/sec<br/>regional ingest<br/>partitioned Kafka<br/>tiered storage"]:::s4

    S1 --> S2 --> S3 --> S4

    classDef s1 fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef s2 fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s3 fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef s4 fill:#fce7f3,stroke:#be185d,color:#831843
```

<details markdown="1">
<summary><b>Show: what breaks at each transition</b></summary>

**Stage 1 to 2 (add batching).** Postgres CPU climbs to 80%. WAL fsync is the bottleneck: every INSERT must flush to disk before returning. Switching to a 100ms in-memory buffer and `COPY` gives 10x throughput on the same hardware. Cost: up to 1,000 events lost on crash.

**Stage 2 to 3 (add queue and LSM store).** Postgres hits its I/O ceiling. Vertical scaling is exhausted. The crash-loss problem also grows at 100k/sec (100ms x 100k = 10k events lost per crash), which is now unacceptable. Kafka decouples producers from storage. Cassandra's LSM tree handles write rates that Postgres cannot. Multiple independent consumers read the same topic.

**Stage 3 to 4 (partition and tier).** Single-region Kafka hits NIC and disk limits. One large tenant saturates one Kafka partition and one Cassandra node. Cold-tier costs grow unbounded if you keep everything in Cassandra. Regional ingest tiers, sub-sharding for hot tenants, Flink for derived data, and S3 Parquet for cold storage are the answers.

**The discipline.** Name the limit of stage N before reaching for stage N+1. A system that starts at 100 events/sec does not need Kafka. Building it with Kafka adds operational weight before it can carry any load.

</details>

---

## The full pipeline at 1M events/sec

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        P([Web / Mobile / Server]):::user
        GW["API Gateway<br/>(TLS, rate limit, back-pressure)"]:::edge
    end

    subgraph WritePath["Synchronous write path"]
        IS["Ingest Service<br/>(validate, stamp, route)"]:::app
    end

    K{{"Kafka<br/>200 partitions, RF=3<br/>hash(event_type, tenant_id)<br/>7-day retention"}}:::queue

    subgraph Consumers["Async consumers (independent consumer groups)"]
        HW["Hot writer<br/>(UNLOGGED BATCH<br/>per Cassandra partition)"]:::app
        AR["Archiver<br/>(buffer 5 min,<br/>write Parquet to S3)"]:::app
        FL["Flink<br/>(rollups, fraud alerts,<br/>enrichment)"]:::app
    end

    CS[("Cassandra<br/>hot tier, RF=3<br/>90-day TTL")]:::db
    S3[("S3 Parquet<br/>cold tier<br/>date/type/tenant prefix")]:::db
    AT["Athena / Presto"]:::app
    OB["Metrics<br/>(Prometheus + Grafana<br/>lag, skew, batch size)"]:::cache

    P --> GW --> IS --> K
    K --> HW --> CS
    K --> AR --> S3 --> AT
    K --> FL
    IS & K & HW & AR & FL -.metrics.-> OB

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

| Box | What it does |
|-----|--------------|
| **API Gateway** | Terminates TLS, applies per-tenant rate limits, returns 429 when Kafka is unhealthy. |
| **Ingest Service** | Stateless. Validates schema, stamps event_id and server timestamp, routes to Kafka. Returns 202. |
| **Kafka** | The shock absorber. Producers fill it. Consumers drain independently. Buffers 5-minute stalls without affecting producers. |
| **Hot writer** | Reads Kafka, writes UNLOGGED BATCHes per Cassandra partition. Commits offset after storage ack. |
| **Archiver** | Separate consumer group. Buffers 5 minutes or 100k events. Writes one Parquet file to S3. |
| **Flink** | Derived data: per-minute rollups, anomaly scores, fraud alerts. Same Kafka topic as others. |
| **Cassandra hot tier** | Recent events. Query by `(tenant_id, day)` range. 90-day TTL, auto-deleted by compaction. |
| **S3 Parquet cold tier** | 7-year archive. Partitioned by date/event_type/tenant_id. Queried by Athena. |
| **Metrics** | Consumer lag, throughput, batch size, partition skew. These diagnose every common failure. |

> **Take this with you.** Three consumer groups read the same Kafka topic independently. The archiver can fall behind without affecting Cassandra. Flink can crash without affecting the archiver. Kafka is what makes this possible.

---

## One event, all the way through

```mermaid
sequenceDiagram
    autonumber
    participant P as Producer
    participant B as Local Buffer
    participant I as Ingest Service
    participant K as Kafka
    participant HW as Hot Writer
    participant Cs as Cassandra
    participant A as Archiver
    participant S as S3

    P->>B: emit event
    Note over B: buffer 100ms or 1000 events
    B->>I: POST /events/batch
    I->>I: validate, stamp event_id, pick partition
    I->>K: produce (acks=all)
    K-->>I: ack (replicated to ISR)
    I-->>B: 202 Accepted
    Note over P,I: sync slice ends (P99 ~50ms)

    K-->>HW: poll batch
    HW->>Cs: UNLOGGED BATCH per partition
    Cs-->>HW: ack
    HW->>K: commit offset

    K-->>A: poll batch (separate consumer group)
    Note over A: buffer 5 min or 100k events
    A->>S: PUT Parquet file
    S-->>A: ack
    A->>K: commit offset
```

Three things to notice:

1. The 202 goes back to the producer after Kafka ack, not after Cassandra ack. If Kafka has it, the event is safe. Cassandra is just the queryable view.
2. The hot writer commits the Kafka offset *after* Cassandra ack. On a crash between write and commit, it replays the batch on restart. Cassandra's primary-key UPSERT makes the replay a no-op.
3. End-to-end lag to Cassandra is 1-3 seconds. Lag to S3 is up to 5-6 minutes (the archiver's flush window).

---

## Delivery guarantees

At small scale, every event is in one Postgres. One ACID transaction. Either on disk or not.

At 1M events/sec, that promise is gone. Pick one of three delivery models.

```mermaid
flowchart TD
    A[Pick delivery guarantee] --> B{Is it OK to lose events?}
    B -->|Yes, stats only| C["At-most-once<br/>fire and forget<br/>cheapest, lowest latency"]:::ok
    B -->|No, never lose| D{Are duplicates OK?}
    D -->|Yes, consumer can dedupe| E["At-least-once<br/>+ idempotent consumer<br/>most common choice"]:::ok
    D -->|No, side effect cannot be undone| F["Exactly-once<br/>Kafka EOS or<br/>transactional outbox"]:::ok
    C --> G["Use for: click tracking<br/>ad impressions, perf traces"]:::edge
    E --> H["Use for: audit, billing<br/>most event pipelines"]:::edge
    F --> I["Use for: SMS sending<br/>payment processing"]:::edge

    classDef ok   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef edge fill:#e2e8f0,stroke:#475569,color:#1e293b
```

At-least-once with idempotent storage gives the same correctness as exactly-once at a tenth of the cost. Most systems should pick this.

<details markdown="1">
<summary><b>Show: the cost of each guarantee</b></summary>

**At-most-once.** Producer sends, returns immediately, does not retry. If the broker is down, the event is lost. Zero retry cost. No idempotency machinery. Use when the data is statistical: page views, click tracking, performance traces.

**At-least-once.** Producer retries on any failure to ack. A network blip may cause the broker to write a second copy. Consumer commits offsets after processing.

Handle duplicates by using `event_id` as the primary key in storage. The second write is a no-op via Cassandra UPSERT or `INSERT ON CONFLICT DO NOTHING`. This is what 80% of production pipelines do.

**Exactly-once.** Kafka EOS via transactional producers and read-committed consumers. Throughput drops 20-40% compared to at-least-once. Latency increases. Use only when the downstream effect cannot be deduped (SMS, payment processing).

Most "we need exactly-once" requirements are actually "we need at-least-once with idempotent processing." At-least-once is 10x cheaper and covers 95% of cases.

</details>

> **Take this with you.** At-least-once with idempotent storage gives you the same correctness as exactly-once at a tenth of the cost. Most systems should pick this.

---

## Follow-up questions

Try answering each in 2 to 4 sentences before reading the solution.

1. **Back-pressure.** Producers are sending 2x the rate Kafka can absorb. Brokers are healthy but disk is at 80%. What does the ingest service do? What does the producer SDK do?

2. **Hot tenant.** One tenant's mobile app has a bug and is sending 200k events/sec when the average is 100. They are saturating one Kafka partition. How do you find them? What do you do in the next 5 minutes vs the next 5 days?

3. **Clock skew.** Two producers disagree about "now" by 3 minutes. Downstream reports show events arriving "in the future." How do you fix it without requiring nanosecond-precision NTP everywhere?

4. **Duplicate events.** A producer retried after a broker timeout that actually succeeded. Cassandra now has two copies of every event in that batch. Walk through detection and dedup.

5. **Consumer fell behind.** A Cassandra writer consumer has been stuck for 30 minutes. Kafka has buffered 1.8 billion events for that consumer group. What happens when you fix the bug and restart? How do you keep it from melting storage?

6. **Schema evolution.** A team added a new field. Old producers send 5 fields, new producers send 6. Cassandra has a fixed table schema. How do you handle migration without dropping events or breaking old consumers?

7. **Recent-event reads.** A consumer wants "all events for user U in the last 30 seconds." Your storage path is Kafka batched every 5 minutes into Cassandra. The event might still be in Kafka. How do you make the read see both?

8. **A region goes down.** The US-East Kafka cluster is offline. Producers there cannot publish. What is your DR plan? How much data could be lost?

9. **Cold-tier query cost.** A user wants "every event for tenant X for the past 3 years." A naive Athena query scans 3 PB of Parquet. How do you make this both fast and cheap?

10. **Exactly-once for a side effect.** One downstream consumer sends an SMS for every fraud alert. SMS is not idempotent (the user gets two texts if you send twice). How do you guarantee exactly one SMS without paying Kafka EOS cost on the whole pipeline?

---

## Related problems

- **[Approval Management (011)](../011-approval-management/question.md).** The audit log in that design is exactly a write-heavy append-only system. The tiered storage and batching patterns here apply directly.
- **[News Feed (002)](../002-news-feed/question.md).** Timeline write fan-out is the classic write-heavy problem at consumer scale: each post produces N writes, one per follower's timeline.
- **[Todo List Sharing (013)](../013-todo-list-sharing/question.md).** The change-log sync pipeline for collaborative edits is the same shape at smaller scale: every edit is a small append-only event partitioned by list_id.
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md).** The mirror image of this problem. Read-heavy is cached. Write-heavy is batched and partitioned.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Write-Heavy System Patterns

### What this is

A write-heavy system is one where the cost comes from taking in data, not from serving it. Each event is small. Queries are simple. The storage engine has one job: absorb writes faster than a normal database can.

The patterns that solve this fall into two categories. Batching patterns amortize per-write cost. Spreading patterns route writes across many nodes. Every tool in this space (Kafka, Cassandra, LSM trees, tiered storage) is one or the other.

The toolkit, in the order you reach for it as scale grows:

1. **One Postgres** at ~1k writes/sec.
2. **In-memory buffer + batched commits** at ~10k writes/sec.
3. **Durable queue + async LSM writer** at ~100k writes/sec.
4. **Partitioned queue + stream processing + tiered storage** at 1M+ writes/sec.

Each step trades latency, consistency, or operational complexity for throughput. The senior move is to name the limit of stage N before reaching for stage N+1.

Three big decisions shape the final design:

- **Partition key.** Time, hash, or tenant. Usually a composite like `(tenant_id, day)`.
- **Storage engine.** LSM at the hot tier. Parquet on object storage at the cold tier.
- **Delivery guarantee.** At-least-once with idempotent storage is right for 95% of cases.

---

### 1. The two questions that matter most

**How much loss is OK?** This decides the durability story. Zero loss means `acks=all` on Kafka, transactional ingest, and idempotent consumers. "0.1% loss acceptable" means fire-and-forget, no retries, no dedup. Those are 10x apart in cost and complexity.

**How fresh must reads be?** 100ms freshness forces synchronous indexing. 5-minute lag lets you batch into Parquet files and pay 1% of the cost. Most audit systems accept 5-10 seconds. Fraud detectors want under 1 second. The lag SLA decides where you put the queue and how large your batches can be.

Everything else (partition strategy, storage engine, delivery guarantee) follows from those two answers.

---

### 2. The math, in plain numbers

At 1M events/sec, 500 bytes per event, 90 days hot, 7 years cold:

| Number | Value | Why it matters |
|--------|-------|----------------|
| Steady bandwidth | 500 MB/sec (4 Gbps) | Multiple ingest nodes needed just for NIC, not CPU |
| Peak bandwidth | 1.5 GB/sec (12 Gbps) | Several machines per region just to accept bytes |
| Daily volume | 86 billion events, 43 TB raw | Hot tier is petabytes |
| Hot storage (90 days) | ~3.9 PB | 10-30 node Cassandra cluster, RF=3 |
| Cold storage (7 years, 5x compression) | ~22 PB on S3 | ~$500k/month standard, ~$25k/month Glacier Deep |
| Queue size on 5-min stall | 300M events, 150 GB | Kafka handles easily; in-memory cannot |

The bottleneck is bandwidth and storage layout, not CPU. One Postgres maxes out at 10k-50k writes/sec. At 1M/sec that is 100x past a single shard. Writes must be spread across nodes and batched to amortize per-write cost.

Always do bytes alongside event counts. A pipeline doing 86 billion events of 50 bytes each is a completely different system from one doing 86 billion events of 5 KB each.

---

### 3. The API

Reads are out of scope. Focus on ingest.

**Batched ingest** (recommended for all high-volume producers):

```
POST /api/v1/events/batch
Content-Encoding: gzip
Content-Type: application/json

{
  "events": [
    { "event_type": "user.login", "user_id": "u_8201", "timestamp": "...", "attributes": {...} },
    { "event_type": "user.click", "user_id": "u_8202", "timestamp": "...", "attributes": {...} }
  ]
}
```

| Status | Meaning |
|--------|---------|
| **202 Accepted** | Events in durable queue, queryable within ~10s |
| **400 Bad Request** | Schema invalid |
| **413 Payload Too Large** | Batch exceeds size limit |
| **429 Too Many Requests** | Rate limited or back-pressure |
| **503 Service Unavailable** | Ingest degraded, producer should retry |

Four load-bearing choices:

- **202, not 200.** The event is in durable queue, not yet in storage. 202 means "we accepted responsibility; stop retrying."
- **Batch endpoint.** Per-event HTTP at 1M/sec means 1M TLS handshakes/sec. Batches of 1000 cut that to 1k req/sec.
- **Server stamps `server_ts`** alongside `producer_ts`. Both are kept. Producer time is "when did the event happen." Server time is "when did we accept it." Clock-skew analysis uses the gap.
- **429 includes `Retry-After`.** Well-behaved producers throttle themselves. Without this, the 429 storm becomes a retry storm.

---

### 4. The data model

**Canonical event in Kafka:**

```json
{
  "event_id":       "01H8K2X...",
  "tenant_id":      "tenant_42",
  "event_type":     "user.login",
  "user_id":        "u_8201",
  "producer_ts":    "2026-05-24T10:14:02.331Z",
  "server_ts":      "2026-05-24T10:14:02.412Z",
  "attributes":     { ... },
  "schema_version": 3
}
```

**Hot tier in Cassandra:**

```cql
CREATE TABLE events_by_tenant_day (
    tenant_id      text,
    day            date,
    event_id       timeuuid,
    event_type     text,
    user_id        text,
    producer_ts    timestamp,
    server_ts      timestamp,
    attributes     text,
    schema_version int,
    PRIMARY KEY ((tenant_id, day), event_id)
) WITH CLUSTERING ORDER BY (event_id DESC)
  AND default_time_to_live = 7776000;
```

Three things doing real work:

**`PRIMARY KEY ((tenant_id, day), event_id)`.** The partition key `(tenant_id, day)` bounds partition size. Even the largest tenant only writes one day at a time into one partition. The clustering column `event_id` keeps rows sorted inside the partition, so "latest events" is a cheap prefix scan.

**`default_time_to_live = 7776000`.** 90 days. Cassandra auto-deletes old rows during compaction. No nightly delete job needed.

**No foreign keys.** Audit-shaped data is reference-free. The event captures who, what, and when. If a user account is later deleted, the audit must survive.

**Cold tier on S3** sits at path `s3://events-cold/date=YYYY-MM-DD/event_type=X/tenant_id=Y/fileN.parquet`. Columnar layout inside each file. Column-pruned reads are free. Partition pruning at the prefix level means Athena skips whole directories that do not match the query filter.

---

### 5. The seven patterns

#### Pattern 1: Batching

Accumulate events in memory. Flush together. One `COPY` statement covers what used to be 1,000 individual `INSERT` calls. Amortizes fsync, network round-trips, and TLS overhead.

```mermaid
flowchart LR
    P([Producer]):::user --> BF["Buffer<br/>(100ms or 1000 events)"]:::app
    BF --> CP["COPY batch"]:::app --> DB[("Postgres")]:::db

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app  fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db   fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**Limit.** ~10k writes/sec on one Postgres. Events in the buffer are lost on crash.

> **Take this with you.** Batching is the first 10x. It costs nothing but a timer and an array. Use it before reaching for Kafka.

---

#### Pattern 2: Append-only log

Only ever append. Never update in place. All writes are sequential. Sequential disk I/O is 10x to 100x faster than random I/O.

```mermaid
flowchart LR
    E1["event: login, ts:10:01"]:::db -.-> E2["event: logout, ts:10:05"]:::db -.-> E3["event: login, ts:10:09"]:::db

    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**Limit.** Storage grows without bounds. Reads that want current state must aggregate across all events. Fix with tiered storage and materialized views.

> **Take this with you.** An append-only log is the cheapest write path. Disk is sequential. Sequential writes are 10x to 100x faster than random writes on any hardware.

---

#### Pattern 3: Queue-based ingestion

Decouple producer speed from storage speed. Producers write to a durable queue. Storage drains at its own pace. Multiple consumers read the same events independently.

```mermaid
flowchart LR
    P([Producer]):::user --> K{{"Kafka"}}:::queue
    K --> HW["Hot writer"]:::app --> CS[("Cassandra")]:::db
    K --> AR["Archiver"]:::app --> S3[("S3")]:::db
    K --> FW["Fraud alerts"]:::app

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

**Limit.** End-to-end lag jumps from ms to seconds. If consumer lag grows past Kafka's retention window, events are lost.

> **Take this with you.** The queue is the shock absorber. If the Cassandra writer dies at 3am, ingest still works. Events just queue up.

---

#### Pattern 4: LSM trees

Postgres uses a B-tree: every insert finds a page, writes in-place, pays a random I/O cost. Cassandra uses an LSM tree: every insert appends to a commit log (sequential), then flushes to an SSTable (sequential). Compaction happens in the background.

```mermaid
flowchart LR
    subgraph BTree["B-tree insert (Postgres)"]
        direction TB
        BW["Random read + random write per insert<br/>fsync on every commit"]:::bad
    end
    subgraph LSM["LSM insert (Cassandra)"]
        direction TB
        LW["Sequential append to commit log<br/>flush to SSTable when memtable fills<br/>compaction in background"]:::ok
    end

    classDef ok  fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**When LSM wins.** Write-heavy work, time-series, logs, telemetry. Above ~50k writes/sec on a single node, Cassandra or ScyllaDB are the standard choice.

**When B-tree wins.** OLTP with frequent updates to the same rows. Read-heavy workloads. Many secondary indexes.

> **Take this with you.** LSM turns many random writes into sequential appends. That single change is why Cassandra can absorb write rates that would melt Postgres.

---

#### Pattern 5: Sharding and partition keys

Spread writes across many nodes. The partition key decides which node gets which writes. A bad key creates a hot node.

| Strategy | Good for | Fails when |
|----------|----------|------------|
| **Time-based** (`day`) | Time-range reads, cheap data expiry | Hot write partition (current hour or day) |
| **Hash-based** (`hash(key) % N`) | Even write distribution, no hotspots | Range queries scatter-gather |
| **Tenant-based** (`tenant_id`) | Per-tenant isolation and deletion | One big tenant overwhelms one node |
| **Composite** (`(tenant_id, day)`) | Bounds partition size, cheap expiry | Slightly more complex routing |

For 1M events/sec: Kafka key = `hash(event_type, tenant_id)`. Cassandra primary key = `((tenant_id, day), event_id)`. S3 path = `date=Y/event_type=X/tenant_id=Z/`.

> **Take this with you.** The partition key is the most important design decision in write-heavy storage. A wrong key gives you a hot node. A hot node negates all the scaling work.

---

#### Pattern 6: Tiered storage

Not all data is accessed equally. Match storage cost to access frequency.

```mermaid
flowchart LR
    K{{"Kafka<br/>(ingest)"}}:::queue --> CS[("Cassandra<br/>hot, 90-day TTL")]:::db
    CS -.nightly.-> S3[("S3 Parquet<br/>cold, 1-7 years")]:::db
    S3 -.after 1 year.-> GL[("S3 Glacier<br/>deep archive")]:::db
    CS --> Q1["Point reads ~10ms"]:::app
    S3 --> AT["Athena queries<br/>seconds-minutes"]:::app
    GL --> RC["Bulk retrieval<br/>12-48h"]:::app

    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

**Cost at 1M events/sec:**
- Cassandra hot tier (90 days, 3.9 PB): ~$50k/month on managed clusters.
- S3 Parquet standard (7 years, 22 PB compressed): ~$500k/month.
- S3 Glacier Deep Archive: ~$25k/month for the same 22 PB.

Keeping 7 years in Cassandra is not just expensive. It is structurally wrong: Cassandra is optimized for fast point reads, not for Athena-style columnar scans across years of data.

> **Take this with you.** Hot queries pay hot prices. Cold queries pay cold prices. Match storage to access pattern.

---

#### Pattern 7: Event sourcing

Model state as an ordered stream of immutable events. Derive current state by replaying them. The event log is the source of truth; everything else is a projection.

```mermaid
flowchart TB
    subgraph EventLog["Event log (append-only source of truth)"]
        E1["user.signed_up, ts=10:01"]:::queue
        E2["user.email_verified, ts=10:05"]:::queue
        E3["user.plan_upgraded, ts=11:30"]:::queue
        E1 -.-> E2 -.-> E3
    end

    subgraph Projections["Derived projections"]
        P1[("users table<br/>(current state)")]:::db
        P2[("billing view<br/>(plan history)")]:::db
        P3[("audit log<br/>(compliance export)")]:::db
    end

    E3 --> P1
    E3 --> P2
    E3 --> P3

    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**Limit.** Replaying millions of events to rebuild state is slow without snapshots. GDPR deletions need tombstone events and projection logic that respects them. Event schemas evolve, so old projections must handle old event versions.

> **Take this with you.** Event sourcing gives you time travel for free. The cost is that every read is a projection. Use it when the audit trail is a first-class requirement, not a side effect.

---

### 6. The architecture at 1M events/sec

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        P([Web / Mobile / Server]):::user
        GW["API Gateway<br/>(TLS, rate limit, back-pressure)"]:::edge
    end

    subgraph WritePath["Synchronous write path"]
        IS["Ingest Service<br/>(stateless, N pods)"]:::app
    end

    K{{"Kafka<br/>200 partitions, RF=3<br/>hash(event_type, tenant_id)<br/>7-day retention"}}:::queue

    subgraph Consumers["Async consumers (independent consumer groups)"]
        HW["Hot writer<br/>(UNLOGGED BATCH<br/>per partition)"]:::app
        AR["Archiver<br/>(buffer 5 min,<br/>write Parquet)"]:::app
        FL["Flink<br/>(rollups, alerts)"]:::app
    end

    CS[("Cassandra<br/>hot tier, RF=3<br/>90-day TTL")]:::db
    S3[("S3 Parquet<br/>cold tier")]:::db
    AT["Athena / Presto"]:::app
    OB["Prometheus + Grafana<br/>(lag, skew, batch size)"]:::cache

    P --> GW --> IS --> K
    K --> HW --> CS
    K --> AR --> S3 --> AT
    K --> FL
    IS & K & HW & AR -.metrics.-> OB

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Five things to notice:

- Ingest pods are stateless. Their only durability hop is Kafka. A pod crash causes the producer's connection to drop. The producer retries. The idempotency key deduplicates if present.
- Three consumer groups read the same Kafka topic independently. The archiver falls behind without affecting Cassandra. Flink crashes without affecting the archiver.
- Cassandra and S3 are not redundant. They serve different access patterns. Cassandra answers "give me events for tenant X on day D" in 30ms. S3 answers "give me everything for tenant X over 2 years" in minutes.
- Observability is on every box. Without consumer lag and partition-skew metrics, failures surface as customer complaints.
- Concrete technology choices: API Gateway via AWS ALB or Cloudflare, ingest pods in Go or Rust, Kafka via Confluent or MSK, hot store via Cassandra or ScyllaDB, Flink for stateful stream processing.

---

### 7. An event, end to end

```mermaid
sequenceDiagram
    autonumber
    participant P as Producer
    participant E as Edge LB
    participant I as Ingest
    participant K as Kafka
    participant HW as Hot Writer
    participant Cs as Cassandra
    participant A as Archiver
    participant S as S3

    P->>E: POST /events/batch
    E->>I: TLS, rate limit check
    I->>I: validate, stamp event_id and server_ts
    I->>K: produce (acks=all)
    K->>K: replicate to ISR
    K-->>I: ack
    I-->>E: 202 Accepted
    E-->>P: 202 Accepted
    Note over P,K: sync slice ends (P99 ~50ms)

    K-->>HW: poll
    HW->>Cs: UNLOGGED BATCH per partition
    Cs-->>HW: ack
    HW->>K: commit offset

    K-->>A: poll (separate consumer group)
    Note over A: buffer 5 min or 100k events
    A->>S: PUT Parquet file
    S-->>A: ack
    A->>K: commit offset
```

**End-to-end lag:**
- Producer to Cassandra-queryable: 1-3 seconds, P99 ~10 seconds.
- Producer to S3 Parquet: up to 5-6 minutes (archiver flush window dominates).

**Read latencies:**
- Point read by event_id: P99 ~10ms.
- Per-tenant range scan: P99 ~30ms.
- Analytics over 1 year via Athena: seconds to minutes.

---

### 8. The scaling journey: 100 events/sec to 1M

```mermaid
flowchart LR
    S1["Stage 1<br/>100 events/sec<br/>1 Postgres + 1 pod<br/>~$80/mo"]:::s1
    S2["Stage 2<br/>10k events/sec<br/>buffer + batch COPY<br/>~$500/mo"]:::s2
    S3["Stage 3<br/>100k events/sec<br/>Kafka + Cassandra<br/>~$10-20k/mo"]:::s3
    S4["Stage 4<br/>1M+ events/sec<br/>regional ingest<br/>tiered storage<br/>~$200-500k/mo"]:::s4

    S1 --> S2 --> S3 --> S4

    classDef s1 fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef s2 fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s3 fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef s4 fill:#fce7f3,stroke:#be185d,color:#831843
```

#### Stage 1: 100 events/sec

One Postgres (db.t3.medium, 4 GB RAM). One app instance. One table, indexed by `event_id` and `(user_id, created_at)`. No queue. No cache. No replicas. ~$80/month.

100 events/sec is 8.6M events/day. Postgres handles this with room to spare, at maybe 50% of one core. Anything more is over-built.

#### Stage 2: 10k events/sec

**What breaks.** Postgres CPU at 80%. WAL fsync is the bottleneck: every commit flushes to disk. Inserts land in random pages, so the buffer pool churns.

**Fixes:** In-app buffer: accumulate events, flush every 100ms or 1000 events via `COPY` instead of `INSERT`. 10-20x faster. Partition the table by day. Add a second app instance and a read replica.

**What you accept.** Buffered events lost on crash: worst case 100ms x 10k/sec = ~1,000 events. End-to-end lag goes from immediate to ~100ms.

**What you do NOT build.** No Kafka, no Cassandra, no multi-region.

#### Stage 3: 100k events/sec

**What breaks.** Postgres cannot keep up even with batching. App crash loses 10k events (100k/sec x 100ms). Read replica lags 30 seconds because primary is saturated.

**Fixes:** Kafka in front of storage (producers get 202 immediately, Kafka buffers if storage falls behind). Switch to Cassandra for the hot tier. Separate Kafka consumer process writes in UNLOGGED BATCHes per partition. 50 Kafka partitions, hash by `(event_type, tenant_id)`.

**What you accept.** End-to-end lag jumped from 100ms to ~5 seconds. Strong consistency is gone.

#### Stage 4: 1M events/sec

**What breaks.** Single-region Kafka hits NIC and disk limits. One large tenant saturates one Kafka partition and one Cassandra node. Cold-tier costs explode if everything stays in Cassandra. Compliance requires 7-year retention.

**Fixes:** Regional ingest and Kafka clusters per region. Sub-shard hot partitions with a random suffix. Flink for enrichment and routing. Tiered storage (hot Cassandra TTL 90 days, cold S3 Parquet 7 years). Per-tenant rate limits with hard caps.

---

### 9. Reliability

**Queue overflow.** Kafka at 90% disk. Back-pressure at ingest: when Kafka send latency P99 exceeds 1 second, ingest returns 429. Producers back off. Premium tenants get reserved Kafka capacity. Free-tier tenants get throttled first.

**Consumer fell behind.** Scale consumer group up temporarily. Configure throttled catch-up at 2x normal rate. Catch-up is a separate workload and should not be mixed with normal traffic.

**Partial batch loss.** A Kafka consumer crashes after writing 800 of 1000 events to Cassandra, before committing the offset. On restart it reprocesses the full batch. Cassandra primary-key UPSERT semantics make the 800 already-written events a no-op. No data loss.

**Ingest pod crash.** Pod crashes between accepting a request and sending to Kafka. Producer's HTTP connection drops with no response. Producer retries. With an idempotency key, the second submission is deduped. Fix: ingest pod sends to Kafka before returning 202.

**Region failure.** Producers in the failed region cannot publish. The SDK should fail over to next-nearest region. Data loss window: events buffered in the producer's local SDK that were never sent. Typically under 1 second. DR play: cross-region Kafka replication via MirrorMaker.

---

### 10. Observability

| Metric | Why it matters | Alert threshold |
|--------|----------------|-----------------|
| `ingest.requests.rate` | Top-line throughput | Drop >50% in 5 min |
| `ingest.latency.p99` | Producer-facing SLO | >100ms for 5 min |
| `ingest.5xx.rate` | Our problem | >0.1% sustained |
| `kafka.producer.ack.latency.p99` | Kafka health | >1s for 5 min |
| `kafka.partition.rate.max / median` | Hot partition skew | >10x ratio |
| `kafka.consumer.lag` per group | Are consumers keeping up? | >30s lag for any group |
| `kafka.broker.disk.used.pct` | Storage capacity | >80% |
| `cassandra.write.latency.p99` | Storage health | >50ms |
| `cassandra.batch.size.p99` | Batching effectively? | <10 events is too small |
| `archiver.lag` | Cold tier behind real-time | >10 min |
| `archiver.parquet_file.size.p50` | Small file problem | <10 MB is too many files |

**Four golden signals:** ingest throughput (events/sec at the API), end-to-end lag (ingest timestamp to Cassandra-readable timestamp), consumer lag per Kafka consumer group, and error rates at each stage.

Page on: ingest 5xx > 0.5%, ingest P99 > 200ms for 10 min, consumer lag > 5 min for any group, Kafka broker disk > 90%.

---

### 11. Follow-up answers

**1. Back-pressure.**

When Kafka send latency P99 exceeds 1 second or any broker is unhealthy, ingest returns 429 with `Retry-After`. The producer SDK backs off with exponential backoff and caches events locally until health returns. Without producer-side backoff, the 429 storm becomes a retry storm. If Kafka is so unhealthy that even 429s are slow, ingest can close connections (TCP RST), forcing producers to back off at the TCP level.

**2. Hot tenant.**

Find them: the per-partition rate metric points at one Kafka partition. Cross-reference with the partition key. Next 5 minutes: hard rate limit at the ingest tier, capping the tenant at their agreed quota. Excess gets 429. Sub-shard them by appending `random(0..15)` to the partition key, spreading load across 16 partitions. They lose per-key ordering during the spike, but the cluster survives. Next 5 days: diagnose the bug (often a retry loop, log misconfiguration, or a runaway script) and establish per-tenant quota policy.

**3. Clock skew.**

Always stamp `server_ts` at ingest. That is the timestamp used for partitioning, bucketing, and ordering downstream. `producer_ts` is kept for display only. NTP-sync producers to the second. Flag any event where `producer_ts` is more than 5 minutes off from `server_ts`. The stream processor tolerates late events via Flink watermarks. Never use `producer_ts` for anything that requires precise ordering.

**4. Duplicate events.**

Detection: Cassandra primary-key conflict on insert is the direct signal. Count `cassandra.dedup.collisions` per minute. A nightly audit of `SELECT event_id, count(*) GROUP BY event_id HAVING count(*) > 1` should always return zero.

Dedup: use `event_id` as the primary key. Prefer producer-generated ULIDs (time-ordered, unique, no coordination needed). If the producer cannot generate one, the server generates at ingest, but then producer retries get different event_ids and dedup is impossible. Cassandra UPSERT semantics make duplicate inserts with the same primary key a no-op.

**5. Consumer fell behind.**

Two failure modes to avoid on restart: resource exhaustion (consumer wakes up, polls Kafka at full speed, melts storage) and out-of-order derived data (rolling metrics get skewed by 1.8B events arriving in one hour). Fix: throttled catch-up at 2x normal throughput. 1.8B events at 200k/sec takes ~2.5 hours to drain. Scale the consumer group up temporarily, but watch storage. If derived consumers care about "now-time" processing, flag them to skip events older than X and replay historical events as a separate batch job.

**6. Schema evolution.**

Options: keep the raw event as JSON (flexible, no columnar benefits); use Avro or Protobuf with backward/forward compatibility rules enforced by a Schema Registry (old consumers ignore unknown fields); use versioned event types (`user.login.v1`, `user.login.v2`) so old consumers stick to v1. Never make a backward-incompatible change without versioning. Adding fields is fine. Removing or renaming fields without a migration plan is not.

**7. Recent-event reads.**

Three approaches. (1) Document the lag ("data has ~5s lag"). Most use cases accept this. Cheapest. (2) Dual-write to a real-time store. A second consumer reads Kafka and writes to Redis (per-user list, capped at 1000 recent events). Queries that need <1s freshness hit Redis; older data falls through to Cassandra. Costs 2x writes at the consumer tier. (3) Query Kafka directly via kSQL. Operationally awkward; Kafka is not a key-value store. For most audit pipelines, option 1 is correct. For fraud or live-dashboard use cases, option 2 is worth the cost.

**8. Region goes down.**

If the producer SDK has failover: it detects local Kafka as unreachable, buffers events locally, and fails over to the next-nearest region. When the local cluster recovers, it drains the buffer. Data loss window: events buffered in the producer process at the moment of failure, typically under 1 second.

If the SDK is naive: producer gets timeouts. All events generated during the outage are lost. DR play: cross-region Kafka replication via MirrorMaker so events that landed in the failed region's Kafka eventually replicate elsewhere. For zero-data-loss DR: write to two Kafka clusters synchronously. Doubles producer latency.

**9. Cold-tier query cost.**

"Every event for tenant X for 3 years" scans naively across 3 years x 365 date partitions x all event_type subdirectories.

Optimizations: `tenant_id` must be in the S3 prefix path, not buried inside Parquet (critical for partition pruning). Parquet's per-row-group statistics let Athena skip row groups that cannot match the filter. For hot queries, pre-aggregate nightly into a small summary table. Events older than 1 year move to Glacier Deep Archive (1/20 the cost, 12-48h retrieval for compliance queries). For interactive sub-second analytics: load data into ClickHouse, BigQuery, or Snowflake. S3 Parquet via Athena is for ad-hoc queries, not interactive dashboards.

**10. Exactly-once for a side effect.**

SMS is not idempotent. Use a transactional outbox at the fraud-alert consumer specifically: the consumer reads Kafka events and writes `(event_id, status='pending')` rows to a local DB table. A separate sender process picks pending rows, calls the SMS API with `idempotency_key = event_id` (Twilio supports this), then marks the row `status='sent'`. If the sender crashes between the API call and the status update, it retries on restart. The SMS provider's idempotency key prevents a second message from sending. Apply the expensive exactly-once guarantee only to the consumer that needs it, not to the whole pipeline.

---

### 12. Trade-offs worth saying out loud

**Sync vs async.** Sync writes give immediate consistency and simpler reasoning. They cap throughput at the storage layer's speed. Async via queue decouples producer rate from storage rate. Higher throughput at the cost of end-to-end lag and weaker consistency. Under 100ms lag target means sync. Over 1 second acceptable means async.

**Batch vs stream.** Batching amortizes per-write overhead. Larger batches mean higher throughput but higher latency per event. The sweet spot: batch enough to amortize fsync, small enough to land within the lag SLA. Typical: 100ms or 1000 events, whichever comes first.

**Exactly-once cost.** Kafka EOS drops throughput 20-40% and adds operational complexity. The right move is usually "at-least-once with idempotent storage." Reserve true exactly-once for non-idempotent side effects.

**Why Cassandra over Postgres at the hot tier.** Postgres B-tree is poor at write-heavy random-key inserts. Cassandra LSM is built for it. Under 50k writes/sec, Postgres is fine and operationally simpler. Above that, Cassandra wins on throughput per node and horizontal scaling (add a node, rebalance automatically).

**Why S3 Parquet for cold tier.** Cheap, durable, columnar, queryable with serverless tools. Keeping 7 years of events in Cassandra costs 100x more for data accessed once a year.

**What to revisit at 10M events/sec.** A specialized vendor (Datadog, Splunk, Honeycomb) or purpose-specific pipelines: one for security events (strict durability, long retention), one for product analytics (loose durability, aggregated only), one for traces (sampled, very short retention). The "one pipeline for everything" pattern stops scaling cleanly past ~1M events/sec.

---

### 13. Common mistakes

**Reaching for Kafka and Cassandra immediately.** The problem starts at 100 events/sec. Proposing a Kafka cluster in minute one means you have not earned the architecture. Walk the stages. Justify each addition by naming what the previous stage broke.

**Confusing buffering with batching.** Buffering means holding events in memory before writing. Batching means writing many events in one storage call. You usually do both. Articulate the difference.

**Not specifying the partition key.** "Use Cassandra" without a partition key is a hand-wave. The partition key determines whether your cluster has hot nodes. It is the most important decision in the storage layer.

**Claiming exactly-once without paying the cost.** If you say "exactly-once," explain how (Kafka EOS, transactional outbox) and what it costs. If you say "at-least-once with idempotent storage," you score the same correctness with a tenth of the operational pain.

**Forgetting back-pressure.** A write-heavy system without back-pressure cascades on the first downstream slowness. The 429 and retry-with-backoff loop is mandatory.

**Not designing for the hot partition.** "It will distribute evenly" is a hope, not a design. Real systems have one tenant 1000x bigger than the median. Have an answer: sub-sharding, rate limiting, dedicated capacity.

**No tiered storage.** Keeping 7 years of events in Cassandra is wasted money. Cold tier (S3 Parquet) is the standard play.

**Treating lag as a bug.** End-to-end lag is the price you pay for async ingestion. Some consumers want lag (cheap batch processing). Some do not (fraud alerts). Acknowledge the spectrum.

**Ignoring observability.** Queue depth, consumer lag, batch size, and partition skew diagnose every common failure mode. They are part of the design, not an afterthought.

**Building the 1M/sec architecture at 100/sec scale.** The system collapses under its own operational weight before it ever sees the traffic it was built for. Design for one stage past current, not three.

If you hit 7 of these 10 cleanly, you are interviewing well. The two that separate staff-level candidates: addressing the hot partition problem unprompted, and explaining the exact moment you would not yet introduce Kafka (the stage 1 to 2 transition). Both show that you understand cost as well as throughput.
{% endraw %}
