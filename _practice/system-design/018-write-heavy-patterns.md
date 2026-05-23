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
## Scene

You walk in. The interviewer skips the small talk:

> *"I have an audit logging service. Today it does 100 events per second. Single Postgres. Everything works. My PM just told me we are going to log every user interaction across the company. About 1 million events per second. Walk me through what you do, in order."*

This is not a question about a finished architecture. It is a question about how you *grow* a system from "one Postgres handles it" to "a million events per second." The interviewer wants to see the toolkit come out one piece at a time: buffering, batching, async pipelines, partitioning, append-only logs, sharding by key, and the moments where you give up on strong consistency.

A write-heavy problem is the mirror image of a read-heavy one. The cost is dominated by ingestion. Each event is small, queries are simple or batched, and the storage engine's job is to absorb writes faster than a normal OLTP DB ever could. Recognizing the shape early changes every later decision.

Candidates who blurt "use Kafka and Cassandra" miss the point. The interviewer wants you to reach for each tool *at the moment its predecessor breaks*, not all at once.

## Step 1: Clarify before you design

Take five minutes. Do not draw anything yet. The naive instinct is "just send it to Kafka." That is wrong until you have answers to the questions below. Aim for about eight questions that meaningfully change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

The first one is durability. "If we drop 0.1% of events during a node failure, is that acceptable?" Audit logging for SOX has zero tolerance. Product telemetry happily drops 1% for cheaper infrastructure. That single answer decides whether you need `acks=all` on Kafka, a transactional outbox, or fire-and-forget UDP.

Then lag. "When an event is ingested, when does it have to be visible to queries? 100ms? 10s? 5 minutes?" Real-time visibility forces synchronous indexing. Five-minute lag lets you batch into Parquet and pay a fraction of the cost.

Ordering matters more than people expect. "Do events need to be globally ordered, ordered per user, or unordered?" Global ordering is a single-writer constraint. Per-key ordering is partitioned-by-key. Unordered is the cheapest and most parallel.

Read pattern shapes the storage engine. "Do consumers query individual events by ID, or do they aggregate?" Point lookups want an LSM with a primary key. Scans and aggregations want columnar layout like Parquet or ClickHouse.

Retention drives the tiered storage decision. "30 days hot, 7 years cold? Forever?" Time-based partitions are trivially droppable; that fact alone often picks the partition scheme.

Event size and shape: a 200-byte event is a completely different system from a 50KB event. Fixed schema lets you use columnar formats. Arbitrary JSON forces store-raw or pay-for-schema-on-read.

Burstiness: "Is 1M/sec sustained or peak? Black Friday multiplier? Log storm risk?" A 5x burst is normal. Some systems see 50x bursts from log loops. Buffer sizing follows from this.

Finally, delivery semantics: at-most-once (lose on failure), at-least-once (may dup), or exactly-once. Exactly-once is expensive and rarely worth the cost. At-least-once with idempotent consumers is the common answer. You should know why.

One more question that separates strong candidates: "What does the *consumer* do with these events?" If it is a dashboard, you optimize for aggregation. If it is fraud detection, you optimize for low-latency streaming. If it is compliance archive, you optimize for cheap durable storage. The downstream changes everything upstream.

</details>

## Step 2: Capacity

The interviewer hands you the numbers. 1M events per second, sustained, 3x peak. Events about 500 bytes each. Retention: 90 days hot, 7 years cold. No global ordering required; per-`user_id` ordering is nice. Acceptable lag from write to readable: 10 seconds.

Compute on paper before peeking:

1. Sustained ingest bandwidth (bytes/sec)
2. Peak ingest bandwidth
3. Daily event volume
4. 90-day hot storage requirement
5. 7-year cold storage requirement (assume 5x compression for cold)
6. Queue depth if downstream stalls for 5 minutes
7. Network connections at the ingest tier if each producer holds an open connection

<details>
<summary><b>Reveal: the math</b></summary>

Sustained bandwidth: 1M events/sec * 500 bytes = 500 MB/sec, which is **4 Gbps sustained**. A single 10G NIC saturates around 80% utilization. You need multiple ingest nodes from the start, not because of CPU, but because of NIC throughput.

Peak: 3x sustained = 3M events/sec = 1.5 GB/sec = **12 Gbps peak**. Now you are looking at multiple machines per region just to terminate TLS and accept the bytes.

Daily volume: 1M * 86400 = **86.4 billion events/day**. At 500 bytes, that is **43 TB/day raw**.

90-day hot storage: 43 TB * 90 = **~3.9 PB hot**. Not a single machine. This is a 10-to-30 node Cassandra cluster, or a heavy-RF Kafka cluster with long retention, or a sharded Postgres farm if you are a masochist.

7-year cold storage: 43 TB * 365 * 7 / 5 (compression) = **~22 PB cold** in S3 / GCS / Azure Blob, stored as Parquet. At $0.023/GB/month for standard storage, that is about $500k/month just for the bits. Glacier Deep Archive cuts it to 1/20 the price if access is rare.

Queue depth on a 5-minute stall: 1M events/sec * 300 sec = **300M events queued**. At 500 bytes, that is **150 GB of buffered data**. A Kafka cluster with 7-day retention handles this trivially. An in-memory queue does not.

Network connections: if each producer holds an open TLS connection (say 100k producer apps across the company) and you have 10 ingest nodes per region, each ingest node is terminating ~10k concurrent TLS connections. Workable, but the ingest tier must be tuned for many idle connections (file descriptor limits, kernel `net.core.somaxconn`, and so on).

What the math is telling you: the system is small in event count (86B/day is large but not crazy) and huge in aggregate bytes. Bandwidth and storage dominate everything. Synchronous per-event writes are physically impossible at this scale. A single Postgres tops out around 10k-50k writes/sec depending on hardware and write shape. We are 20-100x past that on a single shard. Most of the architecture exists to *spread* the write load across many nodes and to *batch* small writes into bigger ones that storage engines can handle efficiently.

</details>

## Step 3: The write pipeline

Here is the conceptual evolution of a write path. Each stage handles roughly 10x the throughput of the previous one. Fill in the limits.

```
Stage A:  producer  --INSERT-->  Postgres                    limit: [ ? ] writes/sec
                                                              fails because: [ ? ]

Stage B:  producer  --INSERT-->  app  --buffer-->  Postgres   limit: [ ? ] writes/sec
                                  (in-memory                  fails because: [ ? ]
                                   flush every
                                   100ms)

Stage C:  producer  --HTTP-->   ingest  -->  [ ? ]   -->  batch writer  --COPY-->  storage
                                                                          (Postgres /
                                                                           Cassandra)
                                  limit: [ ? ] writes/sec
                                  fails because: [ ? ]

Stage D:  producer  -->  regional ingest  -->  regional Kafka  -->  stream processor  -->  [ ? ]
                                                  (partitioned by key)         (Flink /
                                                                                Spark)
                                  limit: 1M+ writes/sec
                                  fails because: [ ? ]
```

<details>
<summary><b>Reveal: the four stages with limits</b></summary>

```
Stage A:  producer  --INSERT-->  Postgres                    limit: ~1k writes/sec
                                                              fails because: WAL flush + index
                                                                            updates per row;
                                                                            disk fsync per commit

Stage B:  producer  --INSERT-->  app  --buffer-->  Postgres   limit: ~10k writes/sec
                                  (in-memory                  fails because: single Postgres
                                   flush every                                still bottlenecks
                                   100ms,                                     on writes; buffer
                                   COPY in                                    is lost on crash
                                   batches of
                                   1000)

Stage C:  producer  --HTTP-->   ingest  -->  Kafka  -->  batch writer  --COPY-->  Cassandra
                                                                                  (or sharded
                                                                                   Postgres)
                                  limit: ~100k writes/sec
                                  fails because: single Cassandra cluster
                                                or single Kafka topic
                                                hits hot partition limits;
                                                consumer lag grows

Stage D:  producer  -->  regional ingest  -->  regional Kafka  -->  Flink  -->  Cassandra (hot)
                                                  (partitioned by                + S3 Parquet
                                                   event_type +                  (cold archive)
                                                   tenant_id)
                                  limit: 1M+ writes/sec
                                  fails because: cross-region replication
                                                lag; cold-tier query
                                                latency; bursts past
                                                Kafka cluster capacity
```

What each transition buys you:

A to B (buffer + batch) stops you from paying fsync cost per event. One fsync now amortizes 1000 events. 10x throughput, same hardware. Risk: in-memory buffer is lost on crash.

B to C (durable queue) decouples producer rate from consumer rate. Producers cannot overwhelm storage; they fill the queue. Storage drains it at its own pace. Cassandra's LSM-tree absorbs sequential writes far better than Postgres's B-tree. Another 10x.

C to D (partitioning + stream processing) scales horizontally with no single bottleneck. Each Kafka partition has its own consumer. Each Cassandra node owns a slice of the key space. A stream processor like Flink does enrichment and routing. Cold tier on S3 Parquet is bottomless and cheap. 10x more, and you can keep going by adding partitions.

What each transition costs:

A to B: lose up to one buffer's worth of events on crash. About 100ms * 10k events/sec = 1000 events lost in the worst case.

B to C: end-to-end lag jumps from milliseconds to seconds. Events are not queryable until the batch writer has flushed them.

C to D: strong consistency is gone. Cross-region replication is eventually consistent. Hot/cold tier splits queries that span both into a join.

The exercise: name the limit before you reach for the next tool.

</details>

## Step 4: Incomplete diagram

Here is the full pipeline for the 1M events/sec design with five placeholders. Fill them in.

```
                                +------------------+
   producer apps  --HTTPS-->   |   [ ? ]          |  (terminates TLS, load balances,
   (web, mobile,                |                  |   anti-abuse, rate limit per tenant)
   server-side)                 +--------+---------+
                                         |
                                         v
                                +------------------+
                                |  Ingest Service  |  (validates schema, assigns event_id,
                                |  (stateless)     |   adds server timestamp, picks
                                |                  |   partition key)
                                +--------+---------+
                                         |
                                         v
                                +------------------+
                                |   [ ? ]          |  (durable, partitioned, replicated;
                                |                  |   7-day retention; absorbs bursts)
                                +--------+---------+
                                         |
                       +-----------------+-----------------+
                       |                 |                 |
                       v                 v                 v
                +-------------+   +-------------+   +-------------+
                |  [ ? ]      |   |  archiver   |   |  realtime   |
                |  (hot       |   |  (writes    |   |  consumer   |
                |   storage   |   |   Parquet   |   |  (fraud,    |
                |   for       |   |   to S3     |   |   alerting) |
                |   point     |   |   in 5-min  |   |             |
                |   reads)    |   |   batches)  |   |             |
                +-------------+   +-----+-------+   +-------------+
                                        |
                                        v
                                +------------------+
                                |   [ ? ]          |  (cold tier, queried by Athena /
                                |                  |   Presto / BigQuery for old events)
                                +------------------+

                                +------------------+
                                |  [ ? ]           |  (consumed by every stage; tracks
                                |                  |   throughput, queue depth, batch
                                |                  |   size, ack lag)
                                +------------------+
```

<details>
<summary><b>Reveal: the full pipeline</b></summary>

```
                                +----------------------+
   producer apps  --HTTPS-->   |  Edge LB + API       |  TLS, anycast,
   (web, mobile,                |  Gateway + WAF       |  per-tenant rate limit,
   server-side)                 |                      |  back-pressure (429 when
                                |                      |  downstream queue full)
                                +----------+-----------+
                                           |
                                           v
                                +----------------------+
                                |  Ingest Service      |  validate schema, assign
                                |  (stateless, N pods) |  event_id (snowflake),
                                |                      |  add server timestamp,
                                |                      |  pick partition key
                                |                      |  (event_type + tenant_id)
                                +----------+-----------+
                                           |
                                           v
                                +----------------------+
                                |  Kafka cluster       |  partitioned by
                                |  (or Kinesis,        |  hash(event_type, tenant_id);
                                |   Pulsar, NATS JS)   |  RF=3; 7-day retention;
                                |                      |  acks=all
                                +----------+-----------+
                                           |
                       +-------------------+---------------------+
                       |                   |                     |
                       v                   v                     v
                +--------------+   +--------------+     +--------------+
                |  Cassandra   |   |  Archiver    |     |  Flink /     |
                |  (hot tier,  |   |  (consumes,  |     |  stream      |
                |   90-day     |   |   buffers    |     |  processor   |
                |   point      |   |   5 min,     |     |  (fraud,     |
                |   reads,     |   |   writes     |     |   alerts,    |
                |   sharded    |   |   Parquet)   |     |   rollups)   |
                |   by key)    |   |              |     |              |
                +--------------+   +------+-------+     +--------------+
                                          |
                                          v
                                +----------------------+
                                |  S3 / GCS (Parquet)  |  partitioned by
                                |  + Athena / Presto / |  date=YYYY-MM-DD/
                                |  BigQuery on top     |  event_type=XYZ/
                                |                      |  tenant_id=ABC/
                                +----------------------+

                                +----------------------+
                                |  Metrics + Logs      |  Prometheus / OTel;
                                |  (Prometheus,        |  every stage reports
                                |   Grafana,           |  throughput, queue depth,
                                |   OpenTelemetry)     |  batch size, ack lag,
                                |                      |  partition skew
                                +----------------------+
```

Why each piece is here:

The edge LB and API gateway exist because multiple ingest pods are required just to terminate TLS at 12 Gbps. Per-tenant rate limit prevents one noisy tenant from drowning out the rest. Back-pressure (returning 429 to producers when Kafka is unhealthy) protects the cluster from cascading failure.

The ingest service is stateless. Its only job: validate, stamp, route. It does not own state; it puts the event in Kafka and returns 202 Accepted.

Kafka is the shock absorber. Producers fill it; consumers drain it. If a downstream consumer stalls for 5 minutes, Kafka buffers the backlog without affecting producers.

Cassandra hot tier handles recent events queryable by key (event_id, or (tenant_id, ts) range). LSM-tree is the right shape: writes are sequential, no read-modify-write penalty per insert.

The archiver reads from Kafka, buffers 5 minutes of events or N MB, writes one big Parquet file to S3. Trades latency for cost; you get cold-storage prices and columnar query performance.

The stream processor (Flink) handles derived data: per-minute rollups, anomaly scores, alerts. Reads the same Kafka topic.

S3 + query layer is bottomless storage. Athena, Presto, or BigQuery query Parquet without a dedicated cluster.

Observability sits on the side because without metrics on queue depth, batch size, and ack lag, you find out about ingestion problems via customer complaints.

</details>

## Step 5: Append-only log structures (why LSM beats B-tree here)

Postgres uses a B-tree for its primary index. Cassandra uses an LSM-tree. RocksDB, ScyllaDB, HBase, and Kafka's log itself are all LSM-flavored. For write-heavy workloads, LSM wins. Why?

Sketch the difference. In particular, what is a B-tree doing on a random INSERT that an LSM is not?

<details>
<summary><b>Reveal: B-tree vs LSM for writes</b></summary>

A B-tree insert (Postgres, MySQL InnoDB) does five things. Find the leaf page for this key, often requiring a random read from disk if the page is not in the buffer pool. Insert the key into the page; if the page is full, split it (write 2 pages instead of 1). Update parent pages if the split propagates up. Write to WAL (sequential), then update the data page (often random, often later). On commit, fsync the WAL.

Random-key writes are the worst case. Each insert touches a different leaf page. The buffer pool churns. You pay a random read plus a random write per insert. A single Postgres tops out around 1k-10k writes/sec for keyed inserts that do not fit in memory.

An LSM insert (Cassandra, RocksDB, Scylla) is simpler. Append to a write-ahead commit log (sequential disk write). Insert into an in-memory memtable (sorted skip list or balanced tree, in RAM). When the memtable is full, flush it to disk as a new immutable SSTable (one big sequential write). Background compaction merges old SSTables to reclaim space and bound read amplification.

Why this is faster: all disk writes are sequential. The commit log appends. SSTable flushes are big sequential writes. Sequential disk throughput is ~10-100x random disk throughput on spinning disks, and even on NVMe sequential beats random IOPS for sustained workloads. There is no read-before-write (B-tree inserts read the leaf page first; LSM just appends). And no in-place updates: SSTables are immutable, updates are new writes with a tombstone for deletes, concurrency is trivial with no page locks.

What you pay: read amplification (a read might check the memtable plus several SSTables; bloom filters help but reads are slower than B-tree reads for the same data), write amplification (compaction rewrites SSTables; the same byte may be written 5-10 times over its lifetime), and space amplification (until compaction runs, you have multiple copies of data on disk).

LSM wins for write-heavy, read-by-key-or-range, time-series, logs, telemetry. Cassandra, ScyllaDB, RocksDB, LevelDB, HBase, BigTable, DynamoDB under the hood, InfluxDB.

B-tree wins for OLTP with frequent updates to the same rows, read-dominated workloads, secondary-index-heavy queries. Postgres, MySQL.

The append-only log extreme is even simpler than LSM: Kafka's storage is pure append to a segment file, no compaction unless you enable log compaction explicitly. Reads are by offset (O(1) seek to position). This is why Kafka can ingest millions of messages per second per partition on commodity hardware. The trade-off: you cannot query by arbitrary key, only by offset or time.

For our 1M events/sec audit pipeline, the storage layers stack up: Kafka log (pure append, infinite write throughput per partition until disk fills), Cassandra hot tier (LSM, query by key, 90-day retention), S3 Parquet cold tier (immutable columnar files, queried by partition). Each is optimized for write throughput at its scale.

</details>

## Step 6: Partitioning strategy

You have to pick a partition key for Kafka and a shard key for Cassandra. The choice determines whether load distributes evenly or whether one partition gets 10x the traffic of the rest. Three families of strategies. For each, name when it works and when it does not.

| Strategy | How it works | Good for | Fails when |
|----------|-------------|----------|-----------|
| Time-based | partition = day or hour | [ ? ] | [ ? ] |
| Hash-based | partition = hash(key) % N | [ ? ] | [ ? ] |
| Tenant-based | partition = tenant_id | [ ? ] | [ ? ] |

<details>
<summary><b>Reveal: the three partitioning families</b></summary>

| Strategy | How it works | Good for | Fails when |
|----------|-------------|----------|-----------|
| **Time-based** | Each hour or day gets its own partition. Files named `events/2026-05-23/...` | Time-range queries ("events from last week"). Cheap to drop old data (delete the partition directory). Cold-storage archiving (move yesterday's partition to S3 Glacier). Natural fit for Parquet on S3. | **Hot partition on writes.** All writes go to the current hour's partition. The newest partition is hot; the rest are cold. Compute is wasted on cold partitions; the hot one melts. Mitigation: combine with a secondary key (hour + hash). |
| **Hash-based** | `partition_id = hash(event_id) % N` or `hash(user_id) % N` | Even write distribution. No hotspots if the key has high cardinality. Trivial horizontal scaling: add nodes, rebalance. | **Range queries become scatter-gather.** "All events for user X in last hour" hits every partition unless you hash by user_id (then "all events between time A and B" is the scatter case). Cannot drop old data without scanning. Adding nodes triggers a rebalance that moves data across the network. |
| **Tenant-based** | `partition_id = tenant_id` or hash(tenant_id) | Multi-tenant isolation. Noisy-tenant containment (one tenant's spike does not affect others). Easy per-tenant deletion (GDPR, customer offboarding). Per-tenant SLAs. | **Uneven partition sizes.** Your largest tenant might be 1000x bigger than the median. That tenant's partition is hot; smaller ones are cold. The classic "one big customer" problem. Mitigation: sub-shard the largest tenants by appending a random suffix (`tenant_42_0`, `tenant_42_1`, ..., `tenant_42_15`). |

The right answer is usually a composite.

For 1M events/sec audit logging, the Kafka partition key is `hash(event_type, tenant_id)`. That spreads load across partitions while preserving per-key ordering within a single (event_type, tenant_id) stream. Start at about 100 partitions, scale to 1000+ as needed. Each partition handles ~10k events/sec at the high end.

The Cassandra primary key is `((tenant_id, day), event_id)`. Partition key `(tenant_id, day)` puts all events for a tenant on a given day in one place (cheap range scan). Clustering column `event_id` gives uniqueness and ordering within the partition. The day component bounds partition size: even a huge tenant only writes one day at a time per partition.

The S3 Parquet prefix is `date=YYYY-MM-DD/event_type=X/tenant_id=Y/`. Time-based at the top level (cheap to drop old data), hash-friendly subdirs for query pruning. Athena uses partition pruning to skip entire prefixes when the query filters on date or tenant.

The hot partition problem in practice: suppose one tenant's mobile app has a bug that emits 100k events/sec instead of the normal 100. Their (event_type, tenant_id) partition gets 100k/sec while every other partition gets 100. That partition's Kafka broker pegs CPU, lag grows, consumers cannot keep up, eventually the broker disk fills.

Mitigations, in order: detect early via per-partition rate monitoring with alerting on `max(partition_rate) / median(partition_rate) > 10x`. Sub-shard the hot key by adding a random suffix to the partition key for that one tenant: `(event_type, tenant_id, random(0..15))`. Now their load spreads across 16 partitions. Cost: you cannot rely on per-key ordering for that tenant. Apply a per-tenant rate limit at the ingest tier; cap any single tenant at, say, 50k events/sec. Excess events get 429. The tenant fixes their bug. Long term, quota and isolation: premium tenants get reserved capacity; long-tail tenants share a pool.

For Cassandra, hot partition = hot row = hot node. Same mitigations apply: sub-shard the key, monitor for skew, throttle at ingest.

</details>

## Step 7: When to give up consistency

At small scale, every event is in one Postgres. One ACID transaction. Either it is durably written or it is not. Linearizable. Easy.

At 1M events/sec, that promise is gone. You cannot have linearizable writes across a distributed Kafka cluster + Cassandra + S3 and 10 Gbps of bandwidth without paying enormous latency. So you trade.

Three delivery semantics, and every write-heavy system has to pick:

- **At-most-once.** Send and forget. If anything fails between producer and storage, the event is lost. Cheapest, fastest, lowest latency.
- **At-least-once.** Acknowledge end-to-end. On any failure, retry. May produce duplicates. Most common in practice.
- **Exactly-once.** Each event appears in storage exactly one time, no duplicates, no losses. Expensive, complicated, slow.

For each, when would you use it?

<details>
<summary><b>Reveal: when each semantics is the right choice</b></summary>

**At-most-once.** Use when the data is statistical, not transactional. Page-view metrics, click-tracking, performance traces, ad impressions. Losing 0.1% does not change the analysis. Use when latency matters more than completeness. UDP-style fire-and-forget. The producer does not wait for an ack.

Implementation: producer sends, returns immediately, does not retry. If the broker is down or the network drops the packet, the event is gone forever. Cost: zero retry overhead, no idempotency machinery, no transactional logs. Cheapest pipeline you can build.

Do not use for anything where missing one event has user-facing consequences (audit, billing, security alerts, order events).

**At-least-once.** The default for almost every modern event pipeline. Use when loss is unacceptable but duplicates are tolerable, often because the consumer is idempotent. Kafka producers with `acks=all` and consumer-side commit-after-process gives you at-least-once.

Implementation: producer retries on any failure to ack. Network blip? Producer did not see the ack but the broker may have written it. Producer retries; broker writes a second copy. Event appears twice. Consumer commits offsets after processing. If consumer crashes between processing and committing, it reprocesses on restart. Event processed twice.

How you handle duplicates: idempotent consumer (use the event's `event_id` as the primary key in storage; second write is a no-op via INSERT ON CONFLICT DO NOTHING, Cassandra's `IF NOT EXISTS` clause, or dedupe at S3 Parquet compaction time). Or a deduplication window: keep recent event_ids in a Bloom filter or Redis set; reject duplicates seen in the last N minutes. Cheap, probabilistic. Or an idempotent producer: Kafka's idempotent producer (transactional ID + sequence numbers) prevents duplicates within a producer session. Not full exactly-once but kills the most common dup source (retries on transient broker errors).

Cost: the storage layer carries the dedup burden. Indexing on event_id eats space.

This is what 80% of production pipelines do. Acknowledge the duplication risk; design consumers to be idempotent; move on.

**Exactly-once.** Use when the downstream effect is non-idempotent and money is involved. Payment processing. Order fulfillment. Inventory deduction. Audit logging *sometimes* claims to need this. In practice, at-least-once with idempotent storage (event_id as primary key) is equivalent to exactly-once and 10x cheaper.

Implementation in the Kafka world: Kafka EOS (exactly-once semantics) via transactional producers + read-committed consumers. The producer wraps writes to multiple partitions in a transaction; the consumer only sees committed messages. Combined with idempotent producer IDs.

Cost: throughput drops 20-40% vs at-least-once. Latency increases (you wait for commits). Operational complexity goes up (transactional IDs must survive producer restarts, consumer offset commits become two-phase, partition rebalances are more expensive). All downstream consumers must opt into read-committed mode.

The transactional outbox pattern is the non-Kafka version: producer writes the event to its local DB in the same transaction as the business state change, into an outbox table; a separate process reads the outbox and ships to Kafka with retries. The "exactly once" is "the event will appear in Kafka at least once, but only if the business write succeeded." Same idempotent-consumer requirement on the read side.

The honest take: most "we need exactly-once" requirements are actually "we need at-least-once with idempotent processing." The latter is much easier and cheaper. The former is for cases where you literally cannot make the consumer idempotent (a side effect that cannot be deduped, like sending an SMS).

**What we pick for the 1M events/sec audit pipeline.** At-least-once. Audit needs durability, so at-most-once is out. Storage is Cassandra keyed by `event_id`, so idempotency is free; second write is a no-op. Exactly-once via Kafka EOS would cost ~30% throughput and would not help (we already dedupe at storage).

Producer: Kafka producer with `acks=all`, `enable.idempotence=true`, `retries=Integer.MAX_VALUE`. Within a producer session, no duplicates due to retries. Across producer crashes, duplicates are possible (handled by `event_id` dedup).

Consumer: commit Kafka offset after the Cassandra write completes. If consumer crashes mid-batch, it reprocesses the batch on restart; Cassandra's `IF NOT EXISTS` (or just the primary-key constraint) catches the duplicates.

End-to-end guarantee: every event that the producer believed it sent successfully is durably stored at least once. Reads see each event exactly once (deduplicated by `event_id`).

</details>

## Follow-up questions (10)

Try answering each in 2 to 4 sentences before reading the solution.

1. **Back-pressure.** Producers are sending 2x the rate Kafka can absorb. The Kafka brokers are healthy but the per-partition log is filling and disk is at 80%. What does the ingest service do? What does the producer SDK do?

2. **Hot tenant.** One tenant's mobile app has a bug and is sending 200k events/sec when the average is 100. They are saturating one Kafka partition and that partition's broker is at 100% CPU. How do you find them, and what do you do in the next 5 minutes versus the next 5 days?

3. **Clock skew.** Two producers on different machines disagree about "now" by 3 minutes. They both send events tagged with their local timestamps. Your downstream reports show events arriving "in the future." How do you fix it without forcing every producer to NTP-sync to nanosecond precision?

4. **Duplicate events.** A producer retried a batch after a broker timeout. The broker had actually committed the first attempt. Now Cassandra has two copies of every event in that batch. Walk me through the detection and dedup strategy.

5. **Consumer fell behind.** A Cassandra writer consumer has been stuck for 30 minutes due to a bad deploy. Kafka has buffered 1.8 billion events for that consumer group. What happens when you fix the bug and restart? How do you keep it from melting the storage layer when it catches up?

6. **Schema evolution.** A team added a new field to the event schema. Old producers send 5 fields, new producers send 6. Cassandra has a fixed table schema. How do you handle the migration without dropping events or breaking old consumers?

7. **Recent-event reads.** A consumer wants to query "all events for user U in the last 30 seconds." Your storage path is Kafka, then batched 5 min into Cassandra. The event might still be in Kafka. How do you make the read see both?

8. **A region goes down.** US-East Kafka cluster is offline. Producers in that region cannot publish. Producers in other regions are fine. What is your DR play, and how much data could be lost?

9. **Cold-tier query cost.** A user wants "every event for tenant X for the past 3 years." Naive Athena query scans 3 PB of Parquet. How do you make this both fast and cheap?

10. **Exactly-once for a side effect.** One downstream consumer sends an SMS for every fraud alert. SMS is non-idempotent (the user gets two texts if you send twice). How do you guarantee exactly one SMS without paying Kafka EOS cost on the whole pipeline?

## Related problems

- **[Approval Management (011)](../011-approval-management/question.md)**. The audit log in that design is a write-heavy append-only system. The patterns here (tiered storage, append-only log, batched writes) apply directly to its audit pipeline.
- **[Todo List Sharing (013)](../013-todo-list-sharing/question.md)**. The change-log / sync pipeline for collaborative todo edits is the same shape at smaller scale: every edit is a small append-only event, partitioned by list_id, eventually projected to read-side state.
- **[News Feed (002)](../002-news-feed/question.md)**. Timeline write fan-out is the canonical write-heavy problem at consumer scale: each post produces N writes (one per follower's timeline). Same partitioning and batching toolkit, different shape because fan-out multiplies the load.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Write-Heavy System (Patterns Walkthrough)

### TL;DR

A write-heavy system is one whose cost is dominated by ingestion. Each event is small, queries are simple or batched, and the database's job is to absorb writes faster than a normal OLTP DB can. The interesting work is at the seams: deciding when to add a buffer, when to add a queue, when to give up linearizability, and when to stop adding pieces because what you have is already enough.

The toolkit, in the order you reach for it as scale grows, goes from a single Postgres at about 1k writes/sec, to an in-memory buffer plus batched commits at 10k, to a durable queue plus async LSM writer at 100k, to a partitioned queue plus stream processing plus tiered storage at 1M and beyond. Each step trades latency, consistency, or operational complexity for throughput. The senior move is naming the limit of stage N before reaching for stage N+1, not pre-emptively building stage 4.

Three cross-cutting decisions decide the final shape. The partition key (time, hash, or tenant, usually a composite like `(event_type, tenant_id, day)`). The choice of append-only storage (LSM at the hot tier, Parquet on object storage at the cold tier). And the delivery semantics: at-least-once with idempotent storage is right for 95% of cases. At-most-once is for stats. Exactly-once is only for non-idempotent side effects.

### 1. Clarifying questions, recap

The four that meaningfully change the design are covered in `question.md`. Durability decides whether you need `acks=all` and a transactional outbox or whether UDP fire-and-forget is fine. Acceptable lag decides whether you write synchronously or batch into Parquet at 1% of the cost. Ordering drives the partition strategy. Read pattern picks the storage engine.

If you walked in without asking durability and lag, you have no basis to choose between Kafka EOS (expensive, exactly-once) and fire-and-forget UDP (cheap, lossy). They are 1000x apart in cost.

### 2. Capacity, with the math

The given: 1M events/sec sustained, 3M peak, 500 bytes/event, 90 days hot, 7 years cold, no global ordering, 10s acceptable lag.

Bandwidth comes out to 500 MB/sec sustained (4 Gbps) and 1.5 GB/sec peak (12 Gbps). You need multiple ingest nodes per region just for NIC throughput, not for CPU.

Daily volume is 86.4B events at 43 TB raw. Hot storage at 90 days is roughly 3.9 PB, which is a 10-to-30 node Cassandra cluster with RF=3. Cold storage at 7 years with 5x compression is about 22 PB in S3 Parquet (~$500k/month at standard storage tier; Glacier Deep Archive cuts that 20x).

A 5-minute downstream stall queues 300M events, about 150 GB. Kafka with 7-day retention swallows that. An in-memory queue does not.

Network connections: assume 100k producer apps and 10 ingest nodes per region, so each ingest node terminates ~10k concurrent TLS connections. Workable, but tune the kernel.

The headline takeaway: bottleneck is bandwidth and storage layout, not CPU. A single Postgres maxes out around 10k writes/sec, which is 100x too slow. We need to spread writes across nodes and batch them so per-write overhead amortizes.

### 3. API

Reads are out of scope for this problem; they come later as a separate concern.

Single-event ingest is the path for low-volume producers:

```
POST /api/v1/events
Content-Type: application/json
X-Tenant-Id: tenant_42
Authorization: Bearer <token>
Idempotency-Key: <uuid>           # optional; if set, server dedupes on this key

{
  "event_type": "user.login",
  "user_id": "u_8201",
  "timestamp": "2026-05-23T10:14:02.331Z",   # producer clock
  "attributes": { ... }                       # arbitrary JSON
}
```

| Status | Meaning |
|--------|---------|
| 202 Accepted | Event written to durable queue; will be queryable within 10s |
| 400 Bad Request | Schema invalid (missing required field, wrong type) |
| 401 Unauthorized | Missing or bad token |
| 413 Payload Too Large | Single event > 1 MB |
| 429 Too Many Requests | Per-tenant rate limit exceeded, or downstream queue overloaded (back-pressure) |
| 503 Service Unavailable | Ingest cluster degraded; producer should retry with backoff |

Batched ingest is the recommended path for everyone else:

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

Responses are per-batch (whole-batch accept) or per-event (partial accept):

| Status | Meaning |
|--------|---------|
| 202 Accepted | Whole batch durably queued. Response body: `{"batch_id": "...", "accepted": 1000}` |
| 207 Multi-Status | Partial success. `{"accepted": 998, "failed": [{"index": 17, "error": "schema_invalid"}]}` |
| 429 / 503 | Same as single-event |

A few load-bearing choices:

202, not 200. The event is not durably stored at the time of the response; it is durably queued. Returning 200 implies "we have it" with full guarantees. 202 communicates "we have accepted responsibility, you can stop retrying."

Idempotency-Key is optional. Most producers do not need it (event_id dedup at storage handles most dups). For producers that cannot retry safely (one-shot lambdas), an Idempotency-Key gives end-to-end dedup.

The batch endpoint is the recommended path because per-event HTTP at 1M/sec is 1M TLS handshakes/sec (impossible) or 1M HTTP requests on persistent connections (very expensive). Batches of 1000 cut to 1k req/sec. Same bytes, 1000x cheaper.

Server stamps a server timestamp in addition to producer timestamp; both are kept. Producer time is "when did the event happen." Server time is "when did we accept it." Clock-skew analysis uses the gap.

Per-tenant rate limits are visible to producers: 429 responses include `Retry-After` and `X-RateLimit-Remaining` so well-behaved producers throttle themselves.

### 4. Data model

The canonical event:

```json
{
  "event_id": "01H8K2X...",            // ULID or snowflake, generated by server if absent
  "tenant_id": "tenant_42",
  "event_type": "user.login",
  "user_id": "u_8201",
  "producer_ts": "2026-05-23T10:14:02.331Z",
  "server_ts":   "2026-05-23T10:14:02.412Z",
  "attributes": { ... },
  "schema_version": 3
}
```

Hot tier in Cassandra:

```cql
CREATE TABLE events_by_tenant_day (
    tenant_id     text,
    day           date,                   -- derived from server_ts
    event_id      timeuuid,                -- sortable, unique
    event_type    text,
    user_id       text,
    producer_ts   timestamp,
    server_ts     timestamp,
    attributes    text,                    -- JSON serialized
    schema_version int,
    PRIMARY KEY ((tenant_id, day), event_id)
) WITH CLUSTERING ORDER BY (event_id DESC)
  AND default_time_to_live = 7776000;     -- 90 days
```

The partition key `(tenant_id, day)` bounds partition size. Even the largest tenant only writes one day at a time into one partition. A "large" tenant at 100k events/sec * 86400s * 500B = 4 TB/day is too big for one Cassandra partition (target: <100 MB per partition). For those tenants, subshard by appending an hour or a random suffix: `(tenant_id, day, bucket)`. The same key also makes "events for tenant X on day D" a single-partition read, which is the common query.

The clustering column `event_id` (timeuuid, monotonic) keeps rows sorted within the partition, so "latest events" is a prefix scan. It also gives natural dedup: the same `event_id` inserted twice is the same row.

A second, denormalized table for the per-user access pattern:

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

Same data, different partition key, supports "events for user U." Written by the stream processor (Flink) reading the Kafka topic and writing both tables. Cost: 2x write amplification at the storage layer. Benefit: O(1) lookups for both access patterns.

Cold tier sits on S3 with path `s3://events-cold/date=YYYY-MM-DD/event_type=X/tenant_id=Y/file_N.parquet`. Inside each Parquet file: columnar layout. Column-pruned reads (only read `user_id` and `event_type` from a 50-column event) are free. Partition pruning at the file-prefix level means Athena/Presto skip entire directories that do not match the query filters.

### 5. The write pipeline

Four stages, each with a clear contract with the next.

**Stage 1: Ingest service** (synchronous part of producer's request).

```python
def handle_batch(request):
    tenant = authenticate(request)
    rate_limiter.check(tenant)                     # 429 if over quota
    queue_health.check()                            # 503 if Kafka is unhealthy

    events = parse_and_validate(request.body)       # 400 on schema errors
    for e in events:
        e.event_id = e.event_id or new_ulid()
        e.server_ts = now()
        e.tenant_id = tenant.id

    # Group by partition key for fewer Kafka send calls
    by_partition = group_by(events, lambda e: partition_for(e))

    futures = []
    for partition, group in by_partition.items():
        # Async send; producer batches internally per partition
        futures.append(kafka_producer.send_async(
            topic="events",
            partition=partition,
            value=group,
            acks="all",                              # wait for ISR
            timeout_ms=5000
        ))

    wait_all(futures, timeout_ms=10000)             # ack-wait
    return 202_accepted(batch_id=request.id)
```

The HTTP response is sent only after Kafka confirms durable replication. If the producer sees 202, the event is on disk on multiple brokers. There is no DB write at ingest; Kafka is the only durable hop here. P99 ingest target: 50 ms (excluding producer-to-edge network). If Kafka send exceeds 5s timeout, return 503 and let the producer retry.

**Stage 2: Kafka** (durable queue).

Start with 200 partitions, expandable. Each handles ~5k events/sec comfortably. RF=3. `min.insync.replicas=2` with producer `acks=all` gives "no loss as long as 2 brokers survive." Retention 7 days, long enough to replay a full week if consumers fall behind. Compression zstd, which trades a bit of CPU for ~60% smaller on-disk footprint.

Per-partition ordering is preserved. Cross-partition ordering is not. That is the trade we made when picking the partition strategy.

**Stage 3: Hot-tier writer** (Cassandra).

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
            cass_session.execute(batch)              # one network roundtrip

        consumer.commit()                            # only after Cassandra ack
```

The UNLOGGED BATCH per Cassandra partition is the throughput trick. Cassandra's UNLOGGED batches that hit a single partition are a single coordinated write, 10-100x faster than single-event INSERTs.

Commit Kafka offset after Cassandra ack. At-least-once: if the consumer crashes between Cassandra write and offset commit, it reprocesses the records on restart. Primary-key dedup in Cassandra (or `IF NOT EXISTS`) catches the duplicates.

Bound the batch size: do not let a single Cassandra BATCH exceed ~5 KB; larger triggers Cassandra warnings and tombstone-related issues. Limit to ~50 events per batch as a safety bound.

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

Flush every 5 minutes or every 100k events, whichever first. Small batches waste S3 PUT operations ($0.005 per 1000); 5-min batches keep cost manageable. Parquet over S3 is columnar, compressed, Athena-queryable, cheap. Group by partition path so each S3 key is one Parquet file with one (date, event_type, tenant_id). Lets queries prune entire prefixes.

### 6. Architecture (full pipeline)

The whole picture, drawn small enough to fit one screen:

```
                                        +-----------------------+
   producer apps  --HTTPS-->            |  Edge LB + WAF        |  anycast, TLS,
   (web, mobile,                        |  + API Gateway        |  per-tenant rate
   server-side)                         |                       |  limit, anti-abuse
                                        +------------+----------+
                                                     |
                              +----------------------+----------------------+
                              |                      |                      |
                              v                      v                      v
                       +-------------+        +-------------+        +-------------+
                       |  Ingest     |        |  Ingest     |        |  Ingest     |
                       |  (N pods)   |        |  (N pods)   |        |  (N pods)   |
                       |  validate,  |        |             |        |             |
                       |  stamp,     |        |             |        |             |
                       |  route      |        |             |        |             |
                       +------+------+        +------+------+        +------+------+
                              |                      |                      |
                              +--------------+-------+----------------------+
                                             |
                                             v
                                +------------------------+
                                |  Kafka cluster         |  200 partitions,
                                |  topic: events         |  RF=3, 7-day retention,
                                |  partitioned by        |  acks=all, zstd
                                |  hash(event_type,      |
                                |       tenant_id)       |
                                +--+----------+----------+--+
                                   |          |          |
                +------------------+          |          +---------------------+
                |                             |                                |
                v                             v                                v
        +------------------+         +------------------+           +------------------+
        |  Hot writers     |         |  Archiver        |           |  Stream proc     |
        |  (Cassandra      |         |  (S3 Parquet     |           |  (Flink)         |
        |   consumer       |         |   consumer       |           |                  |
        |   group)         |         |   group)         |           |  - per-min       |
        |                  |         |                  |           |    rollups       |
        |  UNLOGGED        |         |  5-min batches   |           |  - fraud         |
        |  BATCH per       |         |  100k events     |           |    alerts        |
        |  partition       |         |                  |           |  - dedup         |
        +--------+---------+         +--------+---------+           +--------+---------+
                 |                            |                              |
                 v                            v                              v
        +------------------+         +------------------+           +------------------+
        |  Cassandra       |         |  S3 / GCS        |           |  Rollup DB       |
        |  (hot tier)      |         |  (Parquet,       |           |  (ClickHouse or  |
        |  90-day TTL      |         |   7-year         |           |   Druid for      |
        |  RF=3            |         |   retention)     |           |   dashboards)    |
        |  sharded by      |         |  date / event /  |           |                  |
        |  (tenant, day)   |         |  tenant prefix   |           |                  |
        +------------------+         +--------+---------+           +------------------+
                                              |
                                              v
                                     +------------------+
                                     |  Athena / Presto |  ad-hoc queries
                                     |  / BigQuery      |  over cold data
                                     +------------------+

         +-----------------------------------------------------------------+
         |  Observability: Prometheus + Grafana + OpenTelemetry tracing    |
         |  every stage publishes: rate, queue depth, batch size, ack lag, |
         |  partition skew, error rate                                     |
         +-----------------------------------------------------------------+
```

A few things worth pointing out while reading this:

The ingest pods are stateless. Their only durability is Kafka. If a pod dies mid-request, the producer's connection drops, the producer retries, and either the second attempt lands or the producer's idempotency key (if present) deduplicates the first.

Three separate consumer groups read the same Kafka topic. They are independent: the archiver can fall behind without affecting Cassandra writes; Flink can crash without affecting the archiver. Each maintains its own Kafka offsets.

Cassandra and S3 are not redundant; they serve different access patterns. Cassandra answers "give me events for tenant X on day D" in 30ms. S3 answers "give me everything for tenant X over 2 years" in minutes. Picking one or the other gives you the wrong cost-performance curve for at least one of those queries.

Observability is on every box. Without it, the first thing you learn about a stuck consumer is a customer complaint two hours later.

Concrete tech: Edge LB is AWS ALB or Cloudflare + Envoy, with Redis-backed token bucket for per-tenant rate limits. Ingest pods in Go or Rust for low GC overhead. Kafka via Confluent, AWS MSK, or Aiven (alternatives: AWS Kinesis for simpler ops, Apache Pulsar for multi-tenant story, Redpanda for Kafka-compatible lower latency). Cassandra or ScyllaDB (the latter for better per-node performance) or DynamoDB if you want fully managed. Archiver is a Kafka consumer writing Parquet, often a Flink job. Stream processor: Flink for stateful, KSQL or Spark Structured Streaming for SQL-flavored, Materialize for incremental views. Cold tier: S3 + Athena, Glacier Deep Archive for >1 year.

### 7. An event's journey, end to end

Here is the create-event flow drawn as a sequence:

```
   Producer   Edge LB    Ingest    Kafka     Hot Writer   Cassandra   Archiver     S3
      |          |          |         |           |            |          |          |
      | POST     |          |         |           |            |          |          |
      | /events  |          |         |           |            |          |          |
      |--------->|          |         |           |            |          |          |
      |          | TLS,     |         |           |            |          |          |
      |          | rate     |         |           |            |          |          |
      |          | limit    |         |           |            |          |          |
      |          |--------->|         |           |            |          |          |
      |          |          | validate,           |            |          |          |
      |          |          | stamp ids           |            |          |          |
      |          |          |                     |            |          |          |
      |          |          | produce             |            |          |          |
      |          |          | acks=all            |            |          |          |
      |          |          |-------->|           |            |          |          |
      |          |          |         | replicate |            |          |          |
      |          |          |         | to ISR    |            |          |          |
      |          |          |         |           |            |          |          |
      |          |          |<--------|  ack      |            |          |          |
      |          | 202      |                     |            |          |          |
      |          |<---------|                     |            |          |          |
      | 202 OK   |                                |            |          |          |
      |<---------|                                |            |          |          |
      |                                           |            |          |          |
      |                     ~ async from here ~                |          |          |
      |                                           |            |          |          |
      |                     |  poll   |           |            |          |          |
      |                     |         |<----------|            |          |          |
      |                     |         |  records  |            |          |          |
      |                     |         |---------->|            |          |          |
      |                     |         |           | UNLOGGED   |          |          |
      |                     |         |           | BATCH per  |          |          |
      |                     |         |           | partition  |          |          |
      |                     |         |           |----------->|          |          |
      |                     |         |           |<-----------|  ack     |          |
      |                     |         |           | commit                |          |
      |                     |         |           | offset                |          |
      |                     |         |<----------|            |          |          |
      |                     |         |                                   |          |
      |                     |         |  poll                             |          |
      |                     |         |<----------------------------------|          |
      |                     |         |  records                          |          |
      |                     |         |---------------------------------->|          |
      |                     |         |                                   | buffer   |
      |                     |         |                                   | 5 min /  |
      |                     |         |                                   | 100k     |
      |                     |         |                                   | events   |
      |                     |         |                                   |          |
      |                     |         |                                   | PUT      |
      |                     |         |                                   | Parquet  |
      |                     |         |                                   |--------->|
      |                     |         |                                   |<---------|
      |                     |         |                                   | commit   |
      |                     |         |                                   | offset   |
      |                     |         |<----------------------------------|          |
```

End-to-end lag from producer to Cassandra-queryable is typically 1-3 seconds, P99 around 10 seconds. Lag to S3 Parquet is up to 5-6 minutes (the archiver's flush window dominates).

The synchronous slice is small: producer to Kafka ack, P99 50 ms. Everything after Kafka happens at its own pace.

Reads have their own short flows. Point read by event_id: `SELECT * FROM events_by_tenant_day WHERE tenant_id = ? AND day = ? AND event_id = ?`, P99 about 10ms. Per-user range: `events_by_user_day` single-partition prefix scan, P99 about 30ms. Analytics over 1 year: Athena against S3 Parquet, partition pruning + columnar read, P99 in seconds to minutes depending on scope.

A read that crosses tiers ("last 30 seconds for user U") might still be in Kafka. Three options exist: accept the lag and tell users "data has ~5s lag" (cheapest, fits most audit workloads); dual-write to a real-time store (Redis hash per user) in parallel for sub-second visibility (pay 2x writes); or query Kafka directly via kSQL (operationally awkward, Kafka is not a key-value store). Pick based on the user-facing SLA.

### 8. Scaling journey: 100 events/sec to 1M

This is the section the interviewer cares about most. At every stage, name what just broke and what fixes it. Build nothing preemptively.

**Stage 1: 100 events/sec.** A single Postgres (db.t3.medium, 4 GB RAM). One Go or Python app instance with a `/events` endpoint doing `INSERT INTO events_table (...) VALUES (...)`. One table, indexed by `event_id` and `(user_id, created_at)`. No queue, no cache, no replicas. Cost: ~$50/month for the DB, ~$30/month for app hosting.

Why this is enough: 100 events/sec is 8.6M events/day. Postgres handles this with room to spare, about 5ms per insert, using maybe 50% of a single core. One table at 30 GB/year fits on disk easily. Reads are easy because writes are easy.

The lesson: at 100 events/sec, the simplest possible system *is* the right system. Anything else is a portfolio piece, not engineering.

**Stage 2: 10k events/sec.** Postgres CPU is at 80% steady state. WAL fsync is the bottleneck (each commit fsyncs to disk). Inserts land in random pages (the `(user_id, created_at)` index has high cardinality), so the buffer pool churns. The app does one network round-trip per event; even at 1ms each, 10k of them is 10 cores of round-trip waiting.

Fixes: add in-app buffering, accumulating events in memory and flushing every 100ms or every 1000 events, whichever comes first. The flush is a Postgres `COPY` instead of `INSERT`, 10-20x faster. Partition the table by day (`CREATE TABLE events_2026_05_23 PARTITION OF events_master FOR VALUES FROM ('2026-05-23') TO ('2026-05-24')`) so old partitions drop cheaply and newer indexes stay small. Add a second app instance behind a load balancer. Add a read replica for the analytics queries that were spiking the primary.

What you accept: buffered events lost on app crash, worst case 100ms of events (~1000 events at 10k/sec). Tolerable for most use cases. Document it. End-to-end lag goes from immediate to ~100ms.

What you do *not* build: no Kafka, no Cassandra, no multi-region. The buffer + batch trick gets you to 10k/sec on one Postgres. Cost: ~$500/month, the bigger Postgres instance dominating.

This is where most teams overengineer. They jump to Kafka because "we'll need it eventually." That is true at stage 3, not stage 2. The buffer-and-batch pattern buys 10x runway with minimal complexity.

**Stage 3: 100k events/sec.** Postgres cannot keep up even with batching. The single instance is at IO ceiling and vertical scaling has hit its limit (largest RDS Postgres does maybe 30k writes/sec). The app process holding the buffer is a single point of failure with 1000 events in flight; tolerable at 10k/sec, scary at 100k/sec because a restart loses 100k events worth of buffer. Read replica lags by 30 seconds because the primary is saturated. A bad consumer query takes down the primary, which is also serving writes.

Fixes: Kafka in front of storage. Events go to Kafka first; storage writes are async. Decouples producer rate from storage rate. Kafka buffers a backlog if storage falls behind. Producers get 202 immediately. Switch storage to Cassandra (LSM-tree is the right shape, sequential writes, horizontal scaling by adding nodes; RF=3 across three AZs). Add a separate Kafka consumer process that reads events and writes to Cassandra in batched UNLOGGED BATCH per partition; this consumer is stateless, you run N of them for redundancy. Crashes do not lose data because Kafka holds the events. First pass at partitioning: Kafka topic with 50 partitions, hash by `(event_type, tenant_id)`. Cassandra primary key `((tenant_id, day), event_id)`. First pass at observability: Kafka consumer lag, partition rate, batch size, Cassandra write latency. You will use these constantly.

What you accept: end-to-end lag jumped from 100ms to ~5 seconds (ingest, Kafka, consumer poll, Cassandra). Strong consistency is gone (if two producers write events with the same event_id and the second is the "real" one, Cassandra's last-write-wins might give you the wrong one; use a unique event_id like ULID or snowflake to avoid the conflict). One Kafka consumer crash = a few seconds of replay, handled by idempotent storage.

What you do *not* build: no multi-region (yet), no cold tier (Cassandra TTL deletes after 90 days, older events gone unless someone needs them), no Flink (the Kafka consumer does all the processing). Cost: ~$10-20k/month for Kafka cluster, Cassandra cluster (5-10 nodes), self-hosted or managed.

Stage 3 is the inflection point. You introduced asynchrony, accepted eventual consistency, and have an actual distributed system. Operational complexity went 10x. Worth it because the alternative is sharded Postgres, which is its own nightmare.

**Stage 4: 1M events/sec.** Single-region Kafka hits NIC and disk limits. Cross-region producers add latency. Cassandra cluster at 30 nodes: one node failure no longer self-heals fast enough; repairs take days. A hot tenant (one team's mobile app is misbehaving) saturates one Kafka partition and one Cassandra node, degrading other tenants' writes. Cold-tier costs explode if you keep everything in Cassandra; 3.9 PB hot is expensive. Compliance asks for 7-year retention; Cassandra is the wrong tier at petabyte scale.

Fixes: regional ingest + regional Kafka clusters. Each region (us-east, eu-west, ap-south) has its own ingest tier and Kafka cluster. Events are written to the producer's home region. Cross-region replication for events that need to be globally visible (a separate "global" topic populated by an in-region MirrorMaker job). Shard Kafka topics by `event_type + tenant_id`; bigger tenants get their own topics or high-partition-count topics, long-tail tenants share a multi-tenant topic. Sub-shard hot partitions with a random suffix when a partition's rate exceeds a threshold: the ingest tier starts appending `random(0..15)` to the partition key for that tenant. Trades per-key ordering for load distribution; reversed when the spike ends. Bring in Flink for stream processing: enrichment (geoip, user attribute join), routing to multiple sinks (Cassandra hot, S3 cold, ClickHouse rollups, Kafka fraud alerts). Tiered storage: hot in Cassandra (90-day TTL), cold in S3 Parquet (7-year retention), a dedicated archiver consumer writing 5-minute Parquet batches. The archiver is a separate consumer group from the Cassandra writer; each has its own Kafka offset. A nightly job lifts Cassandra partitions older than 90 days to Parquet if not already there via the live archiver (belt and suspenders), then drops the Cassandra partition. Per-tenant rate limits at the ingest tier: hard cap, 429 above the limit.

What you accept: cross-region replication lag is seconds to minutes. Cold-tier queries are slow (Athena runs in minutes; acceptable for compliance and audit, not for interactive use). Operational complexity is significant; you have a Kafka team, a Cassandra team, a Flink team, or a small platform team that knows all of these.

What you would do at 10x scale (10M events/sec): honestly, at that point you are at the scale of a major observability vendor (Datadog, Splunk, Honeycomb). You stop building this in-house and either move to a fully managed platform (Kinesis Data Firehose + Iceberg on S3, BigQuery Storage Write API) or build very specialized infrastructure (custom Kafka forks, custom storage engines like Honeycomb's Retriever). Or you split the workload by purpose: one pipeline for security events (strict durability, long retention), one for product analytics (loose durability, short retention, aggregated only), one for performance traces (sampled, very short retention). Different pipelines have different requirements; trying to make one serve all of them at 10M/sec is what kills the system.

Cost at 1M events/sec: roughly $200k-500k/month all-in, depending on managed vs self-hosted and storage retention choices. Bandwidth and storage dominate compute.

The lesson of the four stages: each stage solved a specific pain. None were preemptive. The most common failure mode in interviews is to build the stage-4 architecture for a stage-1 problem. The second most common is to refuse to evolve past stage 2 because "Postgres handles everything."

### 9. Reliability

**Queue overflow.** Kafka cluster is at 90% disk. Producers keep sending. Back-pressure at the ingest tier: when Kafka send latency P99 exceeds 1 second or any broker is unhealthy, the ingest service starts returning 429. Producers back off. Total system protection. Shed less-important traffic: premium tenants get reserved Kafka partition capacity; free-tier tenants get throttled first. Emergency disk add: Kafka brokers can have storage expanded. Painful but possible. 30-60 min fix.

**Downstream slow.** Cassandra writer lag is at 5 minutes and climbing. Kafka is fine; Cassandra is the bottleneck. Scale Cassandra writer consumers horizontally (adding consumers in the same group spreads partitions across them). If Cassandra is at IO ceiling, you need more Cassandra nodes (adding takes hours for data redistribution). Temporarily pause the archiver (it can catch up later from Kafka), freeing Kafka broker IO for the hot writer. Worst case: drop or sample (write 1 in 10) until backlog clears. Audit-grade systems cannot do this; product-telemetry systems can.

**Partial batch loss.** A Kafka consumer crashes after writing 800 of 1000 events to Cassandra but before committing the offset. On restart, it reprocesses the entire batch. Idempotent storage saves you: the 800 already-written events are no-op on re-insert (Cassandra UPSERT with same primary key). The 200 not-yet-written events get written for the first time. No data loss, no corruption. If the consumer crashed mid-Cassandra-batch (some events of an UNLOGGED BATCH applied, others not), Cassandra's behavior is "the batch is not atomic, individual events may or may not be applied." Same recovery: replay on restart, idempotent storage handles the partial state.

**Ingest pod crash.** Pod crashes between accepting a request and sending to Kafka. The producer's HTTP connection drops with no response. Producer must retry. With idempotency key, second submission is dedup'd; without, you get a duplicate. Mitigation: ingest pod should send to Kafka before returning 202. If Kafka send fails, return 503 and let the producer retry.

**Region failure.** Producers in failed region cannot publish. Their SDK should fail over to the next-nearest region. Events get stamped with their original `tenant_id` but written to a different region's Kafka. Cross-region replication eventually brings them back to the original region's storage if needed for locality. Data loss window: events buffered in the producer's local SDK that were never sent. Typically <1 second.

**Cassandra node failure.** RF=3 means surviving 1 node failure with no data loss; surviving 2 with degraded consistency (CL=ONE reads still work). Failed node is auto-replaced; data rebuilds from replicas over hours to days. Writes continue; reads might see slight latency increase on the affected partitions until repair completes.

**Total Kafka cluster loss.** Catastrophic. Producers cannot send. Data in flight is lost. Mitigations: multi-region Kafka (different cluster per region, failover is automatic); MirrorMaker for cross-region replication (destination cluster gets data within seconds of the source); producer-side buffering (producers buffer events locally to a disk-backed queue when the broker is unreachable, replay when broker recovers). Worth it for high-value events; expensive for high-volume telemetry.

### 10. Observability

| Metric | Why it matters | Alert threshold |
|--------|----------------|------------------|
| `ingest.requests.rate` | Top-line throughput | Drop >50% in 5 min = upstream broken |
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

Four golden signals for the pipeline: ingest throughput (events/sec at the API), end-to-end lag (event ingest timestamp to Cassandra-readable timestamp), consumer lag per Kafka consumer group, and error rates at each stage.

Distributed tracing: every event gets a trace ID stamped at ingest. The trace follows it through Kafka, consumer, Cassandra. Lets you debug "why did this specific event take 2 minutes to land" without grepping through gigabytes of logs. Sample at 0.1%; the rest you just have metrics for.

Page on: ingest 5xx > 0.5%, ingest p99 > 200 ms for 10 min, consumer lag > 5 min for any group, Kafka broker disk > 90%. Ticket on: partition skew > 10x for 1 hour, parquet file size < 10 MB sustained, dedup collisions > 100/hour. Dashboard only: throughput, latency, error rates by tenant, batch sizes.

### 11. Gotchas the senior interviewer is listening for

Some of these only come out when the interviewer asks "what happens if...". The senior candidate brings them up unprompted.

**Back-pressure done wrong.** If you do not have back-pressure at the ingest tier, a downstream slowness becomes a cascading failure. Producers keep retrying; the retry storm doubles or triples the load; the cluster collapses. The correct response is to start refusing new traffic (429) when downstream is unhealthy, not to absorb infinite buffer until you fall over.

**Hot partition.** One key (a tenant, a user, a topic) gets 100x the traffic of others. The partition owning that key is saturated; the rest are idle. You have a 10-node cluster doing the work of 1 node. Detection: per-partition rate metric, alert on `max / median > 10x`. Mitigation: sub-shard the hot key with a random suffix (cost: per-key ordering broken for that tenant). Per-tenant rate limit at the ingest tier. Dedicated capacity for premium tenants; long-tail in a shared pool.

**Clock skew.** Producer A's clock is 3 minutes ahead. Producer B's is 30 seconds behind. Events from A look like they happened in the future; events from B look out of order. Always stamp server time; producer time is for user reference, server time is the source of truth for ordering and bucketing. NTP everywhere (reduces skew to milliseconds). Late-event tolerance in stream processing (Flink allows a "late arrival" window per partition; events arriving 1 minute "late" relative to wall clock still get processed into the correct time bucket). Detect outliers: events with producer_ts > server_ts + 5 min get flagged.

**Duplicate events.** Producer retried after a broker timeout that actually succeeded. Now Kafka has two copies. Detection: monitor `event_id` collision rate at the storage layer. Cassandra primary-key conflict on insert is your "duplicate" signal. Dedup: same event_id = same event, use a deterministic event_id (ULID with the producer's source info; second insert is a no-op). Kafka idempotent producer prevents duplicates within a producer session. Bloom filter at the consumer for cheap probabilistic dedup.

**Tombstone proliferation.** Cassandra deletes do not free space immediately; they write tombstones that get cleaned up at compaction. Many deletes (or a high TTL) and tombstones can dominate the read path, slowing queries dramatically. Mitigation: avoid deletes in the write-heavy path. Use TTL on the table. Run regular compaction.

**Small file problem on S3.** Archiver flushes too often; many small Parquet files; each Athena query opens thousands; queries become slow and expensive. Mitigation: bigger archiver batches (5+ minutes, 100k+ events). Periodic compaction job: merge files smaller than 64 MB into larger files. Standard Iceberg/Delta Lake feature.

**Producer-side buffering bugs.** Producer SDK buffers events to coalesce network calls. Producer process crashes. Buffer lost. User thought their event was sent; it was not. Mitigations: disk-backed producer buffer for critical events (slow but durable); sync mode for critical events (wait for ack before returning); for telemetry-grade events, accept the loss and document it.

**Re-partition rebalance storm.** You add a Kafka consumer to a consumer group. Kafka rebalances; every consumer briefly pauses, rejoins, picks up new partitions. During the rebalance (5-30 seconds), no consumption happens. Lag spikes. Mitigation: cooperative rebalancing (Kafka 2.4+) instead of eager rebalancing (only the moving partitions pause). Scale consumers during low-traffic windows when possible. Static membership (`group.instance.id`) for long-running consumers reduces rebalance frequency on transient restarts.

### 12. Follow-up answers

**1. Back-pressure.** The ingest service checks Kafka health: broker reachability, producer ack latency, consumer lag for any group falling behind. When thresholds are crossed, the ingest service returns 429 with `Retry-After`. Producers back off and retry with exponential backoff.

The producer SDK respects 429 and 503; it caches events locally (in-memory or disk-backed) and replays when health returns. Without producer-side backoff, the 429 storm just becomes a retry storm; the SDK has to actively reduce send rate.

If Kafka is so unhealthy that even 429s are slow, the ingest tier can shed load by simply closing connections (TCP RST), forcing producers to back off at a lower level. Brutal but protects the cluster.

**2. Hot tenant.** Find them: the per-partition rate metric points at one Kafka partition. Cross-reference with the partition key (tenant + event_type). The dashboard shows tenant_42 at 200k events/sec when average is 100/sec.

Next 5 minutes: apply a hard rate limit at the ingest tier, capping tenant_42 at 50k events/sec. Excess gets 429. Their misbehaving client sees errors; their well-behaved clients keep working. If the Kafka partition is still saturated, sub-shard them by hashing `(tenant_42, random(0..15))` for their events. Spreads across 16 partitions. They lose per-key ordering during the spike but the cluster survives.

Next 5 days: contact tenant_42, diagnose the bug (often a retry loop, a log misconfiguration, or a runaway script). Establish a per-tenant quota policy with documented limits. Build per-tenant isolation: premium tenants get reserved Kafka partition capacity, long-tail in a shared pool, hot tenants auto-detected and isolated to their own partitions.

**3. Clock skew.** The fix is structural, not "make every producer perfect." Always stamp server time at the ingest tier; that is the timestamp used for partitioning, bucketing, and ordering downstream. Producer time is kept for user-facing display. NTP-sync producers to the second (achievable everywhere; reduces skew enough that producer_ts is useful as a sanity check). Detect outliers: any event with producer_ts more than 5 minutes off from server_ts is logged as suspicious; usually identifies a misconfigured client (factory-default time, wrong timezone). Stream processor tolerates late events: Flink watermarks define a "lateness budget" (typically 1 minute); events arriving within the budget still land in their correct time bucket.

The trap: do not use producer time for anything that requires precise ordering. Use server time always.

**4. Duplicate events.** Detection: Cassandra primary-key conflict on insert is the most direct signal. The consumer counts `cassandra.dedup.collisions` per minute. Spikes mean producers are retrying frequently. A separate audit: nightly job runs `SELECT event_id, count(*) FROM events GROUP BY event_id HAVING count(*) > 1`. Should be zero. Actually it should never run because Cassandra's primary key prevents duplicates at insert time, but the audit catches schema-level dedup bugs.

Dedup: the `event_id` is the dedup key. Generated by the producer if possible (ULID is good: time-ordered, unique, no coordination needed). If absent, server generates one at ingest, but then producer retries get *different* event_ids and dedup is impossible. Always prefer producer-generated event_ids. Cassandra UPSERT semantics (default for INSERT) make duplicate inserts a no-op for the same primary key. No explicit "if not exists" needed. For at-most-once semantics at the consumer (do not process a dup), a Bloom filter of recent event_ids in the consumer. Memory bounded, probabilistic.

**5. Consumer fell behind.** Kafka has 1.8 billion events buffered. Consumer restarts. Two failure modes to avoid: resource exhaustion at the storage layer (consumer wakes up, polls Kafka at full speed, sends 1.8B events to Cassandra as fast as Cassandra accepts, melts the cluster); out-of-order processing of derived data (if the consumer was computing rolling metrics, 1.8B events arriving in the next hour skews every metric for that hour).

Strategies: throttled catch-up, configuring the consumer to ingest at 2x normal throughput, not unbounded. Catch-up takes longer but storage stays healthy. At 100k/sec normal and 200k/sec catch-up, 1.8B events take 2.5 hours to drain. Parallel consumers: scale the consumer group up temporarily; more consumers consume more partitions in parallel; watch storage, do not scale past what storage can absorb. Watermark-aware downstream: if derived consumers care about "now-time" processing, give them a flag to skip events older than X; bulk-replay the historical events into a separate batch job (Spark on the Kafka backlog) that writes directly to Cassandra without going through the live processor.

The general principle: catch-up is a separate workload. Do not pretend it is normal traffic.

**6. Schema evolution.** Old producers send 5 fields. New producers send 6. Cassandra has 5 columns plus a JSON blob column for the rest.

Strategies for the migration: schema-flexible storage (keep raw event as JSON or in a JSON column; use Avro/Protobuf with backward/forward compatibility rules; old consumers ignore unknown fields, new consumers know the field is optional for old records). Schema registry (Confluent Schema Registry or similar) where producers register their schema version, consumers fetch the schema and parse correctly, compatibility checks enforced at registration. Versioned event type (`user.login.v1`, `user.login.v2`); old consumers stick to v1, new ones handle v2; trade-off is data fragmentation across versions. Cassandra schema add: `ALTER TABLE` adds a column, old data has NULL for that column, new data has the value; generally safe but coordinate with rolling consumer deploys.

The discipline: never make a backward-incompatible schema change without versioning. Adding fields is fine. Removing or renaming is not without a migration plan.

**7. Recent-event reads.** Three real approaches. Document the lag ("data has ~5s lag"); most use cases accept this, cheapest option. Dual write to a real-time store: a second consumer reads Kafka and writes to Redis (per-user list, capped at 1000 recent events); queries that need <1s freshness hit Redis, older data falls through to Cassandra; costs 2x writes at the consumer tier. Query Kafka directly via kSQL or a Pulsar query function to filter Kafka topics by `user_id`; operationally awkward, Kafka is not a key-value store, works only for narrow windows.

For most audit pipelines, option 1 is correct. For fraud or live-dashboard use cases, option 2 is worth the cost.

**8. Region down.** If the producer SDK is well-designed, it detects local Kafka cluster unreachable, buffers events locally (in-memory or disk), fails over to the next-nearest region's Kafka. When the local cluster recovers, it drains the buffer to local Kafka. Data loss window: events in the producer buffer at the moment the producer process dies. Typically <1 second.

If the producer SDK is naive (no failover), producer gets timeouts on Kafka send. Producer either accepts the loss or holds the events in memory until OOM. All events generated during the outage are lost.

DR play: cross-region Kafka replication (MirrorMaker) so events that did land in the failed region's Kafka eventually replicate elsewhere. When the failed region comes back, consumers replay from Kafka; downstream storage catches up.

The hard part: if writes were already in flight to Cassandra in the failed region, those Cassandra writes are stuck. Cross-region Cassandra replication (RF spread across regions) handles this for events already in storage. For events still in Kafka when the region failed, they sit in Kafka until the region recovers.

For zero-data-loss DR: write events to two Kafka clusters synchronously. Doubles producer cost but guarantees survival of one region's loss.

**9. Cold-tier query cost.** "Every event for tenant X for 3 years" scans naively across 3 years * 365 partitions * all event_type subdirectories. Even with partition pruning by tenant, that is a lot of files.

Optimizations: partition pruning by tenant_id at the prefix level (path is `date=Y/event_type=X/tenant_id=Z/`; Athena prunes paths that do not match; critical that tenant_id is in the path, not buried inside the Parquet file). File-level statistics (Parquet's per-row-group statistics let Athena skip row groups that cannot match the filter; add min/max on event_id, user_id, etc.). Pre-aggregated cube for hot queries (if "events per tenant per day" is a common query, materialize it nightly into a small summary table; original Parquet stays for ad-hoc, the summary serves the dashboard). Cold-cold storage (events older than 1 year move to S3 Glacier or Glacier Deep Archive; queries against deep archive take 12-48 hours to retrieve files but cost 1/20 of standard S3; acceptable for "compliance asks for an event from 2 years ago"). Tenant-specific extracts (when a tenant requests their data for GDPR or audit, pre-build a single Parquet extract for them; subsequent queries hit the extract, not the full lake).

For interactive queries on 3 years of data: build an OLAP layer (ClickHouse, BigQuery, or Snowflake) and pre-load the data there. S3 Parquet via Athena is for ad-hoc, not for sub-second analytics.

**10. Exactly-once for a side effect.** SMS is non-idempotent. You cannot dedup at the receiver. So you have to make sure the side effect runs exactly once.

Pattern: transactional outbox + idempotent sender. The consumer reads Kafka events and writes "send SMS" records to a local DB table `pending_sms` keyed by event_id, with `status = 'pending'`. (Kafka offsets and DB transactions do not share a transaction by default, so the consumer writes to `pending_sms` keyed by event_id and the row has `status = 'pending'`.) A separate sender process picks pending rows, calls the SMS API with `idempotency_key = event_id` (the SMS provider must support idempotency keys; Twilio does), then marks the row `status = 'sent'`.

Crash safety: if the sender crashes between API call and status update, on restart it sees the row as still pending and retries. The SMS provider's idempotency key prevents a second SMS.

Cost: one extra DB write per event. Adds maybe 5 ms per event at the consumer. Cheap insurance.

The general lesson: when you need exactly-once at a specific downstream, use a transactional outbox at that consumer rather than paying Kafka EOS cost on the whole pipeline. The expensive guarantee is local to where you need it.

### 13. Trade-offs worth saying out loud

**Sync vs async.** Sync writes (producer waits for storage) give you immediate consistency and simpler reasoning. They cap throughput at the storage layer's speed. Async (via queue) decouples producer rate from storage rate; higher throughput at the cost of end-to-end lag and weaker consistency. The right call depends on the lag SLA. <100ms = sync. >1s acceptable = async.

**Batch vs stream.** Batching amortizes per-write overhead (TLS, fsync, network round-trip). Larger batches = higher throughput but higher latency per event. The sweet spot is "batch enough to amortize, small enough to land within the lag SLA." Typical: 100ms or 1000 events.

**Exactly-once cost.** Kafka EOS drops throughput 20-40% and adds operational complexity. The right move is usually "at-least-once with idempotent storage," which is functionally equivalent at the storage layer for 10x less complexity. Reserve true exactly-once for non-idempotent side effects (SMS, payment processing).

**Why Cassandra over Postgres at the hot tier.** Postgres B-tree is bad at write-heavy random-key inserts; Cassandra LSM is built for it. At <50k writes/sec, Postgres is fine and operationally simpler. Above that, Cassandra wins on throughput per node. At scale, Cassandra also gives you easier horizontal scaling (add a node, rebalance automatically) versus Postgres which requires manual sharding.

**Why Kafka and not Kinesis / Pulsar / NATS.** Kafka has the largest ecosystem, the deepest tooling, the best operational documentation. Kinesis is simpler to operate (fully managed) but harder to migrate off. Pulsar has a better multi-tenant story (per-tenant namespaces). NATS JetStream is lighter weight. At 1M events/sec, all of them work; pick what your team can operate.

**Why S3 Parquet for cold tier.** Cheap, durable, columnar, queryable with serverless tools (Athena/BigQuery). The alternative (keep everything in Cassandra) costs 100x more for events that are accessed once a year.

**What I would revisit at 10M events/sec.** Specialized vendor (Datadog, Splunk, Honeycomb) or specialized infrastructure (Honeycomb's Retriever, ClickHouse for everything). Or split into purpose-specific pipelines (security, analytics, traces). The "one pipeline for everything" pattern stops scaling cleanly past ~1M events/sec.

### 14. Common interview mistakes

Most weak answers fall into one of these.

**Reaching for Kafka and Cassandra immediately.** The interviewer started you at 100 events/sec. If you immediately propose a Kafka cluster, you have not earned the architecture. Walk the stages. Justify each addition with a specific failure mode of the previous stage.

**Confusing buffering with batching.** Buffering means holding events in memory before writing. Batching means writing many events in one storage call. You usually do both. Articulate the difference.

**Not addressing partitioning.** "Use Cassandra" without specifying the partition key is a hand-wave. The partition key determines whether your cluster has hot nodes; it is the most important decision in the storage layer.

**Claiming exactly-once without paying the cost.** Senior interviewers will probe. If you say "exactly-once," you must explain how (Kafka EOS, transactional outbox) and what it costs. If you say "at-least-once with idempotent storage," you score the same correctness with a tenth the operational pain.

**Forgetting back-pressure.** A write-heavy system without back-pressure cascades on the first downstream slowness. The 429 / retry-with-backoff loop is mandatory.

**Not designing for the hot partition.** "It will distribute evenly" is a hope, not a design. Real systems have one tenant 1000x bigger than the median. Have an answer (sub-sharding, rate limiting, dedicated capacity).

**No tiered storage.** Keeping 7 years of events in Cassandra is wasted money. Cold tier (S3 Parquet) is the standard play. Mention it.

**Treating lag as a bug.** End-to-end lag is the *price* you pay for async ingestion. Some consumers want lag (cheap batch processing). Some do not (fraud alerts). Acknowledge the spectrum.

**Ignoring observability.** "We'll add monitoring later" loses senior-level credit. Queue depth, consumer lag, batch size, and partition skew are the metrics that diagnose every common failure. They are part of the design, not an afterthought.

**Building the 1M/sec architecture at 100/sec scale.** Junior engineers love this mistake. The system collapses under its own operational weight before it ever sees the traffic it was built for. The discipline is "design for one stage past current, not three."

If you hit 7 of these 10 cleanly, you are interviewing well. The two that separate staff-level candidates from senior: addressing the hot partition problem unprompted, and explaining the exact moment you would *not* yet introduce Kafka (the stage 1 to 2 transition). Both demonstrate that you understand cost as well as throughput.
{% endraw %}
