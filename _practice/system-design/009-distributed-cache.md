---
layout: practice-problem
track: system-design
problem_id: 9
title: Design a Distributed Cache (Redis / Memcached)
slug: 009-distributed-cache
category: Distributed Systems
difficulty: Medium
topics: [consistent hashing, replication, eviction, ttl, hot keys]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/009-distributed-cache"
solution_lang: markdown
---

{% raw %}
## Scene

Second round. The interviewer pulls up a whiteboard:

> *You've used Redis. Design it. Not the data structures inside one node, the cluster. How does the cluster work? How does it find the key? What happens when a node dies? How do you add a node without downtime?*

They cross their arms. This is the question that separates candidates who treat Redis as a magic black box from candidates who treat it as a distributed system. If I open with "Redis stores key-value pairs in memory" I have already lost ground. The interviewer wants the cluster story: hash slots, gossip, replication, failover, resharding.

The trap is that every other problem in this repo uses a distributed cache as a primitive. I will be asked this question, or something shaped like it, sooner or later.

## Step 1: clarify before designing

Five minutes. No drawing yet. The goal is at least six questions that meaningfully change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. Consistency model. "Strong consistency on writes, or eventual? Can a read after a write return stale data?" Most caches tolerate eventual. If the answer is strong, I am now designing a distributed database, not a cache, and the whole shape changes (synchronous replication, quorum reads, leader election on every write).
2. Persistence. "Pure in-memory, or do we need durability across restarts?" Memcached has none. Redis has RDB snapshots and AOF logs. The answer decides whether process restart loses data.
3. Value size and access patterns. "Values small (under 1 KB) or multi-MB? Just GET/SET, or do I need sorted sets, lists, pub/sub?" Memcached is flat KV. Redis is a data-structure server. The answer scopes the API surface.
4. Traffic shape. "Ops per second? Working set size? Read/write ratio?" Without these I cannot size the cluster. A typical answer: 1M ops/sec, 1 TB working set, 10:1 read:write.
5. Eviction policy. "When memory is full, what happens? LRU? Reject writes? TTL-only?" Product question. The wrong eviction policy silently corrupts application behavior.
6. Multi-region. "One region or many? Active-active or active-passive?" Cross-region cache replication is unusual; most teams keep caches regional and let the source-of-truth database deal with multi-region. Confirm.
7. Client topology. "Smart client that knows topology, or a proxy in front?" Redis Cluster uses smart clients (MOVED redirects); Memcached typically uses a proxy (mcrouter, twemproxy). Different operational properties.
8. Failure tolerance. "How many node failures must we survive without data loss? Without availability loss?" Drives replication factor and quorum.

A candidate who only asked "how many ops per second" and "how much data" missed consistency, persistence, and eviction. Those three are what the interviewer most wants to hear.

</details>

## Step 2: capacity estimates

Assume the interviewer gave me these numbers:

- 1M operations per second sustained, 3M peak
- 1 TB working set
- 10:1 read:write ratio
- Average value size: 1 KB
- Average key size: 50 bytes
- P99 latency target: under 5 ms in-region
- Durability: tolerate one node failure per shard with zero data loss

Compute on paper before revealing:

1. Reads per second and writes per second at peak
2. Network bandwidth at peak
3. Memory per node with a 6-node cluster, replication factor 2
4. Memory per node with a 12-node cluster
5. TCP connection count from 1000 application servers each pooling 50

<details>
<summary><b>Reveal: the math</b></summary>

Reads and writes. At 3M ops/sec peak with 10:1 read:write:

- Reads: ~2.7M/sec
- Writes: ~300K/sec

A single Redis node tops out around 100K-200K ops/sec on simple GET/SET, depending on hardware and pipelining. Higher with pipelining (commands batched on the wire), lower with complex commands. Need at least 15-30 nodes to handle 3M ops/sec before headroom.

Network bandwidth at peak. Each op moves roughly 50 byte key + 1 KB value + ~20 byte protocol overhead = ~1.1 KB. 3M times 1.1 KB = 3.3 GB/sec aggregate. Across 30 nodes, ~110 MB/sec per node. Comfortable within a 25 Gbps NIC budget (~3 GB/sec per node). Watch out: replication doubles write bandwidth for primaries.

Memory per node, 6-node cluster, RF=2. 1 TB working set times 2 copies = 2 TB total. Across 6 nodes, ~340 GB per node. Doable on the right instance (r7g.16xlarge has 512 GB), but blast radius of a single failure is huge: ~170 GB of primary keyspace briefly unavailable.

Memory per node, 12-node cluster, RF=2. 2 TB total / 12 = ~170 GB per node. Smaller blast radius. Each node owns ~85 GB primary. r7g.8xlarge (256 GB) fits with headroom.

Plus overhead: Redis itself uses ~20% more RAM than the dataset due to encoding, expiration metadata, and replication buffers. Budget 200 GB instances for a 170 GB dataset.

Connection count. 1000 servers times 50 connections = 50K client connections. With Redis Cluster smart clients, every client opens connections to every shard primary. 50K times 12 = 600K connections across the cluster, ~50K per node.

Redis handles this on a single event loop. 50K idle connections is fine. 50K active connections at 200K ops/sec means each connection does 4 ops/sec, light. But each connection costs ~20 KB of buffer memory in Redis: 50K times 20 KB = 1 GB per node just for connection state. Account for it.

The shape that matters. The cluster is bottlenecked by per-node CPU (single-threaded event loop) and memory, not network. Number of nodes and replication factor are driven by per-node ops/sec ceiling and blast-radius tolerance, not raw capacity.

</details>

## Step 3: partitioning

I have a key. I have N nodes. How do I decide which node owns the key? Three serious approaches: modulo hashing, consistent hashing, rendezvous (HRW) hashing. Ten minutes. Write down the pros and cons of each, and what happens when nodes come and go.

<details>
<summary><b>Reveal: comparison of partitioning schemes</b></summary>

| Scheme | How it works | Cost to add/remove a node | Distribution |
|--------|-------------|---------------------------|--------------|
| Modulo hashing | `node = hash(key) % N` | Catastrophic. Changing N from 6 to 7 reshuffles ~6/7 of keys. Cluster is unusable during rehash. | Perfectly even. |
| Consistent hashing | Map keys and nodes onto a ring; key goes to the next node clockwise. | Only ~1/N of keys move. Adding one node to a 12-node cluster moves ~8% of keys, all to the new node. | Uneven with few nodes. Fixed by virtual nodes. |
| Rendezvous (HRW) hashing | For each key, compute `hash(key, node_id)` for every node; key goes to the highest score. | Only ~1/N of keys move. Same as consistent hashing. | Even by construction. No virtual nodes needed. |

Consistent hashing with virtual nodes is the standard answer.

The naive ring (one position per node) gives uneven distribution: with 6 nodes, one node might own 30% of the keyspace and another 5%. The fix: 100 to 200 virtual nodes (vnodes) per real node at different ring positions. With 1200 vnodes for 6 nodes, distribution converges close to uniform.

Redis Cluster uses a variant: 16384 hash slots, statically. Each key hashes to `CRC16(key) mod 16384`. Slots are assigned to nodes. Rebalancing moves slots. Mathematically equivalent to consistent hashing with 16384 vnodes globally, but with explicit slot ownership rather than ring traversal.

Memcached takes a different path. The protocol has no built-in clustering; clustering is a client concern. Clients use libketama (consistent hashing with vnodes) to pick a server. No server-side rebalancing; if I change the client config, keys move and I accept the cache miss storm.

Migration math.

12-node cluster, ~85 GB per node. I add node 13. With consistent hashing, ~1/13 of keys move, distributed across the 12 old nodes (each gives ~1/12 of its keys to node 13):

- Each old node sends ~7 GB to node 13.
- Node 13 receives ~85 GB total.
- At 100 MB/sec migration rate (throttled to not saturate the network), ~85 GB / 100 MB/sec = 850 seconds, about 14 minutes.

During migration, what happens to lookups for keys being moved? Redis Cluster uses `ASK` redirects: if a key is in flight, the client first tries the old node, gets an `ASK` pointing to the new node, retries on the new node. After migration completes, the old node responds with `MOVED` for that slot.

Removing a node is the reverse: redistribute its slots to survivors, then take it down. Plan migration to complete before decommission.

Honest trade-off. Consistent hashing minimizes movement but does not eliminate it. A naive client that ignores `MOVED`/`ASK` and just retries on the old node will see cache misses (and possibly fall through to the source-of-truth database) during the migration window. Migration is not free; it is just contained.

</details>

## Step 4: sketch the architecture

Intentionally incomplete diagram. Fill in the five `[ ? ]` boxes. Hint: how does the client find a node, how do nodes find each other, what sits next to each primary for durability, what runs across all nodes to keep the cluster healthy?

```
                ┌────────────────────────┐
                │   Application Server    │
                │   ┌────────────────┐   │
                │   │  [ ? ]         │   │  (knows the cluster topology,
                │   └───────┬────────┘   │   picks the right node for a key)
                └───────────┼────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────────────┐
        │            [ ? ]                              │  (decides which node owns the key:
        │                                               │   slot/hash → node mapping)
        └────────┬──────────────┬──────────────┬────────┘
                 │              │              │
                 ▼              ▼              ▼
         ┌────────────┐  ┌────────────┐  ┌────────────┐
         │ Shard 1    │  │ Shard 2    │  │ Shard 3    │
         │            │  │            │  │            │
         │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │
         │ │Primary │ │  │ │Primary │ │  │ │Primary │ │
         │ └───┬────┘ │  │ └───┬────┘ │  │ └───┬────┘ │
         │     │ repl │  │     │ repl │  │     │ repl │
         │ ┌───▼────┐ │  │ ┌───▼────┐ │  │ ┌───▼────┐ │
         │ │ [ ? ]  │ │  │ │ [ ? ]  │ │  │ │ [ ? ]  │ │  (takes over on primary failure)
         │ └────────┘ │  │ └────────┘ │  │ └────────┘ │
         └────────────┘  └────────────┘  └────────────┘
                 ▲              ▲              ▲
                 └──────────────┼──────────────┘
                                │
                       ┌────────▼─────────┐
                       │    [ ? ]         │  (every node talks to every other node,
                       │                  │   exchanges topology and health)
                       └──────────────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
                ┌────────────────────────────────┐
                │   Application Server            │
                │   ┌────────────────────────┐   │
                │   │   Smart Client Library  │   │  Caches slot→node map.
                │   │   (Lettuce, Jedis,      │   │  Picks node by CRC16(key) % 16384.
                │   │    redis-py-cluster)    │   │  Reacts to MOVED/ASK redirects.
                │   └───────────┬────────────┘   │
                └───────────────┼────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────────────────┐
        │   Hash Slot Ring (16384 slots)                     │
        │   slot = CRC16(key) % 16384                        │
        │   slot → owning node, kept in sync by gossip       │
        └────────┬──────────────┬──────────────┬─────────────┘
                 │              │              │
                 ▼              ▼              ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │  Shard 1     │ │  Shard 2     │ │  Shard 3     │
         │  slots 0-5460│ │  5461-10922  │ │  10923-16383 │
         │              │ │              │ │              │
         │ ┌──────────┐ │ │ ┌──────────┐ │ │ ┌──────────┐ │
         │ │ Primary  │ │ │ │ Primary  │ │ │ │ Primary  │ │
         │ │ accepts  │ │ │ │          │ │ │ │          │ │
         │ │ writes   │ │ │ │          │ │ │ │          │ │
         │ └────┬─────┘ │ │ └────┬─────┘ │ │ └────┬─────┘ │
         │      │ async │ │      │       │ │      │       │
         │      │ repl  │ │      │       │ │      │       │
         │ ┌────▼─────┐ │ │ ┌────▼─────┐ │ │ ┌────▼─────┐ │
         │ │ Replica  │ │ │ │ Replica  │ │ │ │ Replica  │ │
         │ │ serves   │ │ │ │          │ │ │ │          │ │
         │ │ reads    │ │ │ │          │ │ │ │          │ │
         │ │ promotes │ │ │ │          │ │ │ │          │ │
         │ │ on fail  │ │ │ │          │ │ │ │          │ │
         │ └──────────┘ │ │ └──────────┘ │ │ └──────────┘ │
         └──────────────┘ └──────────────┘ └──────────────┘
                 ▲              ▲              ▲
                 └──────────────┼──────────────┘
                                │
                       ┌────────▼─────────────┐
                       │  Gossip Protocol      │  Every node pings a few peers
                       │  (cluster bus on a    │  per second over a separate
                       │  separate port)       │  TCP port. Exchanges:
                       │                       │   - node liveness
                       │                       │   - slot ownership map
                       │                       │   - epoch/version numbers
                       │                       │   - failover votes
                       └───────────────────────┘
```

Component responsibilities:

- Smart Client Library. Holds the slot map locally. Sends each command directly to the right primary. If topology changed and the client targets the wrong node, the node responds `MOVED <slot> <new_address>` and the client updates its map. `ASK` is the same idea but only for the duration of a slot migration.
- Hash Slot Ring. 16384 fixed slots. Each slot owned by exactly one primary at any moment. Slot map replicated across all nodes via gossip.
- Primary per shard. Single writer for its slot range. Holds canonical data in memory.
- Replica per shard. Async-replicated copy. Can serve reads (slightly stale). Promoted to primary if the primary dies.
- Gossip protocol. The cluster's nervous system. Every node sends a `PING` to a small random subset of peers every ~100ms, including its view of the topology. After enough rounds, every node converges. Detects failures within a few seconds. Coordinates failover votes.

For Memcached, the picture is simpler: no built-in cluster, no gossip, no replication. The "cluster" lives only in the client library, which consistent-hashes across a static list of servers. If a server dies, clients detect the connection failure, mark the server dead, and re-hash to the survivors. No automatic failover. Intentional: Memcached prizes simplicity and assumes the application survives any single key disappearing.

</details>

## Step 5: eviction and expiration

The cache fills up. Now what? Two distinct mechanisms, often confused: expiration (TTL passes) and eviction (memory pressure forces removal regardless of TTL).

Ten minutes. List the policies Redis offers and when to choose each. What is "approximated LRU" and why does Redis use it instead of true LRU?

<details>
<summary><b>Reveal: eviction policies and the LRU approximation</b></summary>

Expiration (TTL).

`SET key value EX 60` gives the key a 60-second TTL. Two ways to remove an expired key:

- Passive. When a client tries to read the key, Redis notices it has expired and deletes it before responding. Cheap. But an expired key the application never reads sits in memory forever.
- Active. A background job samples 20 random keys with TTLs every 100ms. If more than 25% are expired, sample again immediately. Bounds maximum staleness in memory without scanning the whole keyspace.

Both run together. Active sampling keeps memory usage close to actual live keys.

Eviction policies (when `maxmemory` is hit).

| Policy | Behavior |
|--------|----------|
| `noeviction` | Reject writes with an error. Reads still work. Application has to handle the rejection. |
| `allkeys-lru` | Evict the approximate least-recently-used key from anywhere in the keyspace. |
| `volatile-lru` | Evict the approximate LRU key, but only from keys with a TTL. |
| `allkeys-lfu` | Evict the approximate least-frequently-used key (counts access frequency over a decay window). |
| `volatile-lfu` | Same as `allkeys-lfu` but restricted to keys with a TTL. |
| `allkeys-random` | Evict a random key. |
| `volatile-random` | Evict a random key from those with TTL. |
| `volatile-ttl` | Evict the key with the soonest TTL expiration. |

Choice depends on workload:

- Pure cache: `allkeys-lru` or `allkeys-lfu`. I do not care about specific keys; keep the hot set.
- Mixed cache + queue/state: `volatile-lru`. Put TTLs on truly cacheable keys; leave critical keys (counters, locks) without TTL so eviction skips them.
- No eviction allowed: `noeviction` with monitoring. Used when the cache is the source of truth (which I should not be doing, but sometimes I am).

Approximated LRU.

True LRU needs a doubly-linked list of every key. Every access moves the touched key to the head. With 100M keys and millions of ops/sec, the pointer overhead hurts: ~16 bytes per key for prev/next pointers, plus cache-unfriendly random pointer chasing.

Redis approximates. Sample 5 keys at random (configurable, default 5, can raise to 10 for closer-to-true LRU) and evict the oldest of the sample. With sample size 10, the result is statistically close to true LRU at a fraction of the overhead.

How "oldest" is tracked: every key has a 24-bit "last access time" field (`lru` field in the object header), updated on read or write. Sampling reads this field. No linked list, no pointer overhead.

Trade-off: occasionally evicts a not-quite-oldest key. For cache use cases this is invisible. Memory savings (no list pointers across 100M keys = 1.6 GB saved per node) is significant.

LFU is implemented similarly: sampled, with a counter that increments on access and decays over time so old-frequent keys do not stay sticky forever.

</details>

## Step 6: replication and failover

Each primary has one or more replicas. When the primary dies, a replica takes over. How: synchronously or asynchronously? Quorum or unanimous? Who picks the new primary?

Ten minutes:

- Default async replication. What is the data loss window?
- Synchronous option. What is the latency cost?
- How does the cluster detect a primary is down?
- Who decides on the new primary?
- What if the "dead" primary comes back?

<details>
<summary><b>Reveal: replication and failover</b></summary>

Async replication (default).

Primary handles the write, replies to the client, queues the write for replication. Replicas pull from the primary's replication buffer and apply.

- Latency: write returns as soon as the primary commits to memory. Replicas catch up in milliseconds under normal conditions.
- Data loss window: the writes in the buffer that have not yet reached the replica. Under steady-state load, a handful of operations (a few KB). Under load spike, larger.
- If the primary dies before replication catches up, those writes are lost.

This is the right default for cache workloads. I am caching, not storing the only copy.

Synchronous replication (the `WAIT` command).

After a write, the client can issue `WAIT <numreplicas> <timeout_ms>`. Blocks until the specified number of replicas have acked the previous writes, or the timeout fires.

- Latency: bounded by the slowest of the N replicas. One replica same-AZ adds ~1ms. Cross-AZ adds ~5-10ms.
- Data loss window: zero if I wait for all replicas. But `WAIT` does not give true synchronous semantics if the primary crashes after the write but before the WAIT returns; I still need a fencing mechanism to prevent a stale primary from accepting writes after a partition.

Sync replication is rare for caches. Use it only for the small subset of writes intolerant to loss (a financial counter, a deduplication marker).

Failure detection.

Redis Cluster uses gossip-based detection. Each node pings a random subset of peers every 100ms. If a node fails to respond for ~5 seconds, the pinging node marks it PFAIL (possibly failed) and gossips this. Once a majority of primaries report PFAIL for the same node, it becomes FAIL (cluster-wide consensus that it is down).

Threshold is configurable. Lower = faster failover but more false positives during network blips. Higher = more conservative but slower recovery.

Leader election (failover).

When a primary is declared FAIL, its replicas race to take over.

1. Each replica waits a small delay proportional to its replication lag (least-lagging goes first).
2. The replica requests votes from all other primaries: "should I take over for failed primary X?"
3. Other primaries vote yes if they agree X is FAIL and the requesting replica is the only one asking within an epoch.
4. With a majority vote, the replica promotes itself, claims the slot range, and gossips the new topology.
5. Clients discover the new primary via `MOVED` redirects on the next request.

Total failover time: typically 5-15 seconds in well-tuned clusters. Most of that is the detection window; the actual promotion takes under a second.

Memcached has no failover. Server dies, the client library notices, hashes to remaining servers. Keys on the dead server are simply gone until it returns.

The "old primary returns" problem.

The old primary was network-partitioned, not dead. Now it can talk again. The cluster has already promoted a replica.

On first gossip exchange, the returning primary learns its epoch is stale. It demotes itself to replica of the new primary, discards in-memory state, syncs. Any writes accepted during the partition window are lost. Canonical CAP trade-off: the cluster chose availability (let the new primary take writes during the partition) and accepts that partitioned writes on the old primary cannot be reconciled.

To minimize this: use `min-replicas-to-write` so a primary refuses writes if it cannot reach at least one replica. Trades availability for consistency. Some teams set this; most accept the small loss window for caches.

</details>

## Step 7: read the full solution

That is the heart: partitioning, replication, failover, eviction. The solution adds persistence options (RDB vs AOF), the hot key and big key problems, encoding tricks for memory efficiency, and the day-2 problems that determine whether the cluster survives production.

## Follow-up questions

Answer each in 2 to 3 sentences before reading the solution.

1. Hot key. One key gets 500K req/s. It lives on one shard. That shard's CPU pegs. What do I do?
2. Big key. One key holds a sorted set with 2M entries. `ZRANGE 0 -1` stalls the event loop for 800ms. Every other op queues behind it. How do I prevent and how do I recover?
3. I set a TTL of 60 seconds on a million keys at once (bulk import). 60 seconds later, application latency P99 doubles. Why? Fix it without changing the TTL.
4. Persistence. When RDB? When AOF? When both? When neither? What does each cost in latency and data loss window?
5. Resharding. 6 nodes growing to 12. How do I do it without dropping ops/sec or losing data? How long does it take?
6. Network partition. Two nodes in one DC can talk to each other but not to the rest of the cluster. What happens? Will the partition try to elect its own primaries?
7. Memory fragmentation. Redis reports `used_memory_rss / used_memory = 1.8`. Translate that for the interviewer and say what I do about it.
8. Cache stampede. A popular cache key expires. 10,000 concurrent requests miss, hit the database. Database melts. How do I prevent this in the cache layer?
9. Inconsistent reads. A user writes `SET balance 100`, immediately reads back, sees the old value. Why? When can this happen in a cluster that uses replicas for reads?
10. Cache hit rate dropped from 95% to 60% overnight. No deploys. What is my investigation path?

## Related problems

- [URL Shortener (001)](../001-url-shortener/question.md), uses this cache heavily on the redirect path. The hot key problem there is the same one analyzed here.
- [News Feed (002)](../002-news-feed/question.md), timeline store is a Redis cluster. Sorted-set encoding, hot-key replicas, cold-user eviction all come from this design.
- [Typeahead Autocomplete (005)](../005-typeahead-autocomplete/question.md), the prefix index sits in the same kind of distributed cache. The big-key problem is acute there (top prefixes hold large suggestion lists).
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Distributed Cache (Redis / Memcached)

### TL;DR

A distributed cache is a sharded, replicated, in-memory key-value store with a few hard problems hidden inside. How to find a key when nodes come and go. How to keep replicas close enough to primaries that failover does not lose much. How to evict gracefully under pressure. How to survive the few keys that get all the traffic.

The standard shape is consistent hashing (or fixed hash slots) across a cluster of shards, each shard a primary plus one or more async replicas, with a gossip protocol exchanging topology and liveness. Clients are smart: they cache the slot map locally and adjust when nodes redirect them. Eviction is approximated LRU or LFU because true LRU costs too much memory. Persistence is optional and almost always trades latency for durability.

The interesting engineering is at the edges. The hot key that breaks a shard (replicas plus in-process cache). The big key that stalls the event loop (cap value size at write time, scan instead of bulk read). The resharding that has to happen without dropping traffic (incremental slot migration with `ASK` redirects).

### 1. Clarifying questions

Covered in `question.md`. The eight that matter: consistency model, persistence, value size and data structures, traffic shape, eviction policy, multi-region, client topology, failure tolerance. Skipping persistence and consistency is the classic miss; they change the design fundamentally.

### 2. Capacity estimates

Recap:

- 1M ops/sec sustained, 3M peak. 10:1 read:write.
- 1 TB working set. 1 KB average value, 50 byte average key.
- Single-node Redis ceiling: ~150K ops/sec for mixed GET/SET, higher with pipelining.
- 6-shard cluster is undersized for peak; 12-shard is comfortable. With RF=2 that is 24 nodes.
- Per node: ~170 GB primary data, plus replication buffers and connection state, plus 20% encoding overhead. 256 GB instances with headroom.
- Network: ~110 MB/sec per node, well under a 25 Gbps NIC.
- Connections: 50K per node from 1000 app servers. Buffer cost ~1 GB per node.

The bottleneck is per-shard CPU (single event loop), not memory or network. Sizing is driven by per-shard ops/sec and blast radius, not raw storage.

### 3. API design

Two things to design: wire protocol and client-facing semantics.

Core commands (Redis-style).

| Command | Behavior |
|---------|----------|
| `GET key` | Return value or nil. O(1). |
| `SET key value [EX seconds] [NX|XX]` | Set with optional TTL. NX = only if not exists; XX = only if exists. O(1). |
| `MGET key1 key2...` | Batch get. Cluster note: keys must be on the same shard, or the client fans out. |
| `MSET k1 v1 k2 v2...` | Batch set. Same shard constraint. |
| `DEL key` | Delete. Returns 1 if existed, 0 otherwise. |
| `EXPIRE key seconds` | Add TTL to an existing key. |
| `TTL key` | Return remaining TTL, -1 if no TTL, -2 if key does not exist. |
| `INCR key` / `INCRBY key n` | Atomic increment of integer value. Foundational for counters. |
| `EXISTS key` | Cheap existence check. |
| `SCAN cursor [MATCH pattern]` | Cursored iteration. Use this, never `KEYS *`. |

Plus the data-structure commands: `HSET`/`HGET` (hash), `LPUSH`/`LRANGE` (list), `SADD`/`SMEMBERS` (set), `ZADD`/`ZRANGE` (sorted set), `XADD`/`XREAD` (streams). Each is O(1) or O(log N) per element, but operations on whole structures (`SMEMBERS` on a set with 1M elements) are O(N) and block the event loop.

Memcached is a strict subset: `get`, `set`, `add`, `replace`, `delete`, `incr`, `decr`, `cas` (check-and-set). That is it. No data structures, no scripting, no pub/sub.

Cluster-aware semantics.

- Hash tags. `SET {user:42}:profile...` and `SET {user:42}:settings...` hash to the same slot because `{...}` is the only thing hashed. Lets multi-key operations like `MGET` or transactions stay on one shard.
- Multi-key constraints. `MGET k1 k2` and `MULTI`/`EXEC` only work if all keys are on the same shard. The client either constrains keys with hash tags or fans out and merges client-side.
- Pipelining. Send N commands without waiting for responses, then read N responses. Cuts round-trip overhead from N RTTs to 1. Critical for throughput. A client can push 500K ops/sec with aggressive pipelining where without it gets 50K.

Errors clients must handle.

| Response | Meaning | Client action |
|----------|---------|---------------|
| `MOVED <slot> <host:port>` | Slot now lives on another node | Update slot map, retry on new node |
| `ASK <slot> <host:port>` | Slot is migrating; this specific key is on the new node temporarily | Send `ASKING` then the command to the new node, do not update slot map yet |
| `CLUSTERDOWN` | Cluster is unhealthy (some slots have no owner) | Back off and retry; alert the operator |
| `LOADING` | Node is loading data from disk (post-restart) | Retry after a delay |
| `READONLY` | Tried to write to a replica | Update slot map, write to primary |
| `OOM` (out of memory) | Eviction disabled and memory is full | Application must handle write rejection |

### 4. Data model and in-memory representation

The conceptual model is a flat hash table: keys to values. The interesting engineering is how Redis encodes values to save memory.

Object header. Every Redis value has a header with type tag, encoding, reference count, and a 24-bit "last access time" used for LRU/LFU sampling. ~16 bytes per object.

Encoding tricks. Redis picks an encoding based on size and content.

| Type | Small encoding | Large encoding | Switch threshold |
|------|---------------|----------------|------------------|
| String | `embstr` (one allocation, 44 bytes max) | `raw` (separate allocation) | 44 bytes |
| String of small integer | `int` (no allocation, value in the header pointer) | `embstr`/`raw` | Not an integer |
| Hash | `listpack` (flat array of key-value pairs) | `hashtable` | 128 entries or any field > 64 bytes |
| List | `listpack` | `quicklist` (linked list of listpacks) | 128 entries or any element > 64 bytes |
| Set of integers | `intset` (sorted dense array) | `hashtable` | 512 entries or any non-integer |
| Sorted set | `listpack` | `skiplist + hashtable` | 128 entries or any element > 64 bytes |

Why this matters: a 10-field hash as `listpack` takes ~200 bytes; as `hashtable` it takes ~600. At 100M small hashes that is 40 GB saved by staying in `listpack`.

Flip side: operations on `listpack` are O(N) (linear scan). Once the threshold trips and the encoding switches to `hashtable`, operations become O(1) but memory triples. Redis picks the encoding at write time and upgrades in place (never downgrades).

For Memcached, encoding is simpler: a slab allocator with fixed-size slabs (64 B, 128 B, 256 B...). A 100-byte value goes into a 128-byte slab. Memory-efficient if value sizes cluster on slab boundaries; wasteful if not. The "calcification" problem: once slabs are allocated to size classes, they cannot easily be reassigned. If traffic shifts from many small values to fewer large values, small slabs sit empty.

Expiration metadata. Keys with TTL have an entry in a secondary "expires" dictionary mapping key to expiration timestamp. Active expiration samples from this dictionary, not from the main keyspace.

### 5. Core algorithm: consistent hashing and replication

#### Consistent hashing with hash slots

Redis Cluster uses 16384 fixed slots. Large enough that slots can be assigned at fine granularity (each shard owns 16384/N slots), small enough that the slot map is a manageable size to gossip (16384 bits = 2 KB).

```
slot = CRC16(key) & 16383
node = slot_map[slot]
```

The slot map is replicated across all nodes via gossip. Clients also cache it. When the map changes (shard added, removed, migrated), clients learn through `MOVED` redirects on the next operation that targets the wrong node.

The hash ring (drawn flat as fixed slots):

```
   slot:    0        4096       8192      12288     16383
            |---------|----------|----------|---------|
   owner:   Shard 1   Shard 2    Shard 3    Shard 4

   key "user:42:profile"
     → CRC16("user:42:profile") & 16383 = 5798
     → slot 5798 lives in [4096..8191] → Shard 2 primary

   key "{user:42}:settings"
     → CRC16("user:42") & 16383 = 5798     (hash tag forces same slot)
     → also Shard 2 primary (colocated with profile)
```

Client → shard flow on a `GET`:

```
  ┌────────────┐                                  ┌──────────────┐
  │  App + SDK │── 1. compute slot ──────────────►│ slot_map     │
  └─────┬──────┘                                  └──────┬───────┘
        │                                                │
        │ 2. open TCP to owning primary (cached)         │
        ▼                                                ▼
  ┌────────────────────────────────────────────────────────────┐
  │  Shard 2 primary                                            │
  │  - looks up key in hash table                               │
  │  - if TTL expired, deletes and returns nil                  │
  │  - updates lru/lfu counter                                  │
  │  - returns value                                            │
  └────────────────────────────────────────────────────────────┘
        │
        │ on topology change:
        │   responds MOVED 5798 10.0.3.4:6379
        │   SDK updates slot_map[5798] = 10.0.3.4:6379
        │   retries on new node (one extra RTT, once)
        ▼
  ┌────────────┐
  │  App + SDK │
  └────────────┘
```

Why CRC16 instead of MurmurHash, xxHash, or SHA? CRC16 is fast (a few cycles per byte), has well-understood distribution properties on text keys, and is good enough; cryptographic hash is overkill. xxHash would be faster but the difference is nanoseconds when the rest of the op is microseconds. A historical "good enough" choice.

Hash tags. The hashing function only hashes the substring inside `{...}` if present:

```
CRC16("{user:42}:profile") = CRC16("user:42")
CRC16("{user:42}:settings") = CRC16("user:42")
```

Both keys land on the same slot. The application uses this to colocate related keys for multi-key operations.

#### Replication protocol

Each shard has one primary and one or more replicas. Replication is asynchronous by default.

The replication backlog. The primary maintains a circular buffer (default 1 MB, configurable) of recent writes. When a replica connects, the primary checks if the replica's replication offset is within the backlog. If yes, stream forward from that offset (partial resync). If no, the replica fell behind too far and the primary does a full resync: serializes the entire dataset (RDB snapshot), ships it, then streams new writes.

Partial resyncs are fast (seconds). Full resyncs are slow (depends on dataset size; ~30 GB takes a few minutes). Size the backlog so brief network blips do not trigger full resyncs. 1 MB is too small for most production workloads; 256 MB or even 1 GB is common.

Replica reads. Replicas serve reads if the client issues `READONLY` on connect. Application accepts that reads may be slightly stale (typically milliseconds; can spike under replication lag).

WAIT for sync writes. A client can issue `WAIT <N> <timeout>` after a write to block until N replicas have acked. Not true synchronous replication; it is best-effort. If the primary crashes during the wait, the client gets timeout but the write may or may not have made it to replicas. For true sync semantics I need fencing (refuse writes on the old primary post-partition).

#### Failover

When the cluster detects a primary down (gossip-based, threshold around 5 seconds), replicas of that primary race to take over.

1. Each replica computes its readiness rank based on replication lag. Most-current goes first.
2. After a small delay, the replica increments its `currentEpoch` and broadcasts a vote request.
3. Other primaries vote yes if (a) they also see the old primary as failed, (b) they have not yet voted in this epoch, and (c) the requesting replica is a legitimate replica of the failed primary.
4. With a majority vote (more than half the primaries), the replica promotes itself.
5. The promoted node claims the slot range and gossips the new ownership.
6. Other replicas of the old primary reattach to the new primary.

Raft-like but not exactly Raft; a Redis-specific protocol tuned for fast cache failover. Typical failover completes in 5-15 seconds end to end. Production tuning often shortens the timeout for faster failover at the cost of more sensitivity to brief network glitches.

Redis Sentinel (not Redis Cluster) is a separate failover mechanism for non-clustered deployments: a small set of Sentinel processes monitors a primary-replica pair and triggers failover when the primary fails. Same idea, different protocol. Used when I want HA but not horizontal sharding.

### 6. Architecture (detailed)

```
                  ┌─────────────────────────────────────────┐
                  │           Application Tier              │
                  │  ┌────────┐ ┌────────┐ ┌────────┐       │
                  │  │ App 1  │ │ App 2  │ │ App N  │       │
                  │  │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │       │
                  │  │ │SDK │ │ │ │SDK │ │ │ │SDK │ │       │  Smart client.
                  │  │ │+LRU│ │ │ │+LRU│ │ │ │+LRU│ │       │  Holds slot map.
                  │  │ └─┬──┘ │ │ └─┬──┘ │ │ └─┬──┘ │       │  Optional in-process
                  │  └───┼────┘ └───┼────┘ └───┼────┘       │  LRU for hot keys.
                  └──────┼──────────┼──────────┼────────────┘
                         │          │          │
                         └──────────┼──────────┘
                                    │
              ┌─────────────────────┼─────────────────────────────┐
              │                     │                             │
              ▼                     ▼                             ▼
       ┌────────────┐        ┌────────────┐               ┌────────────┐
       │  Shard 1   │        │  Shard 2   │      ...      │  Shard 12  │
       │  slots     │        │  slots     │               │  slots     │
       │  0-1364    │        │  1365-2729 │               │  15020-    │
       │            │        │            │               │  16383     │
       │ ┌────────┐ │        │ ┌────────┐ │               │ ┌────────┐ │
       │ │Primary │ │        │ │Primary │ │               │ │Primary │ │
       │ │ 256 GB │ │        │ │        │ │               │ │        │ │
       │ └───┬────┘ │        │ └───┬────┘ │               │ └───┬────┘ │
       │     │      │        │     │      │               │     │      │
       │  async repl│        │     │      │               │     │      │
       │     │      │        │     │      │               │     │      │
       │ ┌───▼────┐ │        │ ┌───▼────┐ │               │ ┌───▼────┐ │
       │ │Replica │ │        │ │Replica │ │               │ │Replica │ │
       │ │ same   │ │        │ │        │ │               │ │        │ │
       │ │ AZ     │ │        │ │        │ │               │ │        │ │
       │ └────────┘ │        │ └────────┘ │               │ └────────┘ │
       │            │        │            │               │            │
       │ ┌────────┐ │        │ ┌────────┐ │               │ ┌────────┐ │
       │ │Replica │ │        │ │Replica │ │               │ │Replica │ │
       │ │ cross  │ │        │ │        │ │               │ │        │ │
       │ │ AZ     │ │        │ │        │ │               │ │        │ │
       │ └────────┘ │        │ └────────┘ │               │ └────────┘ │
       └─────┬──────┘        └─────┬──────┘               └─────┬──────┘
             │                     │                            │
             └─────────────────────┼────────────────────────────┘
                                   │
                          ┌────────▼─────────┐
                          │  Cluster Bus      │  Separate TCP port per node.
                          │  (gossip)         │  Every node pings ~5 peers
                          │                   │  every 100ms. Exchanges:
                          │                   │   - PING/PONG
                          │                   │   - node liveness state
                          │                   │   - slot ownership
                          │                   │   - epoch numbers
                          │                   │   - failover vote requests
                          └───────────────────┘

       Out-of-band (per-node):
       ┌──────────────────────────┐
       │  Disk: RDB snapshot file │   Periodic checkpoint of the dataset.
       │        (optional)         │   Used for backup and replica seeding.
       └──────────────────────────┘
       ┌──────────────────────────┐
       │  Disk: AOF append log     │   Every write appended.
       │        (optional)         │   Used for durability.
       └──────────────────────────┘
       ┌──────────────────────────┐
       │  Monitoring agent         │   Scrapes INFO, slowlog, MEMORY USAGE.
       └──────────────────────────┘
```

Why each piece:

- Smart client with optional in-process LRU. First line of defense against hot keys. A 1000-entry process-local LRU with 5-second TTL turns 500K req/s on one key into 200 req/s reaching the cluster.
- 12 shards. Sized so per-shard ops/sec stays comfortably under 200K and per-shard memory under 200 GB primary.
- Replicas: one same-AZ, one cross-AZ. Same-AZ catches up in <1ms (low lag, used for failover). Cross-AZ protects against AZ failure but lags more.
- Gossip on a separate port. Cluster bus traffic (port 16379 by default, +10000 from the data port) does not contend with client traffic. Bus messages are small (~100 bytes per ping); aggregate gossip is a few MB/sec across the cluster.
- Disk persistence optional. Most caches do not persist. Some do, to seed new replicas faster or to survive a full cluster restart without losing the working set.

### 7. Read and write paths

Write path (`SET key value EX 60`):

1. Application calls `client.set("user:42:profile", v, ex=60)`.
2. Client computes `slot = CRC16("user:42:profile") & 16383`. Looks up `slot_map[slot]` to find primary node.
3. Client sends SET over its persistent TCP connection to that primary.
4. Primary parses the command, validates key length, applies to its in-memory hash table, sets TTL in the expires dictionary. Updates the `lru` field on the object.
5. Primary appends the command to its replication backlog (and, if AOF is enabled, to the AOF file).
6. Primary returns `+OK`. Latency so far: ~0.3 ms in same DC.
7. Asynchronously, replicas pull from the backlog and apply. Replication lag at steady state: <1 ms intra-AZ, ~5 ms cross-AZ.
8. If `WAIT 1 100` follows, the primary blocks until at least one replica acks (or 100ms timeout). Most workloads do not use WAIT.

P99 target: 5 ms. Under load, the bottleneck is event-loop contention on the primary (single-threaded). Mitigation: spread keys evenly via hash tags only when needed; do not let big keys hog the event loop.

Read path (`GET key`):

1. Application calls `client.get("user:42:profile")`.
2. Client computes the slot, looks up the primary (or a replica if `READONLY` is set on the connection).
3. Client sends GET.
4. Node looks up the key in its hash table. If TTL has expired (passive expiration), deletes the key and returns nil.
5. Updates the `lru` field (so it stays "young" for LRU eviction).
6. Returns the value. Latency: ~0.2 ms in same DC.

If the slot has moved:

- Returns `MOVED <slot> <new_node:port>`.
- Client updates its slot map and retries on the new node. One extra round trip on the first redirected request after a topology change.

If the slot is mid-migration:

- Returns `ASK <slot> <new_node:port>`.
- Client sends `ASKING` followed by the command to the new node. Does not update the slot map yet (migration is not complete).

In-process LRU: before any of the above, the client checks its local LRU. Hit returns in microseconds. Miss falls through to the cluster.

### 8. Scaling: add and remove nodes without downtime

Adding a shard (12 → 13).

1. Bring up the new primary and its replica. Empty.
2. Add them to the cluster (`CLUSTER MEET`). They appear in gossip but own no slots.
3. Plan slot migrations. To equalize, each existing shard gives ~1/13 of its slots to the new shard. 16384/13 ≈ 1260 slots to the new shard.
4. Migrate slot by slot. For each slot:
   a. Mark the slot as MIGRATING on the source and IMPORTING on the destination.
   b. Iterate the keys in that slot. For each, call `MIGRATE`, which copies it to the destination atomically (network ack required) and deletes it from the source.
   c. During this window, the source still serves reads/writes for keys not yet moved, and responds with `ASK` redirects for keys that have moved.
   d. After all keys in the slot are migrated, send `CLUSTER SETSLOT <slot> NODE <new_node>` to all primaries. They gossip the new ownership.
5. After all 1260 slots migrate, the cluster is balanced.

Throughput cost. Migration uses bandwidth and CPU on both source and destination. Default migration rate is a few thousand keys/sec per slot, throttleable. For 100 GB per source shard moving to a new shard, expect a few hours of migration. Migration is incremental; the cluster keeps serving traffic throughout.

Client behavior during migration. Smart clients handle `MOVED`/`ASK` transparently. The application sees slightly elevated tail latency (one extra round-trip per redirected request) but no errors. Dumb clients that ignore redirects see "cache misses" and may overload the database; client choice matters.

Removing a shard (12 → 11).

1. Pick the shard. Distribute its slots to the remaining 11 (same migration mechanism).
2. After migration completes, the shard owns zero slots. Shut it down.
3. Inform the cluster (`CLUSTER FORGET`). Other nodes remove it from their topology.

Rebalancing without changing the shard count. If load is uneven (some shards hotter than others), move slots between shards without adding or removing nodes. Same mechanism. Useful when traffic patterns drift.

### 9. Reliability

Persistence options.

| Mechanism | What it stores | Latency cost | Data loss window |
|-----------|---------------|--------------|------------------|
| None (default for caches) | Nothing | Zero | Everything on process restart |
| RDB snapshot | Point-in-time binary dump of the dataset | Brief CPU + I/O spike during snapshot. Fork-based, so 2x memory transient | Up to the snapshot interval (typical 5 minutes) |
| AOF (append-only file) | Every write command, appended | Small per-write (fsync policy dependent) | `appendfsync always`: 0 (per-write fsync, kills throughput). `everysec`: 1 second. `no`: OS decides (seconds-minutes) |
| RDB + AOF | Both | AOF latency cost + RDB CPU spike | AOF window; RDB is just for faster boot |

When to use each.

- Pure cache, ephemeral data. No persistence. The database is source of truth; if cache restarts, repopulate on miss.
- Cache that takes hours to warm. RDB snapshots every 5 minutes. After restart, load the snapshot and start serving warm immediately. Tolerable loss: the last 5 minutes of cache updates, which the application will repopulate.
- Stateful Redis (Redis as primary store). AOF with `everysec`. Up to 1 second of writes lost on crash; acceptable for many workloads. Combined with replicas, real-world loss is rare.
- Strict durability. AOF with `always`. Throughput drops ~10x. Use only for the few keys that demand it.

For Memcached: no persistence. Process restart = empty cache. By design; Memcached prizes simplicity and assumes a warmer cache layer or database absorbs the warm-up traffic.

Failure scenarios.

- One node dies. Replica is promoted (5-15 seconds). Slot range unavailable for that window. Clients see errors; well-built apps treat cache errors as cache misses and fall through to the database. Database briefly sees a fraction of cache traffic for the affected slots.
- Entire shard (primary + replicas) dies. Slot range unavailable until at least one replica returns or the shard is rebuilt. RF=2 (primary + 1 replica) tolerates one failure per shard. RF=3 tolerates two.
- Network partition. The smaller side cannot get a majority of primaries to vote on failover and refuses to promote replicas. Avoids split-brain. The larger side proceeds normally. When the partition heals, the smaller side reattaches with the larger as authoritative.
- Cluster-wide reboot. Without persistence, the cluster comes back empty. The application's database tier absorbs the cache-miss storm. Sizing the database to handle this is a separate decision; I do not want a 100% cache miss to take down production.
- Slow consumer (replica falling behind). Replication backlog overflows. Primary promotes the replica from "online" to "needs full resync." Replica requests an RDB dump and reloads. During this window the replica cannot serve reads. Mitigation: make the backlog generous, monitor replication lag, alert on saturation.

### 10. Observability

| Metric | What it tells me | Alert threshold |
|--------|------------------|-----------------|
| `ops_per_sec` per shard | Hot-shard detection | Shard at >2x cluster median |
| `latency.p99` per shard | Slow shard detection | P99 > 10 ms |
| `cache_hit_rate` | Application using cache effectively | Below 80% (depends on workload) |
| `used_memory` vs `maxmemory` | Eviction headroom | Above 80% |
| `mem_fragmentation_ratio` (rss/used) | Memory waste due to allocator | Above 1.5 |
| `evicted_keys_per_sec` | Eviction pressure | Spike from baseline |
| `expired_keys_per_sec` | Active expiration cost | Spike (could mean TTL stampede) |
| `replication_lag_sec` | Replica freshness | Above 1 second sustained |
| `connected_clients` | Connection leak detection | Spike beyond expected |
| `slowlog_count` | Commands exceeding threshold (default 10ms) | Any sustained appearance |
| `cluster_state` | Cluster health (ok / fail) | Not "ok" |
| `keyspace_hits` / `keyspace_misses` | Cache efficiency | Miss rate climbing |

Slowlog deserves attention. Every command past a threshold (default 10ms) gets logged. For a single-threaded event-loop server, a 100ms command blocks every other operation for 100ms. The slowlog names the offenders. Almost always: `KEYS *`, `SMEMBERS` on a giant set, `HGETALL` on a giant hash. Cap value sizes and avoid these commands.

Alerting:

- Page on: cluster_state != ok, replication_lag > 5s, P99 latency > 20ms, ops_per_sec drop > 50%.
- Ticket on: hit rate drop > 10pp, evicted_keys spike, fragmentation > 1.8.

### 11. Follow-up answers

**1. Hot key (500K req/s on one key).**

Symptoms: that shard's CPU pegs. P99 for everyone on that shard climbs. Other shards fine.

Mitigations in order of cheapness:

1. In-process LRU on application servers. A 100-entry LRU with 5-second TTL absorbs >99% of the load. The hottest 1% of keys never reach the cluster. The single biggest win.
2. Replica reads. Direct reads for that key to replicas (using `READONLY` connections). With 2 replicas, triple the read throughput for that key. Trade: slightly stale.
3. Key splitting (sharding the hot key). Store the same value under N keys (`hot_key:0`, `hot_key:1`,..., `hot_key:7`), each on a different slot. Clients pick a random suffix per request. Spreads load across 8 shards. Adds complexity: every write must update all 8 copies. Worth it only for extreme hot keys.
4. Client-side request coalescing. If many concurrent requests on one app server want the same expired key, only one fetches from cache+DB; the rest wait. Reduces stampede when the local LRU entry expires.

**2. Big key (sorted set with 2M entries, ZRANGE 0 -1 stalls for 800ms).**

The event loop is single-threaded. An 800ms command blocks every other operation on that node for 800ms. P99 spikes across all keys on that node.

Prevention:

- Cap value size at the application layer. Reject writes that would push a set past 10K entries, or split into multiple smaller sets.
- Use `SCAN`-family commands (`SSCAN`, `HSCAN`, `ZSCAN`) which return small batches per call. Many small commands instead of one giant one.
- Track key size via `MEMORY USAGE key`. Alert on outliers.

Recovery (key already exists, currently causing pain):

- Do not delete with `DEL`. `DEL` on a 2M-entry sorted set is itself a multi-second blocking call.
- Use `UNLINK` (Redis 4+) which moves the deletion to a background thread. Returns immediately; deallocation happens off the event loop.
- For breaking up the data: iterate with `ZSCAN` in a script, move chunks to new keys, then `UNLINK` the original.

**3. TTL stampede (1M keys all expire at 60s).**

At t=60s, Redis's active expiration job has to delete 1M keys at once. Active expiration samples 20 keys per 100ms; if more than 25% are expired, samples again immediately. With 1M keys all expired, the job runs at full speed for many seconds. CPU dedicated to expiration; client latency spikes.

Also: at expiration, dependent application code (a "regenerate" path) fires for many keys at once, hammering the source-of-truth database.

Fix without changing the TTL value: add jitter at write time. Instead of `EX 60`, use `EX (60 + random(0, 30))`. Spreads expirations across a window. 1M keys over 30 seconds = 33K expirations/sec, which active expiration handles without spiking.

Same insight as cache stampede prevention: never let many things expire simultaneously when they were created simultaneously.

**4. RDB vs AOF.**

| Use case | Recommendation | Why |
|----------|---------------|-----|
| Pure cache, fast warm time | RDB only, snapshot every 5-15 min | Recovers a warm cache after restart in seconds. Some data loss between snapshots is acceptable. |
| Pure cache, slow warm time (hours to fill) | RDB + small AOF (or just RDB) | Same as above; RDB is enough. |
| Cache that doubles as a queue or counter store | AOF with `everysec` | Up to 1 second loss on crash. Tolerable for most use cases. |
| Source-of-truth storage | AOF with `everysec`, plus replicas | Gives durability without paying for `appendfsync always`. |
| Tightest durability | AOF with `always` | Each write fsyncs. Throughput drops to thousands of ops/sec per node. Use sparingly. |

Both: snapshot for fast recovery; AOF for the writes since the last snapshot. AOF rewrite compacts the log periodically (replays it into a new file with all redundancies removed).

Neither (Memcached-style): when restart latency is acceptable and the database can handle the warm-up storm. The most common production choice for true cache workloads.

**5. Resharding from 6 to 12 nodes.**

1. Bring up 6 new shards (each primary + replica). Empty and gossip in.
2. Plan slot migrations: each of the original 6 gives half its slots to one of the new shards. ~1365 slots per migration.
3. Migrate slot by slot using `MIGRATE`. Each slot's keys move atomically; clients get `ASK` redirects during migration and `MOVED` after.
4. Throttle migration so source and destination are not saturated. Target: ~5% CPU overhead.
5. Migration time depends on data per shard. For 200 GB per source shard, half (~100 GB) moves at ~50 MB/sec sustained: ~30 minutes per source shard. In parallel across the 6 sources = ~30 minutes total.

Traffic continues throughout. Cache hit rate may dip slightly (a few percentage points) from redirect overhead on migrating slots. Application sees no errors if the client handles `ASK`/`MOVED`.

**6. Network partition (two nodes isolated).**

Two nodes can talk to each other but not to the other 22.

If those two are not primaries (or only one is): primaries on the other side promote replicas. The isolated nodes, when they get only minority votes in any election attempt, refuse to act. Eventually they time out and shut down (the `cluster-require-full-coverage` flag affects this; defaults vary).

If both are primaries of different shards: the larger side declares them dead and promotes their replicas. The isolated primaries, unable to gather a majority for anything, refuse new writes (cannot confirm they still own their slots safely). They accept reads of their cached data until they realize they are partitioned and stop.

When the partition heals, the isolated nodes gossip in, see their epochs are stale, demote themselves to replicas of the new primaries.

No split-brain: a primary on the minority side that kept accepting writes would corrupt the system. The cluster prevents this by requiring majority for failovers and by old primaries deferring to higher-epoch nodes on reunion.

**7. Memory fragmentation ratio 1.8.**

`used_memory_rss / used_memory = 1.8` means the OS sees Redis using 1.8x the memory Redis thinks it is using. The 80% gap is allocator fragmentation: jemalloc has free chunks scattered through arenas, unable to return to the OS because of allocation patterns.

Causes:

- Workloads with widely varying value sizes (small and large mixed). The allocator cannot cleanly defrag.
- High churn: many small allocations and frees over time fragment the heap.
- Specifically: keys with TTLs that expire in random order leave gaps.

Mitigations:

- Enable active defragmentation (`activedefrag yes`). Redis runs a background defragmenter that moves objects to consolidate free space. CPU cost: ~5%.
- Restart Redis. Aggressive but effective: new process starts with clean memory layout. Plan failover; restart replica first, fail over, then restart the demoted primary.
- Audit value size distribution. If many sizes, consider normalizing (pad to power-of-two sizes) or using Memcached's slab approach for that specific workload.

Above 1.5 warrants investigation; above 2.0 is action-required.

**8. Cache stampede on key expiry.**

A popular key expires. 10K concurrent requests miss, hit the database, melt it.

Mitigations:

- Probabilistic early expiration. A small percentage of reads (well before the TTL) trigger a refresh. One client refreshes; others continue serving the old value. Spreads the refresh across the TTL window. Implementations: XFetch algorithm.
- Request coalescing. On miss, the client uses a per-key in-process lock. First request fetches and populates the cache; concurrent requests for the same key wait on the lock and read the populated value. Reduces 10K DB calls to 1.
- Stale-while-revalidate. Serve the expired value for a short grace window while one goroutine fetches the new value asynchronously. Application tolerates a few seconds of staleness in exchange for no stampede.
- Jittered TTLs (prevention). As above, prevents synchronized expiration.

All four together is the standard defense. None alone is sufficient at high request rates.

**9. Inconsistent read after write.**

User issues `SET balance 100`, then `GET balance`, gets the old value.

Most common cause: the GET went to a replica that has not yet received the write. Replication lag is typically <1 ms intra-AZ but can spike under load.

Other causes:

- The SET went to a shard that just failed over; the read goes to the new primary which has not yet received that write through replication. Failover with `min-replicas-to-write` would prevent this but at the cost of some availability.
- The client has a stale slot map and sent SET to one node and GET to another (briefly possible during resharding).

Fixes:

- Route both SET and GET to the primary when read-after-write consistency is required for that code path.
- Use a transaction or pipeline that keeps both commands on the same node.
- For cluster-wide guarantees, use `WAIT 1 timeout_ms` after the SET so it is acked by at least one replica before GET goes to a replica.
- Accept eventual consistency for caches (the common choice).

**10. Cache hit rate dropped from 95% to 60% overnight.**

Investigation order:

1. Eviction pressure. Check `evicted_keys_per_sec`. If high, the cache is full and evicting hot keys. Cause: working set grew (new feature, more users) or memory shrunk (replica added, RAM used by something else).
2. TTL change. Did someone shorten TTLs in a deploy? Even a small reduction can collapse hit rate on long-tail keys.
3. Key churn. Are app servers writing new keys at a higher rate? `DEBUG OBJECT` on samples, look at write rate trends. A code change writing a unique key per request (instead of a shared one) is a classic regression.
4. Cluster topology change. Did a node fail and is the cluster degraded? `CLUSTER INFO` will say. During degraded operation, redirects increase and some keys may be effectively missing.
5. Resharding. A migration that did not complete cleanly can leave slots half-owned. Symptoms: high `MOVED` rate in slowlog, application metrics showing redirect chains.
6. Application bug. Cache key construction changed (new prefix, version bump). The application is reading with a new key name and writing too. Existing keys are stranded.

Mid-level investigates eviction first. Senior also considers application changes and topology. Fastest signal is usually: did anything deploy? Has anyone changed Redis config? If both no, look at cluster state and application traffic patterns.

### 12. Trade-offs and what a senior would mention

- Memcached vs Redis. Memcached is simpler, multi-threaded per process (scales to all cores on a single box), and has lower memory overhead per key (slab allocator, no per-key encoding metadata). Redis is single-threaded per process and supports data structures, persistence, scripting, pub/sub, and cluster mode. Use Memcached when I want a pure KV cache with maximum density and the simplest operational model. Use Redis when I want any of: TTL, data structures, atomic counters, persistence, replication, cluster.
- Sharded client (twemproxy) vs cluster mode. Twemproxy and similar proxies sit between clients and a static set of Redis nodes; clients are dumb (talk to the proxy, which forwards). Pro: simple client. Con: no automatic failover, no live resharding. Cluster mode (smart client + gossip) handles both but requires a more capable client library. Cluster mode is the default modern choice for new deployments; proxies linger in legacy systems.
- Why single-threaded event loop, not multi-threaded. Avoids lock contention. Every command is atomic against the keyspace by construction. Trade: a single slow command stalls everything. The fix is operational discipline (cap value sizes, no `KEYS *`, watch slowlog). Redis 6+ added I/O threads (parses requests and writes responses in parallel) but command execution stays serial.
- Multi-region cache. Almost always wrong. Cache should be regional; the database (or its replication) handles multi-region durability. Cross-region cache replication adds latency and consistency headaches with little benefit for a layer that is supposed to be lossy by design.
- What I would revisit at 10x scale.
  - Move from a single large cluster to many smaller per-service clusters. Reduces blast radius and lets each service tune eviction, persistence, and replication independently.
  - Adopt a tiered cache (in-process LRU → regional Redis → DB) explicitly, with metrics at each tier.
  - For specific high-traffic keys, consider Memcached or a custom in-memory service. Redis's data structures are not needed for everything.
  - Re-evaluate hash slot count. 16384 was fine at 6-12 shards; at 100 shards, slots get smaller and migration is more granular.

### 13. Common interview mistakes

- "Redis stores things in memory." Yes, but the question is the cluster. Skip the intro; go to partitioning.
- Using modulo hashing. Falls apart on every cluster size change. Always say consistent hashing or hash slots.
- No mention of virtual nodes. Consistent hashing without vnodes gives uneven distribution. The interviewer waits for "vnodes" or "hash slots."
- Confusing expiration and eviction. TTL is per-key; eviction is global memory pressure. Different mechanisms, different policies.
- Recommending true LRU. Memory overhead for a doubly-linked list across 100M keys is significant. Approximated LRU is the right answer, and I should know why.
- Forgetting the hot key problem. Will be asked. In-process LRU plus replica reads is the standard answer.
- Forgetting the big key problem. Less often asked, but a sign of seniority if I bring it up unprompted. The phrase is "single-threaded event loop blocks on O(N) commands."
- Synchronous replication everywhere. Doubles latency for writes that almost never need it. Default async; opt into `WAIT` per-call.
- No persistence story. Even if the answer is "none," articulate the choice. The interviewer wants to hear I reasoned about it, not skipped it.
- Cache stampede handwave. "We'll use TTLs" is not enough. Mention jitter, request coalescing, stale-while-revalidate.

Hit 8 of these 10 and I am clearly above the bar. Consistent hashing, replication-and-failover narrative, eviction policy choice, and hot-key mitigation is the spine of a strong answer.
{% endraw %}
