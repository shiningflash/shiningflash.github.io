---
layout: practice-problem
track: system-design
problem_id: 1
title: Design a URL Shortener
slug: 001-url-shortener
category: Basics
difficulty: Medium
topics: [encoding, kv store, caching, sharding, read-heavy]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/001-url-shortener"
solution_lang: markdown
---

{% raw %}
## Scene

10:08 AM. Your interviewer opens a blank doc and pastes one sentence:

> *Design a URL shortener like bit.ly.*

Then they go quiet and look at you. They are not going to feed you more until you ask.

This is the most common opening in system design interviews. It looks easy. It is not. The interviewer is watching whether you start drawing boxes right away (the usual failure mode) or whether you pause and ask questions.

## Step 1: clarify before you design

Take 5 minutes. Don't draw anything yet. What would you ask? Aim for at least five questions that would meaningfully change the design depending on the answer.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Traffic shape.** "How many new URLs per day? How many redirects?" Without this you can't size storage, pick a cache, or choose between hash-based and counter-based shortcodes. A bit.ly-scale answer is around 100M new URLs per month with 10x more reads than writes.
2. **Shortcode length and character set.** "Target length? Custom aliases allowed?" 7 characters in base62 covers 3.5 trillion URLs, which is plenty. Custom aliases change the picture because you can't just hash; you have to reserve and check for conflicts.
3. **Retention.** "Do links expire? Can users delete them?" Permanent storage vs TTL changes the data store. Expiration also opens the door to sharding by time, which simplifies things.
4. **Read latency target.** "What's the redirect P99 we're shooting for?" Under 100ms globally means a CDN or geo-distributed cache. Under 500ms in one region is far easier.
5. **Analytics.** "Click counts? Geo? Referrer? Real-time or batch?" Real-time counts need a separate write path with a counter store. Batch can lag and is much cheaper.
6. **Auth and abuse.** "Anonymous shortening? Account required? What do we do about phishing?" This pulls in a rate limiter, a safe-browsing check, and a moderation pipeline.
7. **Dedup on conflicts.** "If two requests shorten the same long URL, do they get the same shortcode?" This is a deduplication decision that drives the write path.

If you walked in asking only "how many URLs" and "how long are the shortcodes," you've left the interviewer guessing. The seven above give you enough to scope the design.

</details>

## Step 2: capacity estimates

Assume the interviewer hands you these numbers:

- 100M new short URLs per month
- Reads are 10x writes
- Average long URL length: 100 bytes
- Storage retention: 5 years
- Target redirect P99: 100ms globally

Compute (do this on paper before revealing):

1. Writes per second (sustained, not peak)
2. Reads per second (sustained)
3. Total URLs stored after 5 years
4. Storage required for the URL records alone (no logs, no analytics)
5. Cache size required to hit a 90% cache hit rate, assuming hot URLs follow roughly a Zipf distribution where the top 20% serve 80% of traffic
6. Bandwidth at peak (3x sustained)

<details>
<summary><b>Reveal: the math</b></summary>

**Writes per second.**
100M / month = 100M / (30 × 86400) ≈ 38 writes/sec sustained. Peak is 3x to 5x sustained, so call it ~150 writes/sec peak.

**Reads per second.**
10x writes = 380 reads/sec sustained, ~1500/sec peak. Small.

**Total URLs in 5 years.**
100M × 12 × 5 = 6 billion URLs.

**Storage.**
Per record: 7 byte shortcode + 100 byte long URL + 8 byte created_at + 8 byte user_id + ~30 byte overhead ≈ 150 bytes.
6B × 150 bytes = 900GB. Round up to 1TB. Fits on a single big box, but you shard for reasons other than capacity (latency, blast radius).

**Cache.**
Total redirects per day ≈ 380 × 86400 ≈ 33M reads/day. 90% hit rate means at most 10% of unique URLs are hot, but with Zipf the hot set is much smaller. The top 1M URLs typically serve ~80% of traffic. 1M × 150 bytes ≈ 150MB. Fits in a single Redis node, but replicate for availability.

**Bandwidth.**
Peak write: 150 × (100 byte URL + ~50 byte response) ≈ 22 KB/s. Negligible.
Peak read: 1500 × (small request + 302 redirect), also negligible at the API layer. The redirect itself sends the user away.

**The takeaway.** Heavily read-skewed system, tiny working set. Cache effectiveness dominates everything. Once the cache is warm, the database is almost an afterthought.

</details>

## Step 3: sketch the high-level architecture

Here's an intentionally incomplete diagram. Fill in the four `[ ? ]` boxes. Hint: think about what sits in front of the service, what sits behind it, and what speeds up reads.

```
                  ┌─────────────┐
   Client ──────► │   [ ? ]     │  (sits at the edge, terminates TLS, distributes traffic)
                  └─────┬───────┘
                        │
                        ▼
                  ┌─────────────┐
                  │  URL Service │  (stateless, horizontally scalable)
                  └──┬──────┬───┘
                     │      │
              read   │      │ write
                     │      │
                     ▼      ▼
              ┌──────────┐ ┌──────────┐
              │  [ ? ]   │ │   [ ? ]  │  (fast lookups vs durable storage)
              └──────────┘ └──────────┘

                                ▲
                                │ async writes
                            ┌───┴────┐
                            │ [ ? ]  │  (analytics, click counts)
                            └────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
                  ┌──────────────────┐
   Client ──────► │  Load Balancer   │  (terminates TLS, geo-routes,
                  │  + WAF + Rate    │   distributes to nearest region)
                  │     Limiter      │
                  └─────────┬────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │   URL Service    │  (stateless, horizontally scalable,
                  │ (read & write)   │   deployed per region)
                  └──┬───────────┬───┘
                     │           │
              read   │           │ write
                     │           │
                     ▼           ▼
              ┌──────────┐  ┌──────────────┐
              │  Cache   │  │  Database    │  (sharded by shortcode hash,
              │  (Redis) │  │  (Postgres/   │   replicated for failover)
              │  cluster │  │   Cassandra)  │
              └──────────┘  └──────┬───────┘
                                   │
                                   │ async (CDC or Kafka)
                                   ▼
                            ┌──────────────┐
                            │  Click Stream │  (Kafka → ClickHouse or
                            │  Aggregator   │   BigQuery for analytics)
                            └──────────────┘
```

Why each piece is here:

- LB with WAF and rate limiter goes first because the service is internet-facing. WAF blocks the obvious phishing and bot patterns; the rate limiter caps a single client from minting millions of links.
- Stateless URL Service scales horizontally and deploys per region. No session affinity.
- Cache in front of the database for reads. With 90%+ hit rate, the database serves only the cold tail.
- Database is the source of truth. Postgres vs Cassandra depends on access patterns; covered in the solution.
- Async click pipeline. Click counts are not on the redirect's critical path. The redirect has to be fast, so you fire-and-forget the click event.

</details>

## Step 4: API design

Define the API. Two endpoints minimum. What method, path, request body, response shape, status codes? What about errors?

<details>
<summary><b>Reveal: reference API</b></summary>

**Create short URL**

```
POST /api/v1/links
Content-Type: application/json
Authorization: Bearer <token>     # optional for anonymous; required if rate-limit-bypass desired

{
  "long_url": "https://example.com/very/long/path?with=query",
  "custom_alias": "my-link",       # optional, must match [a-zA-Z0-9_-]{4,32}
  "expires_at": "2026-12-31T00:00:00Z"  # optional, ISO 8601
}
```

Responses:

| Status | Meaning | Body |
|--------|---------|------|
| 201 Created | New short URL minted | `{ "short_url": "https://shrt.ly/abc1234", "shortcode": "abc1234", "long_url": "...", "expires_at": "..." }` |
| 200 OK | Same long_url submitted before by this user → return existing | same shape as 201 |
| 400 Bad Request | Invalid long_url, alias format, or expires_at in past | `{ "error": "invalid_alias", "message": "..." }` |
| 409 Conflict | Custom alias already taken | `{ "error": "alias_taken" }` |
| 429 Too Many Requests | Rate limit hit | `{ "error": "rate_limited", "retry_after": 60 }` |
| 451 Unavailable for Legal Reasons | URL flagged as phishing | `{ "error": "blocked_url" }` |

**Redirect (the hot path)**

```
GET /<shortcode>
```

Responses:

| Status | Meaning | Headers |
|--------|---------|---------|
| 302 Found | Redirect (use 302 not 301 so analytics work and we can change the target later) | `Location: <long_url>`, `Cache-Control: private, max-age=0` |
| 404 Not Found | Shortcode does not exist | |
| 410 Gone | Shortcode existed but expired or was deleted | |
| 451 Unavailable for Legal Reasons | URL was flagged after creation | |

Notes on the redirect:

- 302 not 301. Browsers cache 301s permanently. If you ever need to change the target (you will, for moderation), browsers skip your service entirely. Use 302 with an explicit `Cache-Control: private, max-age=0`.
- No body needed. A 302 with `Location` header is enough. Some implementations send a tiny HTML body for ancient clients; you can skip it.

</details>

## Step 5: encoding scheme

You have to mint a 7-character shortcode. Three serious approaches: hash the long URL, encode an auto-incrementing counter, or generate random and check for collision. Take 10 minutes to write the pros and cons of each.

<details>
<summary><b>Reveal: comparison and recommended choice</b></summary>

| Approach | How it works | Pros | Cons |
|----------|-------------|------|------|
| **Hash long URL (MD5/SHA truncated to 7 chars)** | Take first 42 bits of hash, base62 encode | Deterministic (same URL → same code) which is great for dedup. Stateless. | Birthday collision at ~16M URLs. Must handle collisions explicitly. Hash is one-way so cannot recover long URL from shortcode (which you do not need to). |
| **Counter encoded in base62** | Increment a 64-bit counter, base62 encode it | Zero collisions ever. Compact. Predictable size. | Counter is global state, must be coordinated. Sequential codes are guessable (a security or scraping risk). |
| **Random + check** | Generate random 7-char string, check DB for collision, retry on conflict | Unguessable. Simple. | Latency spike when collision rate gets high (it stays low for years at our scale). Requires extra DB lookup. |

**Recommendation: counter-based with sharded counters.**

- Use a bank of counters, each pre-allocating a range. The URL Service grabs a range of (say) 10000 IDs at a time from a coordinator (Redis or ZooKeeper) and hands them out from its local range. When it exhausts the range, it grabs another. No per-write coordination round-trip.
- To prevent guessability, shuffle the bits before base62 encoding. Take the 64-bit counter, XOR with a secret, then base62. Same uniqueness guarantee, but consecutive IDs don't produce consecutive shortcodes.
- For dedup ("same long URL submitted twice"), keep a separate `long_url_hash → shortcode` map (scoped per user for privacy). On submit, hash the long URL, look it up; if found, return existing; if not, mint and store both.

Hash-based is a fine answer too. What matters is that you talk through the collision math and say when you'd switch approaches. Saying "hash" without acknowledging the birthday problem is what a weaker candidate does.

</details>

## Step 6: read your way through the rest in solution.md

You've done the hardest 60%. The rest is mechanics: sharding, cache invalidation, regional distribution, analytics pipeline, abuse handling. Read `solution.md` once you've made your own attempt at the follow-ups below.

## Follow-up questions

Try answering each in 2 to 3 sentences before reading the solution.

1. **Two users submit the same long URL within milliseconds.** Do they get the same shortcode or different ones? What does your system do? What if they want different ones?
2. **Custom aliases.** How do you reserve them atomically? What happens if user A reserves "summer-sale" at the same moment user B does?
3. **A single shortcode goes viral and takes 100K req/s.** Is your single Redis enough? What if one specific cache key sees all of that traffic? Look up "hot key problem".
4. **Phishing detection.** How do you check submitted URLs against Google Safe Browsing without slowing the create path? What about URLs that were safe at creation but become malicious later?
5. **Click counts.** A short URL needs to display its total click count. Real-time? Eventually consistent? How do you avoid every redirect doing a database write?
6. **Custom domains.** Customers want `shrt.acme.com/abc1234` instead of `shrt.ly/abc1234`. What changes in the routing, certificate, and database?
7. **Expiration with retention.** Links expire after 1 year by default. Delete the row, mark it expired, or just set TTL on the cache? What about analytics that still need the historical link?
8. **A popular URL exists in the database but the cache evicts it during a traffic spike.** Describe the thundering herd and prevent it.
9. **GDPR.** A user wants all their data deleted. How do you find every short URL they created across 8 sharded databases?
10. **3am: the counter coordinator (Redis) lost its state due to a misconfigured failover and handed the same range to two URL Service instances.** What's the blast radius? How do you detect and recover?

## Related problems

- [Distributed Cache (009)](../009-distributed-cache/question.md), the caching layer this problem leans on. Understand its eviction and replication first.
- [Rate Limiter (004)](../004-rate-limiter/question.md), the rate limiter on `POST /links` is one of the standard algorithms.
- [Notification System (010)](../010-notification-system/question.md), the click stream pipeline at the bottom reuses the same fan-out and durability patterns.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a URL Shortener

### TL;DR

A URL shortener is a read-skewed key-value lookup. Three things make it interesting: minting unique short codes without a global coordinator on the hot path, surviving a 100k req/s viral link without a hot-key meltdown, and handling phishing without slowing the write path.

The shape is a stateless service in front of a sharded database with an aggressive cache. Shortcodes come from a sharded counter (each service grabs a range), get XOR-scrambled to look random, and are base62 encoded. Reads almost always hit cache; the database is a fallback. Click analytics are async so the redirect stays under 50ms.

The interesting engineering lives at the edges. Surviving a single popular code (replication and request coalescing). Keeping the create path fast despite a safe-browsing check (async with a pre-flight allowlist). Recovering when the counter coordinator misbehaves (range ledger and idempotency).

### 1. Clarifying questions and why each matters

Covered in `question.md`. The seven you must ask: traffic shape, shortcode length, retention, latency target, analytics, auth/abuse, dedup on conflicts. Walking in without asking traffic shape leaves you with no way to size anything. It's the single most common mistake.

### 2. Capacity estimates (full working)

- 100M new URLs / month → 100M / (30 × 86400) = **~38 writes/sec sustained, ~150/sec peak** (3-5x multiplier).
- 10x reads → **~380 reads/sec sustained, ~1500/sec peak**.
- 6B URLs after 5 years at ~150 bytes/record = **~900GB**. Fits on one machine; you shard for blast radius and tail latency, not capacity.
- Top 1M URLs serve ~80% of redirects (Zipf). 1M × 150B = **150MB hot set**, trivially cacheable.
- Bandwidth is negligible. The redirect is a 302 with a Location header and zero body.

The math says the system is small. Most of the architecture exists for **availability, latency, and abuse-resistance**, not capacity.

### 3. API design

In `question.md`. The non-obvious calls:

- 302 over 301. A 301 is browser-cached permanently; you lose the ability to change the target, kill phishing, or track clicks.
- `Cache-Control: private, max-age=0` on the redirect response, so intermediate proxies don't cache it.
- Idempotency on POST. When the same `long_url` is submitted by the same authenticated user, return 200 with the existing shortcode instead of 201. Anonymous users always get a fresh shortcode for privacy; otherwise two devices submitting the same URL would leak that they're the same person.

### 4. Data model

```sql
CREATE TABLE short_links (
    shortcode    VARCHAR(16) PRIMARY KEY,        -- base62, typically 7 chars
    long_url     TEXT NOT NULL,
    creator_id   BIGINT,                         -- NULL for anonymous
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,                    -- NULL = no expiry
    status       SMALLINT NOT NULL DEFAULT 1,    -- 1=active, 2=expired, 3=blocked
    custom_alias BOOLEAN NOT NULL DEFAULT FALSE,
    long_url_hash BYTEA                          -- SHA-256 of long_url for dedup lookups
);

CREATE INDEX idx_creator_created ON short_links (creator_id, created_at DESC);
CREATE INDEX idx_long_url_hash ON short_links (creator_id, long_url_hash);  -- for dedup
CREATE INDEX idx_expires ON short_links (expires_at) WHERE expires_at IS NOT NULL;
```

Choices worth defending:

- `shortcode` as PK, not a synthetic ID. Reads are by shortcode. Having the PK match the lookup key avoids an index hop on every redirect.
- `long_url` as `TEXT`, not `VARCHAR(2048)`. Real URLs do exceed 2048 chars (Google Maps share links, deep OAuth callbacks). Trust the use case.
- `status` as smallint, not enum. Easier to add new states (4=pending_review, 5=quarantined) without schema migrations.
- `long_url_hash` lets you dedup without a full-text comparison or a giant secondary index on TEXT.

### 5. Core algorithm: shortcode generation

#### The three approaches in detail

**a. Hash and truncate.**

```
shortcode = base62(truncate(SHA256(long_url), 42 bits))
```

42 bits in base62 ≈ 7 characters. Birthday paradox: probability of any collision passes 50% at √(2^42) ≈ 2M URLs. At 6B URLs you'll have lots. You handle them by appending a counter or salt and rehashing until unique. Works, but the "until unique" loop has unpredictable latency at the long tail.

**b. Counter, base62 encoded.**

```
id = next_counter_value()           # globally unique 64-bit integer
shortcode = base62(id ^ secret)     # XOR before encoding so codes look random
```

The XOR step matters. Without it, shortcodes are sequential: `abc1230`, `abc1231`, `abc1232`. An attacker iterates the namespace and harvests every link. With XOR (or any bijective scrambling like a Feistel network), consecutive IDs map to scattered shortcodes. The XOR secret is a 64-bit constant baked into the service.

**c. Random + check.**

```
while True:
    code = random_base62(7)
    if not db.exists(code):
        return code
```

At 7 chars (62^7 = 3.5T codes), collision rate stays below 0.1% for the first few hundred million URLs. Beyond that, retry latency climbs. Add a "code length" knob and bump to 8 chars at that scale.

#### Recommendation

**Counter with sharded range allocation, then XOR-scrambled.**

Why:
- No collisions, no retry latency.
- Sharded range allocation removes the per-write coordination round-trip. Each URL Service instance grabs a range of (say) 10,000 IDs from a coordinator (Redis with a Lua script, or a small dedicated service backed by Postgres). When the local range is exhausted, it fetches another.
- Counter state has to be durable. The coordinator is the single point of contention, but it's contacted only every 10,000 writes per instance, so load is trivial.

The risk: if the coordinator hands out the same range twice (failover bug, misconfigured replica), two URL Service instances mint the same shortcode. Mitigation: log every range allocation with a unique ledger ID, and on coordinator startup replay the ledger to refuse already-allocated ranges. More on this in follow-up 10.

### 6. High-level architecture (detailed)

```
                                    ┌────────────────┐
   Browser ───────────────────────► │   CDN / Edge   │  cache 302s for popular shortcodes
                                    │   (CloudFront, │  TTL: short, e.g. 60s
                                    │    Fastly)     │
                                    └───────┬────────┘
                                            │
                                    ┌───────▼────────┐
                                    │ Global Load    │  Anycast IP
                                    │ Balancer       │  Routes to nearest healthy region
                                    └───────┬────────┘
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  │                         │                         │
            ┌─────▼──────┐            ┌─────▼──────┐           ┌─────▼──────┐
            │  Region    │            │  Region    │           │  Region    │
            │  us-east   │            │  eu-west   │           │  ap-south  │
            │            │            │            │           │            │
            │ ┌────────┐ │            │ ┌────────┐ │           │ ┌────────┐ │
            │ │  WAF + │ │            │ │  WAF + │ │           │ │  WAF + │ │
            │ │  Rate  │ │            │ │  Rate  │ │           │ │  Rate  │ │
            │ │ Limiter│ │            │ │ Limiter│ │           │ │ Limiter│ │
            │ └───┬────┘ │            │ └───┬────┘ │           │ └───┬────┘ │
            │     │      │            │     │      │           │     │      │
            │ ┌───▼────┐ │            │ ┌───▼────┐ │           │ ┌───▼────┐ │
            │ │  URL   │ │            │ │  URL   │ │           │ │  URL   │ │
            │ │Service │ │            │ │Service │ │           │ │Service │ │
            │ │(N pods)│ │            │ │(N pods)│ │           │ │(N pods)│ │
            │ └─┬───┬──┘ │            │ └─┬───┬──┘ │           │ └─┬───┬──┘ │
            │   │   │    │            │   │   │    │           │   │   │    │
            │ ┌─▼─┐ │    │            │ ┌─▼─┐ │    │           │ ┌─▼─┐ │    │
            │ │Red│ │    │            │ │Red│ │    │           │ │Red│ │    │
            │ │is │ │    │            │ │is │ │    │           │ │is │ │    │
            │ │ cl│ │    │            │ │ cl│ │    │           │ │ cl│ │    │
            │ └───┘ │    │            │ └───┘ │    │           │ └───┘ │    │
            │       │    │            │       │    │           │       │    │
            └───────┼────┘            └───────┼────┘           └───────┼────┘
                    │                         │                         │
                    │     ┌───────────────────┴─────────────────────────┘
                    │     │
                    ▼     ▼
            ┌──────────────────────────┐
            │  Primary Database (DB)   │  Sharded by shortcode hash.
            │  (Postgres or DynamoDB)  │  Multi-region: regional writes
            │                          │  go to a primary in one region,
            │                          │  read replicas in every region.
            └────────────┬─────────────┘
                         │  CDC / outbox
                         ▼
            ┌──────────────────────────┐
            │  Click Stream Pipeline   │  Kafka → ClickHouse / BigQuery
            │  (async, off hot path)   │  Aggregated click counts per
            │                          │  shortcode, 1-minute rollup.
            └──────────────────────────┘
```

Component responsibilities:

- CDN / edge cache. Caches the 302 for popular shortcodes. TTL is short (60s) so we can revoke phishing links. Most redirects never touch origin.
- Global LB + Anycast. One IP, routed to the nearest healthy region. Removes a DNS round-trip and gives failover for free.
- WAF + Rate Limiter. WAF for obvious abuse (SQL injection in custom alias, etc.). Rate limiter caps `POST /links` per IP and per account.
- URL Service. Stateless. Owns the counter range, talks to local cache, falls back to DB on miss. Fires click events to Kafka asynchronously.
- Regional Redis. Caches reads. Replicated within the region for HA. Inter-region cache is not shared; a miss in eu-west goes to the database, not to us-east's Redis.
- Sharded DB. One primary region for writes (multi-master sharded DBs are a lot more complex than this problem needs). Read replicas everywhere.
- Click pipeline. Kafka with 7-day retention, ClickHouse or BigQuery for aggregation. A streaming job emits per-shortcode click counts every minute. The result is written to a counter store (separate from the primary DB) that the UI reads.

### 7. Read path vs write path

**Write path (`POST /links`)**

1. Client → CDN → LB → Regional API Gateway → URL Service.
2. WAF and rate limiter. Rate limit: 100 links/hour for anonymous, 10,000/hour for authenticated, scoped by IP and account.
3. Pre-flight URL validity check (DNS resolvable, not on local blocklist).
4. If `custom_alias` is given: atomic `INSERT... ON CONFLICT DO NOTHING` on the shortcode. If it returns 0 rows, 409.
5. Otherwise: pop the next ID from the local counter range. If empty, fetch a new range from the coordinator (the only call to a global service in the write path).
6. Scramble (XOR with secret), base62 encode.
7. `INSERT` into DB sharded by hash(shortcode). If insert fails on duplicate shortcode (range allocation bug), bump ID and retry.
8. Write to local Redis with a short TTL (60s). Let the read path populate longer-lived entries.
9. Fire-and-forget event to Kafka `link_created` topic.
10. Async safe-browsing API call. If flagged, set status to `blocked` (3) and invalidate cache.
11. Return 201 with the shortcode.

P99 target: 200ms. Bottleneck is the synchronous DB insert; counter range fetches are too rare to matter.

**Read path (`GET /<shortcode>`)**

1. Browser → CDN. If cached and not expired, return 302 directly. **80%+ of hot URL traffic should never reach origin.**
2. CDN miss → LB → Regional URL Service.
3. URL Service checks Redis. If hit and `status=active`, return 302. **~5ms.**
4. Redis miss → DB read (regional read replica). If found and active, write to Redis with a 1-hour TTL for hot keys (with random jitter to avoid synchronized expiry), then return 302. **~30-50ms.**
5. DB miss → 404.
6. Status `expired` (2) → 410.
7. Status `blocked` (3) → 451.

In parallel, fire a click event to Kafka. **Never block the redirect on analytics.**

P99 target: 50ms regional, 100ms cross-region. With CDN, most users see <20ms.

### 8. Scaling

#### a. Caching strategy

- Cache key: the shortcode.
- Cache value: long URL + status + expires_at (so 410 is returnable without touching the DB).
- TTL: 1 hour with ±10% jitter. Jitter prevents synchronized expiry from stampeding the DB.
- Eviction: LRU. The hot set is small enough that the working set fits.
- Write-through, not write-back. On `POST`, write the DB first, then populate cache. Write-back risks losing brand-new links if the cache node dies.
- Cache invalidation. Two reasons: link is blocked (phishing) or link is deleted. On state change, publish to a Redis pub/sub channel that all URL Service instances subscribe to; each instance evicts the affected key from its local cache.

#### b. Database sharding

- Shard key: hash(shortcode). Spreads writes and reads evenly. A sequential ID shard key would hotspot.
- 64 shards to start. Easy to add more with consistent hashing; harder to remove. Start over-provisioned.
- Indexes per shard. PK on shortcode; secondary on `(creator_id, created_at)` for the "my links" page; secondary on `(creator_id, long_url_hash)` for dedup.

#### c. Read replicas

- One primary per shard in the home region. Read replicas in every other region. Replication lag SLO: 1 second P99.
- Reads go to the closest replica; writes always to the primary. Eventually consistent is fine; a redirect lagging by 1 second is invisible to users.

#### d. CDN

- Cache 302 responses by shortcode. TTL 60 seconds.
- Trade-off: longer TTL means more cache hits but slower phishing revocation. 60 seconds is the sweet spot. If a link is flagged, it can still serve from CDN for up to 60s.
- For known-suspicious links: set `Cache-Control: no-store` so the CDN never caches them. They become hot for the origin, but they're a tiny slice of traffic.

#### e. Geographic distribution

- Three regions (us, eu, ap). Each has its own URL Service, Redis, and DB read replicas.
- Writes route to the home region. If that region goes offline, writes fail but reads keep working. For a URL shortener this trade-off is fine (writes are rare; reads have to work).
- For higher write availability you'd adopt a leaderless multi-region DB (DynamoDB Global Tables, Spanner). That's a more complex answer and only justified at YouTube/TikTok scale.

### 9. Reliability

- Cache failure. If Redis is down, reads fall through to the DB. The DB can't sustain 15k req/s for long. Mitigation: shed traffic (503 with `Retry-After`), and have the URL Service detect Redis health and switch to a self-protective slow path with stricter rate limits.
- DB primary failure. Promote a replica. Writes are unavailable for 30 to 60 seconds (typical Postgres failover). Reads keep working from other replicas. The counter coordinator must not lose state here; back it with Postgres or use ZooKeeper.
- Counter coordinator failure. The scariest one. If the coordinator hands the same range to two instances, you get duplicate shortcodes. Mitigation: range allocations are logged to a durable ledger; on coordinator startup it reads the ledger and refuses to re-allocate any range it has already given out. Each URL Service also writes its own "I am using range X" record, so on misbehavior the ranges can be reconciled.
- Multi-region failure. Detected by the global LB; traffic shifts to healthy regions. Cache in the failed region is cold elsewhere; expect a 5-minute degraded latency window after the swap.

### 10. Observability

What must be instrumented from day one:

| Metric | Why |
|--------|-----|
| `redirect.latency` by region, p50/p95/p99 | The headline SLO |
| `redirect.cache_hit_rate` | If this drops below 80% something is wrong |
| `redirect.404_rate` | Spikes indicate scrapers; can become a signal for new rate limit rules |
| `create.latency` p50/p99 | Slow creates indicate counter coordinator or DB problems |
| `create.dedup_rate` | If 30%+ of POSTs are dedups, your clients are buggy |
| `counter.range_fetches_per_sec` | Should be roughly QPS / 10000 |
| `counter.range_age_max` | Alerts on coordinators stuck |
| `safe_browsing.flagged_rate` | Sudden spike = abuse campaign |
| `kafka.click_event_lag` | If clicks lag by >5 min, analytics is stale |
| `db.replication_lag_p99` | Should be under 1s |

Alerting:
- Page on: redirect P99 > 200ms for 5min, cache hit rate < 70% for 5min, create error rate > 5%.
- Ticket on: dedup rate spike, 404 rate spike (could be scraping, or someone deleted a popular link).

### 11. Follow-up answers

**1. Two users submit the same long URL within milliseconds.**

If both are anonymous: different shortcodes. Privacy-preserving and avoids accidentally linking two devices.

If both are the same authenticated user: dedup. Flow:
- Compute `sha256(long_url)`.
- `SELECT shortcode FROM short_links WHERE creator_id = ? AND long_url_hash = ? LIMIT 1`.
- Hit: return existing.
- Miss: INSERT with the hash.

The race: both requests miss the SELECT and both proceed to INSERT. Fix it with a unique index on `(creator_id, long_url_hash)` and `INSERT... ON CONFLICT (creator_id, long_url_hash) DO UPDATE SET... RETURNING shortcode`. The second INSERT gets the first's shortcode back. Idempotent under concurrency.

If they want different shortcodes despite the same URL: add a `force_new=true` query parameter that skips the dedup lookup.

**2. Custom aliases (atomic reservation).**

```sql
INSERT INTO short_links (shortcode, long_url, creator_id, custom_alias)
VALUES ($alias, $url, $user, TRUE)
ON CONFLICT (shortcode) DO NOTHING
RETURNING shortcode;
```

If `RETURNING` is empty, the alias was taken. Return 409. Atomic at the DB level. No extra locking.

The annoying case: aliases that look like generated shortcodes (`abc1234`). Reserve a namespace: custom aliases must be at least 4 chars and contain at least one non-base62 character (hyphen or underscore), or be at least 8 chars. Kills the conflict between the two pools without runtime checks.

**3. Hot key problem (one shortcode getting 100K req/s).**

Symptoms: that one Redis key absorbs all the load. CPU on the Redis shard owning the key pegs at 100%, P99 latency for everyone else on that shard degrades, and you start dropping traffic.

Mitigations in order of complexity:

1. CDN. First line of defense. If 99% of the 100K req/s hits the CDN, Redis sees 1000 req/s for that key, which it handles fine.
2. Read-only replicas of the hot key. Redis has read replicas; the URL Service round-robins across them. Multiplies hot-key throughput by N.
3. In-process LRU cache on the URL Service. A 1000-entry in-process cache with 60s TTL turns 100K Redis reads into a few dozen. Cheapest, biggest win.
4. Probabilistic refresh (request coalescing). If the cache entry is about to expire, only one goroutine refreshes it; the rest get the stale value. Prevents thundering herd on expiry.

Tier all four. For YouTube-trailer-scale virality, also pre-warm: when a marketing team is about to announce something, push the entry to every region's cache in advance.

**4. Phishing detection.**

The write path can't wait for Google Safe Browsing (200-500ms call). The approach:

- At create time: synchronous check against a small in-memory bloom filter of known-bad domains. Misses rarely; catches the worst.
- Asynchronously: queue the new URL for safe-browsing verification via Kafka. A separate worker calls the external API. If flagged, set `status=3 (blocked)` and broadcast cache invalidation.
- Continuously: a nightly job re-scans URLs created in the last 30 days. New phishing campaigns sometimes weaponize previously-clean URLs.

The trade-off: a phishing URL can be live for a few minutes before being blocked. To shrink the window, send the URL to safe-browsing **before** returning from create, but only block on the response if it lands within 50ms. After that, return success and let the async pipeline catch late detection. Tail-latency vs accuracy.

**5. Click count analytics.**

Each redirect can't do a DB write. 1500 req/s of `UPDATE short_links SET clicks = clicks + 1` would melt the DB and serialize writes on hot rows.

Pipeline:
- Redirect emits an event to Kafka (`{shortcode, ts, ip_hash, ua_hash}`).
- A streaming job (Flink or KSQL) aggregates per shortcode in 1-minute windows.
- Aggregate writes to a counter store (Redis INCR is fine for the rolling count; ClickHouse for the time series).
- UI queries the counter store, not the primary DB.

Consistency: eventually consistent, 1-2 minutes behind. Fine for 99% of cases. If someone wants real-time-exact, point them at the raw Kafka stream and explain the cost.

**6. Custom domains.**

`shrt.acme.com/abc1234` instead of `shrt.ly/abc1234`. Changes:

- TLS. Need a wildcard or per-customer cert. Either provision via Let's Encrypt automation per domain, or use a wildcard cert across a domain you own.
- Routing. Load balancer SNI-routes incoming TLS to the URL Service. The service reads the Host header and looks up which tenant owns it.
- Database. Add a `tenant_id` column to `short_links`, and a `custom_domains` table mapping domain to tenant. Shortcodes are now scoped per tenant; the same `abc1234` can exist for two tenants.
- Migration. Existing shortcodes get an implicit `tenant_id = 0` (the default shrt.ly tenant). All new schema queries scope by tenant.
- DNS. Customer CNAMEs their domain to your LB. You handle the rest.

**7. Link expiration with retention.**

Three states: `active`, `expired`, `deleted`. Distinct because:
- Expired links return 410, but the row stays for analytics ("how many clicks before it expired?").
- Deleted links are gone. You may even hash-blank the long_url for GDPR.

Cache TTL is independent of the link's `expires_at`. A nightly batch job sets `status=2 (expired)` on rows where `expires_at < now()`. Cache entries expire naturally and the re-fetch picks up the new status.

For storage: keep expired rows in cold storage tables. Move to S3 after 6 months. Analytics retains references.

**8. Thundering herd on cache miss.**

A popular URL's cache entry expires. Suddenly 10k req/s hit the DB for that one row. The DB CPU spikes.

Mitigations:
- Jittered TTLs. Top 1% of keys should not expire in the same second.
- Request coalescing. On a cache miss, the URL Service grabs a per-key in-process lock. The first request fetches from DB and populates cache; the rest wait on the lock and read the populated value. 10k concurrent misses become 1 DB read.
- Stale-while-revalidate. Serve the stale value while one goroutine refreshes. The same idea as HTTP `stale-while-revalidate`, implemented at the cache layer.

**9. GDPR delete.**

User asks for all their data deleted.

- Find: scatter-gather across all 64 shards. `WHERE creator_id = ?` runs in parallel; results are unioned.
- Delete or anonymize: either DELETE the rows, or NULL out `long_url`, `creator_id`, and set `status=4 (gdpr_deleted)`. Keep the shortcode reservation so the code isn't reissued to someone else.
- Click history: anonymize the analytics records too. Hash the user identifier; drop any PII (IP).
- Cache: publish a pub/sub event to evict all of this user's keys from all caches.
- Confirm completion to the user within the regulatory window (30 days in most jurisdictions).

The scatter-gather is the expensive part. If you expect many GDPR requests, maintain a secondary index from `creator_id` to all their shortcodes in a dedicated index table.

**10. Counter coordinator misbehavior.**

Scenario: Redis (the coordinator) failed over, the replica had stale state, and it handed the range [10000, 20000] to instance A while instance B already had that range.

Detection:
- Each URL Service writes a row to a `range_allocations` table at allocation time: `(range_start, range_end, instance_id, allocated_at)`.
- A periodic job checks for overlapping ranges and alerts immediately.

Recovery:
- For all overlapping IDs, scan the DB to find which (if any) actually got used. Mark the conflicts (at most a few hundred duplicates).
- For each duplicate shortcode that ended up with two different `long_url` values: this is the disaster case. Decide whose long_url to honor. In practice, keep the earlier one and contact the second user to apologize and reissue.
- Tighten the coordinator: never run a single coordinator without a strongly-consistent backing store. Use Postgres with a sequence, or ZooKeeper, instead of Redis.

A real "what would you do at 3am" scenario. The senior answer covers detection, recovery, and prevention in one breath. The mid-level answer only covers prevention.

### 12. Trade-offs worth saying out loud

- Why no multi-master DB. You could use DynamoDB Global Tables or Spanner. The write-latency cost and operational complexity are rarely worth it at URL-shortener traffic. Single-primary with read replicas is the right answer at this scale.
- Why not blockchain or content-addressed storage. Sometimes asked as a curveball. Answer: deterministic hash-addressed URLs lose the ability to change targets (for moderation). Mutability is a feature here.
- Why no analytics database optimization upfront. Premature. Ship the basic Kafka to ClickHouse pipeline. Optimize after you see real query patterns.
- What I'd revisit at 10x scale:
 - Move counter allocation entirely client-side with a Snowflake-style ID (machine ID + timestamp + sequence). Coordinator gone.
 - Adopt a tiered cache (in-process LRU, regional Redis, DB) explicitly, not as an emergent property.
 - Re-evaluate the DB. Postgres at 64 shards is workable but Cassandra or DynamoDB starts winning on operations.

### 13. Common interview mistakes

- Diving straight into "use Redis and a database." No clarification, no math, no API. Loses the candidate immediately.
- Hashing the long URL with MD5 and assuming no collisions. Birthday paradox: at 6B URLs you'll have lots. Either acknowledge the collision handling or use a counter.
- Ignoring analytics. Click counts are part of every URL shortener. A senior candidate mentions the async pipeline even if not asked.
- Cache invalidation hand-wave. "We'll just use TTLs" is fine for routine eviction but doesn't cover blocked links needing immediate revocation. Mention the pub/sub eviction.
- No mention of phishing. It's a real operational issue. Acknowledge it.
- Over-engineering. Don't propose a globally distributed multi-master CRDT-backed KV store unless asked. Match the design to the stated scale.
- Ignoring the hot-key problem. You'll be asked. Read replicas and in-process caches are the answers.

If you hit 8 of those 13, you're interviewing well.
{% endraw %}
