---
concept_id: 24
slug: cache-strategies
title: "Cache strategies"
tease: "Aside, through, back, around. When each one fits."
section: "Caching"
status: live
---

There are four classic ways to wire an application, a cache, and the underlying data store together. They differ in who writes to the cache, when, and what happens on a cache miss. Cache-aside is the most common; the other three exist for specific reasons. Picking the wrong one is how teams end up with a cache that almost never hits, or a database that gets corrupted by stale writes.

## Cache-aside (also called lazy loading)

The application talks to the cache and the database separately. On a read, it checks the cache first. On a miss, it queries the database, fills the cache, and returns the value.

```mermaid
sequenceDiagram
    autonumber
    participant App as Application
    participant C as Cache
    participant DB as Database

    Note over App,DB: Read path — cache miss
    App->>C: GET product:42
    C-->>App: miss
    App->>DB: SELECT * WHERE id = 42
    DB-->>App: row
    App->>C: SET product:42 = row, TTL 60s
    App-->>App: return row

    Note over App,DB: Read path — cache hit (next reads)
    App->>C: GET product:42
    C-->>App: row
    App-->>App: return row

    Note over App,DB: Write path
    App->>DB: UPDATE products WHERE id = 42
    DB-->>App: ok
    App->>C: DELETE product:42  (or SET to new value)
```

This is by far the most common pattern. Redis, Memcached, and most in-process caches are used this way. The application is in charge: the cache is just a fast key-value store on the side.

**Strength.** Simple, robust. The cache and the database are decoupled; if the cache dies, the application still works (just slower).

**Weakness.** First read is always slow (cold miss). Every cached value is what the application chose to put there; consistency rules are entirely the application's job.

## Write-through

Every write goes to the cache first, and the cache writes through to the database synchronously. Reads always hit the cache.

```mermaid
sequenceDiagram
    autonumber
    participant App as Application
    participant C as Cache
    participant DB as Database

    Note over App,DB: Write path
    App->>C: SET product:42 = new value
    C->>DB: UPDATE products WHERE id = 42
    DB-->>C: ok
    C-->>App: ok

    Note over App,DB: Read path — always served from cache
    App->>C: GET product:42
    C-->>App: row
```

**Strength.** Cache and database are always in sync (no stale reads, no missing entries after a write).

**Weakness.** Every write is slower; the cache becomes a critical write path. If the cache is down, writes stop. Few real systems use this; it is more common as an internal pattern inside database engines or storage layers.

## Write-back (also called write-behind)

Writes go to the cache and are acknowledged immediately. The cache flushes them to the database asynchronously, in batches.

```mermaid
sequenceDiagram
    autonumber
    participant App as Application
    participant C as Cache
    participant DB as Database

    Note over App,DB: Write path
    App->>C: SET product:42 = new value
    C-->>App: ok (immediately)

    Note over C: collect writes for a few seconds
    C->>DB: batch UPDATE x, y, z
    DB-->>C: ok

    Note over App,C: Read path — served from cache (latest values)
    App->>C: GET product:42
    C-->>App: row
```

**Strength.** Very fast writes (returns before the database has acknowledged). Batches absorb write spikes.

**Weakness.** If the cache crashes before the flush, those writes are lost. Used inside CPU caches, some storage engines, and analytics pipelines where some data loss is tolerable. Rarely the right pattern for primary application data.

## Write-around

Writes go straight to the database and skip the cache entirely. Reads use cache-aside.

```mermaid
sequenceDiagram
    autonumber
    participant App as Application
    participant C as Cache
    participant DB as Database

    Note over App,DB: Write path — bypass cache
    App->>DB: UPDATE products WHERE id = 42
    DB-->>App: ok
    Note over C: Cache is untouched, may now be stale

    Note over App,DB: Read path — cache-aside
    App->>C: GET product:42
    C-->>App: miss (or stale)
    App->>DB: SELECT * WHERE id = 42
    DB-->>App: latest row
    App->>C: SET product:42 = row
```

**Strength.** Writes are unaffected by the cache. Good for write-heavy data that is rarely read soon after writing (audit logs, telemetry, batch ingest).

**Weakness.** The cache is stale until the next read repopulates it. Writes do not benefit from any cache layer.

## Picking the right one

```mermaid
flowchart TB
    Q1{"Do reads dominate by a wide margin?"}:::query
    A1["Cache-aside.<br/>Default choice for almost every application."]:::strong

    Q2{"Are writes very frequent<br/>and reads rare or delayed?"}:::query
    A2["Write-around.<br/>Avoid filling the cache with cold data."]:::mid

    Q3{"Do you need the cache and database<br/>to always agree on every write?"}:::query
    A3["Write-through.<br/>Slower writes, never-stale reads."]:::mid

    Q4{"Can you tolerate losing some<br/>recent writes to gain throughput?"}:::query
    A4["Write-back.<br/>Used inside engines, rarely for app data."]:::weak

    Q1 -->|"yes"| A1
    Q1 -->|"no"| Q2
    Q2 -->|"yes"| A2
    Q2 -->|"no"| Q3
    Q3 -->|"yes"| A3
    Q3 -->|"no"| Q4
    Q4 -->|"yes"| A4

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
```

Cache-aside covers something like 90% of real applications. Reach for the others when you have a specific reason: write-around for telemetry, write-through for "must always be consistent" scenarios with the cache in the critical path, write-back inside an engine you control.

## Two scenarios

**Scenario one: a product catalog page.**

Hot reads, cold writes. The product description changes a few times a week; the page is loaded thousands of times per minute. Cache-aside with a 60-second TTL. First request per product fills the cache; the next thousand are sub-millisecond.

**Scenario two: an audit log ingest.**

Millions of writes per minute. Almost no reads, and the reads happen days later for compliance. Write-around. Writes go straight to the database; no point filling the cache with rows nobody will read soon.

## What this connects to

- **Why cache.** The motivation for picking any pattern at all. See [Why cache and what to cache](/practice/system-design/concepts/023-why-cache-what-cache/).
- **Cache invalidation.** Every pattern has its own invalidation rules. See [Cache invalidation](/practice/system-design/concepts/026-cache-invalidation/).
- **Cache eviction.** Even the right strategy still needs to deal with a full cache. See [Cache eviction](/practice/system-design/concepts/025-cache-eviction/).
- **Idempotency.** Especially relevant in write-through and write-back where a retry could land in either the cache or the database. See [Idempotency](/practice/system-design/concepts/021-idempotency/).

## Common mistakes

- **Cache-aside without invalidation on write.** The classic stale-read bug. Always invalidate (or update) the cached entry when its underlying data changes.
- **Caching a value that is too large.** A 5 MB cached object means N copies for N instances. Cache the bare minimum.
- **Using write-back for primary data.** If the cache dies between the ack and the flush, those writes are gone. Acceptable for metrics, not for orders.
- **Treating the cache as durable storage.** Caches are best-effort. Plan for a flushed Redis.
- **Pretending the cache cannot fail.** A request path that crashes when the cache is down is too tightly coupled. Catch and fall back to the source on cache errors.

## Quick recap

- Cache-aside: application is in charge, default for almost everything.
- Write-through: cache writes synchronously to the database, always consistent, slower writes.
- Write-back: cache acks instantly, flushes async, fast but risky for primary data.
- Write-around: writes skip the cache, fine for write-heavy, rarely-read data.
- The right strategy depends on the read/write ratio and how much staleness you can tolerate.

This concept sits in **Stage 3 (Caching, queues, and async work)** of the [System Design Roadmap](/practice/system-design/roadmap/).
