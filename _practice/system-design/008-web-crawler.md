---
layout: practice-problem
track: system-design
problem_id: 8
title: Design a Web Crawler (Googlebot)
slug: 008-web-crawler
category: Distributed Systems
difficulty: Hard
topics: [bfs, frontier, deduplication, politeness, distributed coordination]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/008-web-crawler"
solution_lang: markdown
---

{% raw %}
## Scene

Second slot of the loop. The interviewer worked on Google's indexing pipeline a long time ago and wants a war-game. They pull up a whiteboard tab and write one line:

> *Design a web crawler at Google's scale. Walk me through it.*

Then they wait. Most candidates start by drawing a queue and a worker pool. At this scale that gets you the wrong answer, because the system breaks for reasons that have nothing to do with the queue. Slow down. Figure out what kind of crawler this is before you commit to a shape.

## Step 1: clarify before you design

Take 5 minutes. The shape of the system changes a lot depending on what is being crawled and why. Write down at least seven questions before you peek.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. Scope. "HTML only, or also images, video, PDFs, JavaScript-rendered pages?" The default Googlebot answer is HTML first, a separate render path for JS-heavy pages, and a separate pipeline for media. Assume "everything in one pass" and you will design a much larger and slower system than the interviewer wanted.
2. Seed set. "What are we starting from? A seed list, sitemaps, or the existing web graph?" Cold-starting a crawler is a different problem from running an established one. Real crawlers always have an existing frontier; they never start from zero in production.
3. Freshness target. "How fresh must the index be? Hourly for news, daily for the rest, monthly for dormant pages?" This drives the recrawl scheduler, which is often a bigger system than the discovery crawler.
4. Politeness rules. "Do we respect robots.txt strictly? What is the default per-host rate? What is the SLA back to webmasters?" One stranger's site should never be melted by your crawler. Non-negotiable.
5. Output shape. "What does the crawler produce? Raw HTML to a blob store, parsed text to an indexer, structured records?" Most candidates skip this and end up with no plan for what happens after the fetch.
6. Scale and budget. "Pages per day? Hosts? Bandwidth budget? Storage budget?" 5 billion fetches per day at 100KB per page is 500TB per day. If the interviewer says 1 billion pages per day, the storage problem is a tenth the size.
7. JavaScript rendering. "Do we render with a headless browser, or only static HTML?" Rendering is 10x to 100x more expensive than a plain fetch. Treat it as a separate, smaller pipeline.
8. Trust and abuse. "How do we deal with crawler traps, infinite calendar URLs, spam farms, soft 404s?" The interviewer wants to see whether you understand the adversarial parts of the open web.

If you only asked "how many pages per day", you skipped politeness, scope, and freshness, which together account for most of the design's complexity. Politeness in particular is a load-bearing constraint, not an afterthought.

</details>

## Step 2: capacity estimates

Suppose the interviewer hands you these numbers:

- Crawl target: 5 billion pages per day (the public web is roughly 50 to 100 billion useful pages; we recrawl the most useful subset frequently and the long tail rarely)
- Average HTML page size: 100KB compressed, ~500KB uncompressed
- Average outlinks per page: 20
- Total URLs known to the system (frontier plus already-seen): 50 billion
- Distinct hosts in the frontier: 500 million
- Default politeness: 1 request per host per second
- Time horizon for storage: 30 days hot, then archived

Do the math yourself before revealing:

1. Fetches per second (sustained, peak)
2. Bandwidth in and out at peak
3. Storage per day for raw HTML, and total for 30 days
4. Storage for the URL frontier and the seen-URL dedup index
5. Concurrent host slots needed, given the per-host rate limit and the daily target
6. Fetcher node count, given one fetcher sustains around 500 simultaneous TCP connections

<details>
<summary><b>Reveal: the math</b></summary>

Fetches per second. 5B / 86400 = ~58K fetches/sec sustained. Peak 2x to 3x, call it 150K fetches/sec peak.

Bandwidth. At 100KB per page compressed, ingress = 58K × 100KB = 5.8 GB/sec sustained, ~17 GB/sec peak. Roughly 50 to 150 Gbps of inbound bandwidth across the fleet. Real Googlebot pulls more than this; we are sizing one well-fed crawler.

Storage for raw HTML. 58K/sec × 86400 = 5B pages/day × 100KB = 500TB/day of compressed HTML. 30 days hot = 15PB. After dedup by content hash, expect 20% to 40% savings because near-identical templates show up everywhere. Round to ~10PB hot.

URL frontier storage. 50 billion URLs. A canonicalized URL averages ~80 bytes. Add metadata (host_id 4 bytes, priority float 4 bytes, scheduled_at 8 bytes, attempt_count 1 byte, parent ref 8 bytes) and you get ~110 bytes per row. 50B × 110 = ~5.5TB of frontier metadata. Sharded, fits comfortably.

Seen-URL dedup index. 50B URLs, each a 128-bit hash in a Bloom filter. A Bloom filter with 50B elements at 1% false positive rate needs ~10 bits per element = 500 Gbit = ~60GB total. Tiny. The whole filter sits in memory across a small cluster.

Concurrent host slots. Per-host rate limit = 1 req/sec, so one host delivers 1 page/sec. We need 58K pages/sec, so at least 58K hosts being crawled in parallel at any moment. With 500M hosts in the frontier, hosts are not scarce. The constraint is: do not stack two simultaneous fetches against the same host.

Fetcher node count. One fetcher node sustains 500 concurrent connections, each connection averages a 1 second fetch (DNS + TCP + TLS + GET + body), so one node = 500 fetches/sec. 150K/sec peak means ~300 fetcher nodes. Add 50% headroom: ~450 nodes.

The point the math leaves you with: storage is large but tractable, bandwidth is large but linear. The real complexity is coordination between 450 nodes that must collectively respect 1 req/sec per host across 500M hosts, with dedup across 50 billion URLs.

</details>

## Step 3: BFS-like exploration

A crawler is a graph traversal of the web. URLs lead to other URLs through outlinks. Classical BFS visits one level at a time. In a real crawler you cannot do strict BFS because:

- The graph is infinite (calendars, parameter combinations, search result pages).
- Most pages are not equally important; you want to spend disk on the useful ones.
- Politeness forces you to interleave hosts, not chase a single host depth-first.

Before reading on, decide: what governs the order of URL visits in your crawler? What data structure holds pending URLs? How do you ensure you do not crawl the same URL twice?

<details>
<summary><b>Reveal: priority frontier, not pure BFS</b></summary>

The frontier is a priority queue, not a FIFO. Each URL gets a score based on:

- Estimated importance (PageRank, inlink count, or a learned signal).
- Freshness need (news every hour, static pages monthly).
- Discovery freshness (newly found URLs go in with a default priority).
- Penalties for traps (URLs from known-trap patterns get lowered or dropped).

URLs are popped in priority order, subject to politeness. The "BFS-like" description is loose: yes, we explore outlinks of fetched pages, but ordering is by priority, not by depth.

Dedup has two layers:

1. URL dedup. Canonicalize the URL (lowercase host, sort query parameters alphabetically, strip session tokens like `?sid=`, drop `#frag`, normalize trailing slashes). Hash the canonical form. Check the Bloom filter; if probably-new, do a confirming lookup in a sharded KV store. If new, add to the frontier and mark seen.
2. Content dedup. After fetching, hash the meaningful content (strip ads, headers, footers, then hash). If the content hash matches one already stored, we still record the URL but link it to the canonical content. This catches mirror sites and duplicate templates.

Depth vs breadth control. Each URL carries a depth-from-seed counter. Past depth ~20 you almost always stop, because past depth 20 you are inside a calendar widget or a session-token-paginated search result. We also rate-limit "how many URLs we accept from one host per day" so a single trap site cannot flood the frontier.

</details>

## Step 4: sketch the high-level architecture

Fill in the five `[ ? ]` placeholders. Think about where the URLs to crawl live, what fetches them, what extracts links, where raw HTML is stored, and what prevents duplicates.

```
                      seed URLs                  outlinks from fetched pages
                          │                                    │
                          ▼                                    │
                  ┌──────────────────┐                         │
                  │   [ ? ]          │ ◄───────────────────────┘
                  │ (holds URLs to   │
                  │  crawl, ordered) │
                  └────────┬─────────┘
                           │ pop next batch (respecting politeness)
                           ▼
                  ┌──────────────────┐
                  │   [ ? ]          │
                  │ (talks HTTP to   │
                  │  the open web)   │
                  └────────┬─────────┘
                           │ raw HTML
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌──────────────┐       ┌──────────────┐
        │   [ ? ]      │       │   [ ? ]      │
        │ (durable     │       │ (parses HTML │
        │  storage of  │       │  and emits   │
        │  the page)   │       │  new links)  │
        └──────────────┘       └──────┬───────┘
                                      │
                                      ▼
                              ┌──────────────┐
                              │   [ ? ]      │
                              │ (was this    │
                              │  URL seen?)  │
                              └──────────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
                      seed URLs                  outlinks from fetched pages
                          │                                    │
                          ▼                                    │
                  ┌──────────────────┐                         │
                  │   URL Frontier   │ ◄───────────────────────┘
                  │  (priority queue │
                  │   sharded by     │
                  │   host hash)     │
                  └────────┬─────────┘
                           │ pop next batch (per-host token bucket gates release)
                           ▼
                  ┌──────────────────┐
                  │  Fetcher Pool    │   ~450 nodes.
                  │  (HTTP/HTTPS,    │   Each node owns a slice of hosts.
                  │   DNS cache,     │   500 concurrent fetches per node.
                  │   robots.txt)    │   Honors crawl-delay header.
                  └────────┬─────────┘
                           │ raw HTML + headers + status
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌──────────────┐       ┌──────────────┐
        │ Content      │       │ Link         │
        │ Store        │       │ Extractor    │
        │ (S3/GCS by   │       │ (parse HTML, │
        │  content     │       │  canonicalize│
        │  hash; meta  │       │  outlinks,   │
        │  in KV)      │       │  filter)     │
        └──────────────┘       └──────┬───────┘
                                      │ candidate new URLs
                                      ▼
                              ┌──────────────┐
                              │ Dedup Index  │   Bloom filter + sharded KV.
                              │ (seen URLs   │   "Probably new?" then confirm
                              │  hash set)   │   "definitely new" then frontier.
                              └──────────────┘

  Side flows (not shown in detail):
    - robots.txt cache, per-host, refreshed every 24h.
    - DNS cache, per-host, refreshed on TTL.
    - Recrawl scheduler: a separate job that re-injects already-seen URLs
      back into the frontier on their refresh cadence.
    - Trap detector: scans patterns in the frontier; downgrades or drops
      suspicious branches.
```

Component responsibilities:

- URL Frontier. The brain. Priority queue per host. Sharded so all URLs for a given host land on the same shard, which makes politeness a single-node decision.
- Fetcher Pool. The dumb hands. Stateless workers that take a batch of URLs from the frontier, fetch them with appropriate headers, and emit results. DNS cache and robots.txt cache live near the fetcher to avoid hammering DNS and webmasters.
- Content Store. Raw HTML in object storage, addressed by content hash. Metadata (URL, fetched_at, status code, content hash, parent URL) in a sharded KV store keyed by URL hash.
- Link Extractor. Parses HTML, finds `<a href>` and equivalent link sources (sitemap-driven, canonical link rel), canonicalizes each URL, filters obvious junk (mailto:, javascript:, fragment-only), and emits candidate URLs to the dedup index.
- Dedup Index. Bloom filter first ("probably seen"), then a sharded KV confirms. Only confirmed-new URLs go back to the frontier.

</details>

## Step 5: politeness

The single feature most candidates skip and most interviewers grade on. The open web is run by people you have never met. If your crawler hammers their site, three things happen: their site goes down, your IP gets blocked, and they file a complaint with your abuse desk. Politeness is non-negotiable, and it is the constraint that shapes coordination.

Before reading: what are the politeness rules and where in the architecture do they live?

<details>
<summary><b>Reveal: politeness mechanisms</b></summary>

robots.txt.

- Before fetching any URL on a host, GET `https://host/robots.txt`. Cache the result for 24 hours per host.
- Parse the directives: `User-agent`, `Disallow`, `Allow`, `Crawl-delay`, `Sitemap`. Match against your crawler's user agent string.
- If robots.txt cannot be fetched (5xx, timeout) treat the host as "crawl with caution". Some crawlers default to allowed, some default to disallowed. The safe default is to skip until robots.txt is readable, which is what major crawlers do.
- A 404 on robots.txt means "no rules, fetch freely" by RFC 9309.
- The robots.txt cache lives next to the fetcher, not in the frontier. The frontier knows nothing about robots.txt; the fetcher refuses to fetch URLs that violate it and feeds back a "skipped: disallowed" event.

Per-host rate limit.

- Default: 1 request per second per host. Honor `Crawl-delay` if specified.
- Implemented with a token bucket per host. The bucket holds N tokens with refill rate R. To fetch a URL on host H, the fetcher consumes a token from H's bucket. If empty, the URL is requeued with a delay.
- Aggressive hosts (large news sites with explicit agreements) may be opted into higher rates. Configurable per host.
- The bucket lives on the frontier shard that owns the host, not on every fetcher. That is why we shard the frontier by host hash: it makes the bucket a single-node decision.

HTTP status backoff.

- `200`, `301`, `302`: success, follow normally.
- `404`: record, do not retry.
- `403`: record as disallowed, do not retry for 7 days.
- `429 Too Many Requests`: honor `Retry-After`, double the per-host crawl-delay, exponential backoff on repeat.
- `503 Service Unavailable`: same as 429.
- `5xx` repeated: exponential backoff with jitter; after N failures (say 5 over 24h) treat the host as down and recrawl much less frequently.
- Connection timeouts: penalize the host's "health score". If health drops below threshold, the host is parked in a slow-lane queue.

User agent.

- Identify yourself: `Mozilla/5.0 (compatible; MyCrawler/2.0; +https://example.com/crawler-info)`.
- The URL in the user agent leads to a page explaining your crawler and how to block it. This is a baseline expectation by webmasters; missing it is rude.

Bandwidth caps.

- Per-host: do not pull more than X MB per day from one host without explicit allowance. Stops you from accidentally pulling a multi-GB site mirror.
- Per-network: respect bandwidth limits across your own datacenter egress.

Why this matters for design. Politeness, taken seriously, means each host has state (rate-limit tokens, last-fetched timestamp, health score, robots.txt cache, crawl-delay). That state must be consistent across the crawler. If two fetchers think they can each fetch from `example.com` at the same instant, you have failed politeness. This is why the frontier shards by host: all decisions about a host happen on one node.

</details>

## Step 6: distributed coordination

You have ~450 fetcher nodes. They share a 50-billion-URL frontier. They must collectively crawl 5B pages/day without duplicating work and without violating per-host rates. How is the work divided?

Three serious options. For each, ask: what happens when a node dies? What happens when a host has an outsized fraction of URLs? How is per-host politeness enforced?

<details>
<summary><b>Reveal: hash-partition by host</b></summary>

Option A: every fetcher pulls from a single shared queue.

Pros: simple. Cons: every fetcher coordinates with every other fetcher about politeness ("are you about to fetch from example.com? then I won't"). At 450 nodes, this is N² gossip and it does not scale.

Option B: hash by URL.

Pros: even load. Cons: URLs from the same host land on different shards. Politeness now requires cross-shard coordination on every fetch. Same N² problem.

Option C: hash by host.

```
shard_id = hash(host) mod num_shards
```

Each frontier shard owns a slice of hosts. All URLs for `example.com` live on one shard. That shard:

- Holds the priority queue for those hosts' URLs.
- Holds the per-host token bucket and rate-limit state.
- Holds the robots.txt cache for those hosts.
- Holds the per-host health score.

When a fetcher needs work, it asks a specific shard for a batch of URLs that are safe to fetch right now (politeness satisfied). The shard picks N URLs across N different hosts that have available tokens, and hands them to the fetcher. The fetcher does the IO, returns the results, and the shard updates state.

This is the standard pattern. Almost every large crawler is structured this way.

Failure handling.

- If a frontier shard dies, all hosts on that shard are temporarily unavailable. Replicate the shard (Raft, or primary + warm standby). Cassandra/DynamoDB-style replication works; the consistency needs are not strict (we already tolerate a few duplicate fetches).
- If a fetcher dies mid-batch, the URLs it had reserved time-out and become available again. Use a lease pattern: fetcher gets URLs with a 60-second lease; if not acknowledged within the lease, they go back into the queue.

Hot host.

- One host has 50M URLs in the frontier. The shard owning that host is hot. Mitigation:
 - Cap the per-host pop rate: even if the bucket is full, never hand out more than K URLs per second for one host, regardless of how starved the queue is for that host.
 - Spill the host's URLs to secondary storage; only keep the top-priority subset hot in the queue.
 - For truly huge hosts (Wikipedia, GitHub), split by sub-host or by URL hash within the host onto multiple shards, but coordinate the token bucket separately. The rare exception.

Fetcher-to-shard assignment.

- Fetchers are not assigned to shards. Any fetcher can pull from any shard. The fetcher chooses which shard to pull from based on consumer-fairness (round-robin) or based on which shards have available work (push from shards).
- Keeps fetchers stateless and lets them auto-scale on CPU/network.

</details>

## Step 7: read the full solution

You have covered the four hard parts: priority frontier, content and URL dedup, politeness, and host-sharded coordination. The solution covers data models, recrawl scheduling, JavaScript rendering, trap detection, multi-region distribution, and the day-2 reliability problems.

## Follow-up questions

Try answering each in 3 to 4 sentences before reading the solution.

1. Crawler trap. A site has a calendar widget that links to `?date=2026-05-23`, `?date=2026-05-24`, and so on for the next 10,000 years. Your crawler dutifully follows every link. How do you detect and stop this without hardcoding a list of trap sites?
2. Soft 404. A site returns HTTP 200 with a body that says "Page not found, sorry". You add it to your index. Later you discover the entire site is identical "not found" pages with different URLs. How do you detect this in the pipeline?
3. JavaScript-rendered content. A modern SPA returns an empty `<div id="root">` and loads everything via JS. The link extractor finds zero outlinks. What is the pipeline change to handle these pages?
4. Recrawl scheduling. A news site posts 100 articles per day. A dormant blog posts once a year. You want news pages refreshed within an hour and the blog refreshed monthly. How do you decide each URL's recrawl interval without hand-tuning per site?
5. Frontier persistence. A frontier shard's machine reboots. You have 5 billion URLs queued in that shard. How is the queue persisted across restarts without making every push a synchronous disk write?
6. Distributed Bloom filter coordination. The Bloom filter for "have we seen this URL" is 60GB. You shard it across 8 nodes. Two fetchers in different regions encounter the same new URL at the same time and both try to add it. How do you avoid double-adding to the frontier?
7. Two URLs serve identical content. `example.com/article/123` and `example.com/article/123?utm=email` are the same page. Both got fetched. How does the storage layer recognize and consolidate them, and what does the index see?
8. A new important domain is launched. It has 1 million internal pages and the world starts linking to it heavily. Your default per-host rate of 1 req/sec means you need ~12 days to crawl it. How do you accelerate ethically?
9. Spam farm. An adversary generates 10 million auto-generated low-value pages on cheap domains that interlink and link to a target site to manipulate ranking. How does the crawler avoid wasting capacity on them?
10. Geo-distributed targets. A French news site is hosted in France. Your fetchers are in us-east. Each fetch takes 200ms of round-trip. How do you cut the latency without spinning up a full crawler in every region?

## Related problems

- [Rate Limiter (004)](../004-rate-limiter/question.md). Per-host politeness is exactly a token-bucket rate limiter at huge cardinality. The data structures and edge cases transfer directly.
- [Distributed Cache (009)](../009-distributed-cache/question.md). The dedup index, robots.txt cache, and DNS cache all share the same sharded-cache patterns. The eviction and consistency trade-offs there are foundational here.
- [Typeahead Autocomplete (005)](../005-typeahead-autocomplete/question.md). Both this and typeahead have a batch pipeline that transforms raw input into a serving-side index. The pipeline shape (Kafka spine, stateless workers, periodic compaction) is the same.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Web Crawler (Googlebot)

### TL;DR

A crawler at this scale is a distributed graph traversal where the constraints are not data structures but etiquette, deduplication, and coordination. The frontier is a priority queue, not a FIFO. Hash-by-host sharding makes per-host politeness a single-node decision instead of a fleet-wide gossip problem. Dedup happens at two layers (URL canonicalization, content hash) and a Bloom filter keeps the hot path cheap. Recrawl is a separate pipeline from discovery and runs on its own cadence.

One queue-like component (the frontier), one fleet of stateless fetchers, two stores (raw content addressed by content hash, metadata keyed by URL hash), and several caches (DNS, robots.txt, dedup). The hard engineering is in: deciding when not to fetch (traps, soft 404s, spam farms), spreading load fairly across hundreds of millions of hosts, surviving hot hosts and failed shards, and producing a stable output stream into the downstream indexer.

The trade-offs worth lingering on are BFS vs priority ordering, strict URL dedup vs content dedup, aggressive recrawl vs politeness, and in-house JavaScript rendering vs skipping JS-only pages.

### 1. Clarifying questions

Covered in `question.md`. The most consequential one is scope: HTML-only versus HTML + JS-rendered versus HTML + media. Each adds a separate pipeline. Most candidates assume "everything" and end up designing a 10x larger system than the interviewer wanted.

The second most consequential is freshness target. A crawler that promises hourly freshness for news has a recrawl scheduler that is a bigger system than the discovery crawler.

### 2. Capacity estimates (full working)

Restated from the question:

- 5B fetches/day = ~58K fetches/sec sustained, ~150K peak.
- Bandwidth: 5.8 GB/sec sustained, ~17 GB/sec peak. Across 450 fetcher nodes, ~40 MB/sec each. Reasonable.
- Raw HTML storage: 500TB/day compressed. ~10PB hot after dedup, archived afterwards.
- Frontier: 50B URLs × 110 bytes = ~5.5TB of metadata, sharded across, say, 64 frontier shards = ~85GB per shard.
- Dedup Bloom filter: 50B URLs × 10 bits = ~60GB, sharded across 8 to 16 nodes.
- Concurrent host slots: at least 58K active hosts being fetched per second, out of 500M known hosts. Not scarce.
- Fetcher nodes: 500 fetches/sec/node × 300 nodes = 150K/sec. Add headroom: ~450 nodes.

The most useful observation: the bottleneck is neither storage nor CPU; it is per-host politeness coordination. That single constraint dictates the sharding scheme and the fetcher-to-frontier protocol.

### 3. Internal API design

The crawler is not user-facing. The APIs that matter are the ones between subsystems.

Frontier to Fetcher: pull a batch.

```
POST /frontier/{shard_id}/lease_batch
{
  "fetcher_id": "fetcher-042",
  "batch_size": 100,
  "lease_seconds": 60
}

Response (200):
{
  "lease_id": "L-9871234",
  "urls": [
    { "url": "https://example.com/a", "host": "example.com", "priority": 0.81, "depth": 3, "parent": "..." },
    ...
  ],
  "expires_at": "2026-05-23T10:01:23Z"
}
```

A couple of load-bearing details:

- The frontier picks URLs so no two URLs in the batch are from the same host (politeness in-batch), and each host has a free token (politeness across-fetchers).
- Lease pattern: if the fetcher does not acknowledge within `lease_seconds`, the URLs return to the queue. Prevents lost work when a fetcher dies.

Fetcher to Frontier: acknowledge.

```
POST /frontier/{shard_id}/ack
{
  "lease_id": "L-9871234",
  "results": [
    { "url": "...", "status": 200, "content_hash": "sha256:...", "outlinks_count": 21, "fetched_at": "..." },
    { "url": "...", "status": 429, "retry_after_seconds": 600 },
    { "url": "...", "status": 0, "error": "dns_timeout" }
  ]
}
```

Each result updates the host's health, the host's next-allowed-fetch timestamp, and the URL's record in metadata. On error the URL may be requeued with a delay or dropped.

Link Extractor to Dedup Index: candidate URLs.

```
POST /dedup/check_and_add
{
  "candidates": [
    { "url": "https://example.com/x", "parent_url": "...", "depth": 4 },
    ...
  ]
}

Response:
{
  "new_urls": [ { "url": "...", "parent_url": "...", "depth": 4 }, ... ]   # subset that was not seen before
}
```

The dedup service does the Bloom filter check, then a confirming KV lookup for any that the Bloom said "possibly seen". Only the truly-new ones come back and get forwarded into the frontier.

Recrawl Scheduler to Frontier: re-inject.

```
POST /frontier/{shard_id}/reinject
{
  "urls": [
    { "url": "...", "priority": 0.92, "reason": "freshness_due", "previous_fetched_at": "..." }
  ]
}
```

Recrawl is structurally identical to discovery once the URL is in the frontier; the only difference is it is reinjected by the scheduler rather than discovered by extraction.

### 4. Data model

Per-URL metadata (sharded by URL hash):

```sql
CREATE TABLE url_meta (
    url_hash         BYTEA PRIMARY KEY,          -- SHA-256 of canonical URL
    url              TEXT NOT NULL,              -- canonical form
    host_id          INT NOT NULL,               -- foreign key to host_meta
    first_seen       TIMESTAMPTZ NOT NULL,
    last_fetched     TIMESTAMPTZ,                -- NULL if never fetched
    last_status      INT,                        -- HTTP status
    content_hash     BYTEA,                      -- SHA-256 of normalized body, NULL if not fetched
    priority         REAL,                       -- 0.0 to 1.0
    next_refresh_at  TIMESTAMPTZ,                -- when the recrawl scheduler wants to revisit
    depth            SMALLINT,                   -- depth from any seed
    parent_url_hash  BYTEA,                      -- first parent that linked to it
    flags            INT NOT NULL DEFAULT 0      -- bitfield: blocked, trap, soft_404, etc.
);
CREATE INDEX idx_host_priority ON url_meta (host_id, priority DESC) WHERE last_fetched IS NULL;
CREATE INDEX idx_refresh ON url_meta (next_refresh_at) WHERE next_refresh_at IS NOT NULL;
```

Per-host metadata (sharded by host hash):

```sql
CREATE TABLE host_meta (
    host_id              INT PRIMARY KEY,
    hostname             TEXT NOT NULL UNIQUE,
    robots_fetched_at    TIMESTAMPTZ,
    robots_body          TEXT,                  -- cached robots.txt
    crawl_delay_seconds  REAL NOT NULL DEFAULT 1.0,
    health_score         REAL NOT NULL DEFAULT 1.0,
    last_fetched_at      TIMESTAMPTZ,
    consecutive_failures INT NOT NULL DEFAULT 0,
    daily_quota_used     INT NOT NULL DEFAULT 0,
    daily_quota_max      INT NOT NULL DEFAULT 100000,
    flags                INT NOT NULL DEFAULT 0  -- trap, spam, opt-out, etc.
);
```

Per-frontier-shard in-memory state:

- Priority queue (heap, or Redis sorted set) keyed by `(host_id, scheduled_at, priority)`.
- Per-host token bucket: `(tokens_available, next_refill_at)`.
- Per-host "next allowed fetch" timestamp.

Content store (object storage):

- Key: `content_hash` (SHA-256 of normalized body).
- Value: compressed raw HTML.
- Why hash-addressed: two URLs serving the same content share one blob. Storage savings of 20-40% on the open web because of duplicate templates.

Two design choices worth defending out loud:

The state is intentionally duplicated. The frontier shard holds in-memory queues for its hosts. The url_meta table is the durable record. The frontier can be rebuilt from url_meta if a shard dies; that is what makes the system survivable.

`flags` is a bitfield rather than separate columns. New states (trap_suspected, redirect_chain_too_long, off_domain_redirect) can be added without schema migration. Each bit is a separate test.

### 5. Core algorithm: priority frontier with politeness

#### URL canonicalization

Before doing anything with a URL, canonicalize:

```python
def canonicalize(raw_url, base_url):
    url = urljoin(base_url, raw_url)            # resolve relative
    parsed = urlparse(url)
    
    # Lowercase scheme and host
    scheme = parsed.scheme.lower()
    host = parsed.hostname.lower()
    if host.startswith("www."):
        host = host[4:]                          # normalize www
    
    # Drop default ports
    port = parsed.port
    if (scheme, port) in (("http", 80), ("https", 443)):
        port = None
    
    # Path: collapse "//", resolve "./" and "../"
    path = posixpath.normpath(parsed.path) or "/"
    
    # Sort query parameters alphabetically; strip known session tokens
    params = parse_qs(parsed.query)
    for token in ("sid", "PHPSESSID", "jsessionid", "utm_source", "utm_medium", "utm_campaign"):
        params.pop(token, None)
    query = urlencode(sorted(params.items()), doseq=True)
    
    # Drop fragment
    fragment = ""
    
    return urlunparse((scheme, host_with_port(host, port), path, "", query, fragment))
```

Notes worth saying out loud:

Stripping `utm_*` is opinionated. It is correct for crawl dedup but discards a tracking signal you might want elsewhere; in practice the crawler does not need it.

Session tokens (`sid`, `PHPSESSID`) cause infinite URL explosions: the same logical page has a different URL per visitor. Strip them aggressively.

The trailing slash decision is a per-host hint, not a universal rule. `example.com/foo` and `example.com/foo/` may or may not be the same page; treat them as the same and confirm by content hash after fetch.

#### Dedup with Bloom filter

```python
def is_new(url):
    h = sha256(canonical(url))
    if not bloom.contains(h):
        return True                              # definitely new
    if not kv_store.exists(h):
        return True                              # Bloom said "possibly seen" but lying
    return False                                 # confirmed seen

def mark_seen(url):
    h = sha256(canonical(url))
    bloom.add(h)
    kv_store.put(h, {"first_seen": now()})
```

The Bloom filter is partitioned by URL hash prefix across N nodes. Each node owns 1/N of the keyspace. Reads and writes go to one node. The Bloom filter is rebuilt periodically from the KV store so it drifts back to the right size as the universe grows.

False positive rate target: 1%. Meaning 1% of new URLs get a confirming KV lookup that confirms "actually new"; the cost is one extra KV read for those. Tunable.

#### Priority scoring

```python
def initial_priority(url, parent_url, parent_priority):
    p = 0.5                                      # default
    p *= host_quality_score(host_of(url))        # 0.0 (spam) to 1.0 (high-quality)
    p *= parent_priority ** 0.5                  # diffuse from parent
    p *= 1 / (1 + depth(url))                    # depth decay
    if has_known_trap_pattern(url):
        p *= 0.1
    return min(1.0, max(0.0, p))
```

Host quality is a slow-moving signal. PageRank-style scores are computed offline in a separate batch job over the link graph and updated daily.

#### Politeness with token buckets

```python
class HostTokenBucket:
    def __init__(self, rate_per_sec=1.0):
        self.rate = rate_per_sec
        self.tokens = 1.0
        self.last_refill = now()
    
    def try_consume(self):
        elapsed = now() - self.last_refill
        self.tokens = min(1.0, self.tokens + elapsed * self.rate)
        self.last_refill = now()
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False
```

The bucket lives on the frontier shard that owns the host. `lease_batch` only returns URLs whose host bucket has tokens. URLs whose buckets are dry get skipped, and the shard moves on to other hosts.

### 6. High-level architecture (detailed)

Here is the whole picture on one screen.

```
                    ┌──────────────────────────────────────────────┐
                    │              Seed Set + Sitemaps             │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │                URL Frontier                  │
                    │  64 shards, hash-by-host. Each shard owns    │
                    │  a slice of hosts. Per-host priority queue,  │
                    │  per-host token bucket, per-host quota.      │
                    │  Persisted to durable KV (RocksDB/Cassandra).│
                    └──────┬────────────────────────────┬──────────┘
                           │ lease_batch                │ ack
                           ▼                            │
                    ┌──────────────────────────────────────────────┐
                    │                Fetcher Pool                  │
                    │  ~450 stateless nodes. Each holds:           │
                    │    - DNS cache (per host TTL)                │
                    │    - robots.txt cache (24h TTL per host)     │
                    │    - HTTPS connection pool                   │
                    │  500 concurrent fetches per node.            │
                    └─────┬─────────────────────┬──────────────────┘
                          │ raw response        │ events
                          ▼                     ▼
            ┌──────────────────────┐    ┌──────────────────────────┐
            │  Content Store        │    │   Link Extractor        │
            │  (object store, blob  │    │   Stateless workers     │
            │   addressed by        │    │   that parse HTML,      │
            │   content_hash;       │    │   extract <a href>,     │
            │   meta in url_meta)   │    │   canonicalize URLs,    │
            │                       │    │   filter mailto / js,   │
            │                       │    │   apply depth limit.    │
            └──────────────────────┘    └──────────┬──────────────┘
                                                   │ candidate URLs
                                                   ▼
                                       ┌────────────────────────┐
                                       │   Dedup Service        │
                                       │   Sharded Bloom + KV.  │
                                       │   Returns only new.    │
                                       └──────────┬─────────────┘
                                                  │ new URLs
                                                  ▼
                                       (back to URL Frontier above)

   Side systems:
   ┌─────────────────────────┐   ┌──────────────────────────┐
   │  Recrawl Scheduler      │   │   Trap Detector          │
   │  Scans url_meta for     │   │   Background job scans   │
   │  URLs whose             │   │   frontier patterns,     │
   │  next_refresh_at is     │   │   flags hosts with       │
   │  due. Re-injects into   │   │   pathological URL       │
   │  frontier with          │   │   shapes.                │
   │  freshness priority.    │   └──────────────────────────┘
   └─────────────────────────┘

   ┌─────────────────────────┐   ┌──────────────────────────┐
   │  JS Render Pipeline     │   │   Indexer (downstream)   │
   │  Headless Chromium      │   │   Reads from Content     │
   │  pool. Fed URLs flagged │   │   Store + url_meta to    │
   │  as JS-heavy. Output    │   │   build search index.    │
   │  rendered HTML back     │   │   Out of scope here, but │
   │  to Content Store.      │   │   the contract is the    │
   │                         │   │   content_hash + meta.   │
   └─────────────────────────┘   └──────────────────────────┘
```

Five things to notice while reading this:

The frontier is the bottleneck of coordination. Politeness, priority, and dedup-confirmation all need state. Sharding by host keeps the hot path local.

The fetcher pool is the bottleneck of bandwidth. Stateless. Easy to scale horizontally. Caches are per-node to avoid central choke points.

Content Store is hash-addressed. Removes the need for content-dedup-on-write. Two URLs serving the same content write the same blob; the second write is a no-op.

Link Extractor is a separate service, not part of the fetcher. Two reasons: parsing is CPU-bound, fetching is IO-bound, mixing them wastes resources; and parsing failure should not block fetching. If the parser dies, we still have the raw HTML.

Dedup Service is also separate from the frontier. The Bloom filter is shared across the whole system; co-locating it with the frontier shards would force dedup to follow the host sharding, but URLs from one parsed page span many hosts.

Recrawl Scheduler is a separate pipeline. Discovery and recrawl have different priorities, different rate budgets, and different SLAs. Mixing them in one loop conflates two systems.

### 7. The crawl path: one URL's journey

Follow a single URL through the system to make the architecture concrete.

1. Discovery. A fetched page `https://blog.example.com/post-1` is parsed by the Link Extractor. One of its `<a href="...">` links is `/post-2`. Canonicalize to `https://blog.example.com/post-2`.
2. Dedup check. Send `https://blog.example.com/post-2` to the Dedup Service. Bloom filter says "not seen". Confirming KV lookup is skipped (Bloom is authoritative on negatives). Service returns it as new.
3. Frontier insert. Routed to the frontier shard owning `hash("blog.example.com") mod 64 = shard 17`. Compute initial priority from parent priority, depth, host quality. Insert into shard 17's priority queue.
4. Wait. The URL sits in the queue. Many other URLs from the same host are also in the queue. The host's token bucket releases 1 token/sec.
5. Lease. Fetcher node `fetcher-042` calls `lease_batch` on shard 17 with batch_size=100. Shard 17 picks 100 URLs, each from a distinct host that has a free token. `post-2` is one of them. Tokens are consumed; next-allowed-fetch timestamps update; URLs returned with a 60-second lease.
6. DNS. `fetcher-042` checks its DNS cache for `blog.example.com`. Cache miss. Query DNS, cache for the TTL.
7. Robots. Check robots.txt cache. Cache hit, parsed rules say `/post-2` is allowed.
8. Fetch. Open HTTPS connection (reuse from pool if possible). GET `https://blog.example.com/post-2` with the crawler's user agent. Receive 200 + body.
9. Content hash. Normalize body (strip comments and boilerplate that varies per request like CSRF tokens), compute SHA-256.
10. Store. Write the compressed body to object storage at key `sha256:abc123...`. Update url_meta row for this URL: `last_fetched=now()`, `last_status=200`, `content_hash=abc123...`.
11. Ack. Fetcher posts ack to shard 17 with the result. Shard 17 updates host health (success), schedules next refresh (based on content stability heuristics), removes the URL from the active queue.
12. Extract. Link Extractor consumes from the "fetched pages" queue (could be Kafka). Parses `post-2`'s HTML, finds 25 outlinks. Each goes through canonicalization, dedup, frontier-insert.
13. Done. The URL's journey from discovery to extracted-outlinks took roughly: queue wait (variable, often hours for low-priority URLs) + 1-2s of fetch + 100ms of parse + 10ms of insertion.

The interesting observation: most of the latency is queue wait. The actual work is fast. The system is throughput-bound, not latency-bound, so we can tolerate processing each URL slowly as long as we keep many URLs in flight.

### 8. Frontier maintenance

The frontier is not just "a queue we add to and pop from". It must be actively maintained.

Trim dead URLs. URLs with `last_status` in `[404, 410, 451]` for more than 30 days are removed from the frontier (and may be removed from url_meta after a longer retention). They will not be retried.

Refresh policy. Each URL has a `next_refresh_at`. The recrawl scheduler periodically scans url_meta and re-injects URLs whose refresh time has come.

The refresh interval is adaptive:

- Pages whose content_hash changed since last fetch: shorten the interval (suggests it changes often).
- Pages whose content_hash has been stable for several refreshes: lengthen it.
- Pages on hosts marked as news sites: floor the interval at 1 hour.
- Pages on hosts marked as dormant: floor at 30 days.

```python
def update_refresh_interval(url):
    prev = url.refresh_interval_seconds
    if url.content_changed_since_last:
        new = max(MIN_INTERVAL, prev * 0.5)
    else:
        new = min(MAX_INTERVAL, prev * 1.5)
    url.refresh_interval_seconds = new
    url.next_refresh_at = url.last_fetched + new
```

`MIN_INTERVAL` and `MAX_INTERVAL` are per-host-class, not global. News hosts have `MIN_INTERVAL=600` (10 minutes); generic hosts have `MIN_INTERVAL=86400` (1 day).

Bucket recompute. Daily, recompute each host's priority and reorder the queue. Hosts whose quality dropped (newly identified as spam) have their pending URLs deprioritized.

Compaction. The frontier's RocksDB instance accumulates tombstones from ack'd URLs. Run compaction off-peak.

Resharding. If one frontier shard becomes consistently hot (one or two giant hosts dominate it), split the shard. Splitting drains the shard's URLs into the new shards atomically and updates the routing table; same pattern as resharding a sharded SQL database.

### 9. Scaling

#### a. Sharded by host hash

The fundamental partitioning. 64 shards is a starting point.

- Politeness state is single-node.
- Per-host quotas are single-node decisions.
- One giant host stacks all its URLs on one shard. Mitigations below.

#### b. Hot host mitigations

- Cap the per-host pop rate even when the bucket has tokens. A host with 50M URLs cannot push more than, say, 10 URLs/sec to the fetcher pool, regardless of how many tokens it accumulates.
- Per-host quota: max N URLs accepted into the frontier per day. Anything beyond goes to a "cold storage" tier; we revisit it when the host's regular quota frees up.
- For truly outsized hosts (Wikipedia, GitHub, government sites with millions of public records): coordinate with the host. They publish sitemaps and rate guidelines; we set a per-host config that overrides defaults.

#### c. Regional fetchers for geo-distributed sites

A fetch from us-east to a server in Sydney is ~150ms round-trip even before TLS. If 5% of your crawl is in Asia, that is a lot of wasted seconds.

- Maintain a small fetcher pool in each major region (us-east, eu-west, ap-south).
- When the frontier hands out URLs, it consults a geo-hint on the host (resolved by IP geolocation, cached) and routes the URL to the regional fetcher pool that is closest.
- The frontier itself remains globally sharded; only the IO leg is regional.

The cost: 3x deployment, but only fetcher pools are duplicated, not the frontier or stores. The benefit: typical fetch latency for Asian sites drops from 300ms to 50ms.

#### d. Storage tiering

- Last 7 days of raw HTML: hot in S3 standard / GCS standard.
- 7 to 30 days: warm in S3 standard-IA / GCS nearline.
- Beyond 30 days: cold in Glacier / coldline, accessed only for archival / disputes.

The indexer typically only needs the hot tier. The warm tier is for delta jobs that re-extract features after model changes.

#### e. Bloom filter resharding

When the universe of URLs doubles, the existing Bloom filter's false positive rate degrades. Two options:

- Rebuild from scratch using the KV store as the source of truth. Expensive but correct.
- Add a second-tier Bloom filter for the newest URLs, in addition to the first. Check both. Rebuild on a slower cadence.

In practice, periodic full rebuild is what most crawlers do. The KV scan is large but offline.

### 10. Reliability

Frontier shard failure. The shard's hosts are temporarily uncrawlable. Replicate frontier shards (Raft, or warm standby) with sub-minute failover. The in-memory queue state is rebuilt from RocksDB on failover.

Fetcher node failure. Leases expire; URLs return to the queue. No data loss. Auto-scaling replaces the node.

Link Extractor failure. Backlog grows in the "fetched, not yet parsed" Kafka topic. Once the extractor recovers, it catches up. The fetcher does not block.

Dedup Service failure. New URLs cannot be confirmed. Fail open (treat all as new), accept temporary duplicate work; the Bloom filter eventually catches up when the service recovers. Failing closed (rejecting all) is worse because new outlinks are lost.

Content Store failure. Cannot persist HTML. The fetcher buffers locally for up to a few minutes; beyond that, drop the fetch and re-add the URL to the frontier with a delay.

Region failure. The regional fetcher pool is offline; URLs targeted at that region are reassigned to the next-closest region. Latency degrades for those URLs but throughput holds.

General posture: anything between the fetcher and the store can fail temporarily; the system buffers and retries. The frontier itself must be highly available because everything else depends on it.

### 11. Observability

| Metric | Why |
|--------|-----|
| `fetches_per_sec` (sustained, peak) | Headline throughput |
| `frontier_size_per_shard` | Detects hot shards |
| `host_quota_used_per_host` | Politeness compliance |
| `robots_disallow_rate` | If it jumps, your user agent may be banned somewhere |
| `dedup_false_positive_rate` | If above 1%, rebuild the Bloom filter |
| `content_dedup_rate` (same content_hash as existing) | Should be ~30%; much higher = crawling mirrors |
| `outlinks_per_page p50/p99` | Sudden spike = trap site |
| `fetch_status_breakdown` (200/4xx/5xx) | Spike in 429/503 = backoff needed |
| `frontier_lease_expiry_rate` | High = fetcher pool struggling |
| `frontier_priority_starvation` | Low-priority URLs starved? If yes, priority floor needed |
| `recrawl_scheduler_lag` | If overdue refreshes pile up, freshness SLO breached |
| `dns_cache_hit_rate` | Below 95% = you are hammering DNS |
| `js_render_queue_depth` | JS pipeline is slower; can bottleneck |
| `webmaster_complaint_count` | Page on this; politeness is the headline non-functional SLO |

Page on: webmaster complaint volume rising, frontier shard down, 429/503 rate >5% (we are being too aggressive), throughput below 50% of target. File a ticket on: dedup rate drift, content dedup rate spike (mirror crawl), trap detector firings.

### 12. Follow-up answers

**1. Crawler trap.**

Symptoms: one host produces unbounded outlinks of the same shape (`?date=2026-05-23`, `?date=2026-05-24`, ...). The frontier fills with that one host's URLs.

Detection:

- Per-host URL count cap. If a host has more than N URLs added to the frontier in one day (say 1M), pause new additions from that host pending review.
- Pattern heuristic. For each host, cluster URLs by their normalized shape (replace digits and tokens with placeholders). If one shape accounts for >80% of the host's URLs, mark it as a likely trap.
- Depth limit. Hard cap at depth 20. Calendar traps usually link to themselves, so depth grows monotonically; the cap stops them.
- Outlink density. Pages with >500 outlinks of the same shape pointing to the same host get flagged for the extractor to ignore.

Recovery: dropped URLs are removed from the frontier (not marked seen, so if a legitimate path discovers them later they can be revisited). The host's quality score is lowered.

**2. Soft 404.**

A site returns HTTP 200 with "page not found" content. The URL looks fetched-successfully but is useless.

Detection:

- Per-host duplicate-content ratio. Compute the content_hash distribution per host. If a single content_hash accounts for >30% of fetched pages on a host, mark those URLs as soft 404s.
- Boilerplate signals. Some sites' soft 404s have detectable markers: "404", "not found", "page does not exist" in headers, very short content, specific HTTP response headers. A small classifier (regex + length) catches the obvious ones in the Link Extractor.
- External signal. Compare against the Wayback Machine or other observability of the URL; if it was meaningful before and is the boilerplate now, the page died.

Once detected, mark URLs with the `soft_404` flag in url_meta. The indexer ignores them. The recrawl scheduler reduces their refresh rate to once a month (in case the site fixes itself).

**3. JavaScript-rendered content.**

A SPA returns a near-empty document. Link Extractor finds zero outlinks and 100 bytes of meaningful text.

Pipeline change:

- Detect. If `len(extracted_text) < threshold` or `outlinks_count == 0` while the page is non-trivially long, flag the URL for JS rendering.
- Render pipeline. A separate fleet of headless Chromium nodes. The URL is sent to the render queue. The renderer loads the URL with JS execution enabled, waits up to N seconds for the document to settle, snapshots the rendered HTML, and pushes the rendered HTML back to the Content Store under a new content_hash with a flag `(rendered=true)`.
- Cost. JS rendering is 10x to 100x more expensive than a static fetch. Allocate a fraction (say 5%) of total crawl capacity to rendering; prioritize high-value URLs.
- Outlinks. The Link Extractor re-runs on the rendered HTML and emits the JS-discovered outlinks.

This is how Googlebot's two-pass crawl works: first pass is static fetch, second pass is rendering for pages that look JS-heavy.

**4. Recrawl scheduling.**

The naive approach is one global TTL: recrawl every page every X hours. Wrong, because news pages need hourly and dormant pages need monthly.

Adaptive scheduling per URL:

- Track `content_changed_since_last_fetch` (compare current content_hash to previous).
- If changed: halve the interval (down to a floor).
- If not changed: 1.5x the interval (up to a ceiling).

Host-level floor and ceiling:

- News hosts (detected by HTTP cache-control hints, sitemap freshness, or learned classifier): floor 10 minutes.
- Generic hosts: floor 1 day.
- Dormant hosts: floor 30 days.

Implementation:

- The Recrawl Scheduler runs continuously, scanning `url_meta` for rows where `next_refresh_at < now()`.
- For each, push back into the frontier with a `freshness` priority.
- The scheduler batches by host (and respects the same host's daily quota) to avoid hammering one host during refresh.

The recrawl pipeline is a peer of the discovery pipeline, not a subordinate.

**5. Frontier persistence.**

Writing every frontier push synchronously to disk would melt the IOPS budget. Instead:

- In-memory primary, RocksDB secondary. The shard's priority queue is in memory for low-latency ops. Every operation is also appended to a RocksDB write-ahead log asynchronously.
- Periodic snapshots. Every 5 minutes, take a snapshot of the in-memory queue state to RocksDB.
- Replication for HA. The frontier shard runs as a primary + 1 or 2 standbys. Replication is via the log (Raft, or a simpler primary-driven approach).
- On restart. Load the most recent snapshot, replay the log past the snapshot's offset, resume.

The cost: a crash may lose the last few seconds of pushes (those that had not yet written to the log). For a frontier this is fine because URLs are idempotent: a re-discovered URL is detected by the Bloom filter and discarded.

**6. Distributed Bloom filter coordination.**

Two fetchers in different regions both discover `https://example.com/new` at the same instant. Both query the dedup service. Both could be told "new" if the writes race.

- Sharded Bloom: each URL hash has one owning shard. Both fetchers' check-and-add for the same hash route to the same shard.
- Single-node compare-and-swap. On the shard, the operation is atomic: if not in Bloom, add and confirm to KV; otherwise reject. Only one wins.
- Bloom set semantics. The Bloom filter is a set; adding twice is idempotent. The KV store enforces uniqueness via primary key.

The remaining risk: two fetchers race against the same shard. Resolved by the shard's atomicity. There is no inter-region race because the URL hash deterministically routes both calls to the same shard, regardless of which region the caller is in.

**7. Two URLs serving identical content.**

`example.com/article/123` and `example.com/article/123?utm=email`. After canonicalization, the `utm` parameter is stripped, so they become the same URL and dedup at the URL layer.

What if the canonicalization missed a parameter? Then both URLs get fetched. Both compute the same content_hash. The Content Store deduplicates at the blob layer (already addressed by content_hash; second write is a no-op). The url_meta table has two rows pointing to the same content_hash.

Downstream, the indexer notices that multiple url_meta rows share a content_hash, and picks a canonical URL among them (by signals like inlink count, URL length, etc.). The other URLs are indexed as aliases.

This two-layer dedup (URL + content) is why we keep them separate. URL dedup catches the cheap case (98%); content dedup catches the long tail.

**8. New important domain at default rate.**

12 days to crawl 1M pages at 1 req/sec is too slow if the domain is important (a major news site relaunching, say).

- Negotiate. Major sites have crawler-relations contacts. Set up a per-host config with `crawl_delay_seconds=0.1` (10 req/sec) by mutual agreement.
- Use the site's sitemap. Sitemaps publish update timestamps. The crawler can ingest the sitemap once and recrawl only changed URLs, dramatically reducing total fetches.
- Boost only the important pages. Use a quick PageRank pass on the new domain's link graph, fetch the top 10K pages at the higher rate, leave the long tail at the default.

Politeness is a default, not a law. With consent and signal, you can crawl faster.

**9. Spam farm.**

10M auto-generated low-value pages that link to each other. The crawler discovers them, fetches them, wastes capacity.

Mitigation in layers:

- Host quality score. Spam hosts have low PageRank, low inlink diversity, low content quality. Compute the score in an offline batch job. Use it to set per-host quota and per-URL priority.
- Content quality filter at the extractor. Pages with extreme repetition, very low text-to-markup ratio, or known spam patterns get flagged. Their outlinks get a steep priority discount.
- Aggressive cap on outlinks per page. A page with 5000 outlinks to itself is probably junk. Cap extraction at 200 outlinks per page.
- Drop entire hosts. If a host's quality score drops below a threshold and it shows known spam features, blacklist it. The blacklist is reviewed weekly.

A spam farm should burn through its host quota in a day and then stop affecting crawler capacity.

**10. Geo-distributed targets.**

A French news site is hosted in France. Fetching from us-east costs 200ms round-trip. Hourly recrawl × 1000 articles = 1000 fetches/hour × 200ms = 200 seconds of waiting per hour. With concurrent connections this is fine in absolute terms but wasteful.

Solution: regional fetcher pools as in section 9c. The frontier annotates each URL with a `region_hint` based on the host's geo IP. When dispatched to fetchers, the URL prefers a fetcher in the same region.

The frontier remains globally sharded; only the IO leg is regional. This avoids running a separate full crawler per region while still cutting fetch latency.

### 13. Trade-offs worth saying out loud

BFS vs PageRank-prioritized. Pure BFS spends capacity on everything equally. PageRank prioritization focuses on the useful subset but starves the long tail; you have to add a small "exploration" budget for low-priority URLs to avoid blindspots. Most production crawlers run weighted: 80% priority-driven, 20% exploration.

URL dedup only, or also content dedup. URL dedup catches 95% of duplicates cheaply (Bloom + KV). Content dedup catches the rest but requires fetching first. The trade-off: fetching duplicates is bandwidth waste, but content-hash dedup is free at storage time. Most crawlers do both.

Strict robots.txt or lenient. Strict: respect every directive, refresh every 24h, fail closed on unreachable robots.txt. Lenient: cache longer, fail open. Strict is safer for webmaster relations; lenient gets more pages. Strict is the only defensible answer in interviews and in practice.

Synchronous fetch-parse-dedup vs decoupled pipeline. Decoupled is harder to operate but lets each stage scale independently. At this scale, decoupled wins.

In-house JS rendering or skip JS-only pages. Rendering is expensive. If 30% of the web is JS-only and you skip it, your index misses a third of the modern web. Most major crawlers render but only for high-value pages; budgeted.

What I would revisit at 10x scale:

- Sharding hierarchy: shard by TLD, then by host within TLD, so country-specific shards can be regional.
- Streaming PageRank: continuous update rather than daily batch, so quality scores reflect link-graph changes faster.
- Per-host adaptive rate: a learned model that estimates the host's safe rate based on response times, instead of a static token bucket.
- Federated frontier: a top-level coordinator and regional frontiers, so the system survives entire-region outages without global degradation.

### 14. Common interview mistakes

"Just BFS from a seed." No priority, no politeness, no dedup. This is a homework crawler, not a production one.

Hashing by URL not by host. Politeness becomes an N² coordination problem. The interviewer will catch this immediately.

Forgetting robots.txt. Politeness is the load-bearing constraint. If you do not mention robots.txt and per-host rate limits, you have skipped the most important part.

Treating recrawl as an afterthought. "Just recrawl everything daily" does not work for either news (too slow) or dormant pages (too wasteful). Adaptive scheduling is the expected answer.

Ignoring content dedup. The web has massive duplication. A crawler that does not deduplicate by content_hash wastes 30% of its storage and pollutes the index with mirrors.

No mention of crawler traps. Calendars, session tokens, infinite pagination. Every real crawler has trap detection. Without it, the frontier fills with junk in days.

"Use a single big queue." Sharding is non-negotiable at this scale. A single queue limits throughput and creates a single point of failure for the entire crawler.

Overengineering the dedup. Some candidates propose a perfect-consistency distributed set with strong guarantees. A Bloom filter with 1% false positive rate is fine; the false positives cost only a confirming KV lookup. Strong consistency on dedup is over-budget.

No JS rendering plan. Modern web is JS-heavy. Without a render pipeline, your crawler misses a large fraction of pages. Even if you do not design it in detail, name the pipeline and say it is a separate fleet.

Skipping geo-distribution. Crawl latency to far-side hosts is real. Regional fetcher pools are a cheap win that experienced candidates name.

If you hit 9 of these in a 45-minute slot, you are interviewing well. Most candidates miss the content dedup, the recrawl scheduler, and the crawler trap handling, which together are about half the design's complexity.
{% endraw %}
