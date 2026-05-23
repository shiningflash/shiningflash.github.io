---
layout: practice-problem
track: system-design
problem_id: 17
title: Design a Read-Heavy System (Patterns Walkthrough)
slug: 017-read-heavy-patterns
category: Patterns
difficulty: Easy
topics: [caching, read replicas, cdn, materialized views, denormalization]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/017-read-heavy-patterns"
solution_lang: markdown
---

{% raw %}
## Scene

You sit down. The interviewer slides a sketch across the desk.

> *"I have a service that serves a product catalog. Today: 100 users, a single Postgres, everything works. The P95 for a product page is 30ms. Our PM just told me we are about to onboard 100,000 users from a partner deal. Reads are 100 times writes. What do you do, in order?"*

They pause. "Walk me through the read path as it scales. Name what breaks first, name the fix, and tell me when *not* to apply each fix."

This is the most common shape of a "scale this" interview. The interviewer is not looking for a final architecture. They are looking for whether you reach for caching before you understand the read pattern, whether you add Redis before you know if a CDN would do the same job for less money, and whether you know the difference between a replica that helps read latency and a replica that just moves the problem.

The point of the question is the toolkit: browser cache, CDN, edge cache, in-process cache, distributed cache, read replicas, materialized views, denormalization. And the *order* in which you apply them.

## Step 1: clarify before you scale anything

Take 5 minutes. The scenario sounds well-defined, but it is not. You need numbers before you reach for tools.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Read latency target.** "What is the P95 the user actually feels? 30ms today, but what is acceptable at 100k users? 50ms? 100ms?" If the target is 200ms you can solve a lot with one Redis. If it is 20ms globally, you need a CDN.
2. **Freshness tolerance.** "When a product price changes, how stale can a viewer's price be? 1 second? 60 seconds? 5 minutes?" This decides cache TTL, invalidation strategy, and whether read replicas are acceptable.
3. **Read pattern.** "Is every request a lookup by product ID? Or are there list queries (category browse), search queries (full-text), filter queries (price range)?" Lookup by ID caches well. Full-text search needs a separate index. Filters need a different denormalization.
4. **Read distribution.** "Is the traffic uniform across products, or does 1% of products get 90% of views?" Zipf distribution makes caching trivial. Uniform distribution makes caching almost useless.
5. **Geographic distribution.** "Are users in one country or spread across continents?" Same-region: skip CDN, use Redis. Global: CDN is the cheapest latency win you can buy.
6. **Personalized vs shared content.** "Does every user see the same product page? Or do we show user-specific pricing, recommendations, stock-near-you?" Shared content caches at the CDN. Personalized content cannot.
7. **Write pattern.** "Is the 100x read-to-write ratio uniform, or are writes bursty (nightly batch import of 1M products)?" Bursty writes break cache invalidation strategies that assume a steady trickle.
8. **Consistency requirement per endpoint.** "Is the product page allowed to be stale, but the checkout price must be exact?" Different endpoints get different cache TTLs (or no cache at all).

A common junior mistake: starting with "add Redis." You don't know yet whether Redis is the right tool. The CDN might do 90% of the work. The in-process cache might do the other 9%. Redis might never be needed.

</details>

## Step 2: capacity

The interviewer tells you:

- 100,000 users active per day.
- Each user makes ~50 reads per session (browse + view + filter).
- Reads are 100x writes.
- Catalog: 1M products. Each product ~5KB JSON.
- Read latency target: P95 < 50ms.
- Freshness: 60 seconds is fine for price; stock count can be 5 minutes stale; product description is essentially immutable.
- Traffic distribution: roughly Zipf. Top 10k products serve ~80% of reads.

Compute, on paper, before revealing:

1. Reads per second sustained and peak.
2. Writes per second sustained and peak.
3. Working-set size for the hot 80%.
4. Cache hit rate required to keep DB load under 200 QPS.
5. Bandwidth if every read returns 5KB.

<details>
<summary><b>Reveal: the math</b></summary>

**Reads per second.**
100k users × 50 reads = 5M reads/day. 5M / 86400 ≈ 58 reads/sec sustained. Peak typically 5x sustained for consumer traffic, call it ~300 reads/sec peak.

**Writes per second.**
58 / 100 = 0.58 writes/sec sustained. ~3 writes/sec peak. Trivially small. The catalog is updated by a few admins, not by users.

**Hot working set.**
Top 10k products × 5KB = 50MB. Easily fits in a single Redis node, in-process LRU, or even browser cache for repeat visitors.

**Required cache hit rate.**
Goal: DB stays under 200 QPS even at peak (300 reads/sec). DB serves the misses. Required hit rate = 1 - (200/300) = 33% at minimum to stay under DB capacity. In practice you target 80-95% hit rate so the DB has headroom. With Zipf 80/20 traffic and a cache covering the top 10k products, 80%+ hit rate is the default outcome with TTL of a few minutes.

**Bandwidth.**
300 reads/sec × 5KB = 1.5 MB/sec = 12 Mbps. Negligible at the origin. At the CDN, it scales out per POP. No bandwidth pressure anywhere.

**Key insight.** This is a textbook read-heavy system with a small hot set and a low absolute QPS. Almost any caching scheme works. The interview is not about whether to cache; it is about *which layer* to cache at, in what order, and why.

</details>

## Step 3: the caching pyramid

Before you draw any architecture, draw the layers. A read request, on its way from the user's browser to the database, passes through up to six tiers of cache. Each one is roughly 10x faster than the one below it. Each one also requires invalidation and capacity planning.

Sketch the six layers from fastest to slowest. For each, name where it lives, what it stores, and how it gets invalidated.

<details>
<summary><b>Reveal: the six tiers</b></summary>

```
Layer                    Where it lives         Round-trip      Storage
─────                    ──────────────         ──────────      ───────
1. Browser cache         User's browser         0ms (no net)    HTTP cache, IndexedDB, service worker
2. CDN edge cache        100s of POPs globally  5-30ms          Static files, cacheable HTTP responses
3. App in-process cache  RAM on the app server  <1ms (local)    LRU map, no network hop
4. Distributed cache     Redis/Memcached cluster 1-5ms          Shared key/value
5. DB shared buffer      RAM on the DB host     1-10ms          Hot pages in Postgres shared_buffers
6. Database disk         Disk on DB host        10-50ms         The source of truth
```

**Speed differences (rough numbers):**

- Browser cache: instant, but only helps a repeat visitor on the same device.
- CDN edge: 5-30ms because the POP is geographically near the user.
- In-process: sub-millisecond because no network hop, just RAM access.
- Distributed (Redis): 1-5ms within the same datacenter.
- DB query cache (shared buffer): 1-10ms when the page is hot.
- DB disk: 10-50ms for SSDs, more for indexes that overflow buffer.

**The pattern: try the fastest layer first; on miss, fall through.**

```
Request
  │
  ▼
Browser cache hit? ──yes──► serve, done (0ms)
  │ no
  ▼
CDN edge hit? ──yes──► serve, done (5-30ms)
  │ no
  ▼
App in-process hit? ──yes──► serve, populate CDN (<1ms)
  │ no
  ▼
Redis hit? ──yes──► serve, populate in-process (1-5ms)
  │ no
  ▼
Read replica? ──yes──► serve, populate Redis (10-30ms)
  │ no (replica lag, replica down)
  ▼
Primary DB ──► serve, populate replica naturally (30-50ms)
```

**Each layer has the same three concerns:**

1. **What goes in it.** Not all data is cacheable. Personalized responses cannot go in a CDN. Mutable counters do not belong in long-TTL caches.
2. **How long it lives.** TTL is the cheapest invalidation. Pub/sub invalidation is the most accurate. Write-through is the most consistent.
3. **How big it is.** Browser cache is bounded by the user's disk quota. CDN is paid by GB-month. Redis is paid by RAM. In-process is bounded by your app server's RAM.

**Which layers you skip:**

- **Browser cache:** always on for static assets. Skipped for dynamic API responses unless you set explicit cache headers.
- **CDN:** skip if every response is personalized. Use for catalog pages, product images, search results that do not vary by user.
- **In-process:** skip if your fleet has 1000+ pods (cache locality is poor; same key may be cached in 1000 places, hard to invalidate). Use for fleets of 10-50 pods.
- **Distributed cache:** the workhorse. Almost always present at scale. Skip only at toy scale (<100 QPS).
- **DB query cache:** you do not control this directly. Tune `shared_buffers` to fit your hot working set.
- **Database:** never skipped. It is the source of truth.

</details>

## Step 4: sketch the read-path architecture

Here is an intentionally incomplete diagram. Fill in the five `[ ? ]` placeholders. Each marks a caching tier or a routing decision. Hint: think about where the user's request first touches a server, what sits between the app and the database, and what handles personalized content differently from cacheable content.

```
                     User browser
                          │
                          ▼
                  ┌───────────────┐
                  │  [ ? 1 ]      │  (geographically distributed; caches
                  │               │   GET responses with Cache-Control)
                  └───────┬───────┘
                          │  cache miss
                          ▼
                  ┌───────────────┐
                  │  Load Balancer│
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  App Server   │
                  │  ┌─────────┐  │
                  │  │ [ ? 2 ] │  │  (RAM on the server,
                  │  │         │  │   sub-millisecond)
                  │  └─────────┘  │
                  └───┬───────┬───┘
                      │       │
            on miss   │       │ on miss of miss
                      ▼       │
              ┌─────────────┐ │
              │  [ ? 3 ]    │ │  (cluster, shared across pods)
              └─────────────┘ │
                              │
                              ▼
                      ┌───────────────┐
                      │  [ ? 4 ]      │  (read traffic only;
                      │               │   async replicated)
                      └───────┬───────┘
                              │  writes only
                              ▼
                      ┌───────────────┐
                      │  [ ? 5 ]      │  (single source of truth;
                      │               │   accepts writes)
                      └───────────────┘
```

<details>
<summary><b>Reveal: complete read-path architecture</b></summary>

```
                     User browser
                          │
                          │ (browser HTTP cache hits here first;
                          │  not shown but always present)
                          ▼
                  ┌───────────────┐
                  │      CDN      │  CloudFront / Fastly / Cloudflare.
                  │  (edge POPs)  │  Caches GET responses with
                  │               │  Cache-Control: public, max-age=N.
                  └───────┬───────┘  ~80% of reads end here.
                          │  cache miss
                          ▼
                  ┌───────────────┐
                  │  Load Balancer│  ALB / Envoy / nginx. Stateless.
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  App Server   │  Stateless. Horizontal.
                  │  ┌─────────┐  │
                  │  │ LRU in- │  │  Per-pod RAM map. 10-50 MB.
                  │  │ process │  │  Hit: sub-ms. No network.
                  │  │ cache   │  │  Eviction: LRU.
                  │  └─────────┘  │
                  └───┬───────┬───┘
                      │       │
            on miss   │       │ on miss
                      ▼       │
              ┌─────────────┐ │
              │   Redis     │ │  Cluster, 1-5ms. Shared across
              │  (cluster)  │ │  all app pods. ~10 GB hot set.
              └──────┬──────┘ │
                     │ on miss│
                     ▼        │
                      ┌───────────────┐
                      │ Read Replicas │  Postgres async replicas.
                      │  (Postgres)   │  Replication lag ~1s P99.
                      │               │  Routed by region.
                      └───────┬───────┘
                              │  writes only
                              ▼
                      ┌───────────────┐
                      │   Primary DB  │  Postgres single primary.
                      │  (Postgres)   │  Accepts all writes.
                      │               │  Source of truth.
                      └───────────────┘
                              │
                              │ change events (CDC, Debezium, or pub/sub)
                              ▼
                      ┌───────────────┐
                      │  Invalidator  │  Listens to writes, publishes
                      │   service     │  cache-purge events to Kafka.
                      └───────────────┘
                              │
                              ▼
                      Redis pub/sub channel; app pods subscribe
                      and evict their in-process entries. CDN
                      receives purge API calls for hot keys.
```

Why each piece is here:

- **CDN.** Cheapest read latency improvement available. Responses with `Cache-Control: public, max-age=60` cache automatically at the edge. Most catalog reads never reach the origin.
- **Load balancer.** Stateless. Distributes to healthy app pods.
- **App with in-process LRU.** Top 1000 hottest keys live in app RAM. Zero network. The win is enormous for the top-N skew.
- **Redis cluster.** Shared across all app pods. Catches the next 10-100k keys that don't fit in any one pod's local RAM. Invalidatable via pub/sub.
- **Read replicas.** Reads that miss all caches go to a regional read replica, not the primary. Replication is async; ~1s lag is typical and acceptable.
- **Primary DB.** Accepts writes. Source of truth.
- **Invalidator.** When the catalog changes (price update), it publishes to a pub/sub topic. App pods drop their local entries. The CDN gets a purge API call for affected URLs.

</details>

## Step 5: read replicas

A read replica is a copy of the database that accepts only reads. The primary takes writes; the replica streams the WAL (write-ahead log) and applies it. Reads route to the replica, freeing the primary.

Three things to know:

1. **Replication is async.** A write committed on the primary is *not yet visible* on the replica. Typical lag: 10-500ms; can spike to seconds under load.
2. **Read-your-writes problem.** A user submits a form (write to primary), then refreshes (read from replica). The replica may not have the write yet. The user sees stale data.
3. **Replica routing.** Most apps route reads to replicas by default and writes to the primary. Some queries need stronger consistency and must go to the primary even on reads.

Sketch: when do you add a replica? How many? How do you route reads vs writes? How do you handle the read-your-writes case?

<details>
<summary><b>Reveal: replica strategy</b></summary>

**When to add a replica.**

Add the first replica when:
- Read QPS on the primary exceeds 50% of its capacity, *or*
- Read latency on the primary degrades because writes are competing for IOPS, *or*
- You need a failover target.

Add more replicas when:
- Reads on the existing replicas exceed 50% of capacity, *or*
- You need a replica per geography for latency.

Typical numbers: 1 primary + 2 replicas for redundancy; 1 primary + N replicas (N per region) for global apps.

**Don't add replicas when:**

- Your DB is bottlenecked on writes. Replicas do not help writes; they amplify them (every write is replicated to every replica).
- Your cache hit rate is already 95%+. The DB barely sees traffic; replicas are wasted spend. Fix the cache, not the DB.
- Your queries are slow because of bad indexes or bad query plans. Replicating bad queries just spreads the pain.

**Routing.**

```
Read request → was a write made by this user in the last 5 seconds?
  yes → route to primary  (read-your-writes guarantee)
  no  → route to replica  (cheap, async OK)

Write request → always primary.

Specific endpoints (checkout total, account balance) → always primary.
Browse endpoints (product list, category page) → always replica.
```

The "5 second pin" is a common pattern. After a user writes, their next reads go to the primary for a short window. Implemented via a session cookie (`pin_to_primary_until=<timestamp>`) or a request header. After the window passes, replica routing resumes.

**Replica lag monitoring.**

- Track `replication_lag_seconds` per replica. P99 should be under 1s.
- Alert at >5s; page at >30s.
- If lag exceeds your read-your-writes window, you have a correctness bug. Fix lag (more IOPS, faster replication) or increase the pin window.

**Replica failure.**

- If a replica falls behind, route around it. Most connection pools (pgbouncer, RDS Proxy) support this.
- If all replicas are gone, fall back to primary. Accept the load increase as a temporary degradation; alert loudly.

</details>

## Step 6: denormalization and materialized views

Sometimes caching is not enough. The query itself is expensive: a 4-table JOIN that recomputes for every request, an aggregate that scans millions of rows, a search that needs full-text matching.

Two patterns precompute the answer so the read serves a flat lookup:

- **Denormalization.** Fold the result of a JOIN into a single wider table. Update it on writes (via trigger or CDC).
- **Materialized views.** A query whose result is stored, like a cached query result. Refreshed on a schedule or on demand.

When do you reach for these? How do they interact with the caching pyramid?

<details>
<summary><b>Reveal: when to denormalize vs materialize</b></summary>

**The normalized version (slow):**

```sql
-- Three-table JOIN, runs on every product page view.
SELECT
  p.product_id, p.name, p.description,
  c.category_name,
  AVG(r.rating) AS avg_rating,
  COUNT(r.review_id) AS review_count
FROM products p
JOIN categories c ON c.category_id = p.category_id
LEFT JOIN reviews r ON r.product_id = p.product_id
WHERE p.product_id = ?
GROUP BY p.product_id, c.category_name;
```

This runs on every page view. Even cached, the cache miss path is slow (200-500ms for popular products with many reviews).

**The denormalized version:**

```sql
CREATE TABLE product_view (
    product_id     BIGINT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL,
    category_name  TEXT NOT NULL,       -- denormalized from categories
    avg_rating     NUMERIC(2,1),         -- precomputed
    review_count   INTEGER,              -- precomputed
    last_updated   TIMESTAMPTZ
);
```

The read is now a single-row lookup by PK. <1ms even uncached.

**How to keep it fresh:**

1. **Triggers.** On write to `products`, `categories`, or `reviews`, a Postgres trigger recomputes `product_view` for the affected `product_id`. Simple but couples writes; slow writes.
2. **CDC stream.** Debezium or similar reads the WAL, publishes change events to Kafka. A consumer recomputes `product_view`. Async; writes stay fast.
3. **Scheduled refresh.** A nightly job recomputes the whole table. Coarse; accepts up to 24h staleness. Fine for cold data (last month's aggregates) but not for live catalog.

**Materialized views (Postgres feature):**

```sql
CREATE MATERIALIZED VIEW top_products_by_category AS
SELECT category_id, product_id, view_count
FROM product_views
WHERE view_count > 1000
ORDER BY view_count DESC;

REFRESH MATERIALIZED VIEW CONCURRENTLY top_products_by_category;
```

- Stored physically, like a table. Indexes work normally.
- `REFRESH` re-runs the underlying query. Can be expensive if the view is large.
- `CONCURRENTLY` lets reads continue during refresh.
- Best for analytics-shaped queries that are read frequently and updated rarely.

**When to denormalize vs materialize:**

| Scenario | Choice |
|----------|--------|
| Single-row lookup that joins 3 tables, frequently updated | Denormalize with CDC |
| Aggregate across millions of rows, updated nightly | Materialized view with REFRESH on schedule |
| Search across all products | Separate search index (Elasticsearch / Postgres FTS), not a view |
| Per-user feed | Neither; this is a different problem (see Problem 002) |
| Top-N leaderboard | Materialized view refreshed every minute |

**Trade-off: write amplification.**

Denormalization makes reads faster and writes slower. Every write to `products` triggers a recompute (or invalidation) of `product_view`. At 100x read-to-write ratio this is a clear win. At 10x or less, reconsider.

**Where this fits in the pyramid.**

Denormalized tables are a layer *below* the cache. The cache still caches the result. The denormalization makes the cache miss path fast. Without denormalization, a cache miss costs 200ms. With denormalization, a cache miss costs 5ms. Both layers compound.

</details>

## Step 7: when cache invalidation becomes the hardest problem

Cache invalidation is the famous one. Phil Karlton's quote: "There are only two hard things in computer science: cache invalidation and naming things."

Four patterns:

1. **TTL.** Each cache entry expires after N seconds. Simple. Tolerates up to N seconds of staleness.
2. **Write-through.** On every write, update the cache too. Cache is always consistent with the DB. Writes are slower.
3. **Write-behind.** On every write, update the cache; queue the DB write asynchronously. Writes are fast. Risk: queue loss = data loss.
4. **Event-driven invalidation.** Writes publish events to a pub/sub. Caches subscribe and evict affected keys.

Sketch when to use each.

<details>
<summary><b>Reveal: invalidation patterns and when each fits</b></summary>

**1. TTL.**

```
SET product:42 "{json}" EX 60     # Redis: expires in 60 seconds.
```

- Use when: staleness is acceptable up to the TTL.
- Simplest, most operationally predictable.
- The TTL is the staleness contract with the user.
- Add jitter (±10% of TTL) to prevent synchronized expiry causing thundering herd.

Example fit: product catalog with 60s TTL. Price changes are visible within a minute. Acceptable for browse; not for checkout.

**2. Write-through.**

```
def update_product(p):
    db.update(p)        # write to DB
    cache.set(p)        # then update cache
```

- Use when: read consistency matters and writes are infrequent.
- Cache is always consistent (modulo race conditions; see "stale write" gotcha).
- Writes are slower (now two operations).

The race: two writers. Writer A writes value 5 to DB, then writer B writes value 7 to DB, then writer A writes value 5 to cache, then writer B writes value 7 to cache. Cache ends up with 7 (correct). But: A writes DB(5), B writes DB(7), B writes cache(7), A writes cache(5). Cache ends with 5; DB has 7. *Inconsistent.*

Mitigation: use cache aside (write-around), or version the cache writes (only update cache if your version is newer).

Example fit: a config service where writes are rare and reads must reflect the latest config immediately.

**3. Write-behind.**

```
def update_product(p):
    cache.set(p)              # update cache first
    queue.publish(p)          # async DB write
```

- Use when: writes are very frequent and durability is acceptable to lose.
- Risk: queue loss = data lost from the source of truth.
- Often used for counters (page views, like counts) where exact accuracy is less important than throughput.

Example fit: increment a "view count" on every page load. Buffer increments in Redis, flush to DB every minute. Acceptable to lose a few seconds of view counts if Redis dies.

**4. Event-driven invalidation.**

```
def update_product(p):
    db.update(p)
    kafka.publish("product.updated", {"product_id": p.id})

# Subscribers (every app pod):
def on_product_updated(event):
    in_process_cache.evict(event.product_id)
    redis.delete(f"product:{event.product_id}")
    cdn.purge(f"/products/{event.product_id}")
```

- Use when: you have multiple cache layers that all need invalidating.
- More accurate than TTL; staleness is bounded by event-propagation latency (<1s).
- Operationally more complex; requires a pub/sub system.

Example fit: a price change must propagate to in-process caches on 50 app pods, Redis, and the CDN within seconds. TTL would take up to a minute (the full TTL). Event-driven gets it within seconds.

**The right answer is usually a mix:**

- TTL as the safety net (caps staleness even if the event system fails).
- Event-driven invalidation as the primary path (fast and accurate).
- Write-through only for specific endpoints where read consistency is non-negotiable.
- Write-behind only for fire-and-forget counters.

**The CDN twist.**

CDN invalidation is slow (seconds to minutes) and not free. Two approaches:

- **Versioned URLs.** Instead of `/products/42`, serve `/products/42?v=17` where `v` is the version number. On update, bump the version. Old URL stays cached but never requested again. New URL is uncached, fetched fresh. Effectively instant invalidation.
- **Purge API.** Call CloudFront/Fastly purge endpoint with the affected URL. Takes 5-30 seconds to propagate. Free at low volume, paid at high volume.

For a catalog: versioned URLs for product pages; purge API for hot pages where you must drop the old version immediately (legal takedown, mispriced item).

</details>

## Follow-up questions

Try answering each in 2 to 4 sentences before reading the solution.

1. **Cache stampede.** A popular product's cache entry expires at exactly the moment 1000 users hit refresh. They all miss; they all hit the DB. The DB CPU spikes; some requests time out. What patterns prevent this?

2. **Cache fallback when Redis is down.** Your Redis cluster is unreachable for 10 minutes. Every read is now a cache miss. What does the app do? Does it just slam the DB? How do you survive this gracefully?

3. **Personalized pages and the CDN.** Your product page now shows "recommended for you" based on browsing history. You cannot cache the page at the CDN anymore. What changes? Can you still cache *parts* of the page?

4. **Read-your-writes.** A user updates their profile and refreshes immediately. The replica has not yet applied the write; they see their old name. How do you fix this without sending all reads to the primary?

5. **Hot key in Redis.** One specific product key gets 10,000 req/s. Redis is a single-threaded server; that key's shard pegs at 100% CPU while others sit idle. What do you do?

6. **CDN cache miss thundering herd.** A new product launches. 100,000 users hit the launch page at the same second. None of them hit the CDN cache. They all hit the origin. How do you survive this?

7. **Cache key design.** You cache `product:42`. Then you add a feature where staff users see internal pricing. Should you cache `product:42:staff` separately? `product:42:role:<role>`? What's the trade-off?

8. **Replication lag spike during a backfill.** You import 10M products overnight. Replication lag balloons to 5 minutes. Reads-from-replica start serving very stale data. What do you do during the backfill?

9. **Cache size estimation.** You have 1M products at 5KB each = 5GB. Your Redis node has 8GB of RAM. Is that enough? What do you forget when sizing?

10. **The endpoint that should never be cached.** Inventory count must be exact at checkout (we cannot oversell). Everything else (browse, search, recommendation) can be cached. How do you enforce "this endpoint must always hit the source of truth" across a team of 30 engineers?

## Related problems

- **[URL Shortener (001)](../001-url-shortener/question.md)**. The canonical read-heavy system. A single shortcode mapping cached in front of a key-value lookup. The hot-key problem, the cache miss thundering herd, and the CDN strategy all show up there.
- **[Distributed Cache (009)](../009-distributed-cache/question.md)**. The Redis layer of this design, in depth. Eviction policies, replication, hot-key handling, and consistency models.
- **[News Feed (002)](../002-news-feed/question.md)**. The personalized read-heavy case. The CDN-friendly catalog approach in this problem does not work for feeds; that one needs precomputed timelines per user, which is its own architecture.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Read-Heavy System (Patterns Walkthrough)

### TL;DR

A read-heavy system at the scale most products see (100x reads to writes, small hot set, Zipf-distributed traffic) is solved by stacking caches in front of the source of truth. Each layer of cache is roughly 10x faster than the one below, and each handles a different fraction of the traffic: the CDN catches the global, shared, cacheable responses; the in-process LRU catches the top-N hottest keys per pod; Redis catches the warm tail across all pods; read replicas catch the cold cache misses; the primary DB serves writes and a tiny fraction of reads.

The non-obvious work is in three places. First, knowing when *not* to add a layer (an in-process cache hurts when you have 1000 pods; a CDN is useless if every response is personalized). Second, invalidation: TTL is the safety net, event-driven pub/sub is the primary path, write-through is for the few endpoints where reads cannot be stale. Third, the failure modes: cache stampede on cold-miss-of-hot-key, hot-key shard saturation in Redis, read-your-writes when reads are routed to replicas, and graceful fallback when the cache itself dies.

The scaling journey is short. Most read-heavy systems never need more than: a CDN, a Redis cluster, two read replicas, and a denormalized view table for the most expensive queries. Past that, the answers become regional (per-region Redis, per-region replicas), and the failure modes become the new design problem.

### 1. Clarifying questions and why each matters

Covered in question.md. The four most decision-shaping questions:

- **Freshness tolerance.** Sets TTL. Without this number, every other choice is a guess.
- **Read pattern.** Lookup by ID caches trivially. Filter-by-attribute does not (cache key explosion). Full-text search needs a separate index.
- **Read distribution.** Zipf means caching wins. Uniform means caching barely helps.
- **Personalization.** Shared responses cache at the CDN. Personalized responses cannot.

The biggest junior mistake is jumping to "Redis" without first asking whether the requests are even cacheable. A catalog page is cacheable. A user-specific cart is not. The same Redis instance handles both, but the strategy is different.

### 2. Capacity estimates

From question.md:

- 100k users × 50 reads/session = 5M reads/day = **58 reads/sec sustained, ~300 reads/sec peak**.
- 0.58 writes/sec sustained, ~3 writes/sec peak. Trivial.
- 1M products × 5KB = 5GB total catalog.
- Top 10k products (1% of catalog) serve ~80% of traffic. Hot working set: **50MB**.
- DB target: stay under 200 QPS. Required cache hit rate: **~33% minimum**, target **80-95%**.

This is small. The architecture is not about throughput; it is about latency, geographic spread, and graceful degradation.

### 3. API design

A typical read-heavy service has three kinds of endpoints, each with a different caching strategy.

**A. Cacheable read (catalog page).**

```
GET /api/v1/products/42
Cache-Control: public, max-age=60, stale-while-revalidate=300

Response:
{
  "product_id": 42,
  "name": "Headphones",
  "price_cents": 4999,
  "currency": "USD",
  "description": "...",
  "image_url": "https://cdn.example.com/p/42.jpg",
  "avg_rating": 4.6,
  "review_count": 1284,
  "category": "Electronics > Audio"
}
```

- `Cache-Control: public, max-age=60`: CDN and browser cache for 60 seconds.
- `stale-while-revalidate=300`: serve stale up to 5 minutes while refreshing in background. Hides cache misses from users.
- ETag and `If-None-Match` for 304 responses on conditional GETs.

**B. Personalized read (user-specific data).**

```
GET /api/v1/products/42/personalized
Cache-Control: private, max-age=30
Vary: Authorization

Response:
{
  "product_id": 42,
  "your_last_viewed": "2026-05-22T10:11:00Z",
  "personalized_price_cents": 4499,    # member discount
  "in_your_wishlist": true
}
```

- `Cache-Control: private`: do not cache at CDN, only at browser.
- `Vary: Authorization`: explicit signal that response depends on user.
- Short TTL because the user expects this to feel "live."

**C. Strong-read endpoint (checkout total).**

```
GET /api/v1/cart/total
Cache-Control: no-store
X-Read-Consistency: strong

Response:
{
  "subtotal_cents": 9998,
  "tax_cents": 800,
  "total_cents": 10798,
  "computed_at": "2026-05-22T10:15:34Z"
}
```

- `Cache-Control: no-store`: never cache, anywhere.
- `X-Read-Consistency: strong`: hint to the routing layer to send this to the primary, not a replica.
- Caller can rely on the price being exact.

**The three endpoints share a code base but route through different cache tiers.** A junior mistake is to slap a uniform cache on everything; you end up caching the cart total and overcharging or undercharging customers.

### 4. Data model

The data model for a read-heavy system has two halves: the normalized source-of-truth tables (small, write-side schema), and the denormalized read-side views (wider, optimized for read patterns).

```sql
-- Source of truth: normalized.
CREATE TABLE products (
    product_id      BIGINT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    category_id     BIGINT REFERENCES categories(category_id),
    price_cents     INT NOT NULL,
    currency        CHAR(3) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version         INT NOT NULL DEFAULT 1            -- bumped on every write
);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_updated ON products (updated_at);

CREATE TABLE categories (
    category_id     BIGINT PRIMARY KEY,
    category_name   TEXT NOT NULL,
    parent_id       BIGINT REFERENCES categories(category_id)
);

CREATE TABLE reviews (
    review_id       BIGINT PRIMARY KEY,
    product_id      BIGINT REFERENCES products(product_id),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reviews_product ON reviews (product_id);

-- Read-side: denormalized for the product page.
CREATE TABLE product_view (
    product_id      BIGINT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    category_name   TEXT NOT NULL,                    -- denormalized
    category_path   TEXT NOT NULL,                    -- "Electronics > Audio > Headphones"
    price_cents     INT NOT NULL,
    currency        CHAR(3) NOT NULL,
    avg_rating      NUMERIC(2,1),                     -- precomputed
    review_count    INT NOT NULL DEFAULT 0,           -- precomputed
    version         INT NOT NULL,                     -- from products.version
    refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Materialized view: top products per category.
CREATE MATERIALIZED VIEW top_products_per_category AS
SELECT
    p.category_id,
    p.product_id,
    p.name,
    COUNT(DISTINCT v.user_id) AS distinct_viewers_30d
FROM products p
JOIN product_views v ON v.product_id = p.product_id
WHERE v.viewed_at > NOW() - INTERVAL '30 days'
GROUP BY p.category_id, p.product_id, p.name
ORDER BY p.category_id, distinct_viewers_30d DESC;

CREATE UNIQUE INDEX idx_top_products ON top_products_per_category (category_id, product_id);
```

**Cache key shapes:**

| Key | Value | TTL | Invalidated by |
|-----|-------|-----|----------------|
| `product:{id}:v{ver}` | full product JSON | 1h | URL is versioned; new version replaces |
| `product:{id}` | full product JSON | 60s | TTL + pub/sub event |
| `category:{id}:top:v{ver}` | top product IDs list | 5min | TTL + nightly refresh |
| `search:{normalized_query}:p{page}` | result page | 5min | TTL only |
| `user:{uid}:cart` | cart contents | 5min | write-through on cart update |
| `user:{uid}:pinned_until` | timestamp | 5s | TTL only |

**Why version the key.** When a product's price changes, we bump `products.version`. Cached reads use the old key; new reads use the new key. The old key expires naturally. No explicit purge needed for that key. The CDN URL is `?v={ver}` for the same reason.

**Why include the version in the value too.** Lets the app detect stale cache writes ("I have v3 in cache, the DB has v5; my cache is stale, evict and refresh").

### 5. Core algorithm: when to apply each pattern, in order

The order of operations as the system grows. This is the lesson of the problem.

**Order of application:**

1. **HTTP cache headers and a CDN.** Cheapest. Often free up to a tier. Catches the largest fraction of cacheable traffic.
2. **Distributed cache (Redis).** Next-cheapest. Catches per-key lookups that the CDN cannot (because the CDN caches at URL granularity, not key granularity, and personalized URLs blow up the cache).
3. **Read replicas.** When the primary's read load is causing write latency to suffer. Not before.
4. **In-process LRU.** When the top-N hot keys are saturating Redis (hot key problem) or when you want sub-millisecond reads for the hottest items.
5. **Denormalization / materialized views.** When the *cache miss path* is too slow because the underlying query is expensive (multi-table JOIN, aggregate over millions of rows).
6. **Per-region everything.** When latency targets cannot be met from a single region.

**Anti-order (what *not* to do, in order of how badly it fails):**

1. Add Redis before knowing if the responses are cacheable.
2. Add read replicas before checking cache hit rate. (If hit rate is 5%, fixing it is better than adding replicas.)
3. Denormalize aggressively before measuring query time. (Premature write amplification.)
4. Build per-region from day one. (Most apps never need it.)
5. Build a custom cache when Redis or memcached would do.

**Decision tree at each stage:**

```
Question: which layer do I add next?

Is read latency too high?
  ├── Is it geographic (users far from origin)?         → CDN
  ├── Is it because every request hits the DB?          → Redis
  ├── Is it because cache misses are slow?              → Denormalize
  └── Is it because Redis is overloaded on one key?     → In-process LRU
       OR is Redis itself the bottleneck?               → Read replica + Redis shard

Is the DB CPU too high?
  ├── Is the primary handling reads it shouldn't?       → Read replica
  ├── Are queries slow due to bad indexes?              → Fix indexes (not a caching problem)
  └── Are writes too frequent for the cache to help?    → Write-behind for non-critical, accept

Is the cache hit rate low?
  ├── Are TTLs too short?                               → Increase TTL within freshness budget
  ├── Is the hot set bigger than cache memory?          → Bigger cache, or different cache key shape
  └── Is the workload uniform (no Zipf)?                → Caching won't help; rethink the problem
```

### 6. Architecture diagram: full read path

```
                              User browser
                                   │
                                   │  (1) browser HTTP cache check
                                   ▼
                          ┌─────────────────┐
                          │  Browser cache  │  hit? → done
                          └────────┬────────┘
                                   │ miss
                                   ▼
                          ┌─────────────────┐
                          │     CDN POP     │  CloudFront / Fastly / Cloudflare.
                          │   (regional)    │  Cache-Control: public, max-age=60.
                          │                 │  hit? → done (~10ms)
                          └────────┬────────┘
                                   │ miss (or no-cache header)
                                   ▼
                          ┌─────────────────┐
                          │ Origin LB       │  Routes to nearest healthy region.
                          └────────┬────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
        ┌──────────┐         ┌──────────┐         ┌──────────┐
        │  Region  │         │  Region  │         │  Region  │
        │  us-east │         │  eu-west │         │  ap-south│
        │          │         │          │         │          │
        │ ┌──────┐ │         │ ┌──────┐ │         │ ┌──────┐ │
        │ │  LB  │ │         │ │  LB  │ │         │ │  LB  │ │
        │ └──┬───┘ │         │ └──┬───┘ │         │ └──┬───┘ │
        │    │     │         │    │     │         │    │     │
        │ ┌──▼─────┐         │ ┌──▼─────┐         │ ┌──▼─────┐
        │ │ App    ││         │ │ App    ││         │ │ App    ││
        │ │ pod 1  ││         │ │ pod 1  ││         │ │ pod 1  ││
        │ │ ┌─LRU─┐││         │ │ ┌─LRU─┐││         │ │ ┌─LRU─┐││
        │ │ └─────┘││         │ │ └─────┘││         │ │ └─────┘││
        │ └──┬─────┘│         │ └──┬─────┘│         │ └──┬─────┘│
        │    │      │         │    │      │         │    │      │
        │ ┌──▼───┐  │         │ ┌──▼───┐  │         │ ┌──▼───┐  │
        │ │Redis │  │         │ │Redis │  │         │ │Redis │  │
        │ │clstr │  │         │ │clstr │  │         │ │clstr │  │
        │ └──┬───┘  │         │ └──┬───┘  │         │ └──┬───┘  │
        │    │      │         │    │      │         │    │      │
        │ ┌──▼───┐  │         │ ┌──▼───┐  │         │ ┌──▼───┐  │
        │ │ Read │  │         │ │ Read │  │         │ │ Read │  │
        │ │replic│  │         │ │replic│  │         │ │replic│  │
        │ └──┬───┘  │         │ └──┬───┘  │         │ └──┬───┘  │
        └────┼──────┘         └────┼──────┘         └────┼──────┘
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                                   │ writes only
                                   ▼
                          ┌─────────────────┐
                          │   Primary DB    │  Postgres single primary.
                          │   (Postgres)    │  Source of truth.
                          └────────┬────────┘
                                   │
                                   │ CDC (Debezium / logical replication)
                                   ▼
                          ┌─────────────────┐
                          │   Kafka topic   │  product.changed
                          └────────┬────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                ▼                  ▼                  ▼
         ┌─────────────┐    ┌─────────────┐   ┌─────────────┐
         │ View-table  │    │ Cache       │   │ CDN purge   │
         │ updater     │    │ invalidator │   │ worker      │
         │ (recomputes │    │ (Redis pub/ │   │ (calls CDN  │
         │ denormalized│    │ sub; per-   │   │ purge API   │
         │ rows)       │    │ pod evicts) │   │ for hot     │
         │             │    │             │   │ URLs)       │
         └─────────────┘    └─────────────┘   └─────────────┘
```

Component responsibilities:

- **Browser cache.** Free. Controlled by `Cache-Control` headers.
- **CDN POPs.** First server-side cache. Serves ~80% of cacheable traffic with sub-30ms latency.
- **Origin LB + regional LB.** Stateless. Routes to closest healthy region.
- **App pod with in-process LRU.** Per-pod hot-key cache. ~10-50MB. Sub-ms hit latency. Per-pod invalidation via Redis pub/sub.
- **Redis cluster (per region).** Catches the warm tail. ~5GB-10GB. Shared across all pods in the region. Invalidated by the invalidator service.
- **Read replicas (per region).** Async copies of the primary. Lag <1s P99. Serves cache misses.
- **Primary DB.** Accepts writes. Replicates to all regional replicas. Emits change events via logical replication.
- **CDC pipeline.** Reads WAL, publishes to Kafka. Decouples writes from downstream consumers.
- **View-table updater.** Consumes change events, recomputes denormalized `product_view` rows.
- **Cache invalidator.** Publishes invalidation events to Redis pub/sub. App pods subscribe and evict.
- **CDN purge worker.** Calls CDN purge API for hot URLs that must be revoked immediately (legal takedown, mispricing).

### 7. Read path and write path in detail

**Read path: `GET /products/42`**

1. Browser checks its HTTP cache. If a non-expired entry exists, serve from disk. Zero network. Done.
2. Browser sends request to CDN POP (geographically nearest). POP checks its cache. If hit and not expired, serve. ~10ms. Done.
3. CDN miss: POP forwards to origin LB. LB routes to nearest healthy region.
4. Regional LB forwards to an app pod.
5. App pod checks in-process LRU by `product:42`. If hit, serve. <1ms. (Total time from user: ~30-50ms because the request still traversed CDN-to-origin.)
6. LRU miss: app pod queries Redis for `product:42`. If hit, copy into LRU (so the next request from this pod hits LRU), serve. ~5ms.
7. Redis miss: app pod queries the regional read replica with `SELECT * FROM product_view WHERE product_id = 42`. If hit, populate Redis with TTL of 60s + jitter, serve. ~30ms.
8. Replica miss (replica is down or row not yet replicated): fall back to primary. Same query. Serve and populate both Redis and (if possible) the replica's local cache on the next replication tick.
9. Primary miss: row genuinely does not exist. Return 404.

Each hop populates the cache it just missed in. The system self-warms.

P95 budget:
- Cache hit at any layer: 30-50ms (including network from user to CDN).
- Full miss to DB: 80-150ms.

**Write path: `PUT /products/42`**

1. Client → CDN → LB → regional LB → app pod. CDN never caches writes (`POST`, `PUT`, `DELETE` are never cached by default).
2. App pod validates the request, performs auth.
3. App pod writes to primary DB. The write must go to the primary, not a replica. Reuses a connection pool that knows to send writes to primary.
4. DB write succeeds. App pod publishes a `product.changed` event to Kafka with `{product_id: 42, version: 5}`.
5. App pod responds 200 to client.
6. Asynchronously, downstream consumers act:
   - **View-table updater** recomputes `product_view` for product 42.
   - **Cache invalidator** publishes `evict: product:42` on Redis pub/sub. All app pods (in all regions) drop the key from their LRU and from Redis.
   - **CDN purge worker** calls CDN purge API for `/products/42`. Takes 5-30s to fully purge across all POPs.
7. Replicas pick up the write within ~1s via standard streaming replication.

The write path is slower than the read path (it has more side-effects). But writes are 1/100th of reads, so total system load is dominated by reads.

**Read-your-writes mechanism:**

- When the app pod processes a write, it sets a cookie `pin_to_primary_until=<now + 5s>` on the response.
- On subsequent reads from the same client, the app pod inspects the cookie. If the timestamp is in the future, the read is routed to the primary instead of the replica.
- After 5 seconds (longer than the worst-case replication lag), the cookie expires and reads resume from the replica.

This costs almost nothing (5 seconds of slightly heavier load on the primary per write) and eliminates the most common consistency bug users notice.

### 8. Scaling journey: 10 to 1M users

The four stages each have one big architectural change driven by a concrete pain point.

#### Stage 1: 10 to 100 users (the original sketch)

- **Setup:** Single Postgres, single app server, no cache.
- **Traffic:** ~10 reads/min, 0.1 writes/min. P95 = 30ms.
- **Cost:** ~$50/month.

There is nothing to optimize. Postgres comfortably handles 100s of QPS for indexed lookups. The app server sits at 5% CPU. The interviewer should have stopped you if you tried to add Redis here.

**What you do not have:**
- No CDN. URLs are dynamic; you serve them from the app.
- No cache. Postgres is fast enough.
- No read replicas. There is no read load to offload.

**What breaks first (in the future):**

Probably nothing for a while. The first thing that breaks is geographic latency if you take on users far from your single region. That alone is solved by a CDN.

#### Stage 2: 10k users (add caching)

- **Setup:** Single Postgres, app server, **Redis** in front of the hottest read endpoints.
- **Traffic:** ~6 reads/sec sustained, ~20/sec peak. Writes still ~0.2/sec.
- **What just broke:** P95 is now 80ms because the catalog page does a 3-table JOIN that takes 60ms even on warm data. Every read hits Postgres.
- **Cost:** ~$150/month (Redis adds ~$30).

**What you add:**

- **Redis in front of `GET /products/{id}`.** TTL: 60 seconds. Key: `product:{id}`. Value: the full denormalized JSON the API returns.
- **Cache-aside pattern.** App pod checks Redis first; on miss, queries Postgres, populates Redis, returns.
- **TTL with jitter.** Each entry has TTL of 60s ± 10% to prevent synchronized expiry.

**Numbers:**
- Cache hit rate: ~80% (Zipf-shaped traffic; top 1000 products cover most reads).
- DB QPS drops from ~6/sec to ~1.2/sec.
- P95 on cache hit: 5ms. P95 on cache miss: 30ms. Weighted P95: ~8ms.

**What you do not add:**
- No CDN. Most users are in one region; CDN setup overhead is not worth it yet.
- No read replicas. The DB is barely loaded.
- No in-process LRU. With only 2-3 app pods, the marginal benefit is small.
- No denormalization yet. The JOIN is fast enough on cache miss.

**Common mistake at this stage:** caching the wrong endpoints. Caching the cart total is a correctness bug. Caching the search-results page with a TTL is fine but doesn't help much (search has too many distinct queries; cache hit rate stays low).

#### Stage 3: 100k users (add CDN, replicas, event-driven invalidation)

- **Setup:** Postgres primary + **2 read replicas**, app servers, Redis, **CDN in front of cacheable endpoints**, **Kafka for cache invalidation**.
- **Traffic:** ~58 reads/sec sustained, ~300/sec peak. Writes ~3/sec peak.
- **What just broke:**
  - Users in three continents complain about page load time (250ms+ from APAC).
  - The catalog page TTL of 60s is no longer fast enough; a flash sale changes prices, and 60 seconds of stale prices causes complaints.
  - Primary DB CPU climbs because reads compete with the nightly catalog import.
- **Cost:** ~$2k/month.

**What you add:**

- **CDN (CloudFront / Fastly / Cloudflare) in front of all GET endpoints with `Cache-Control: public, max-age=60`.** Catches ~70% of all reads at the edge. P95 globally drops to 30ms (CDN POP is geographically close).
- **2 read replicas.** Routes reads to replicas; writes to primary. Primary load drops by ~50%.
- **Event-driven cache invalidation via Kafka.** When a product changes:
  1. Write to primary DB.
  2. Publish `product.changed` event to Kafka.
  3. Cache-invalidator consumer subscribes, evicts Redis key, calls CDN purge API for the URL.
  4. App pods subscribe to a Redis pub/sub channel (lighter weight than full Kafka consumers for fast in-process eviction).
- **In-process LRU on app pods.** 10MB LRU, top-1000 hottest keys. Sub-millisecond reads for the hottest products.

**Numbers:**
- CDN hit rate: ~70% globally.
- Redis hit rate on CDN misses: ~85%.
- DB QPS (replicas): ~5/sec. (300 req/sec × 0.30 CDN miss × 0.15 Redis miss = 13 req/sec; in practice lower because the LRU catches the very hottest.)
- DB QPS (primary): ~3/sec writes only.
- P95 user-perceived: 30ms (CDN hit) / 50ms (CDN miss but Redis hit) / 80ms (full miss).
- Price update propagation: <2s end-to-end (Kafka latency + Redis pub/sub + CDN purge).

**What you do not add:**
- No per-region Redis yet. One central Redis is still fine because Redis-to-app latency is acceptable from any region as a cache miss path.
- No denormalized view table yet. Cache miss path is fast enough on a replica with good indexes.
- No regional databases. The primary is still single-region; replicas can be regional but writes route back.

**Common mistake at this stage:** trusting TTL alone. The flash-sale scenario showed why event-driven invalidation matters. TTL is the safety net; event-driven is the SLA.

#### Stage 4: 1M users (regional everything, denormalized hot tables)

- **Setup:** Per-region full stack (CDN POPs, regional Redis cluster, regional read replicas, regional app servers). Single primary in one region for writes. Denormalized `product_view` table updated by CDC. Hash-chained audit. ML-driven cache warming for predicted-hot products.
- **Traffic:** ~600 reads/sec sustained, ~3000/sec peak. Writes ~30/sec peak (nightly bulk imports push this to ~500/sec for a short window).
- **What just broke:**
  - Cross-region Redis writes (invalidations) have 100ms+ latency. Cache invalidation now takes 500ms+ end-to-end; flash sale starts before the cache is purged.
  - The 3-table JOIN on cache miss takes 200ms; with 5% miss rate at 3000/sec, that is 150 slow queries per second on the replicas.
  - A few products go viral (one product gets 5000 req/s for an hour). Redis shard owning that key saturates at 100% CPU; surrounding shards sit idle.
- **Cost:** ~$30k/month.

**What you add:**

- **Per-region Redis cluster.** Each region has its own Redis. Cross-region invalidation: the invalidator publishes the event to a global Kafka topic; each region's invalidator consumer evicts the key locally. No more cross-region Redis writes.
- **Per-region read replicas.** Each region has its own replicas of the primary. Replication is async but inter-region; lag is ~2s P99 (acceptable).
- **Denormalized `product_view` table updated by CDC.** Every read goes against a single-row lookup, not a 3-table JOIN. Cache miss latency drops from 200ms to 5ms.
- **Hot-key mitigation in Redis.**
  1. App pods sample keys for hotness. When a key exceeds 100 req/s on a single pod, it gets promoted to a long-TTL in-process cache (10min).
  2. Redis read replicas (multiple read-only Redis nodes per master) round-robin the read load for hot keys.
- **CDN cache warming.** A predicted-hot product (marketing push, scheduled product launch) gets pre-warmed at every CDN POP and Redis cluster before the launch. Done via a one-shot script that issues GETs across all POPs, or via the CDN's pre-fetch API.
- **Stale-while-revalidate everywhere.** The CDN serves stale content for up to 5min while refreshing in the background. User never sees a slow page; cache misses are absorbed by the background refresh.

**Numbers:**
- CDN hit rate: ~85% globally.
- Redis hit rate on CDN misses: ~95%.
- DB QPS (replicas, per region): ~10/sec.
- DB QPS (primary): ~30/sec writes.
- P95 user-perceived: 25ms globally.
- Price-update propagation: <3s globally (Kafka cross-region + per-region invalidator + CDN purge).

**What you do not add:**
- No multi-master DB. One primary; if it fails, promote a replica with ~60s downtime. Writes are small enough that this is acceptable.
- No custom cache implementation. Redis + LRU is enough.
- No machine-learning-based cache eviction. LRU is fine.

**What you would do at 10M+ users:**

Honestly, you would re-evaluate whether you are a catalog provider or a marketplace. At 10M users on a catalog, the read path is solved. The interesting problems become inventory consistency, payments, fraud, and search relevance, all of which are different system designs.

You might also:
- Move to a multi-master DB (DynamoDB Global Tables, Spanner) if you have global write traffic.
- Adopt edge compute (CloudFlare Workers, Fastly Compute@Edge) to run logic at the POP, eliminating origin hits for personalized-but-cacheable responses.
- Use a search-specific store (Elasticsearch) for the search path; the catalog read path stays as designed.

### 9. Reliability

**Cache stampede (thundering herd on expiry).**

A popular key (`product:42`) is in cache. Its TTL of 60s expires at exactly the moment 1000 users hit refresh. All 1000 requests miss the cache, all 1000 hit the DB, the DB CPU spikes.

Mitigations, in order:
1. **TTL jitter.** Each entry has TTL ± 10%. Synchronized expiry becomes unlikely.
2. **Single-flight / request coalescing.** When the app pod sees a cache miss for a key, it acquires a per-key in-process lock. The first miss queries the DB and populates the cache; subsequent concurrent misses wait on the lock and read the populated value. 1000 concurrent misses become 1 DB query.
3. **Stale-while-revalidate.** Serve the just-expired value (now technically stale) while one request asynchronously refreshes the cache. Users never wait for the refresh.
4. **Probabilistic early refresh.** Each cache read has a small probability (proportional to age / TTL) of triggering a background refresh. The cache is refreshed before it expires, so no one ever sees a hard miss.

**Cache fallback to DB.**

Redis goes down for 10 minutes. Every read becomes a full miss. The DB cannot handle 3000 req/sec.

Mitigations:
1. **In-process LRU is the first line.** Even with Redis dead, the top 1000 keys are served from app pod RAM. Catches the worst of the surge.
2. **Read replicas absorb the rest.** 5 replicas at 100 QPS each = 500 QPS sustained, enough to weather the storm.
3. **Circuit breaker on the DB.** If DB latency exceeds 200ms P99, the app starts shedding cache-miss reads (return cached-stale-data or a 503 with `Retry-After: 30`).
4. **Throttle the cache miss path.** Cap the number of concurrent DB queries per pod. Excess requests get a stale or empty response.
5. **Reboot Redis from cold start carefully.** When Redis comes back up empty, *do not* let traffic flow to it immediately. The first 60 seconds will be 100% cache misses; the DB will melt. Pre-warm Redis with a one-shot scan or use Redis persistence (AOF) to recover the hot set on restart.

**Replica fail and primary fallback.**

A read replica is unreachable. The connection pool detects this and routes around it. If all replicas are down, fall back to primary. Alert immediately.

**Multi-region failure.**

If one region is fully down, the global LB routes traffic to the surviving regions. The surviving regions' caches were warm for *their* traffic; they are cold for the failed region's traffic. Expect a 5-15 minute degraded latency window as the caches warm up. ML-driven warming can preload predicted-popular keys.

**Dogpile on cold start.**

The whole region's app fleet is restarted at the same time. All in-process caches are cold. All requests fall through to Redis. Redis is fine; the in-process caches warm up within a minute. Mitigation: rolling restarts, not all-at-once. Pre-warm in-process cache on pod start with a small set of hottest keys (fetched from Redis).

### 10. Observability

What must be instrumented from day one:

| Metric | Why |
|--------|-----|
| `cache.hit_rate.{layer}` (cdn, lru, redis) | The headline. Drops here precede latency regressions. |
| `cache.miss_path.latency.p99` | If this regresses, your DB or denormalized view path is slow. |
| `replica.lag.seconds.p99` | Should be under 1s. Spikes during bulk imports. |
| `read.latency.p50/p95/p99 by route` | Per-endpoint SLO tracking. |
| `db.qps.{primary, replica}` | Primary should be ~writes-only; replicas should match expected miss rate. |
| `redis.hot_key.requests_per_sec` | Detects hot-key shards before they melt. |
| `invalidation.lag.p99` | Time from DB write to cache eviction across all layers. Should be <2s. |
| `cdn.purge.latency.p99` | Time from purge API call to full propagation. |
| `stampede.coalesced.requests_per_sec` | Single-flight is firing; means you had concurrent misses on the same key. High values are normal during cache misses on hot keys. |
| `circuit_breaker.{db, redis}.tripped` | Counts of times protection fired. |

Alerts:
- Page on: cache hit rate < 70% for 5min; replica lag > 30s; DB QPS spike > 10x baseline.
- Ticket on: any new hot-key signal; CDN miss rate trending up; invalidation lag P99 > 5s.

Dashboards:
- "Read path waterfall": for each endpoint, the breakdown of how many requests served by which layer. Use this to find endpoints whose cache strategy is misconfigured.
- "Hot key heat map": Redis keys ranked by QPS. Watch for one key dominating.
- "Replication lag over time": correlate spikes with bulk writes.

### 11. Common gotchas

1. **Caching the wrong endpoints.** Cart total, account balance, inventory count: these must not be cached, ever. Every team needs a clear policy and a code-review checklist.
2. **Personalized content at the CDN.** A page that varies by user with no `Vary: Authorization` header will serve user A's view to user B. The bug is silent until someone notices.
3. **`Cache-Control: public` on private data.** Same as above. Always default to `private`; opt in to `public`.
4. **Stale write on write-through.** Two concurrent writes can land in different orders in the DB and the cache (see Step 7 in question.md). Mitigation: cache-aside (do not write the cache on write, just invalidate; let the next read populate).
5. **Cache invalidation that does not actually invalidate.** A pub/sub message lost in transit means an evicted entry stays alive. Mitigation: TTL as backstop. Never rely on event-driven alone.
6. **Replication lag during backfills.** A nightly import of 1M products generates 1M WAL entries; replicas fall hours behind. Mitigation: throttle the import, or pause reads-from-replica during the window, or use a separate replica for backfill writes.
7. **In-process cache divergence across pods.** Pod A invalidates its LRU; pod B did not get the message; pod B serves stale. Mitigation: short TTL on in-process cache (~5min), even if pub/sub is in place. Pub/sub is the fast path; TTL is the correctness floor.
8. **Versioned URLs and SEO.** `?v=17` looks like a different URL to Googlebot. Mitigation: include `<link rel="canonical">` pointing to the unversioned URL.
9. **Read-your-writes broken by load balancer.** The 5-second-pin cookie only works if the load balancer routes the next request through a path that respects the cookie. If your LB strips cookies or your client is on a different origin, the pin fails silently. Test the path.
10. **Stale-while-revalidate with a broken backend.** SWR will keep serving stale forever if the background refresh always fails. Add a max-stale window (e.g., never serve content older than 1 hour even if refresh is failing). After max-stale, return an error instead of stale content.

### 12. Follow-up answers

**1. Cache stampede.**

A popular `product:42` cache entry expires. 1000 concurrent users miss; all 1000 hit DB.

Mitigations:
- **TTL jitter.** Top keys do not expire in lockstep.
- **Single-flight (request coalescing).** Per-key in-process lock: the first miss fetches from DB and populates cache; the rest wait and read the populated value. 1000 misses become 1 DB query.
- **Stale-while-revalidate.** Serve the just-expired value while one goroutine refreshes in the background. No user ever sees a hard miss.
- **Probabilistic early refresh.** As age approaches TTL, the probability of triggering a background refresh on each read rises. The cache is refreshed before expiry.

Combine all four. Single-flight alone fixes the immediate spike. SWR makes it invisible to users.

**2. Cache fallback when Redis is down.**

Redis cluster unreachable for 10 minutes. Every read is now a cache miss.

Survival:
- **In-process LRU as first line.** Top 1000 keys are served from pod RAM. Catches the heaviest fraction.
- **Read replicas absorb the rest.** Multiple replicas spread the load.
- **Circuit breaker.** If DB P99 latency exceeds a threshold, app starts shedding load (return 503 with `Retry-After`, or serve a degraded response).
- **Per-pod query throttle.** Cap concurrent DB queries per pod. Excess requests get a stale or empty response.
- **Do not cold-start Redis under load.** When Redis comes back, warm it via a scan from DB or use Redis persistence (AOF) to restore the hot set. Otherwise the first minute of post-recovery traffic is 100% miss again.

The principle: every cache layer must have a defined fallback. Never assume the layer is always up.

**3. Personalized pages and the CDN.**

Page shows "recommended for you." CDN cannot cache the whole page.

Options:
- **Don't cache the page; cache the components.** Split into two requests: `GET /products/42` (cacheable shared response) and `GET /products/42/recommendations` (personalized, not cached). Browser assembles the view.
- **Edge personalization.** CloudFlare Workers, Fastly Compute@Edge, AWS Lambda@Edge. The CDN caches the shared parts; edge code stitches in user-specific data from a fast key-value store at the POP.
- **ESI (Edge Side Includes).** Cache the page with placeholders; the CDN inlines per-user fragments. Older pattern; still used.
- **Vary by user-segment, not user.** If recommendations are bucket-based ("new customers see X, returning customers see Y"), cache one response per bucket. 10 buckets × 1M products = 10M cache entries. Still cacheable.

The general lesson: personalization does not kill caching; it shifts what you cache. Find the seams between shared content and personal content; cache the shared parts.

**4. Read-your-writes.**

User updates profile, immediately refreshes, sees old name (replica has not applied write yet).

Fix: 5-second-pin to primary after a write.
- On write, app sets a cookie `pin_to_primary_until=<now + 5s>` on the response.
- On subsequent reads from the same client, if the cookie is in the future, route to primary.
- After 5s, cookie expires; reads resume from replica.

Cost: a 5-second window of slightly increased primary load per user write. For a write rate of 3/sec, that is at most 15 concurrent pinned users. Negligible.

For cross-device read-your-writes (user writes on phone, reads on laptop), the cookie does not work. Either accept the inconsistency (typical) or use a server-side per-user version vector that the load balancer reads.

**5. Hot key in Redis.**

One product gets 10k req/s; that key's Redis shard pegs at 100% CPU.

Mitigations in order of cost and complexity:
1. **In-process LRU on app pods.** A 1000-entry LRU with 60s TTL catches the hot key locally. 10k req/s on the shard becomes maybe 100 req/s (one refresh per pod per minute).
2. **Redis read replicas.** Each Redis master has 1-3 read-only slaves. App reads round-robin across them. Throughput per key scales linearly with replicas.
3. **Key splitting.** Replace `product:42` with `product:42:{shard}` where shard is a random number 0-9. Reads pick a random shard; writes update all. Spreads the load across 10 Redis shards.
4. **CDN.** If the key corresponds to a CDN-cacheable URL, the CDN absorbs most of the traffic before it reaches Redis.

For viral content, all four together.

**6. CDN cache miss thundering herd.**

100k users hit a new product launch URL at the same instant. CDN is cold. All requests fall through to origin.

Mitigations:
- **Pre-warm the CDN.** Before launch, hit the URL at every POP (via a script that geo-distributes requests). The CDN now has the response cached at every POP.
- **Origin shield.** CDN feature (CloudFlare, Fastly): designate one POP as the "shield" that the other POPs ask first on miss. Origin sees one request per shield, not one per POP. Reduces origin traffic 100x.
- **Stale-while-revalidate.** If the page existed before (slightly different version), CDN serves the stale version while refreshing.
- **Single-flight at origin.** Even if the CDN does not coalesce, the origin can. Same single-flight pattern as the cache stampede.

The pre-warm step is the operational lesson: any large launch should be preceded by a cache warming run.

**7. Cache key design.**

Cache `product:42`. Then add a feature: staff users see internal pricing.

Options:
- **Separate cache by role.** Key becomes `product:42:role:staff` and `product:42:role:public`. Two cache entries per product. Cleanest; doubles cache memory if both roles are common.
- **Wrap response with personalization.** Cache the shared `product:42` (without prices). At read time, app overlays the role-specific price (which lives in a separate small cache). One cache entry per product; more compute per read.
- **Don't cache for staff.** Staff traffic is 0.1% of total. Skip the cache for them. One cache entry per product; staff reads always hit DB.

The right answer depends on the read ratio. If staff is <1% of traffic, "don't cache for staff" is correct. If staff is 50%, "separate cache by role" is correct. The principle: cache key cardinality is your budget; spend it on the dimensions that matter.

**8. Replication lag during backfill.**

Import 10M products overnight; replication lag balloons to 5 minutes.

During the import:
- **Pause reads from the most-lagged replica.** Connection pool detects lag and stops routing to it.
- **Throttle the import.** Limit writes to a rate the replicas can keep up with. Slower import is acceptable; lagged reads are not.
- **Use a separate "backfill" replica.** Dedicate one replica that accepts the lag, never serves reads. The others stay caught up.
- **Pin reads to primary for the duration.** Last resort. Increases primary load.

Post-import:
- **Verify cache state.** Some Redis entries may be from before the import; bulk-invalidate the affected key range or wait for TTL.
- **Re-warm denormalized tables.** If `product_view` is updated via CDC, the CDC pipeline may be lagging too. Wait for it to catch up before resuming normal traffic.

The lesson: bulk writes are different from steady-state writes. They need their own write path and their own monitoring.

**9. Cache size estimation.**

1M products × 5KB = 5GB. Redis node has 8GB RAM. Enough?

What you forget:
- **Redis overhead.** Each key has metadata (TTL, type, encoding). Add ~100 bytes per key. 1M × 100 bytes = 100MB extra.
- **Memory fragmentation.** Redis allocator (jemalloc) has overhead. Real usage often 30-50% higher than naive math.
- **Replication buffer.** If you have Redis replicas, the master keeps a replication backlog (default 1MB, often configured to 256MB).
- **Client buffers.** Each connection has buffers. With 1000 connections, easily hundreds of MB.
- **OS overhead.** The OS itself uses memory; Redis cannot have all 8GB.
- **Eviction headroom.** Redis with `maxmemory-policy: allkeys-lru` needs ~10% headroom to evict cleanly.

Realistic budget: 8GB Redis node holds at most 4-5GB of actual user data. If the hot set is 5GB, you need a bigger node or a cluster.

Always size for hot set + 50% headroom. Plan for cluster mode from the start so you can add shards without re-architecting.

**10. Endpoint that should never be cached.**

Inventory count at checkout must be exact.

Enforcement across 30 engineers:
- **Code-level guard.** A function `get_strong(key)` that explicitly bypasses cache. Reviewer checks that strong-read endpoints use it.
- **`Cache-Control: no-store` set by the framework for the endpoint.** Cannot be overridden by individual handlers.
- **Linter / static analysis rule.** A rule that flags any function in `checkout/` that calls the generic `get_cached` helper. PR fails CI.
- **HTTP response audit.** A nightly job samples production responses; flags any `/checkout/*` response with non-`no-store` cache headers.
- **Naming convention.** Endpoints that must hit primary are named `/api/v1/strong/*` or annotated `@StrongRead`. Stands out in code review.

The lesson: correctness requirements need *systematic* enforcement, not "everyone knows not to cache that." A team of 30 has at least one engineer who does not know.

### 13. Trade-offs

- **Consistency vs latency.** Stronger consistency means more reads to the primary (or longer pins, or shorter TTLs), all of which slow the read path. Weaker consistency (longer TTLs, more replica routing) means faster reads but more user-visible staleness. Pick per endpoint, not per system.
- **Memory vs replicas.** Adding RAM to Redis is cheaper than adding read replicas. But Redis has a hard ceiling (one node's RAM); past that, you shard. Replicas have no per-node ceiling. At enterprise scale you have both; at startup scale you have neither.
- **CDN cost vs origin offload.** CDN is paid by GB-out. At low traffic, CDN is nearly free. At very high traffic, CDN costs more than origin compute. Negotiate volume pricing or use multiple CDNs (Fastly + CloudFlare in front of origin shield).
- **In-process cache vs distributed cache.** In-process is faster and free. But invalidation is harder (every pod needs to evict), and capacity is per-pod. Use in-process for top-N hottest keys only; use distributed for everything else.
- **Denormalization vs query optimization.** Denormalized tables make reads faster and writes more complex. Sometimes a better index on the normalized schema solves the same problem. Measure before denormalizing.
- **TTL vs event-driven invalidation.** TTL is simple and self-healing (if pub/sub fails, TTL still expires the entry eventually). Event-driven is fast and accurate but operationally heavier. Use both: event-driven as primary, TTL as floor.

### 14. Common mistakes

1. **Reaching for Redis without checking if a CDN would do the job.** The CDN is cheaper and absorbs more traffic for cacheable responses. Always check what fraction of reads are cacheable shared responses before adding Redis.
2. **Adding read replicas before fixing the cache.** Replicas amplify the wasted work if the cache hit rate is bad. Fix the cache first; the replicas may not be needed.
3. **Uniform TTL across all endpoints.** Different endpoints have different freshness requirements. A single TTL is either too long for some (correctness bugs) or too short for others (wasted DB load).
4. **Trusting TTL alone for invalidation.** TTL means a write can take up to N seconds to be visible. For a flash sale or a takedown, this is unacceptable. Add event-driven invalidation.
5. **No fallback when the cache is down.** When Redis dies, the DB gets every request. If you have not prepared for this, the DB also dies. Always have a circuit breaker and a degraded mode.
6. **Caching personalized responses without `Vary`.** User A's response served to user B. Silent until a customer notices.
7. **In-process cache as the only cache.** Works at 1 pod. Fails at 100 pods (one write invalidates 1, the other 99 keep serving stale). Always combine with a distributed cache and a pub/sub eviction.
8. **Sizing Redis for the cold data set, not the hot one.** You do not need to cache 1M products; you need to cache the top 10k. Size for hot set + headroom.
9. **No observability per layer.** "Cache hit rate is good" hides the case where one layer has 99% hit rate and another has 30%. Track each layer separately.
10. **Designing for read-your-writes when it does not matter.** Most user-facing reads can tolerate 1-second staleness. Pinning every user to the primary after every write wastes capacity. Pin only for the few endpoints that need it (profile edits, settings).
11. **Building per-region from day one.** Regional infrastructure is 3-10x the operational cost. Most products never need it. Build single-region; add regions when latency complaints come from a specific geography.
12. **Hand-rolling a cache when Redis exists.** Custom in-memory caches are tempting and almost always wrong. Redis is battle-tested; your custom cache is not. Use Redis (or memcached) unless you have a specific reason not to.

If you can hit 9 of these 12, you are interviewing well. The pattern that separates senior from mid-level: senior candidates name the order in which to apply the patterns and the conditions under which each one is the *wrong* answer. Mid-level candidates name the patterns but apply them all uniformly.
{% endraw %}
