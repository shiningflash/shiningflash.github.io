---
layout: practice-problem
track: system-design
problem_id: 18
title: Design a Write-Heavy System (Patterns Walkthrough)
slug: 018-write-heavy-patterns
category: Patterns
difficulty: Easy
topics: [batching, async, partitioning, append-only, queues]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/018-write-heavy-patterns"
solution_lang: markdown
---

{% raw %}
## The scene

You sit down. The interviewer skips the small talk.

> *"I have an audit logging service. Today it does 100 events per second. One Postgres database. It works fine. My PM just told me we are going to log every user click across the company. About 1 million events per second. Walk me through what you do, in order."*

This is not a question about a finished system. It is a question about how you *grow* a system from "one Postgres handles it" to "a million events per second." The interviewer wants to see you reach for one tool at a time. Buffering. Batching. Queues. Partitioning. Append-only logs. The moment you give up strong consistency.

A write-heavy system is the opposite of a read-heavy one. The cost comes from taking in data, not from serving it. Each event is small. Queries are simple. The storage engine has one job: absorb writes faster than a normal database can.

If you say "use Kafka and Cassandra" in the first minute, you fail. The interviewer wants you to reach for each tool *at the moment the previous one breaks*. Not all at once.

We will walk this from 100 events per second to 1 million per second. At every step we name what breaks first, then add the smallest fix.

---

## Step 1: Ask the right questions

Take five minutes. Do not draw anything yet.

The dumb instinct is "just send it to Kafka." That is wrong until you have answers to the questions below. Aim for about 8 questions that change the design if answered differently.

<details markdown="1">
<summary><b>Show: 8 questions that matter</b></summary>

1. **How much loss is OK?** "If we drop 0.1% of events when a node crashes, is that fine?" Audit logging for SOX accepts zero loss. Click tracking accepts 1%. That one answer decides if you need `acks=all` on Kafka, a transactional outbox, or fire-and-forget UDP.

2. **How fresh must reads be?** "When we save an event, when must a query see it? 100ms? 10 seconds? 5 minutes?" Real-time forces you to index right away. 5-minute lag lets you batch into Parquet files and pay 1% of the cost.

3. **Does order matter?** "Do events need to be ordered globally, ordered per user, or unordered?" Global ordering means one writer (slow). Per-user ordering means partition by user (medium). Unordered is the cheapest.

4. **How do consumers read this data?** "By single event ID, or by aggregating?" Point lookups want an LSM tree with a primary key. Scans and counts want a columnar layout like Parquet or ClickHouse.

5. **How long do we keep it?** "30 days hot, 7 years cold? Forever?" Time-based partitions are easy to drop. That fact alone often picks the partition scheme.

6. **How big is one event?** A 200-byte event is a totally different system from a 50KB event. Fixed schemas can use columnar formats. Random JSON forces you to store the raw bytes.

7. **How bursty is the traffic?** "Is 1M/sec steady or a peak? Black Friday spike? Log storm risk?" A 5x burst is normal. Some systems see 50x bursts when a logging loop goes wild. Your queue size depends on this.

8. **What delivery promise do we need?** At-most-once (lose on failure), at-least-once (may duplicate), or exactly-once. Exactly-once is expensive and almost never worth it. At-least-once with idempotent consumers is the usual answer.

A strong candidate adds one more: *"What does the consumer actually do with these events?"* If it is a dashboard, you optimize for aggregation. If it is fraud detection, you optimize for low latency. If it is compliance storage, you optimize for cheap durable disk. The downstream decides the upstream.

</details>

---

## Step 2: How big is this thing?

The interviewer hands you the numbers. 1M events per second, steady. 3x that at peak. 500 bytes per event. Keep 90 days hot, 7 years cold. No global ordering needed. 10 seconds of lag is fine.

Compute six numbers on paper before peeking:

1. Bytes per second at steady state
2. Bytes per second at peak
3. Events per day
4. Hot storage size (90 days)
5. Cold storage size (7 years, assume 5x compression)
6. Queue size if downstream stalls for 5 minutes

<details markdown="1">
<summary><b>Show: the math</b></summary>

**Steady bandwidth.** 1M events/sec * 500 bytes = 500 MB/sec = **4 Gbps**. A 10G network card maxes out around 80%. You need more than one ingest machine just for network throughput, not for CPU.

**Peak bandwidth.** 3x steady = 1.5 GB/sec = **12 Gbps**. Several machines per region just to accept the bytes.

**Daily volume.** 1M * 86,400 seconds = **86 billion events per day**. At 500 bytes each, that is **43 TB per day raw**.

**Hot storage (90 days).** 43 TB * 90 = **about 3.9 PB**. Not one machine. This is a 10 to 30 node Cassandra cluster with RF=3 (three copies of each row).

**Cold storage (7 years, 5x compression).** 43 TB * 365 * 7 / 5 = **about 22 PB** in S3 as Parquet files. Standard S3 costs about $500k/month for that. Glacier Deep Archive cuts it to 1/20 the price if you rarely read it.

**Queue size on 5-minute stall.** 1M events/sec * 300 seconds = **300 million events** = **150 GB**. Kafka with 7-day disk retention handles this easily. An in-memory queue cannot.

**What this means.** Bandwidth and storage dominate. CPU is not the bottleneck. One Postgres maxes out around 10k-50k writes/sec. We are 20x to 100x past that on a single shard. Almost the whole design exists to *spread* writes across many machines and *batch* small writes into bigger ones.

> Why is this so different from a read-heavy system? Reads can be cached. The same data can be served a million times from one cached copy. Writes cannot. Every write is unique. Every write must hit disk. Caching does not help. You can only batch and spread.

</details>

---

## Step 3: The write pipeline grows in 4 stages

Here is how a write path evolves. Each stage handles roughly 10x the throughput of the one before. Fill in the limits.

```
Stage A:  producer -- INSERT --> Postgres            limit: [ ? ] writes/sec
                                                     fails because: [ ? ]

Stage B:  producer -- INSERT --> app -- buffer --> Postgres
                                  (in-memory                limit: [ ? ] writes/sec
                                   flush every 100ms)       fails because: [ ? ]

Stage C:  producer -- HTTP --> ingest --> [ ? ] --> batch writer -- COPY --> storage
                                                                              (Postgres
                                                                               or Cassandra)
                                  limit: [ ? ] writes/sec
                                  fails because: [ ? ]

Stage D:  producer --> regional ingest --> regional Kafka --> stream processor --> [ ? ]
                                                  (partitioned                  (Flink /
                                                   by key)                       Spark)
                                  limit: 1M+ writes/sec
                                  fails because: [ ? ]
```

<details markdown="1">
<summary><b>Show: the 4 stages with limits</b></summary>

```
Stage A:  producer -- INSERT --> Postgres            limit: ~1k writes/sec
                                                     fails because: every INSERT must
                                                                    flush the WAL to disk
                                                                    (fsync). Disk fsync
                                                                    is slow.

Stage B:  producer -- INSERT --> app -- buffer --> Postgres
                                  (flush 100ms,             limit: ~10k writes/sec
                                   COPY in batches          fails because: single Postgres
                                   of 1000)                                still chokes;
                                                                           buffer is lost
                                                                           on app crash

Stage C:  producer -- HTTP --> ingest --> Kafka --> batch writer -- COPY --> Cassandra
                                                                              (sharded)
                                  limit: ~100k writes/sec
                                  fails because: one Cassandra cluster or
                                                 one Kafka topic hits hot
                                                 partition limits;
                                                 consumers fall behind

Stage D:  producer --> regional ingest --> regional Kafka --> Flink --> Cassandra (hot)
                                                  (partitioned                + S3 Parquet
                                                   by event_type                (cold)
                                                   + tenant_id)
                                  limit: 1M+ writes/sec
                                  fails because: cross-region replication lag;
                                                 cold-tier query slowness;
                                                 bursts past Kafka capacity
```

**What each transition buys you:**

- **A to B (buffer + batch).** Stops paying fsync cost on every event. One fsync now covers 1000 events. 10x throughput, same hardware. The cost: if the app crashes, you lose the in-memory buffer. About 100ms * 10k events/sec = up to 1000 lost events.

- **B to C (durable queue).** Separates producer speed from storage speed. Producers cannot crush storage. They fill the queue. Storage drains the queue at its own pace. Cassandra's LSM tree absorbs sequential writes far better than Postgres's B-tree (more on that in Step 5). Another 10x. The cost: end-to-end lag jumps from milliseconds to seconds. Events are not queryable until the consumer has flushed them.

- **C to D (partitioning + stream processing).** Scales sideways with no single bottleneck. Each Kafka partition has its own consumer. Each Cassandra node owns a slice of the keys. A stream processor like Flink does extra work like enrichment and routing. Cold tier on S3 Parquet is bottomless and cheap. 10x more, and you can keep going by adding partitions. The cost: strong consistency is gone. Cross-region replication is eventually consistent.

> The discipline: name the limit of stage N *before* you reach for stage N+1. Junior engineers jump straight to stage D. They build the cathedral before they have any worshippers.

</details>

---

## Step 4: Draw the full pipeline

Here is the 1M events/sec design with 5 boxes missing. Fill them in.

```
                                +-------------------+
   producer apps  --HTTPS-->    |  [ ? ]            |  TLS, load balance,
   (web, mobile,                |                   |  per-tenant rate limit
   server)                      +---------+---------+
                                          |
                                          v
                                +-------------------+
                                |  Ingest Service   |  validate schema,
                                |  (stateless)      |  assign event_id,
                                |                   |  pick partition key
                                +---------+---------+
                                          |
                                          v
                                +-------------------+
                                |  [ ? ]            |  durable, partitioned,
                                |                   |  7-day retention,
                                |                   |  absorbs bursts
                                +---------+---------+
                                          |
                       +------------------+------------------+
                       |                  |                  |
                       v                  v                  v
                +-------------+   +-------------+    +-------------+
                |  [ ? ]      |   |  archiver   |    |  realtime   |
                |  (hot       |   |  (writes    |    |  consumer   |
                |   storage,  |   |   Parquet   |    |  (fraud,    |
                |   point     |   |   to S3     |    |   alerts)   |
                |   reads)    |   |   every     |    |             |
                |             |   |   5 min)    |    |             |
                +-------------+   +------+------+    +-------------+
                                         |
                                         v
                                +-------------------+
                                |  [ ? ]            |  cold tier, queried
                                |                   |  by Athena / Presto
                                +-------------------+

                                +-------------------+
                                |  [ ? ]            |  every stage reports
                                |                   |  rate, queue depth,
                                |                   |  lag, batch size
                                +-------------------+
```

<details markdown="1">
<summary><b>Show: the full architecture</b></summary>

```
                                +----------------------+
   producer apps  --HTTPS-->    |  Edge LB + WAF +     |  TLS, anycast,
   (web, mobile,                |  API Gateway         |  per-tenant rate limit,
   server)                      |                      |  back-pressure
                                +----------+-----------+    (429 if downstream full)
                                           |
                                           v
                                +----------------------+
                                |  Ingest Service      |  validate schema,
                                |  (stateless, N pods) |  assign event_id (ULID),
                                |                      |  add server timestamp,
                                |                      |  pick partition key
                                |                      |  hash(event_type, tenant_id)
                                +----------+-----------+
                                           |
                                           v
                                +----------------------+
                                |  Kafka cluster       |  partitioned by
                                |  (or Kinesis,        |  hash(event_type, tenant_id),
                                |   Pulsar, NATS)      |  RF=3, 7-day retention,
                                |                      |  acks=all
                                +----------+-----------+
                                           |
                       +-------------------+-------------------+
                       |                   |                   |
                       v                   v                   v
                +--------------+   +--------------+    +--------------+
                |  Cassandra   |   |  Archiver    |    |  Flink       |
                |  hot tier    |   |  (consumes,  |    |  stream      |
                |  90-day TTL  |   |   buffers    |    |  processor   |
                |  RF=3        |   |   5 min,     |    |  fraud,      |
                |  sharded by  |   |   writes     |    |  alerts,     |
                |  (tenant,    |   |   Parquet)   |    |  rollups     |
                |   day)       |   |              |    |              |
                +--------------+   +------+-------+    +--------------+
                                          |
                                          v
                                +----------------------+
                                |  S3 / GCS Parquet    |  partitioned by
                                |  + Athena / Presto / |  date=YYYY-MM-DD/
                                |  BigQuery on top     |  event_type=X/
                                |                      |  tenant_id=Y/
                                +----------------------+

                                +----------------------+
                                |  Metrics + Logs      |  Prometheus,
                                |  Prometheus,         |  every stage reports:
                                |  Grafana,            |  throughput, queue
                                |  OpenTelemetry       |  depth, lag, skew
                                +----------------------+
```

What each piece does, in one line:

- **Edge LB + Gateway.** Several ingest pods needed just to terminate TLS at 12 Gbps. Per-tenant rate limit prevents one noisy tenant from drowning the rest. Back-pressure (429 when Kafka is sick) protects the cluster from cascading failure.
- **Ingest Service.** Stateless. Validate. Stamp. Route. Put event in Kafka. Return 202 Accepted. That is it.
- **Kafka.** The shock absorber. Producers fill it. Consumers drain it. If a consumer stalls for 5 minutes, Kafka buffers the backlog without affecting producers.
- **Cassandra hot tier.** Recent events. Query by key (event_id, or `(tenant_id, day)` range). LSM tree shape: writes are sequential, no read-modify-write per insert.
- **Archiver.** Reads Kafka. Buffers 5 minutes or 100k events. Writes one big Parquet file to S3. Trades latency for cost.
- **Flink (stream processor).** Derived data: per-minute rollups, anomaly scores, alerts. Reads the same Kafka topic as the others.
- **S3 + query layer.** Bottomless storage. Athena/Presto/BigQuery query Parquet without a dedicated cluster.
- **Observability.** Without metrics on queue depth, batch size, and lag, you learn about problems from customer complaints.

</details>

---

## Step 5: The journey of one event (sequence diagram)

Picture a single event going from a phone to disk. It hops through buffer, batch, queue, hot store, then nightly to cold store.

```mermaid
sequenceDiagram
    participant P as Producer
    participant B as Local Buffer
    participant I as Ingest Service
    participant K as Kafka
    participant C as Consumer Pool
    participant Cs as Cassandra (hot)
    participant A as Archiver
    participant S as S3 (cold)

    P->>B: emit event
    Note over B: buffer 100ms or 1000 events
    B->>I: POST /events/batch
    I->>I: validate, stamp event_id, pick partition
    I->>K: produce (acks=all)
    K-->>I: ack (replicated to ISR)
    I-->>B: 202 Accepted
    Note over P,I: synchronous slice ends (P99 ~50ms)

    K-->>C: poll batch
    C->>Cs: UNLOGGED BATCH per partition
    Cs-->>C: ack
    C->>K: commit offset

    K-->>A: poll batch (separate consumer group)
    Note over A: buffer 5 min or 100k events
    A->>S: PUT Parquet file
    S-->>A: ack
    A->>K: commit offset
```

End-to-end lag from producer to "queryable in Cassandra" is 1 to 3 seconds, with P99 around 10 seconds. Lag to S3 Parquet is up to 5 to 6 minutes (the archiver's flush window dominates).

The sync part is small. Producer to Kafka ack, P99 about 50 ms. Everything after Kafka happens at its own pace.

---

## Step 6: Append-only logs and why LSM beats B-tree here

Postgres uses a B-tree for its primary index. Cassandra uses an LSM tree. RocksDB, ScyllaDB, HBase, and Kafka's log are all LSM-flavored. For write-heavy work, LSM wins. Why?

Define the terms first:

> **B-tree.** A balanced tree on disk. Each node is a page. Inserts find the right leaf page, write into it, and may split the page if it is full. Postgres and MySQL use B-trees.
>
> **LSM tree.** Log-Structured Merge tree. Optimized for fast writes by appending instead of updating in place. Writes go to an in-memory table (memtable). When it fills, it flushes to disk as a new immutable file (SSTable). Background compaction merges files later.

<details markdown="1">
<summary><b>Show: B-tree vs LSM for writes</b></summary>

**A B-tree insert (Postgres, MySQL) does 5 things:**

1. Find the leaf page for this key. Often a random disk read if the page is not cached.
2. Insert the key. If the page is full, split it (write 2 pages instead of 1).
3. Update parent pages if the split goes up.
4. Write to WAL (sequential), then update the data page later (often random).
5. On commit, fsync the WAL to disk.

Random keys are the worst case. Each insert touches a different leaf page. The cache churns. You pay a random read plus a random write per insert. A single Postgres tops out around 1k-10k writes/sec for keyed inserts that do not fit in memory.

**An LSM insert (Cassandra, RocksDB) is simpler:**

1. Append to a commit log (sequential disk write).
2. Insert into an in-memory memtable (sorted in RAM).
3. When the memtable fills, flush it as a new SSTable file (one big sequential write).
4. Compaction merges old SSTables in the background to free space.

> Why is LSM faster? All disk writes are sequential. Append is the fastest thing a disk can do. Sequential disk throughput is 10-100x random disk throughput on spinning disks, and even on SSDs sequential beats random for sustained writes. There is no read-before-write. SSTables are immutable, so no page locks for concurrency. The cost is paid later, when the system is less busy, during compaction.

**What LSM costs:**

- **Read amplification.** A read might check the memtable plus several SSTables. Bloom filters help, but reads are slower than B-tree reads for the same data.
- **Write amplification.** Compaction rewrites SSTables. The same byte may be written 5-10 times over its life.
- **Space amplification.** Until compaction runs, you have several copies of the same data.

**LSM wins for:** write-heavy work, time-series, logs, telemetry. Cassandra, ScyllaDB, RocksDB, LevelDB, HBase, BigTable, DynamoDB under the hood, InfluxDB.

**B-tree wins for:** OLTP with frequent updates to the same rows, read-heavy work, lots of secondary indexes. Postgres, MySQL.

**The append-only log extreme is even simpler than LSM.** Kafka is pure append to a segment file. No compaction unless you turn it on. Reads are by offset (O(1) seek). This is why Kafka can ingest millions of messages per second per partition on cheap hardware. The trade-off: you cannot query by arbitrary key. Only by offset or time.

For our 1M events/sec audit pipeline, the storage layers stack up like this:

- **Kafka log.** Pure append. Infinite write throughput per partition until disk fills.
- **Cassandra hot tier.** LSM. Query by key. 90-day retention.
- **S3 Parquet cold tier.** Immutable columnar files. Queried by partition.

Each is optimized for write throughput at its scale.

</details>

---

## Step 7: Picking a partition strategy

You have to pick a partition key for Kafka and a shard key for Cassandra. The choice decides if load spreads evenly or if one partition gets 10x the traffic of the rest.

Three families. For each, name when it works and when it does not.

| Strategy | How it works | Good for | Fails when |
|----------|--------------|----------|------------|
| Time-based | partition = day or hour | [ ? ] | [ ? ] |
| Hash-based | partition = hash(key) % N | [ ? ] | [ ? ] |
| Tenant-based | partition = tenant_id | [ ? ] | [ ? ] |

Here is a flowchart to help you pick:

```mermaid
flowchart TD
    A[Need to pick partition strategy] --> B{Time-series queries?}
    B -->|Yes, time-range reads dominate| C[Time-based<br/>partition by hour or day]
    B -->|No| D{Need even write distribution?}
    D -->|Yes, no hot keys allowed| E[Hash-based<br/>hash key % N]
    D -->|No| F{Need per-tenant isolation?}
    F -->|Yes, noisy tenant cannot hurt others| G[Tenant-based<br/>partition by tenant_id]
    F -->|No| H[Composite key<br/>combine 2 of the above]
    C --> I[Cost: hot partition on writes<br/>all writes go to current hour]
    E --> J[Cost: range queries become<br/>scatter-gather]
    G --> K[Cost: uneven sizes<br/>one big tenant kills you]
```

<details markdown="1">
<summary><b>Show: the 3 partition families filled in</b></summary>

| Strategy | How it works | Good for | Fails when |
|----------|--------------|----------|------------|
| **Time-based** | Each hour or day gets its own partition. Files named `events/2026-05-24/...` | Time-range queries ("events from last week"). Cheap to drop old data (delete the directory). Cold-storage archiving (move yesterday to S3 Glacier). Natural fit for Parquet on S3. | **Hot partition on writes.** All writes go to the current hour. Older partitions are cold. The hot one melts. Fix: combine with another key (hour + hash). |
| **Hash-based** | `partition_id = hash(event_id) % N` or `hash(user_id) % N` | Even write distribution. No hotspots if the key has high cardinality. Easy to scale: add nodes, rebalance. | **Range queries become scatter-gather.** "All events for user X in last hour" hits every partition unless you hash by user_id (then "all events between A and B" is the scatter case). Cannot drop old data without scanning. Adding nodes moves data across the network. |
| **Tenant-based** | `partition_id = tenant_id` or hash(tenant_id) | Multi-tenant isolation. Noisy tenant contained (one tenant's spike does not hurt others). Easy per-tenant deletion (GDPR). Per-tenant SLAs. | **Uneven sizes.** Your biggest tenant might be 1000x bigger than the median. That tenant's partition is hot. Classic "one big customer" problem. Fix: sub-shard the biggest tenants with a random suffix (`tenant_42_0`, `tenant_42_1`, ..., `tenant_42_15`). |

**The right answer is usually a mix.**

For 1M events/sec audit logging:

- **Kafka partition key:** `hash(event_type, tenant_id)`. Spreads load across partitions while keeping per-key ordering inside a single `(event_type, tenant_id)` stream. Start at 100 partitions, scale to 1000+ as needed. Each partition handles about 10k events/sec at the high end.

- **Cassandra primary key:** `((tenant_id, day), event_id)`. The partition key `(tenant_id, day)` puts all events for a tenant on a given day in one place (cheap range scan). The clustering column `event_id` gives uniqueness and ordering inside the partition. The day component bounds partition size: even a huge tenant only writes one day at a time per partition.

- **S3 Parquet prefix:** `date=YYYY-MM-DD/event_type=X/tenant_id=Y/`. Time-based at the top (cheap to drop old data). Hash-friendly subdirs for query pruning. Athena uses partition pruning to skip whole prefixes when the query filters on date or tenant.

**The hot partition problem in real life:**

Say one tenant's mobile app has a bug. It emits 100k events/sec instead of the normal 100. Their `(event_type, tenant_id)` partition gets 100k/sec. Every other partition gets 100. That partition's Kafka broker pegs CPU. Lag grows. Consumers cannot keep up. Eventually the broker disk fills.

**Fixes, in order:**

1. Detect early with per-partition rate monitoring. Alert on `max(partition_rate) / median(partition_rate) > 10x`.
2. Sub-shard the hot key by adding a random suffix for that one tenant: `(event_type, tenant_id, random(0..15))`. Load spreads across 16 partitions. Cost: you lose per-key ordering for that tenant during the spike.
3. Apply a per-tenant rate limit at the ingest tier. Cap any single tenant at 50k events/sec. Excess gets 429. The tenant fixes their bug.
4. Long term: quota and isolation. Premium tenants get reserved capacity. Long-tail tenants share a pool.

For Cassandra, hot partition = hot row = hot node. Same fixes apply: sub-shard the key, monitor for skew, throttle at ingest.

</details>

---

## Step 8: Pick a delivery guarantee

At small scale, every event is in one Postgres. One ACID transaction. Either it is on disk or it is not. Easy.

At 1M events/sec, that promise is gone. You cannot have linearizable writes across a distributed Kafka cluster, Cassandra, and S3 at 10 Gbps without paying huge latency. So you trade.

Three delivery guarantees. Every write-heavy system has to pick one.

- **At-most-once.** Send and forget. If anything fails, the event is lost. Cheapest. Fastest. Lowest latency.
- **At-least-once.** Wait for ack. Retry on failure. May produce duplicates. Most common in practice.
- **Exactly-once.** Each event lands in storage exactly once. No duplicates. No losses. Expensive. Slow.

Here is a flowchart to pick:

```mermaid
flowchart TD
    A[Pick delivery guarantee] --> B{Is it OK to lose events?}
    B -->|Yes, stats only| C[at-most-once<br/>fire and forget UDP<br/>cheapest, lowest latency]
    B -->|No, never lose| D{Are duplicates OK?}
    D -->|Yes, consumer can dedupe| E[at-least-once<br/>+ idempotent consumer<br/>most common choice]
    D -->|No, downstream side effect<br/>cannot be undone| F[exactly-once<br/>Kafka EOS or<br/>transactional outbox]
    C --> G[Use for: click tracking,<br/>ad impressions, perf traces]
    E --> H[Use for: audit, billing,<br/>most pipelines]
    F --> I[Use for: SMS sending,<br/>payment processing]
```

<details markdown="1">
<summary><b>Show: when each guarantee is right</b></summary>

**At-most-once.** Use when the data is statistical, not transactional. Page views, click tracking, performance traces, ad impressions. Losing 0.1% does not change the answer. Use when latency matters more than completeness.

> *How it works:* Producer sends, returns immediately, does not retry. If the broker is down or a packet drops, the event is gone forever. Zero retry cost. No idempotency machinery. Cheapest pipeline you can build.

Do not use for anything where a missing event has user-facing impact (audit, billing, security alerts, orders).

**At-least-once.** The default for almost every modern event pipeline. Use when loss is unacceptable but duplicates can be handled, usually because the consumer is idempotent. Kafka producers with `acks=all` plus commit-after-process at the consumer gives you at-least-once.

> *How it works:* Producer retries on any failure to ack. Network blip? Producer did not see the ack but the broker may have written it. Producer retries. Broker writes a second copy. Event appears twice. Consumer commits offsets after processing. If consumer crashes between processing and commit, it reprocesses on restart. Event processed twice.

**How to handle the duplicates:**

- **Idempotent consumer.** Use the event's `event_id` as the primary key in storage. Second write is a no-op via `INSERT ON CONFLICT DO NOTHING`, Cassandra's `IF NOT EXISTS`, or dedup at Parquet compaction.
- **Dedup window.** Keep recent event_ids in a Bloom filter or Redis set. Reject duplicates seen in the last N minutes. Cheap. Probabilistic.
- **Idempotent producer.** Kafka's idempotent producer (transactional ID + sequence numbers) prevents duplicates inside a producer session.

> Why "back-pressure" matters here: the system tells producers to slow down when consumers cannot keep up. Without back-pressure, producers keep retrying. The retry storm doubles or triples the load. The cluster collapses. Back-pressure usually means returning HTTP 429 with `Retry-After` and letting the producer SDK back off.

This is what 80% of production pipelines do. Acknowledge the duplication risk. Design consumers to be idempotent. Move on.

**Exactly-once.** Use when the downstream effect cannot be deduped and money is involved. Payment processing. Order fulfillment. Inventory deduction. Audit logging *sometimes* claims to need this. In practice, at-least-once with idempotent storage (event_id as primary key) gives you the same result for 10x less cost.

> *How it works in Kafka:* "Kafka EOS" (Exactly-Once Semantics) via transactional producers + read-committed consumers. The producer wraps writes to multiple partitions in a transaction. The consumer only sees committed messages.

**What it costs:** throughput drops 20-40% vs at-least-once. Latency goes up. Operational complexity goes up.

**The transactional outbox pattern** is the non-Kafka version. Producer writes the event to its local DB in the same transaction as the business state change, into an outbox table. A separate process reads the outbox and ships to Kafka with retries. Same idempotent-consumer requirement on the read side.

**The honest take:** most "we need exactly-once" requirements are actually "we need at-least-once with idempotent processing." The latter is much easier and cheaper. Exactly-once is only for side effects that you literally cannot dedupe (like sending an SMS).

**What we pick for the 1M events/sec audit pipeline.** At-least-once. Audit needs durability, so at-most-once is out. Storage is Cassandra keyed by `event_id`, so idempotency is free. Second write is a no-op. Exactly-once via Kafka EOS would cost about 30% throughput and would not help (we already dedupe at storage).

</details>

---

## Follow-up questions (10)

Try answering each in 2 to 4 sentences before reading the solution.

1. **Back-pressure.** Producers are sending 2x the rate Kafka can absorb. Brokers are healthy but disk is at 80%. What does the ingest service do? What does the producer SDK do?

2. **Hot tenant.** One tenant's mobile app has a bug and is sending 200k events/sec when the average is 100. They are saturating one Kafka partition and that partition's broker is at 100% CPU. How do you find them? What do you do in the next 5 minutes vs the next 5 days?

3. **Clock skew.** Two producers on different machines disagree about "now" by 3 minutes. They both send events with their local timestamps. Your downstream reports show events arriving "in the future." How do you fix it without forcing every producer to NTP-sync to nanosecond precision?

4. **Duplicate events.** A producer retried a batch after a broker timeout. The broker had actually committed the first attempt. Now Cassandra has two copies of every event in that batch. Walk me through detection and dedup.

5. **Consumer fell behind.** A Cassandra writer consumer has been stuck for 30 minutes due to a bad deploy. Kafka has buffered 1.8 billion events for that consumer group. What happens when you fix the bug and restart? How do you keep it from melting the storage layer when it catches up?

6. **Schema evolution.** A team added a new field. Old producers send 5 fields, new producers send 6. Cassandra has a fixed table schema. How do you handle the migration without dropping events or breaking old consumers?

7. **Recent-event reads.** A consumer wants "all events for user U in the last 30 seconds." Your storage path is Kafka, then batched 5 min into Cassandra. The event might still be in Kafka. How do you make the read see both?

8. **A region goes down.** US-East Kafka cluster is offline. Producers there cannot publish. Producers in other regions are fine. What is your DR play? How much data could be lost?

9. **Cold-tier query cost.** A user wants "every event for tenant X for the past 3 years." Naive Athena query scans 3 PB of Parquet. How do you make this both fast and cheap?

10. **Exactly-once for a side effect.** One downstream consumer sends an SMS for every fraud alert. SMS is not idempotent (the user gets two texts if you send twice). How do you guarantee exactly one SMS without paying Kafka EOS cost on the whole pipeline?

---

## Related problems

- **[Approval Management (011)](../011-approval-management/question.md).** The audit log in that design is a write-heavy append-only system. The patterns here (tiered storage, append-only log, batched writes) apply directly.
- **[Todo List Sharing (013)](../013-todo-list-sharing/question.md).** The change-log sync pipeline for collaborative todo edits is the same shape at smaller scale: every edit is a small append-only event, partitioned by list_id.
- **[News Feed (002)](../002-news-feed/question.md).** Timeline write fan-out is the classic write-heavy problem at consumer scale: each post produces N writes (one per follower's timeline).
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md).** The mirror image of this problem. Read-heavy is cached. Write-heavy is batched and partitioned.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Write-Heavy System Patterns

### The short version

A write-heavy system is one where the cost comes from taking in data, not from serving it. Each event is small. Queries are simple. The database's job is to absorb writes faster than a normal database can.

The interesting work is at the seams. When do you add a buffer? When do you add a queue? When do you give up linearizability? When do you stop adding pieces because what you have is already enough?

The toolkit, in the order you reach for it as scale grows:

1. **One Postgres** at about 1k writes/sec.
2. **In-memory buffer + batched commits** at 10k writes/sec.
3. **Durable queue + async LSM writer** at 100k writes/sec.
4. **Partitioned queue + stream processing + tiered storage** at 1M writes/sec and beyond.

Each step trades latency, consistency, or operational complexity for throughput. The senior move is to name the limit of stage N *before* reaching for stage N+1. Not to pre-emptively build stage 4.

Three big decisions decide the final shape:

- **Partition key.** Time, hash, or tenant. Usually a composite like `(event_type, tenant_id, day)`.
- **Append-only storage.** LSM at the hot tier. Parquet on object storage at the cold tier.
- **Delivery guarantee.** At-least-once with idempotent storage is right for 95% of cases. At-most-once is for stats. Exactly-once is only for non-idempotent side effects.

---

### 1. The clarifying questions, in one paragraph

The four that change the design are covered in `question.md`. **Durability** decides whether you need `acks=all` and a transactional outbox, or whether UDP fire-and-forget is fine. **Acceptable lag** decides whether you write synchronously or batch into Parquet at 1% of the cost. **Ordering** picks the partition strategy. **Read pattern** picks the storage engine.

If you walked in without asking durability and lag, you have no basis to choose between Kafka EOS (expensive, exactly-once) and fire-and-forget UDP (cheap, lossy). They are 1000x apart in cost.

---

### 2. The math, in plain numbers

| Number | Value | Why it matters |
|--------|-------|----------------|
| Sustained bandwidth | 500 MB/sec (4 Gbps) | Multiple ingest nodes per region needed for NIC, not CPU |
| Peak bandwidth | 1.5 GB/sec (12 Gbps) | Several machines per region just to accept bytes |
| Daily volume | 86 billion events, 43 TB raw | Hot tier is petabytes |
| Hot storage (90 days) | 3.9 PB | 10-30 node Cassandra cluster |
| Cold storage (7 years, 5x compression) | 22 PB on S3 | ~$500k/month standard, ~$25k/month Glacier Deep |
| Queue size on 5-min stall | 300M events, 150 GB | Kafka handles easily, in-memory does not |

The headline takeaway: **bottleneck is bandwidth and storage layout, not CPU.** A single Postgres maxes out around 10k writes/sec. We are 100x past that on a single shard. We need to spread writes across nodes and batch them so per-write overhead amortizes.

> Why "events per day" is the wrong KPI: it sounds big (86 billion!) but byte count is what kills servers. A pipeline that does 86 billion events of 50 bytes each is a completely different system from one that does 86 billion events of 5 KB each. Always do bytes too.

---

### 3. The API

Reads are out of scope here. Focus on ingest.

**Single-event ingest** for low-volume producers:

```
POST /api/v1/events
Content-Type: application/json
X-Tenant-Id: tenant_42
Authorization: Bearer <token>
Idempotency-Key: <uuid>           # optional; if set, server dedupes on this key

{
  "event_type": "user.login",
  "user_id": "u_8201",
  "timestamp": "2026-05-24T10:14:02.331Z",   # producer clock
  "attributes": { ... }                       # arbitrary JSON
}
```

| Status | Meaning |
|--------|---------|
| 202 Accepted | Event in durable queue, queryable within 10s |
| 400 Bad Request | Schema invalid |
| 401 Unauthorized | Missing or bad token |
| 413 Payload Too Large | Single event > 1 MB |
| 429 Too Many Requests | Rate limited (per tenant), or back-pressure |
| 503 Service Unavailable | Ingest degraded, producer should retry |

**Batched ingest** for everyone else:

```
POST /api/v1/events/batch
Content-Encoding: gzip
Content-Type: application/json

{
  "events": [
    { ...event 1... },
    { ...event 2... },
    ...up to 1000 events or 1 MB compressed...
  ]
}
```

| Status | Meaning |
|--------|---------|
| 202 Accepted | Whole batch durably queued |
| 207 Multi-Status | Partial success, per-event errors in response |
| 429 / 503 | Same as single-event |

**A few load-bearing choices:**

- **202, not 200.** The event is not durably stored at the time of the response. It is durably queued. 200 implies "we have it." 202 communicates "we have accepted responsibility, you can stop retrying."
- **Idempotency-Key is optional.** Most producers do not need it (event_id dedup at storage handles most dups). For producers that cannot retry safely (one-shot lambdas), an Idempotency-Key gives end-to-end dedup.
- **The batch endpoint is recommended.** Per-event HTTP at 1M/sec is 1M TLS handshakes/sec (impossible). Batches of 1000 cut that to 1k req/sec. Same bytes, 1000x cheaper.
- **Server stamps a server timestamp** in addition to producer timestamp. Both are kept. Producer time is "when did the event happen." Server time is "when did we accept it." Clock-skew analysis uses the gap.
- **Rate limits are visible.** 429 responses include `Retry-After` and `X-RateLimit-Remaining` so well-behaved producers throttle themselves.

---

### 4. The data model

**The canonical event:**

```json
{
  "event_id": "01H8K2X...",            // ULID or snowflake, server-generated if missing
  "tenant_id": "tenant_42",
  "event_type": "user.login",
  "user_id": "u_8201",
  "producer_ts": "2026-05-24T10:14:02.331Z",
  "server_ts":   "2026-05-24T10:14:02.412Z",
  "attributes": { ... },
  "schema_version": 3
}
```

**Hot tier in Cassandra:**

```cql
CREATE TABLE events_by_tenant_day (
    tenant_id     text,
    day           date,                    -- derived from server_ts
    event_id      timeuuid,                 -- sortable, unique
    event_type    text,
    user_id       text,
    producer_ts   timestamp,
    server_ts     timestamp,
    attributes    text,                     -- JSON serialized
    schema_version int,
    PRIMARY KEY ((tenant_id, day), event_id)
) WITH CLUSTERING ORDER BY (event_id DESC)
  AND default_time_to_live = 7776000;      -- 90 days
```

Three small things doing real work:

**`PRIMARY KEY ((tenant_id, day), event_id)`.** The partition key `(tenant_id, day)` bounds partition size. Even the biggest tenant only writes one day at a time into one partition. The clustering column `event_id` keeps rows sorted inside the partition, so "latest events" is a prefix scan. The same key also gives natural dedup: same `event_id` inserted twice = same row.

**`default_time_to_live = 7776000`.** 90 days. Cassandra auto-deletes old rows during compaction. No nightly delete job needed. No tombstone storm if you keep deletes minimal otherwise.

**Why not a foreign key from the events table to anything?** Audit-shaped data is reference-free. The event captures who/what/when. If the user account is later deleted, the audit must still survive. Foreign keys would cascade-delete the audit, which is exactly what you do not want.

**A second table for the per-user access pattern:**

```cql
CREATE TABLE events_by_user_day (
    user_id       text,
    day           date,
    event_id      timeuuid,
    event_type    text,
    tenant_id     text,
    attributes    text,
    PRIMARY KEY ((user_id, day), event_id)
);
```

Same data, different partition key. Supports "events for user U" lookups. Written by the stream processor (Flink) reading the Kafka topic and writing both tables. Cost: 2x write amplification. Benefit: O(1) lookups for both access patterns.

**Cold tier on S3** sits at path `s3://events-cold/date=YYYY-MM-DD/event_type=X/tenant_id=Y/file_N.parquet`. Columnar layout inside each Parquet file. Column-pruned reads (only read `user_id` and `event_type` from a 50-column event) are free. Partition pruning at the file-prefix level means Athena/Presto skip whole directories that do not match the query.

> Why Cassandra and not Postgres at the hot tier? Postgres B-tree does read-modify-write on every insert: find the page, update it, write it back. Cassandra's LSM tree just appends to a log. Append is the fastest thing a disk can do. The cost is paid later, during background compaction, when the system is less busy.

---

### 5. The write pipeline, code level

Four stages. Each with a clear contract with the next.

**Stage 1: Ingest service** (the sync part of the producer's request).

```python
def handle_batch(request):
    tenant = authenticate(request)
    rate_limiter.check(tenant)                       # 429 if over quota
    queue_health.check()                              # 503 if Kafka is unhealthy

    events = parse_and_validate(request.body)         # 400 on schema errors
    for e in events:
        e.event_id = e.event_id or new_ulid()
        e.server_ts = now()
        e.tenant_id = tenant.id

    # Group by partition key for fewer Kafka send calls
    by_partition = group_by(events, lambda e: partition_for(e))

    futures = []
    for partition, group in by_partition.items():
        futures.append(kafka_producer.send_async(
            topic="events",
            partition=partition,
            value=group,
            acks="all",                               # wait for all replicas
            timeout_ms=5000
        ))

    wait_all(futures, timeout_ms=10000)               # wait for ack
    return 202_accepted(batch_id=request.id)
```

The HTTP response is sent only after Kafka confirms durable replication. If the producer sees 202, the event is on disk on multiple brokers. There is no DB write at ingest. Kafka is the only durable hop. P99 ingest target: 50 ms.

**Stage 2: Kafka** (the durable queue).

Start with 200 partitions. Each handles ~5k events/sec comfortably. RF=3. `min.insync.replicas=2` with producer `acks=all` gives "no loss as long as 2 brokers survive." Retention 7 days, long enough to replay a full week if consumers fall behind. Compression zstd, which trades a bit of CPU for ~60% smaller on-disk footprint.

Per-partition ordering is preserved. Cross-partition ordering is not. That is the trade we made when picking the partition strategy.

**Stage 3: Hot-tier writer** (Cassandra consumer).

```python
def consume_loop(consumer, cass_session):
    while True:
        records = consumer.poll(timeout_ms=100, max_records=1000)
        if not records:
            continue

        # Build a Cassandra UNLOGGED BATCH per partition
        batches_by_partition = defaultdict(list)
        for r in records:
            event = json.loads(r.value)
            pk = (event["tenant_id"], date(event["server_ts"]))
            batches_by_partition[pk].append(event)

        for pk, events in batches_by_partition.items():
            batch = BatchStatement(batch_type=BatchType.UNLOGGED)
            for e in events:
                batch.add(insert_stmt, params_for(e))
            cass_session.execute(batch)               # one network roundtrip

        consumer.commit()                             # only after Cassandra ack
```

The UNLOGGED BATCH per Cassandra partition is the throughput trick. Cassandra's UNLOGGED batches that hit a single partition are a single coordinated write, 10-100x faster than single-event INSERTs.

Commit Kafka offset *after* Cassandra ack. At-least-once: if the consumer crashes between Cassandra write and offset commit, it reprocesses on restart. Primary-key dedup in Cassandra catches the duplicates.

Bound the batch size: do not let a single Cassandra BATCH exceed ~5 KB. Limit to ~50 events per batch as a safety bound.

**Stage 4: Cold-tier archiver** (S3 Parquet).

```python
def archive_loop(consumer):
    buffer = []
    last_flush = now()
    while True:
        records = consumer.poll(timeout_ms=1000, max_records=10000)
        buffer.extend(records)

        if len(buffer) >= 100_000 or now() - last_flush > 300:    # 100k or 5 min
            flush(buffer)
            buffer = []
            last_flush = now()

def flush(records):
    # Group by partition path: date / event_type / tenant_id
    grouped = group_by(records, lambda r: parquet_path(r))
    for path, group in grouped.items():
        write_parquet(s3_client, path, group)
    consumer.commit()
```

Flush every 5 minutes or every 100k events, whichever first. Small batches waste S3 PUT operations ($0.005 per 1000). 5-min batches keep cost manageable. Parquet over S3 is columnar, compressed, Athena-queryable, cheap. Group by partition path so each S3 key is one Parquet file with one `(date, event_type, tenant_id)`. Lets queries prune entire prefixes.

---

### 6. The architecture, drawn out

The whole picture as ASCII boxes:

```
   Client                                   Hot tier              Cold tier
   +------+                              +-----------+         +-----------+
   |Phone | --HTTPS-->                   |           |         |           |
   |Web   |              +---------+     |           |         |           |
   |Server| ---batch---> |  Edge   |     |           |         |           |
   +------+              |  LB +   |     |           |         |           |
                         |  WAF    |     |           |         |           |
                         +----+----+     |           |         |           |
                              |          |           |         |           |
                              v          |           |         |           |
                         +---------+     |           |         |           |
                         | Ingest  |     |           |         |           |
                         | Service |     |           |         |           |
                         | (N pods)|     |           |         |           |
                         +----+----+     |           |         |           |
                              |          |           |         |           |
                              v          |           |         |           |
                         +---------+     |           |         |           |
                         |  Kafka  |     |           |         |           |
                         | cluster |     |           |         |           |
                         | 200 par |     |           |         |           |
                         | RF=3    |     |           |         |           |
                         | 7d ret  |     |           |         |           |
                         +----+----+     |           |         |           |
                              |          |           |         |           |
              +---------------+--------+--+-------+  |           |         |
              |                        |          |  |           |         |
              v                        v          v  |           |         |
         +---------+              +---------+ +---------+         |         |
         | Cassan- | <-- writes --| Consumer| | Flink   |         |         |
         | dra hot |              | Pool    | | rollups |         |         |
         | tier    |              | (writes | | alerts  |         |         |
         | RF=3    |              | UNLOG-  | |         |         |         |
         | 90d TTL |              | GED     | +---------+         |         |
         +---------+              | BATCH)  |                     |         |
                                  +---------+                     |         |
                                                                  |         |
                                  +---------+                     |         |
                                  |Archiver |   5-min batches     |         |
                                  |(buffers |   100k events       |         |
                                  | 5 min)  |   per Parquet       |         |
                                  +----+----+                     |         |
                                       |                          |         |
                                       v                          |         |
                                  +---------+                     |         |
                                  |   S3    | <------------------ |         |
                                  | Parquet |    7-year archive   |         |
                                  | date/   |                     |         |
                                  | type/   |                     |         |
                                  | tenant/ |                     |         |
                                  +----+----+                     |         |
                                       |                          |         |
                                       v                          |         |
                                  +---------+                     |         |
                                  | Athena/ |   ad-hoc queries    |         |
                                  | Presto/ |   over cold data    |         |
                                  | BigQuery|                     |         |
                                  +---------+                     |         |
```

A few things worth pointing out:

- **Ingest pods are stateless.** Their only durability is Kafka. If a pod dies mid-request, the producer's connection drops, the producer retries, and either the second attempt lands or the idempotency key (if present) deduplicates the first.
- **Three separate consumer groups read the same Kafka topic.** Independent: the archiver can fall behind without affecting Cassandra writes; Flink can crash without affecting the archiver. Each maintains its own Kafka offsets.
- **Cassandra and S3 are not redundant.** They serve different access patterns. Cassandra answers "give me events for tenant X on day D" in 30ms. S3 answers "give me everything for tenant X over 2 years" in minutes. Picking one or the other gives you the wrong cost/performance curve for at least one query.
- **Observability is on every box.** Without it, the first thing you learn about a stuck consumer is a customer complaint two hours later.

**Concrete tech choices:**

- **Edge LB:** AWS ALB or Cloudflare + Envoy. Redis-backed token bucket for per-tenant rate limits.
- **Ingest pods:** Go or Rust for low GC overhead.
- **Queue:** Kafka via Confluent, AWS MSK, or Aiven. Alternatives: Kinesis (simpler ops), Pulsar (better multi-tenant), Redpanda (Kafka-compatible, lower latency).
- **Hot store:** Cassandra or ScyllaDB (better per-node performance), or DynamoDB (fully managed).
- **Archiver:** Kafka consumer writing Parquet, often a Flink job.
- **Stream processor:** Flink for stateful work, KSQL or Spark Structured Streaming for SQL-flavored, Materialize for incremental views.
- **Cold tier:** S3 + Athena. Glacier Deep Archive for >1 year.

---

### 7. An event's journey, end to end

```mermaid
sequenceDiagram
    participant P as Producer
    participant E as Edge LB
    participant I as Ingest
    participant K as Kafka
    participant HW as Hot Writer
    participant Cs as Cassandra
    participant A as Archiver
    participant S as S3

    P->>E: POST /events
    E->>I: TLS, rate limit
    I->>I: validate, stamp IDs
    I->>K: produce (acks=all)
    K->>K: replicate to ISR
    K-->>I: ack
    I-->>E: 202
    E-->>P: 202 OK
    Note over P,K: sync slice ends (P99 ~50ms)

    K-->>HW: poll
    HW->>Cs: UNLOGGED BATCH per partition
    Cs-->>HW: ack
    HW->>K: commit offset

    K-->>A: poll (separate consumer group)
    Note over A: buffer 5 min or 100k events
    A->>S: PUT Parquet
    S-->>A: ack
    A->>K: commit offset
```

**End-to-end lag:**
- Producer to Cassandra-queryable: 1-3 seconds, P99 ~10 seconds.
- Producer to S3 Parquet: up to 5-6 minutes (archiver flush window dominates).

**Sync slice is small.** Producer to Kafka ack, P99 50 ms. Everything after Kafka happens at its own pace.

**Read latencies (target):**
- Point read by event_id: P99 ~10ms.
- Per-user range scan: P99 ~30ms.
- Analytics over 1 year via Athena: seconds to minutes depending on scope.

**A read that crosses tiers** ("last 30 seconds for user U") might still be in Kafka. Three options:

1. Accept the lag and tell users "data has ~5s lag" (cheapest, fits most audit workloads).
2. Dual-write to a real-time store (Redis hash per user) in parallel for sub-second visibility (pay 2x writes).
3. Query Kafka directly via kSQL (operationally awkward, Kafka is not a key-value store).

Pick based on the user-facing SLA.

---

### 8. The scaling journey: 100 events/sec to 1M

This is the section the interviewer cares about most. At every stage, name what just broke and what fixes it. Build nothing preemptively.

#### Stage 1: 100 events/sec

A single Postgres (db.t3.medium, 4 GB RAM). One Go or Python app instance with a `/events` endpoint doing `INSERT INTO events_table (...) VALUES (...)`. One table, indexed by `event_id` and `(user_id, created_at)`. No queue, no cache, no replicas. Cost: ~$50/month for the DB, ~$30/month for the app.

**Why this is enough:** 100 events/sec is 8.6M events/day. Postgres handles this with room to spare, about 5ms per insert, using maybe 50% of one core. One table at 30 GB/year fits on disk easily. Reads are easy because writes are easy.

> The lesson: at 100 events/sec, the simplest possible system *is* the right system. Anything else is a portfolio piece, not engineering.

#### Stage 2: 10k events/sec

**What breaks:** Postgres CPU is at 80%. WAL fsync is the bottleneck (each commit fsyncs to disk). Inserts land in random pages, so the buffer pool churns. The app does one network round-trip per event. Even at 1ms each, 10k of them is 10 cores of round-trip waiting.

**Fixes:**

- Add in-app buffering. Accumulate events in memory, flush every 100ms or every 1000 events.
- The flush is a Postgres `COPY` instead of `INSERT`. 10-20x faster.
- Partition the table by day (`CREATE TABLE events_2026_05_24 PARTITION OF events_master FOR VALUES FROM ('2026-05-24') TO ('2026-05-25')`). Old partitions drop cheaply. Newer indexes stay small.
- Add a second app instance behind a load balancer.
- Add a read replica for the analytics queries.

**What you accept:** buffered events lost on app crash, worst case 100ms of events (~1000 events at 10k/sec). Tolerable for most use cases. Document it. End-to-end lag goes from immediate to ~100ms.

**What you do NOT build:** no Kafka, no Cassandra, no multi-region. The buffer + batch trick gets you to 10k/sec on one Postgres. Cost: ~$500/month.

> This is where most teams overengineer. They jump to Kafka because "we'll need it eventually." That is true at stage 3, not stage 2. The buffer-and-batch pattern buys 10x runway with minimal complexity.

#### Stage 3: 100k events/sec

**What breaks:**

- Postgres cannot keep up even with batching. Single instance at IO ceiling. Vertical scaling has hit its limit (largest RDS Postgres does maybe 30k writes/sec).
- The app process holding the buffer is a single point of failure. Tolerable at 10k/sec with 1000 events in flight. Scary at 100k/sec because a restart loses 100k events of buffer.
- Read replica lags by 30 seconds because the primary is saturated.
- A bad consumer query takes down the primary, which is also serving writes.

**Fixes:**

- **Kafka in front of storage.** Events go to Kafka first. Storage writes are async. Producers get 202 immediately. Kafka buffers if storage falls behind.
- **Switch storage to Cassandra.** LSM tree is the right shape: sequential writes, horizontal scaling by adding nodes, RF=3 across three AZs.
- **A separate Kafka consumer process** reads events and writes to Cassandra in batched UNLOGGED BATCH per partition. Stateless. Run N of them for redundancy. Crashes do not lose data because Kafka holds the events.
- **First pass at partitioning:** Kafka topic with 50 partitions, hash by `(event_type, tenant_id)`. Cassandra primary key `((tenant_id, day), event_id)`.
- **First pass at observability:** Kafka consumer lag, partition rate, batch size, Cassandra write latency. You will use these constantly.

**What you accept:**

- End-to-end lag jumped from 100ms to ~5 seconds.
- Strong consistency is gone (use a unique event_id like ULID to avoid conflicts).
- One Kafka consumer crash = a few seconds of replay, handled by idempotent storage.

**Cost:** ~$10-20k/month for Kafka cluster + Cassandra (5-10 nodes), self-hosted or managed.

> Stage 3 is the inflection point. You introduced asynchrony, accepted eventual consistency, and now have an actual distributed system. Operational complexity went 10x. Worth it because the alternative is sharded Postgres, which is its own nightmare.

#### Stage 4: 1M events/sec

**What breaks:**

- Single-region Kafka hits NIC and disk limits.
- Cross-region producers add latency.
- Cassandra cluster at 30 nodes: one node failure no longer self-heals fast enough; repairs take days.
- A hot tenant (one team's mobile app is misbehaving) saturates one Kafka partition and one Cassandra node, hurting other tenants.
- Cold-tier costs explode if you keep everything in Cassandra.
- Compliance asks for 7-year retention. Cassandra is the wrong tier at petabyte scale.

**Fixes:**

- **Regional ingest + regional Kafka clusters.** Each region (us-east, eu-west, ap-south) has its own ingest tier and Kafka. Events written to producer's home region. Cross-region replication for events that need to be globally visible (a separate "global" topic populated by MirrorMaker).
- **Shard Kafka topics** by `event_type + tenant_id`. Bigger tenants get their own topics or high-partition-count topics. Long-tail tenants share a multi-tenant topic.
- **Sub-shard hot partitions** with a random suffix when a partition exceeds a threshold: the ingest tier appends `random(0..15)` to the partition key for that tenant. Trades per-key ordering for load distribution.
- **Bring in Flink for stream processing.** Enrichment (geoip, user attribute join), routing to multiple sinks (Cassandra hot, S3 cold, ClickHouse rollups, Kafka fraud alerts).
- **Tiered storage:** hot in Cassandra (90-day TTL), cold in S3 Parquet (7-year retention). Dedicated archiver consumer writing 5-min Parquet batches. Belt and suspenders: nightly job lifts Cassandra partitions older than 90 days to Parquet if not already there.
- **Per-tenant rate limits at ingest.** Hard cap. 429 above the limit.

**What you accept:**

- Cross-region replication lag is seconds to minutes.
- Cold-tier queries are slow (Athena runs in minutes; OK for compliance, not interactive).
- Significant operational complexity. You need a Kafka team, a Cassandra team, a Flink team, or a small platform team that knows all of these.

**Cost:** roughly $200k-500k/month all-in, depending on managed vs self-hosted and retention choices.

#### What you would do at 10M events/sec

Honestly, at that point you are at the scale of a major observability vendor (Datadog, Splunk, Honeycomb). You stop building in-house and either:

1. Move to a fully managed platform (Kinesis Data Firehose + Iceberg on S3, BigQuery Storage Write API).
2. Build very specialized infrastructure (custom Kafka forks, custom storage engines like Honeycomb's Retriever).
3. Split the workload by purpose: one pipeline for security events (strict durability, long retention), one for product analytics (loose durability, short retention, aggregated only), one for performance traces (sampled, very short retention).

> The lesson of the 4 stages: each stage solved a specific pain. None were preemptive. The most common interview failure is to build stage-4 architecture for a stage-1 problem. The second most common is to refuse to evolve past stage 2 because "Postgres handles everything."

---

### 9. Reliability

**Queue overflow.** Kafka is at 90% disk. Producers keep sending.

- **Back-pressure at ingest.** When Kafka send latency P99 exceeds 1 second or any broker is unhealthy, ingest returns 429. Producers back off.
- **Shed less-important traffic.** Premium tenants get reserved Kafka capacity. Free-tier tenants get throttled first.
- **Emergency disk add.** Kafka brokers can have storage expanded. Painful but possible. 30-60 min fix.

**Downstream slow.** Cassandra writer lag is at 5 minutes and climbing.

- Scale Cassandra writer consumers horizontally (adding consumers spreads partitions across them).
- If Cassandra is at IO ceiling, you need more Cassandra nodes (hours for redistribution).
- Temporarily pause the archiver (it can catch up later from Kafka), freeing Kafka broker IO for the hot writer.
- Worst case: drop or sample (write 1 in 10) until backlog clears. Audit-grade systems cannot do this; product-telemetry systems can.

**Partial batch loss.** A Kafka consumer crashes after writing 800 of 1000 events to Cassandra but before committing the offset. On restart, it reprocesses the entire batch. Idempotent storage saves you: the 800 already-written events are no-op on re-insert (Cassandra UPSERT with same primary key). The 200 not-yet-written events get written for the first time. No data loss.

**Ingest pod crash.** Pod crashes between accepting a request and sending to Kafka. Producer's HTTP connection drops with no response. Producer must retry. With idempotency key, second submission is deduped; without, you get a duplicate. Mitigation: ingest pod sends to Kafka before returning 202.

**Region failure.** Producers in failed region cannot publish. Their SDK should fail over to the next-nearest region. Data loss window: events buffered in the producer's local SDK that were never sent. Typically <1 second.

**Cassandra node failure.** RF=3 means surviving 1 node failure with no data loss. Surviving 2 with degraded consistency. Failed node is auto-replaced. Data rebuilds from replicas over hours to days.

**Total Kafka cluster loss.** Catastrophic. Producers cannot send. Data in flight is lost. Mitigations: multi-region Kafka (different cluster per region, failover automatic); MirrorMaker for cross-region replication; producer-side buffering (producers buffer locally to a disk-backed queue when broker is unreachable, replay when broker recovers).

---

### 10. Observability

| Metric | Why it matters | Alert threshold |
|--------|----------------|------------------|
| `ingest.requests.rate` | Top-line throughput | Drop >50% in 5 min |
| `ingest.latency.p99` | Producer-facing SLO | >100 ms for 5 min |
| `ingest.4xx.rate` | Producer misbehavior | >1% sustained |
| `ingest.5xx.rate` | Our problem | >0.1% sustained |
| `kafka.producer.ack.latency.p99` | Kafka health | >1s for 5 min |
| `kafka.partition.rate.max / median` | Partition skew (hot partition) | >10x ratio |
| `kafka.consumer.lag` per group | Are consumers keeping up? | >30s lag for any group |
| `kafka.broker.disk.used.pct` | Storage capacity | >80% |
| `cassandra.write.latency.p99` | Storage health | >50 ms |
| `cassandra.batch.size.p99` | Are we batching effectively? | <10 events = too small |
| `cassandra.partition.size.max` | Hot partition at storage layer | >100 MB |
| `archiver.lag` | Cold tier behind real-time | >10 min |
| `archiver.parquet_file.size.p50` | Small file problem? | <10 MB = too many small files |
| `flink.checkpoint.duration.p99` | Stream processing health | >30 sec |
| `dedup.collision.rate` | Are we seeing duplicate event_ids? | Any non-zero is interesting |

**Four golden signals** for the pipeline:

1. Ingest throughput (events/sec at the API).
2. End-to-end lag (event ingest timestamp to Cassandra-readable timestamp).
3. Consumer lag per Kafka consumer group.
4. Error rates at each stage.

**Distributed tracing:** every event gets a trace ID stamped at ingest. The trace follows it through Kafka, consumer, Cassandra. Lets you debug "why did this specific event take 2 minutes to land." Sample at 0.1%; the rest you have metrics for.

**Page on:** ingest 5xx > 0.5%, ingest p99 > 200 ms for 10 min, consumer lag > 5 min for any group, Kafka broker disk > 90%.

**Ticket on:** partition skew > 10x for 1 hour, Parquet file size < 10 MB sustained, dedup collisions > 100/hour.

---

### 11. Gotchas the senior interviewer is listening for

Some of these only come out when the interviewer asks "what happens if...". The senior candidate brings them up unprompted.

**Back-pressure done wrong.** Without back-pressure at the ingest tier, a downstream slowness becomes a cascading failure. Producers keep retrying. The retry storm doubles or triples the load. The cluster collapses. The correct response is to start refusing new traffic (429) when downstream is unhealthy, not to absorb infinite buffer until you fall over.

**Hot partition.** One key (a tenant, a user, a topic) gets 100x the traffic of others. Detection: per-partition rate metric, alert on `max / median > 10x`. Mitigation: sub-shard with random suffix (cost: per-key ordering broken for that tenant), per-tenant rate limit at ingest, dedicated capacity for premium tenants.

**Clock skew.** Producer A's clock is 3 minutes ahead. Producer B's is 30 seconds behind. Events from A look like they happened in the future. Always stamp server time. Producer time is for user reference; server time is the source of truth for ordering and bucketing. NTP everywhere. Late-event tolerance in stream processing (Flink watermarks). Detect outliers: events with `producer_ts > server_ts + 5 min` get flagged.

**Duplicate events.** Producer retried after a broker timeout that actually succeeded. Now Kafka has two copies. Detection: monitor `event_id` collision rate at storage. Dedup: deterministic event_id (ULID), Cassandra primary-key conflict makes duplicate inserts a no-op, Kafka idempotent producer prevents duplicates within a session.

**Tombstone proliferation.** Cassandra deletes do not free space immediately. They write tombstones cleaned up at compaction. Many deletes can dominate the read path. Mitigation: avoid deletes in the write-heavy path. Use TTL. Run regular compaction.

**Small file problem on S3.** Archiver flushes too often. Many small Parquet files. Each Athena query opens thousands. Queries become slow and expensive. Mitigation: bigger archiver batches (5+ minutes, 100k+ events). Periodic compaction job: merge files smaller than 64 MB into larger files. Standard Iceberg/Delta Lake feature.

**Producer-side buffering bugs.** Producer SDK buffers events to coalesce network calls. Producer process crashes. Buffer lost. User thought their event was sent; it was not. Mitigations: disk-backed producer buffer for critical events; sync mode for critical events; for telemetry-grade events, accept the loss and document it.

**Re-partition rebalance storm.** You add a Kafka consumer to a consumer group. Kafka rebalances. Every consumer briefly pauses. Lag spikes. Mitigation: cooperative rebalancing (Kafka 2.4+) instead of eager rebalancing. Scale consumers during low-traffic windows. Static membership (`group.instance.id`) for long-running consumers.

---

### 12. Follow-up answers

**1. Back-pressure.**

The ingest service checks Kafka health: broker reachability, producer ack latency, consumer lag for any group falling behind. When thresholds are crossed, it returns 429 with `Retry-After`. Producers back off and retry with exponential backoff.

The producer SDK respects 429 and 503. It caches events locally (in-memory or disk-backed) and replays when health returns. Without producer-side backoff, the 429 storm just becomes a retry storm.

If Kafka is so unhealthy that even 429s are slow, the ingest tier can shed load by closing connections (TCP RST), forcing producers to back off at a lower level. Brutal but protects the cluster.

**2. Hot tenant.**

Find them: the per-partition rate metric points at one Kafka partition. Cross-reference with the partition key. Dashboard shows tenant_42 at 200k events/sec when average is 100/sec.

Next 5 minutes: hard rate limit at the ingest tier, capping tenant_42 at 50k events/sec. Excess gets 429. If the Kafka partition is still saturated, sub-shard them by hashing `(tenant_42, random(0..15))`. Spreads across 16 partitions. They lose per-key ordering during the spike but the cluster survives.

Next 5 days: contact tenant_42, diagnose the bug (often a retry loop, log misconfig, or runaway script). Establish a per-tenant quota policy with documented limits. Build per-tenant isolation: premium tenants get reserved capacity, long-tail in a shared pool, hot tenants auto-detected and isolated.

**3. Clock skew.**

The fix is structural, not "make every producer perfect." Always stamp server time at ingest; that is the timestamp used for partitioning, bucketing, and ordering downstream. Producer time is kept for user display.

NTP-sync producers to the second (achievable everywhere; reduces skew enough that producer_ts is useful as a sanity check). Detect outliers: any event with `producer_ts` more than 5 minutes off from `server_ts` is logged as suspicious. Stream processor tolerates late events: Flink watermarks define a "lateness budget" (typically 1 minute).

The trap: do not use producer time for anything that requires precise ordering. Use server time always.

**4. Duplicate events.**

Detection: Cassandra primary-key conflict on insert is the most direct signal. Consumer counts `cassandra.dedup.collisions` per minute. A separate audit: nightly job runs `SELECT event_id, count(*) FROM events GROUP BY event_id HAVING count(*) > 1`. Should be zero.

Dedup: the `event_id` is the dedup key. Generated by the producer if possible (ULID is good: time-ordered, unique, no coordination). If absent, server generates one at ingest, but then producer retries get *different* event_ids and dedup is impossible. Always prefer producer-generated event_ids. Cassandra UPSERT semantics make duplicate inserts a no-op for the same primary key.

For at-most-once semantics at the consumer (do not process a dup), a Bloom filter of recent event_ids in the consumer. Memory bounded, probabilistic.

**5. Consumer fell behind.**

Kafka has 1.8 billion events buffered. Consumer restarts. Two failure modes to avoid:

1. Resource exhaustion at storage (consumer wakes up, polls Kafka at full speed, sends 1.8B events to Cassandra as fast as Cassandra accepts, melts the cluster).
2. Out-of-order processing of derived data (if the consumer was computing rolling metrics, 1.8B events arriving in the next hour skews every metric).

Strategies:

- **Throttled catch-up.** Configure consumer to ingest at 2x normal throughput, not unbounded. At 100k/sec normal and 200k/sec catch-up, 1.8B events take 2.5 hours to drain.
- **Parallel consumers.** Scale the consumer group up temporarily. Watch storage, do not scale past what storage can absorb.
- **Watermark-aware downstream.** If derived consumers care about "now-time" processing, give them a flag to skip events older than X. Bulk-replay the historical events into a separate batch job.

> The general principle: catch-up is a separate workload. Do not pretend it is normal traffic.

**6. Schema evolution.**

Old producers send 5 fields. New producers send 6. Cassandra has 5 columns plus a JSON blob column for the rest.

Strategies:

- **Schema-flexible storage.** Keep raw event as JSON. Use Avro/Protobuf with backward/forward compatibility rules. Old consumers ignore unknown fields. New consumers know the field is optional for old records.
- **Schema registry** (Confluent Schema Registry or similar). Producers register schema version. Consumers fetch the schema. Compatibility checks enforced at registration.
- **Versioned event type** (`user.login.v1`, `user.login.v2`). Old consumers stick to v1, new ones handle v2. Trade-off: data fragmentation across versions.
- **Cassandra schema add.** `ALTER TABLE` adds a column. Old data has NULL. New data has the value. Generally safe but coordinate with rolling consumer deploys.

The discipline: never make a backward-incompatible schema change without versioning. Adding fields is fine. Removing or renaming is not without a migration plan.

**7. Recent-event reads.**

Three real approaches:

1. **Document the lag** ("data has ~5s lag"). Most use cases accept this. Cheapest.
2. **Dual write to a real-time store.** Second consumer reads Kafka and writes to Redis (per-user list, capped at 1000 recent events). Queries that need <1s freshness hit Redis, older data falls through to Cassandra. Costs 2x writes at the consumer tier.
3. **Query Kafka directly via kSQL.** Operationally awkward. Kafka is not a key-value store. Works only for narrow windows.

For most audit pipelines, option 1 is correct. For fraud or live-dashboard use cases, option 2 is worth the cost.

**8. Region down.**

If the producer SDK is well-designed: it detects local Kafka unreachable, buffers events locally, fails over to the next-nearest region's Kafka. When local cluster recovers, it drains the buffer. Data loss window: events in the producer buffer when the producer process dies. Typically <1 second.

If the producer SDK is naive (no failover): producer gets timeouts on Kafka send. Producer either accepts the loss or holds events in memory until OOM. All events generated during the outage are lost.

DR play: cross-region Kafka replication (MirrorMaker) so events that did land in the failed region's Kafka eventually replicate elsewhere. When the failed region comes back, consumers replay; downstream catches up.

For zero-data-loss DR: write events to two Kafka clusters synchronously. Doubles producer cost but guarantees survival of one region's loss.

**9. Cold-tier query cost.**

"Every event for tenant X for 3 years" scans naively across 3 years * 365 partitions * all event_type subdirectories.

Optimizations:

- **Partition pruning by tenant_id at the prefix level.** Path is `date=Y/event_type=X/tenant_id=Z/`. Athena prunes paths that do not match. Critical that tenant_id is in the path, not buried inside Parquet.
- **File-level statistics.** Parquet's per-row-group statistics let Athena skip row groups that cannot match the filter.
- **Pre-aggregated cube for hot queries.** If "events per tenant per day" is a common query, materialize it nightly into a small summary table. Original Parquet stays for ad-hoc.
- **Cold-cold storage.** Events older than 1 year move to S3 Glacier or Glacier Deep Archive. Queries against deep archive take 12-48 hours to retrieve files but cost 1/20 of standard S3.
- **Tenant-specific extracts.** When a tenant requests their data for GDPR or audit, pre-build a single Parquet extract for them.

For interactive queries on 3 years of data: build an OLAP layer (ClickHouse, BigQuery, or Snowflake) and pre-load the data there. S3 Parquet via Athena is for ad-hoc, not for sub-second analytics.

**10. Exactly-once for a side effect.**

SMS is non-idempotent. You cannot dedup at the receiver. So you have to make sure the side effect runs exactly once.

Pattern: **transactional outbox + idempotent sender.** The consumer reads Kafka events and writes "send SMS" records to a local DB table `pending_sms` keyed by event_id, with `status = 'pending'`. A separate sender process picks pending rows, calls the SMS API with `idempotency_key = event_id` (the SMS provider must support idempotency keys; Twilio does), then marks the row `status = 'sent'`.

Crash safety: if the sender crashes between API call and status update, on restart it sees the row as still pending and retries. The SMS provider's idempotency key prevents a second SMS.

Cost: one extra DB write per event. Adds maybe 5 ms per event at the consumer. Cheap insurance.

> The general lesson: when you need exactly-once at a specific downstream, use a transactional outbox at that consumer rather than paying Kafka EOS cost on the whole pipeline. The expensive guarantee is local to where you need it.

---

### 13. Trade-offs worth saying out loud

**Sync vs async.** Sync writes (producer waits for storage) give you immediate consistency and simpler reasoning. They cap throughput at the storage layer's speed. Async (via queue) decouples producer rate from storage rate. Higher throughput at the cost of end-to-end lag and weaker consistency. The right call depends on the lag SLA. <100ms = sync. >1s acceptable = async.

**Batch vs stream.** Batching amortizes per-write overhead (TLS, fsync, network round-trip). Larger batches = higher throughput but higher latency per event. The sweet spot is "batch enough to amortize, small enough to land within the lag SLA." Typical: 100ms or 1000 events.

**Exactly-once cost.** Kafka EOS drops throughput 20-40% and adds operational complexity. The right move is usually "at-least-once with idempotent storage." Reserve true exactly-once for non-idempotent side effects.

**Why Cassandra over Postgres at the hot tier.** Postgres B-tree is bad at write-heavy random-key inserts. Cassandra LSM is built for it. At <50k writes/sec, Postgres is fine and operationally simpler. Above that, Cassandra wins on throughput per node. At scale, Cassandra also gives easier horizontal scaling (add a node, rebalance automatically) versus Postgres which requires manual sharding.

**Why Kafka and not Kinesis / Pulsar / NATS.** Kafka has the largest ecosystem, deepest tooling, best operational docs. Kinesis is simpler to operate (fully managed) but harder to migrate off. Pulsar has a better multi-tenant story. NATS JetStream is lighter. At 1M events/sec, all of them work. Pick what your team can operate.

**Why S3 Parquet for cold tier.** Cheap, durable, columnar, queryable with serverless tools (Athena/BigQuery). The alternative (keep everything in Cassandra) costs 100x more for events accessed once a year.

**What I would revisit at 10M events/sec.** Specialized vendor (Datadog, Splunk, Honeycomb) or specialized infrastructure (Honeycomb's Retriever, ClickHouse for everything). Or split into purpose-specific pipelines (security, analytics, traces). The "one pipeline for everything" pattern stops scaling cleanly past ~1M events/sec.

---

### 14. Common mistakes

Most weak answers fall into one of these.

**Reaching for Kafka and Cassandra immediately.** The interviewer started you at 100 events/sec. If you propose a Kafka cluster in minute one, you have not earned the architecture. Walk the stages. Justify each addition with a specific failure of the previous one.

**Confusing buffering with batching.** Buffering means holding events in memory before writing. Batching means writing many events in one storage call. You usually do both. Articulate the difference.

**Not addressing partitioning.** "Use Cassandra" without specifying the partition key is a hand-wave. The partition key determines whether your cluster has hot nodes. It is the most important decision in the storage layer.

**Claiming exactly-once without paying the cost.** Senior interviewers will probe. If you say "exactly-once," you must explain how (Kafka EOS, transactional outbox) and what it costs. If you say "at-least-once with idempotent storage," you score the same correctness with a tenth the operational pain.

**Forgetting back-pressure.** A write-heavy system without back-pressure cascades on the first downstream slowness. The 429 / retry-with-backoff loop is mandatory.

**Not designing for the hot partition.** "It will distribute evenly" is a hope, not a design. Real systems have one tenant 1000x bigger than the median. Have an answer (sub-sharding, rate limiting, dedicated capacity).

**No tiered storage.** Keeping 7 years of events in Cassandra is wasted money. Cold tier (S3 Parquet) is the standard play. Mention it.

**Treating lag as a bug.** End-to-end lag is the *price* you pay for async ingestion. Some consumers want lag (cheap batch processing). Some do not (fraud alerts). Acknowledge the spectrum.

**Ignoring observability.** "We'll add monitoring later" loses senior credit. Queue depth, consumer lag, batch size, and partition skew are the metrics that diagnose every common failure. They are part of the design, not an afterthought.

**Building the 1M/sec architecture at 100/sec scale.** Junior engineers love this mistake. The system collapses under its own operational weight before it ever sees the traffic it was built for. The discipline is "design for one stage past current, not three."

If you hit 7 of these 10 cleanly, you are interviewing well. The two that separate staff-level candidates from senior: addressing the hot partition problem unprompted, and explaining the exact moment you would *not* yet introduce Kafka (the stage 1 to 2 transition). Both demonstrate that you understand cost as well as throughput.
{% endraw %}
