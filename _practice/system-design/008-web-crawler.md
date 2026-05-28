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
## The scene

You sit down. The interviewer pulls up a blank whiteboard tab.

> *"Design a web crawler. Something like Googlebot. Walk me through it."*

Then they wait.

Most people start by drawing a queue and a pool of workers. That gets you to the wrong answer.

The hard parts of a web crawler are not the queue. They are:

- Being polite to websites so they do not block you.
- Not fetching the same page twice when you have 50 billion URLs to track.
- Splitting work across hundreds of machines without them stepping on each other.

We will walk this step by step. At each step we name what breaks first, then add the smallest fix.

A few words you will see throughout:

- **Frontier.** The to-do list of URLs still to fetch. Think of it as a giant inbox.
- **Fetcher.** A worker that does the actual HTTP GET to download a page.
- **Politeness.** Rules that stop us from hammering one website too hard.
- **robots.txt.** A small file at `https://site.com/robots.txt` where the site owner tells crawlers what they may and may not fetch.
- **Bloom filter.** A tiny memory structure that quickly tells you if you have probably seen a URL before. Fast, but allowed to be wrong sometimes (false positives).
- **Canonicalize.** Clean up a URL so different forms of the same URL look identical.

---

## Step 1: Picture one fetch

Before any boxes, picture what one crawl step looks like.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Queued: URL discovered
    Queued --> Checking: pop from frontier
    Checking --> Skipped: robots.txt blocks it
    Checking --> Fetching: allowed
    Fetching --> Storing: 200 OK
    Fetching --> Retrying: 429 / 5xx
    Fetching --> Dead: 404 / 410
    Storing --> Parsing: save raw HTML
    Parsing --> Queued: new outlinks discovered
    Storing --> [*]
    Skipped --> [*]
    Dead --> [*]
```

That cycle, run across 450 machines, 58,000 times per second, is the whole product. Everything we add later (priority, dedup, recrawl) is a complication on top of this.

> **Take this with you.** A crawler is a loop: pop a URL, fetch it, parse it, push new URLs back. The interesting engineering is what happens inside each step.

---

## Step 2: Ask the right questions

In a real interview, sit quietly for a couple of minutes. Write down questions that change the design if answered differently.

<details markdown="1">
<summary><b>Show: 5 questions that change the design</b></summary>

1. **What are we crawling?** Just HTML pages? Also images, PDFs, JavaScript-rendered SPAs? *Each one is a different pipeline. Assuming "everything" makes the system 10x bigger than the interviewer intended.*

2. **How fresh must the index be?** Hourly for a news site like CNN? Daily for a blog? Monthly for a dormant page? *The recrawl scheduler can be larger and more complex than the discovery crawler itself.*

3. **How polite must we be?** What is the default per-site request rate? *One stranger's website should never go down because of us. This is the single most load-bearing rule.*

4. **What does the crawler output?** Raw HTML to a blob store? Parsed text pushed to an indexer? *Most candidates skip this and have no plan for what happens after the fetch.*

5. **How big?** Pages per day? Distinct hosts? Storage budget? *5 billion pages per day at 100 KB each is 500 TB per day. If the answer is 500 million pages, the storage problem is 10x smaller.*

A strong candidate also asks: "Are JavaScript-rendered pages in scope?" Rendering is 10x to 100x more expensive than a plain fetch. If yes, treat it as a separate, smaller pipeline.

</details>

---

## Step 3: How big is this thing?

Suppose the interviewer gives you these numbers: 5 billion pages per day, average HTML page size 100 KB compressed, 20 outlinks per page, 50 billion total URLs tracked, 500 million distinct hosts, default politeness of 1 request per host per second.

| What | Number |
|------|--------|
| Fetches/sec sustained | 58,000 |
| Fetches/sec peak | ~150,000 |
| Bandwidth sustained | 5.8 GB/sec |
| Raw HTML/day | 500 TB compressed |
| 30-day hot storage | ~10 PB (after dedup) |
| Frontier metadata | ~5.5 TB across 64 shards |
| Bloom filter for 50B URLs | ~60 GB across 8-16 nodes |
| Fetcher nodes | ~450 |

<details markdown="1">
<summary><b>Show: how the numbers come out</b></summary>

**Fetches per second.**

```
5,000,000,000 / 86,400 sec = 58,000 fetches/sec sustained
Peak 2-3x = ~150,000 fetches/sec
```

**Bandwidth.**

```
58,000 fetches/sec * 100 KB = 5.8 GB/sec sustained
Peak: ~17 GB/sec, roughly 50-150 Gbps across the fleet
```

**Storage.**

```
5B pages/day * 100 KB = 500 TB/day compressed
30 days = 15 PB raw
After deduplicating mirror pages (~30% savings): ~10 PB hot
```

**Frontier metadata.**

```
50B URLs * 110 bytes (URL + small metadata) = ~5.5 TB
Split across 64 shards: ~85 GB per shard. Fits in memory/SSD.
```

**Bloom filter for seen URLs.**

```
50B URLs * 10 bits (for 1% false positive rate)
= 500 Gbit = ~60 GB across 8-16 nodes
```

**Fetcher nodes.**

```
One node handles ~500 concurrent fetches
(500 open connections, each ~1 sec for DNS + TLS + GET + body)

Peak 150,000/sec / 500 per node = 300 nodes
With 50% headroom: ~450 nodes
```

**What the math is telling you.** Storage and bandwidth are large but linear. The hard part is coordination: 450 machines must collectively respect "1 request per second" for each of 500 million different websites. That single constraint drives the sharding scheme.

Also: the Bloom filter for 50 billion URLs only takes 60 GB. Tiny. Bloom filters are magic for this kind of dedup problem.

</details>

---

## Step 4: The smallest thing that works

Forget Google. We are building a crawler for a 10-person research team. One seed list, 1 million pages, one machine.

Three boxes. Nothing else.

```mermaid
flowchart LR
    S([Seed URLs]):::user --> F[/"Frontier<br/>(priority queue)"/]:::app
    F --> W[/"Fetcher<br/>(HTTP GET)"/]:::app
    W --> Store[("Content Store<br/>S3, by hash")]:::db
    W -.outlinks.-> P[/"Link Extractor<br/>(parse HTML)"/]:::app
    P -.new URLs.-> F

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

The end-to-end flow for one URL:

```mermaid
sequenceDiagram
    autonumber
    participant Frontier
    participant Fetcher
    participant Site as example.com
    participant Store as Content Store
    participant Parser as Link Extractor

    Frontier->>Fetcher: pop URL
    Fetcher->>Site: HTTP GET /page
    Site-->>Fetcher: 200 OK + HTML
    Fetcher->>Store: write compressed HTML (key = content hash)
    Fetcher->>Parser: send raw HTML
    Parser->>Parser: find all <a href> links
    Parser->>Frontier: push new URLs
```

<details markdown="1">
<summary><b>Show: the two core tables</b></summary>

```sql
CREATE TABLE url_meta (
    url_hash         BYTEA PRIMARY KEY,
    url              TEXT NOT NULL,
    host_id          INT NOT NULL,
    first_seen       TIMESTAMPTZ NOT NULL,
    last_fetched     TIMESTAMPTZ,
    last_status      INT,
    content_hash     BYTEA,
    priority         REAL,
    next_refresh_at  TIMESTAMPTZ,
    depth            SMALLINT
);

CREATE TABLE host_meta (
    host_id              INT PRIMARY KEY,
    hostname             TEXT NOT NULL UNIQUE,
    robots_body          TEXT,
    robots_fetched_at    TIMESTAMPTZ,
    crawl_delay_seconds  REAL NOT NULL DEFAULT 1.0,
    health_score         REAL NOT NULL DEFAULT 1.0,
    consecutive_failures INT NOT NULL DEFAULT 0
);
```

</details>

> **Take this with you.** Always start from the smallest thing that works. On one machine this is just a script and two tables. The interesting part of the interview is what breaks when you scale up.

---

## Step 5: The first crack

The research team needs 500 million pages. We add 10 machines. Three things break immediately.

**First: fetchers step on each other.** Two fetchers both grab cnn.com URLs. One hits CNN at 2 req/sec. CNN rate-limits us.

**Second: we re-fetch pages we already have.** Without a seen-URL check, each machine re-discovers the same outlinks and queues them again. The frontier balloons with duplicates.

**Third: the shared Postgres frontier becomes a bottleneck.** 10 machines all polling one table with SELECT FOR UPDATE. Lock contention everywhere.

All three problems share a root cause: there is no coordination. The fix is the same for all three: **split the frontier by hostname**.

```mermaid
flowchart LR
    subgraph "Before (shared frontier)"
        F1[Fetcher A]:::app --> Q1[("One frontier")]:::db
        F2[Fetcher B]:::app --> Q1
        F3[Fetcher C]:::app --> Q1
    end
    subgraph "After (sharded by host)"
        FA[Fetcher A]:::app --> SA[("Shard 0<br/>cnn.com")]:::db
        FB[Fetcher B]:::app --> SB[("Shard 1<br/>bbc.com")]:::db
        FC[Fetcher C]:::app --> SC[("Shard 2<br/>nytimes.com")]:::db
    end

    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

When all URLs for cnn.com live on one shard, that shard owns CNN's rate limit, CNN's robots.txt, and CNN's health score. No coordination needed across shards.

> **Take this with you.** Shard the frontier by hostname, not by URL. Politeness decisions about one site must live on one machine.

---

## Step 6: Build the architecture, one layer at a time

We have a sharded frontier. Now build the system around it. We add one layer at a time and say why.

### v1: just the loop

```mermaid
flowchart TB
    Seeds([Seed URLs]):::user --> F[/"URL Frontier<br/>(sharded by host)"/]:::app
    F --> W[/"Fetcher Pool<br/>(~450 nodes)"/]:::app
    W --> Store[("Content Store<br/>S3")]:::db
    W -.raw HTML.-> P[/"Link Extractor"/]:::app
    P -.new URLs.-> F

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

Fine for tens of millions of pages.

### v2: seen-URL check

Without dedup, the frontier grows without bound. Add a **Dedup Index**: a Bloom filter for the hot path, backed by a sharded key-value store for confirmation.

```mermaid
flowchart TB
    Seeds([Seed URLs]):::user --> F[/"URL Frontier<br/>(sharded by host)"/]:::app
    F --> W[/"Fetcher Pool"/]:::app
    W --> Store[("Content Store")]:::db
    W -.raw HTML.-> P[/"Link Extractor"/]:::app
    P --> D[/"Dedup Index<br/>(Bloom + KV)"/]:::cache
    D -.new only.-> F

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

### v3: politeness enforcement

The frontier now needs per-host state: token buckets, robots.txt cache, health scores. Add a **Robots Cache** sidecar and per-host state inside each frontier shard.

```mermaid
flowchart TB
    Seeds([Seed URLs]):::user --> F[/"URL Frontier<br/>(64 shards, hash-by-host)<br/>per-host: token bucket,<br/>robots.txt, health score"/]:::app
    F --> W[/"Fetcher Pool<br/>(DNS cache, robots check)"/]:::app
    W --> Store[("Content Store")]:::db
    W --> M[("URL Metadata<br/>Postgres")]:::db
    W -.raw HTML.-> P[/"Link Extractor"/]:::app
    P --> D[/"Dedup Index"/]:::cache
    D -.new only.-> F

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

### v4: recrawl, JS rendering, async pipeline

News sites change every hour. SPAs return empty HTML. Add a **Recrawl Scheduler** to re-inject stale URLs, a **JS Render Pipeline** for single-page apps, and Kafka to decouple the stages.

```mermaid
flowchart TB
    subgraph Seeds["Inputs"]
        S([Seed URLs]):::user
        R["Recrawl Scheduler<br/>(re-injects stale URLs)"]:::app
    end

    subgraph Frontier["Frontier layer"]
        F[/"URL Frontier<br/>64 shards, hash-by-host<br/>per-host: token bucket,<br/>robots.txt, quota, health"/]:::app
    end

    subgraph Fetch["Fetch layer"]
        W[/"Fetcher Pool<br/>~450 stateless nodes<br/>DNS cache · robots cache"/]:::app
        JS["JS Render Pipeline<br/>(headless Chromium,<br/>~5% of traffic)"]:::app
    end

    K{{"Kafka<br/>fetched-pages topic"}}:::queue

    subgraph Parse["Parse layer"]
        P[/"Link Extractor<br/>(stateless workers)"/]:::app
        D[/"Dedup Index<br/>(Bloom + sharded KV)"/]:::cache
    end

    Store[("Content Store<br/>S3, keyed by content hash")]:::db
    Meta[("URL Metadata<br/>Postgres / RocksDB")]:::db

    S --> F
    R --> F
    F --> W
    W --> Store
    W --> Meta
    W -.JS-heavy pages.-> JS
    JS --> Store
    W --> K
    K --> P
    P --> D
    D -.new only.-> F

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Each box, in one line:

| Box | What it does |
|-----|--------------|
| **URL Frontier** | The brain. Sharded by hostname. Owns token buckets, robots.txt, host health. |
| **Fetcher Pool** | The hands. Stateless. Downloads pages. Caches DNS and robots.txt locally. |
| **JS Render Pipeline** | Headless Chromium for SPA pages. Separate fleet, ~5% of volume. |
| **Kafka** | Decouples fetchers from parsers. Parsing is CPU-heavy; fetching is IO-heavy. |
| **Link Extractor** | Reads HTML, finds all `<a href>` links, cleans them up, sends to dedup. |
| **Dedup Index** | Bloom filter for the fast path. KV store confirms. Only new URLs reach the frontier. |
| **Content Store** | Object storage addressed by content hash. Two URLs with the same content share one blob. |
| **URL Metadata** | Durable record for every URL: last fetched, status, next refresh time, depth. |
| **Recrawl Scheduler** | Scans URL metadata for pages whose refresh time has come. Re-injects them. |

> **Take this with you.** If the Link Extractor fleet dies, the fetched-pages Kafka topic grows but no HTML is lost. Once the fleet recovers, it catches up. Decoupling by stage means each stage can fail and recover independently.

---

## Step 7: One URL, all the way through

Follow a single URL from discovery to having its outlinks queued.

```mermaid
sequenceDiagram
    autonumber
    participant F as Frontier (shard 17)
    participant W as Fetcher-042
    participant R as Robots Cache
    participant Site as blog.example.com
    participant Store as Content Store
    participant K as Kafka
    participant P as Link Extractor
    participant D as Dedup Index

    F->>W: lease batch of 100 URLs (different hosts each)
    W->>R: is /post-2 allowed on blog.example.com?
    R-->>W: yes, crawl-delay=1s

    rect rgb(241, 245, 249)
        Note over W,Site: fetch and store
        W->>Site: GET /post-2 (User-Agent: MyCrawler/2.0)
        Site-->>W: 200 OK + HTML body
        W->>Store: write compressed HTML (key = SHA256(body))
        W->>F: ack: url=post-2, status=200, content_hash=abc...
    end

    W->>K: emit fetched-page event
    K->>P: fetched-page event
    P->>P: find 25 outlinks, canonicalize each
    P->>D: check: are these URLs new?
    D-->>P: 18 new, 7 already seen
    P->>F: insert 18 new URLs into shard(s)
```

Three things worth pointing at:

1. No two URLs in the lease batch share a host. The fetcher can fire 100 requests in parallel without violating any site's rate limit.
2. The frontier shard owns the token bucket for blog.example.com. It will not hand out another URL for that host until 1 second has passed.
3. The content hash is the storage key. If a second URL later returns the same HTML body, the write is a no-op. Free dedup.

---

## Step 8: Politeness (the constraint that shapes everything)

If your crawler hits cnn.com with 1000 requests per second, three things happen: CNN's site slows down, CNN's ops team blocks your IPs, and CNN files a complaint with your abuse desk.

Politeness is not a nice-to-have. It shapes the entire sharding scheme.

```mermaid
flowchart TD
    Start([Fetcher wants to fetch a URL]) --> A{"robots.txt:<br/>is this path allowed?"}
    A -- disallowed --> Skip["Skip. Record in url_meta."]:::bad
    A -- allowed --> B{"Token bucket:<br/>is there a token?"}
    B -- empty --> Wait["Wait. URL goes back<br/>in the per-host queue."]:::bad
    B -- token available --> C["Consume token. Fetch."]:::ok
    C --> D{HTTP status?}
    D -- 200 --> OK["Store HTML. Ack."]:::ok
    D -- 404/410 --> Dead["Mark dead.<br/>No retry."]:::bad
    D -- 429/503 --> Back["Honor Retry-After.<br/>Double crawl-delay."]:::bad
    D -- 5xx repeated --> Down["Mark host down.<br/>Slow to a crawl."]:::bad

    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

<details markdown="1">
<summary><b>Show: the full politeness ruleset</b></summary>

**robots.txt.** Before fetching any URL on a site, GET `https://site.com/robots.txt`. Cache for 24 hours per host.

```
User-agent: MyCrawler
Disallow: /private/
Crawl-delay: 2
Sitemap: https://site.com/sitemap.xml
```

- `Disallow` means do not fetch that path.
- `Crawl-delay: 2` means wait 2 seconds between requests to this site.
- If robots.txt returns 404, RFC 9309 says "no rules, fetch freely."
- If robots.txt times out or returns 5xx, skip the site until it is readable again.

**Token bucket per host.** Default: 1 request per second. If robots.txt sets `Crawl-delay`, honor that instead.

- Bucket holds 1 token.
- Refills at the configured rate (1 token/sec by default).
- Fetching costs 1 token. If the bucket is empty, the URL waits.

**HTTP status backoff.**

| Status | Action |
|--------|--------|
| 200, 301, 302 | Success. Follow normally. |
| 404 | Record. No retry. |
| 403 | Do not retry for 7 days. |
| 429 | Honor `Retry-After`. Double the per-host delay. |
| 503 | Same as 429. |
| 5xx repeated | Exponential backoff. After 5 failures in 24h, treat host as down. |

**User agent.** Identify yourself:

```
Mozilla/5.0 (compatible; MyCrawler/2.0; +https://example.com/crawler-info)
```

The URL links to a page explaining what your crawler does and how to block it. Missing this is rude and gets you blocked.

</details>

> **Take this with you.** Politeness is why the frontier is sharded by hostname instead of by URL hash. All decisions about one website must live on one machine so rate limits are enforced without cross-shard coordination.

---

## Step 9: Seen-URL dedup (the two-layer approach)

When you have 50 billion known URLs, you cannot check a database on every single outlink discovery. That would be 20 million database lookups per second.

The answer is a two-layer check.

```mermaid
flowchart TD
    A["New URL discovered<br/>(from link extractor)"] --> B["Canonicalize the URL<br/>(lowercase, strip utm_*, sort params)"]
    B --> C["Hash the canonical URL"]
    C --> D{"Bloom filter:<br/>seen before?"}
    D -->|"No: definitely new"| F["Add to frontier"]:::ok
    D -->|"Maybe: 1% chance it is wrong"| E{"KV store:<br/>really seen?"}
    E -->|"Yes, truly seen"| G["Drop. Do nothing."]:::bad
    E -->|"No, Bloom was wrong"| F
    F --> H["Mark seen in Bloom + KV"]

    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

Why two layers? Bloom alone is wrong 1% of the time (false positive: says "seen" when it has not). We cannot afford to drop 1% of genuinely new URLs. So when Bloom says "maybe seen," we do one extra lookup in the KV store. In practice, 99% of checks never reach the KV store.

**Content dedup** is a second, separate check that runs after fetching. Compute `SHA256(page body)`. Two URLs returning the same content write the same blob to S3. The second write is a no-op. The indexer later notices that two `url_meta` rows point to the same `content_hash` and picks one canonical URL to index.

<details markdown="1">
<summary><b>Show: URL canonicalization in code</b></summary>

```python
def canonicalize(raw_url, base_url):
    url = urljoin(base_url, raw_url)
    parsed = urlparse(url)

    scheme = parsed.scheme.lower()
    host = parsed.hostname.lower()
    if host.startswith("www."):
        host = host[4:]

    port = parsed.port
    if (scheme, port) in (("http", 80), ("https", 443)):
        port = None

    path = posixpath.normpath(parsed.path) or "/"

    params = parse_qs(parsed.query)
    for token in ("sid", "PHPSESSID", "jsessionid",
                  "utm_source", "utm_medium", "utm_campaign"):
        params.pop(token, None)
    query = urlencode(sorted(params.items()), doseq=True)

    return urlunparse((scheme, host_with_port(host, port),
                       path, "", query, ""))
```

Session tokens like `PHPSESSID` and tracking params like `utm_source` cause infinite URL explosions. The same page ends up with a different URL for every visitor. Strip them aggressively.

</details>

> **Take this with you.** URL dedup catches 95% of duplicates cheaply, before any fetch. Content dedup catches the rest after fetching. Run both.

---

## Step 10: Recrawl scheduling

Discovery fills the frontier with new URLs. Recrawl fills it with old ones that need refreshing.

CNN publishes 100 articles per day. A dormant personal blog publishes once a year. Recrawling both daily wastes 99% of capacity on the blog and delivers CNN articles an hour late.

The fix is adaptive scheduling: if the content changed since the last fetch, crawl more often. If it did not, back off.

```mermaid
flowchart LR
    A["Fetch complete"] --> B{"Content changed<br/>since last fetch?"}
    B -- yes --> C["Halve the interval<br/>(down to a floor)"]:::ok
    B -- no --> D["Multiply by 1.5<br/>(up to a ceiling)"]:::bad

    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

Floors and ceilings by host class:

| Host class | Floor | Ceiling |
|------------|-------|---------|
| News (cnn.com, bbc.com) | 10 minutes | 6 hours |
| Generic | 1 day | 30 days |
| Dormant | 30 days | 90 days |

The Recrawl Scheduler runs continuously, scanning `url_meta` for `next_refresh_at < now()`, and re-injects those URLs into the frontier with a freshness priority boost.

> **Take this with you.** Discovery and recrawl look identical at the frontier. The scheduler just puts URLs back in the queue. The engine does not care how a URL got there.

---

## Follow-up questions

Try answering each in 3 or 4 sentences before opening the solution.

1. **Crawler trap.** A site has a calendar widget linking to `?date=2026-05-25`, `?date=2026-05-26`, and so on for 10,000 years. The frontier fills with junk. How do you detect and stop this without maintaining a list of trap sites?

2. **Soft 404.** A site returns HTTP 200 with a body that says "Page not found." You add it to the index. Later you find every URL on that site returns the same "not found" page. How do you catch this?

3. **JavaScript-rendered pages.** A modern single-page app returns an almost-empty `<div id="root">` and loads everything via JS. The link extractor finds zero links. How does the pipeline handle these?

4. **Recrawl scheduling.** A news site posts 100 articles per day. A dormant blog posts once a year. You want news refreshed within an hour and the blog refreshed monthly. How do you decide each URL's refresh rate without tuning per site?

5. **Frontier persistence.** A frontier shard's machine reboots. There are 5 billion URLs queued in that shard. How do you persist the queue without making every push a synchronous disk write?

6. **Bloom filter race.** Two fetchers in different regions discover the same new URL at the same instant. Both query the dedup service. How do you make sure only one of them adds it to the frontier?

7. **Two URLs, same content.** `example.com/article/123` and `example.com/article/123?utm=email` are the same page. Both got fetched. How does the storage layer notice, and what does the search index see?

8. **A new important domain.** A major news site launches with 1 million pages. At 1 req/sec, it would take 12 days to crawl. How do you go faster without being rude?

9. **Spam farm.** Someone generates 10 million auto-generated low-value pages on cheap domains that interlink. How does the crawler avoid wasting capacity on them?

10. **Geo-distributed targets.** A French news site is hosted in France. Your fetchers are in us-east. Each fetch costs 200ms of round-trip latency. How do you cut the latency without running a full crawler in every region?

---

## Related problems

- **[Rate Limiter (004)](../004-rate-limiter/question.md).** Per-host politeness is a token bucket at huge cardinality. Same patterns, same edge cases.
- **[Distributed Cache (009)](../009-distributed-cache/question.md).** The dedup index, robots.txt cache, and DNS cache all use sharded cache patterns from there.
- **[Typeahead Autocomplete (005)](../005-typeahead-autocomplete/question.md).** Both have a batch pipeline that turns raw input into a serving-side index. Same shape: Kafka spine, stateless workers, periodic compaction.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Web Crawler (Googlebot)

### The short version

A web crawler is a graph walker. It pulls a URL off a to-do list (the frontier), downloads the page, finds the links inside, cleans them up, checks if they are new, and adds new ones back to the list. Repeat forever.

The hard parts are not the queue:

- **Politeness.** Never crash another person's website. One stranger should never get hurt by your crawler.
- **Dedup.** With 50 billion URLs, you cannot afford to fetch the same page twice. A Bloom filter handles the hot path. A key-value store confirms.
- **Coordination.** 450 machines must work together without stepping on each other. The trick: split the frontier by hostname so all decisions about one site live on one machine.
- **Recrawl.** News sites change every hour. Old blogs change once a year. A separate scheduler decides when to revisit each URL.

The throughput numbers are large but tractable. The real complexity is etiquette and coordination, not raw QPS.

---

### 1. The two questions that matter most

**What are we crawling?** HTML only? Or also JS-rendered SPAs, images, PDFs? Each is a separate pipeline. Assuming "everything" makes the design 10x bigger than intended.

**How fresh must the index be?** A crawler that promises hourly freshness for news needs a recrawl scheduler that is larger and more complex than the discovery crawler itself.

Everything else (politeness detail, JS rendering, output format) follows from those two answers.

---

### 2. The math, in plain numbers

| What | Number |
|------|--------|
| Fetches/sec sustained | 58,000 |
| Fetches/sec peak | ~150,000 |
| Bandwidth sustained | 5.8 GB/sec |
| Raw HTML/day | 500 TB compressed |
| 30-day hot storage | ~10 PB after dedup |
| Frontier metadata | ~5.5 TB across 64 shards |
| Bloom filter for 50B URLs | ~60 GB across 8-16 nodes |
| Fetcher nodes | ~450 |
| Concurrent host slots active | ~58,000 of 500M known hosts |

The headline observation: the bottleneck is not storage or CPU. It is per-host politeness coordination. That single constraint drives the sharding scheme. Hash by host so all decisions about one website happen on one shard.

---

### 3. Internal APIs (between subsystems)

The crawler does not face end users. The APIs that matter are between its own pieces.

**Frontier to Fetcher: lease a batch.**

```
POST /frontier/{shard_id}/lease_batch
{
  "fetcher_id": "fetcher-042",
  "batch_size": 100,
  "lease_seconds": 60
}

Response:
{
  "lease_id": "L-9871234",
  "urls": [
    { "url": "https://example.com/a", "host": "example.com",
      "priority": 0.81, "depth": 3 },
    ...
  ],
  "expires_at": "..."
}
```

Two load-bearing details. No two URLs in the batch share a host, so the fetcher fires 100 requests in parallel without violating any rate limit. The **lease** means: if the fetcher does not call back in 60 seconds, the URLs go back into the queue. Prevents lost work when a node dies.

**Fetcher to Frontier: acknowledge results.**

```
POST /frontier/{shard_id}/ack
{
  "lease_id": "L-9871234",
  "results": [
    { "url": "...", "status": 200, "content_hash": "sha256:...", "fetched_at": "..." },
    { "url": "...", "status": 429, "retry_after_seconds": 600 },
    { "url": "...", "status": 0, "error": "dns_timeout" }
  ]
}
```

Each result updates the host health score, the next-allowed-fetch timestamp, and the URL record in `url_meta`.

**Link Extractor to Dedup Index: check and add.**

```
POST /dedup/check_and_add
{ "candidates": [{ "url": "...", "parent_url": "...", "depth": 4 }, ...] }

Response:
{ "new_urls": [ ... ] }   # only URLs not seen before
```

The service does a Bloom filter check, then a KV lookup for the ones Bloom flagged as "maybe seen." Only truly-new ones reach the frontier.

---

### 4. The data model

Two main tables. One blob store. Plus in-memory state on the frontier shards.

```mermaid
erDiagram
    host_meta ||--o{ url_meta : "one host, many URLs"
    url_meta ||--o| content_store : "content_hash"

    host_meta {
        int host_id
        text hostname
        text robots_body
        real crawl_delay_seconds
        real health_score
        int consecutive_failures
    }
    url_meta {
        bytea url_hash
        text url
        int host_id
        timestamptz last_fetched
        int last_status
        bytea content_hash
        real priority
        timestamptz next_refresh_at
        smallint depth
    }
    content_store {
        bytea content_hash
        text compressed_html
    }
```

<details markdown="1">
<summary><b>Show: the full SQL</b></summary>

```sql
CREATE TABLE host_meta (
    host_id              INT PRIMARY KEY,
    hostname             TEXT NOT NULL UNIQUE,
    robots_body          TEXT,
    robots_fetched_at    TIMESTAMPTZ,
    crawl_delay_seconds  REAL NOT NULL DEFAULT 1.0,
    health_score         REAL NOT NULL DEFAULT 1.0,
    last_fetched_at      TIMESTAMPTZ,
    consecutive_failures INT NOT NULL DEFAULT 0,
    daily_quota_used     INT NOT NULL DEFAULT 0,
    daily_quota_max      INT NOT NULL DEFAULT 100000,
    flags                INT NOT NULL DEFAULT 0
);

CREATE TABLE url_meta (
    url_hash         BYTEA PRIMARY KEY,
    url              TEXT NOT NULL,
    host_id          INT NOT NULL REFERENCES host_meta(host_id),
    first_seen       TIMESTAMPTZ NOT NULL,
    last_fetched     TIMESTAMPTZ,
    last_status      INT,
    content_hash     BYTEA,
    priority         REAL,
    next_refresh_at  TIMESTAMPTZ,
    depth            SMALLINT,
    parent_url_hash  BYTEA,
    flags            INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_host_priority ON url_meta (host_id, priority DESC)
    WHERE last_fetched IS NULL;
CREATE INDEX idx_refresh ON url_meta (next_refresh_at)
    WHERE next_refresh_at IS NOT NULL;
```

`flags` is a bitfield, not separate columns. States like `trap_suspected`, `soft_404`, `redirect_chain_too_long` can be added without a schema migration. Each bit is one test.

</details>

The **Content Store** lives in object storage (S3 or GCS), addressed by `content_hash` (SHA-256 of the compressed body). Two URLs returning the same page write the same key. The second write is a no-op. This is free content dedup at write time.

The **frontier shard** holds in-memory state not in the tables: a priority heap keyed by `(host_id, scheduled_at, priority)`, per-host token buckets, and per-host "next allowed fetch" timestamps. On restart, rebuild from `url_meta`.

---

### 5. The core algorithm

#### URL canonicalization

Before doing anything with a URL, clean it so different forms of the same page look identical.

<details markdown="1">
<summary><b>Show: the canonicalize function</b></summary>

```python
def canonicalize(raw_url, base_url):
    url = urljoin(base_url, raw_url)
    parsed = urlparse(url)

    scheme = parsed.scheme.lower()
    host = parsed.hostname.lower()
    if host.startswith("www."):
        host = host[4:]

    port = parsed.port
    if (scheme, port) in (("http", 80), ("https", 443)):
        port = None

    path = posixpath.normpath(parsed.path) or "/"

    params = parse_qs(parsed.query)
    for token in ("sid", "PHPSESSID", "jsessionid",
                  "utm_source", "utm_medium", "utm_campaign"):
        params.pop(token, None)
    query = urlencode(sorted(params.items()), doseq=True)

    return urlunparse((scheme, host_with_port(host, port),
                       path, "", query, ""))
```

Session tokens like `PHPSESSID` cause infinite URL explosions: the same page has a different URL for every visitor. Stripping `utm_*` is opinionated but correct for dedup. Sorting query params ensures `?a=1&b=2` and `?b=2&a=1` hash to the same value.

</details>

#### Dedup with a Bloom filter

```python
def is_new(url):
    h = sha256(canonicalize(url))
    if not bloom.contains(h):
        return True                  # definitely new
    if not kv_store.exists(h):
        return True                  # Bloom false positive
    return False

def mark_seen(url):
    h = sha256(canonicalize(url))
    bloom.add(h)
    kv_store.put(h, {"first_seen": now()})
```

The Bloom filter is partitioned by URL hash prefix across 8-16 nodes. Each node owns a slice of the keyspace. Both reads and writes route to one specific node.

False positive rate: 1%. That means 1% of new URLs trigger an extra KV lookup. Tunable by adding more bits per element.

#### Politeness with token buckets

<details markdown="1">
<summary><b>Show: the HostTokenBucket class</b></summary>

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

</details>

The bucket lives on the frontier shard that owns the host. `lease_batch` only returns URLs whose bucket has a token. URLs with empty buckets are skipped; the shard moves on to other hosts.

#### Priority scoring

Each URL gets a score when it enters the frontier:

```python
def initial_priority(url, parent_url, parent_priority):
    p = 0.5
    p *= host_quality_score(host_of(url))    # 0.0 (spam) to 1.0 (great)
    p *= parent_priority ** 0.5              # diffuse from parent
    p *= 1 / (1 + depth(url))               # depth decay
    if has_known_trap_pattern(url):
        p *= 0.1
    return min(1.0, max(0.0, p))
```

Host quality scores are computed offline in a daily batch job over the link graph. Spam hosts identified today have their queued URLs deprioritized overnight.

---

### 6. The architecture

```mermaid
flowchart TB
    subgraph Inputs["Inputs"]
        S([Seed URLs]):::user
        RS["Recrawl Scheduler"]:::app
    end

    subgraph FrontierLayer["Frontier layer"]
        F[/"URL Frontier<br/>64 shards, hash-by-host<br/>per-host: token bucket,<br/>robots.txt, quota, health"/]:::app
    end

    subgraph FetchLayer["Fetch layer"]
        W[/"Fetcher Pool<br/>~450 stateless nodes<br/>DNS cache · robots cache"/]:::app
        JS["JS Render Pipeline<br/>(headless Chromium)"]:::app
    end

    K{{"Kafka<br/>fetched-pages topic"}}:::queue

    subgraph ParseLayer["Parse layer"]
        P[/"Link Extractor<br/>(stateless workers)"/]:::app
        D[/"Dedup Index<br/>(Bloom + sharded KV)"/]:::cache
    end

    Store[("Content Store<br/>S3, keyed by content hash")]:::db
    Meta[("URL Metadata<br/>Postgres / RocksDB")]:::db

    S --> F
    RS --> F
    F --> W
    W --> Store
    W --> Meta
    W -.JS-heavy.-> JS
    JS --> Store
    W --> K
    K --> P
    P --> D
    D -.new only.-> F

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Five things to notice:

1. The frontier is the coordination bottleneck. Politeness, priority, and dedup-confirmation all need state. Sharding by host keeps the hot path local.
2. The fetcher pool is the bandwidth bottleneck. Stateless. Easy to scale. Caches are per-node to avoid choke points.
3. Content Store is hash-addressed. Two URLs with the same content write one blob. Free dedup at write time.
4. Link Extractor is separate from Fetcher. Parsing is CPU-bound; fetching is IO-bound. Mixing them wastes both types of capacity. If the parser fleet dies, the raw HTML is safely in Kafka.
5. The Dedup Index is separate from the Frontier. The Bloom filter is global. Co-locating it with the frontier (sharded by host) would not work because outlinks from one page span many hosts.

---

### 7. One URL's journey, end to end

1. **Discovery.** A fetched page `blog.example.com/post-1` is parsed by the Link Extractor. One `<a href>` link is `/post-2`. Canonicalize to `https://blog.example.com/post-2`.

2. **Dedup check.** Send to the Dedup Service. Bloom says "not seen." Return as new.

3. **Frontier insert.** Route to shard `hash("blog.example.com") mod 64 = shard 17`. Compute initial priority from parent + depth + host quality. Insert into shard 17's priority heap.

4. **Wait.** The URL sits in the queue. The host's token bucket releases 1 token/sec.

5. **Lease.** Fetcher-042 calls `lease_batch` on shard 17 with `batch_size=100`. Shard 17 picks 100 URLs from 100 different hosts, each with a free token. `post-2` is one of them. Tokens consumed. URLs returned with a 60-second lease.

6. **DNS.** Fetcher-042 checks its local DNS cache. Cache miss. Query DNS. Cache for the TTL.

7. **Robots.** Check robots.txt cache. Cache hit. `/post-2` is allowed.

8. **Fetch.** Open HTTPS connection (reuse from pool if possible). GET `/post-2` with the crawler's user agent. Receive 200 + body.

9. **Content hash.** Normalize the body (strip per-request noise like CSRF tokens). Compute SHA-256.

10. **Store.** Write compressed body to S3 at key `sha256:abc...`. Update `url_meta`: `last_fetched`, `last_status=200`, `content_hash=abc...`.

11. **Ack.** Fetcher sends ack to shard 17. Shard updates host health (success), schedules `next_refresh_at`, removes URL from the active lease.

12. **Extract.** Link Extractor consumes the fetched-pages Kafka event. Parses `post-2`'s HTML. Finds 25 outlinks. Each goes through canonicalize, dedup check, frontier insert.

The interesting observation: most of the latency is queue wait, often hours for low-priority URLs. The actual work is fast. The system is throughput-bound, not latency-bound.

---

### 8. Frontier maintenance

The frontier is not just a queue you push to and pop from. It needs active maintenance.

**Trim dead URLs.** URLs with `last_status` in `[404, 410, 451]` for more than 30 days are removed.

**Adaptive refresh.** Each URL has `next_refresh_at`. After every fetch:

- Content changed: halve the interval (floor depends on host class).
- Content unchanged: multiply the interval by 1.5 (up to a ceiling).

Floors and ceilings by host class:

| Host class | Floor | Ceiling |
|------------|-------|---------|
| News (cnn.com, bbc.com) | 10 minutes | 6 hours |
| Generic | 1 day | 30 days |
| Dormant | 30 days | 90 days |

**Daily priority recompute.** Recompute each host's quality score and reorder the queue. Spam hosts flagged today have their pending URLs deprioritized tomorrow.

**Resharding.** If one shard is consistently hot (a giant host dominates it), split the shard. Drain its URLs into the new shards atomically and update the routing table. Same pattern as resharding a SQL database.

---

### 9. The scaling journey: 1 machine to Googlebot

```mermaid
flowchart LR
    S1["Stage 1<br/>1 machine<br/>100K pages/day<br/>SQLite + local disk<br/>~$30/mo"]:::s1
    S2["Stage 2<br/>~10 machines<br/>10M pages/day<br/>Postgres + S3<br/>+ Redis robots cache<br/>~$1k/mo"]:::s2
    S3["Stage 3<br/>~100 machines<br/>500M pages/day<br/>Sharded frontier<br/>+ Kafka + Bloom<br/>~$50-100k/mo"]:::s3
    S4["Stage 4<br/>~450 machines<br/>5B pages/day<br/>+ JS render fleet<br/>+ trap detector<br/>+ regional fetchers"]:::s4

    S1 --> S2 --> S3 --> S4

    classDef s1 fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef s2 fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s3 fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef s4 fill:#fce7f3,stroke:#be185d,color:#831843
```

#### Stage 1: 1 machine, 100K pages/day

One Python script. SQLite for `url_meta`. Local disk for HTML. No Bloom filter (the seen-set fits in RAM). robots.txt fetched on every request. About $30/month.

Fine because 100K pages/day is roughly 1 fetch/sec. Building more is over-engineering.

#### Stage 2: 10 machines, 10M pages/day

What breaks: SQLite locks up under concurrent writes. Local disk runs out. robots.txt re-fetching annoys webmasters.

Fixes, in order: move `url_meta` to Postgres, move HTML to S3 addressed by content hash, cache robots.txt in Redis with 24h TTL, add a real Bloom filter (fits in RAM at this size), add per-host token buckets in Redis. Still one shared frontier. ~$1k/month.

#### Stage 3: hundreds of machines, 500M pages/day

What breaks: Postgres becomes a bottleneck under concurrent frontier access. Politeness violations happen because fetchers race for host tokens. The seen-URL check cannot keep up.

Fixes: shard the frontier by hostname across 64 nodes backed by RocksDB, each with Raft replication. Decouple parsing from fetching via Kafka (fetching is IO-bound, parsing is CPU-bound; separate fleets for each). Add a sharded Bloom filter across 8 nodes. Add regional fetcher pools for EU and Asia hosts. About $50-100k/month.

#### Stage 4: Googlebot scale, 5B pages/day

What breaks: one frontier shard with a giant host (Wikipedia, GitHub) becomes hot. JS-heavy pages return empty content. Spam farms fill the frontier with junk. The Bloom filter's false positive rate drifts up as the universe grows beyond 50B URLs.

Fixes, in order:

- **Hot host mitigation.** Cap per-host pop rate. Spill low-priority URLs to cold storage. Coordinate with mega-hosts via their sitemaps.
- **JS render pipeline.** Separate fleet of headless Chromium. Allocate ~5% of capacity. Flag and route only JS-heavy URLs.
- **Trap detector.** Background job clusters URLs by shape. Hosts where one URL shape dominates get flagged.
- **Bloom rebuild.** Nightly job rebuilds from the KV store, restoring the 1% false positive rate.
- **Adaptive recrawl scheduler.** Per-URL frequency based on observed content changes.

This is also where multi-region shows up. Each major region runs its own fetcher pool. The frontier remains globally sharded. Only the IO leg is regional.

---

### 10. JavaScript rendering

The modern web is JS-heavy. `https://airbnb.com/rooms/123` might return an almost-empty `<div id="root">` and load real content via JavaScript. Plain HTTP GET sees nothing useful.

Two-pass crawl, the way Googlebot actually works:

1. **First pass: static fetch.** Standard HTTP GET. Parse the HTML. If the page looks JS-heavy (very little text, few outlinks, large `<script>` blocks), flag it.
2. **Second pass: render.** Send the URL to a render queue. A headless Chromium node loads the URL, runs JavaScript, waits a few seconds for the page to settle, takes a DOM snapshot, writes rendered HTML to the Content Store under a new key.
3. **Re-extract.** Link Extractor runs again on the rendered HTML. Now it finds the real outlinks.

Rendering is 10x to 100x more expensive than a plain fetch. Allocate ~5% of total capacity. Prioritize high-value URLs only.

---

### 11. Reliability

**Frontier shard fails.** The hosts on that shard pause. Replicate each shard with Raft or primary + warm standby. On failover, rebuild the in-memory queue from RocksDB. Hosts pause under a minute, then resume.

**Fetcher node fails.** Leases expire. URLs return to the queue automatically. No data loss. Auto-scaling replaces the node.

**Link Extractor fails.** The Kafka backlog grows but no HTML is lost. Once the extractor recovers, it catches up. Fetcher does not block.

**Dedup Service fails.** Fail open: treat all candidate URLs as new. Accept some duplicate work. Failing closed (reject all as seen) would lose new URLs forever, which is far worse.

**Content Store fails.** Fetcher buffers locally for a few minutes. Beyond that, drop the fetch and requeue the URL. The recrawl scheduler will re-inject it.

**Region fails.** Regional fetcher pool is offline. URLs targeted at that region get assigned to the next closest region. Latency degrades but throughput holds.

---

### 12. Observability

| Metric | Why it matters |
|--------|----------------|
| `fetches_per_sec` (sustained, peak) | Headline throughput |
| `frontier_size_per_shard` | Detects hot shards |
| `host_quota_used_per_host` | Politeness compliance |
| `robots_disallow_rate` | Spike means your user agent is getting blocked |
| `dedup_false_positive_rate` | Above 1% means rebuild the Bloom filter |
| `content_dedup_rate` | Should be ~30%. Higher means you are crawling mirrors |
| `outlinks_per_page` p50/p99 | Spike means a trap site |
| `fetch_status_breakdown` 429/503 rate | Spike means you are being too aggressive |
| `frontier_lease_expiry_rate` | High means the fetcher pool is struggling |
| `recrawl_scheduler_lag` | Overdue refreshes piling up means the freshness SLO is at risk |
| `dns_cache_hit_rate` | Below 95% means you are hammering DNS |
| `js_render_queue_depth` | JS pipeline is the slow lane; it can back up |
| `webmaster_complaint_count` | Page on this. Politeness is the headline non-functional SLO. |

Page on: webmaster complaint volume rising, frontier shard down, 429/503 rate above 5%, throughput below 50% of target.

Ticket on: dedup rate drift, content dedup rate spike (mirror crawl), trap detector firings.

---

### 13. Follow-up answers

**1. Crawler trap.**

Symptoms: one host produces unbounded outlinks of the same shape (`?date=2026-05-25`, `?date=2026-05-26`, ...).

Detection in layers:

- **Per-host URL count cap.** If a host adds more than 1 million URLs to the frontier in a day, pause new additions from that host pending review.
- **Pattern heuristic.** For each host, cluster URLs by normalized shape (replace digits and tokens with wildcards). If one shape is more than 80% of the host's URLs, flag as a likely trap.
- **Depth limit.** Hard cap at depth 20. Calendar traps link to themselves indefinitely, so depth grows without bound. The cap stops them.
- **Outlink density.** Pages with more than 500 same-shape outlinks to the same host get flagged.

Recovery: drop the trap URLs from the frontier. Lower the host's quality score so future URLs from it get deprioritized.

**2. Soft 404.**

Detection: a single `content_hash` accounting for more than 30% of fetched pages on a host means those URLs all return the same "page not found" body. A secondary signal: that body contains text like "404", "not found", "page does not exist" and is unusually short.

Once detected, mark `soft_404` in `url_meta`. The indexer ignores those URLs. Recrawl drops to once a month in case the site fixes itself.

**3. JavaScript-rendered pages.**

If `outlinks_count == 0` and the page is non-trivially long, flag for JS rendering. Route to the separate headless Chromium fleet. Load the URL, run JavaScript, wait a few seconds, snapshot the DOM, write rendered HTML to the Content Store. Re-run the Link Extractor on the rendered HTML.

Cost: 10x to 100x more expensive than static fetch. Allocate ~5% of total capacity. Prioritize high-value URLs only.

**4. Recrawl scheduling.**

Track whether `content_hash` changed since the last fetch. Changed: halve the interval (down to the floor). Unchanged: multiply by 1.5 (up to the ceiling). Floors and ceilings are per host class: news hosts floor at 10 minutes, generic hosts floor at 1 day, dormant hosts floor at 30 days. The Recrawl Scheduler scans `url_meta` continuously for `next_refresh_at < now()` and re-injects those URLs.

**5. Frontier persistence.**

Writing every push synchronously to disk would exhaust the IOPS budget. Instead: keep the queue in memory for low latency, append every operation to a RocksDB write-ahead log asynchronously, and snapshot the full in-memory state to RocksDB every 5 minutes. On restart: load the most recent snapshot, replay the log past it, resume. A crash may lose the last few seconds of pushes. That is fine because URLs are idempotent: a re-discovered URL is caught by the Bloom filter and discarded.

**6. Bloom filter race.**

Two fetchers in different regions discover the same new URL at the same instant. Both calls route to the same Bloom shard (the URL hash deterministically picks the shard). On the shard, the operation is atomic: if not in Bloom, add to Bloom and KV; otherwise reject. Only one wins. No inter-region race is possible because both calls hit the same shard.

**7. Two URLs, same content.**

After canonicalization, `utm_*` is stripped, so `example.com/article/123?utm=email` and `example.com/article/123` become the same URL. Dedup catches them at the URL layer before any fetch.

If canonicalization misses something and both URLs get fetched, they compute the same `content_hash`. The Content Store write is a no-op on the second. The `url_meta` table has two rows pointing at the same `content_hash`. The indexer picks the canonical URL by signals like inlink count, indexes the rest as aliases.

**8. New important domain at default rate.**

12 days to crawl 1 million pages at 1 req/sec is too slow for a major news site relaunch. Options: negotiate a higher rate with the site's crawler-relations team (set `crawl_delay_seconds=0.1` by mutual agreement), ingest their sitemap (sitemaps publish update timestamps, so you only fetch changed pages), or boost only the top 10,000 pages by a quick PageRank pass and leave the long tail at default.

Politeness is a default, not a law. With consent and signal, you can go faster.

**9. Spam farm.**

Mitigation in layers: compute host quality scores offline (spam hosts have low PageRank, low inlink diversity, low content quality) and use that score for per-host quota and per-URL priority. Cap outlink extraction at 200 per page (a page with 5,000 self-linking outlinks is junk). For a host whose quality drops below a threshold and whose URL patterns match spam, blacklist it pending weekly review.

A spam farm should burn through its daily host quota in a few hours and then stop affecting capacity.

**10. Geo-distributed targets.**

Maintain a small fetcher pool in each major region (us-east, eu-west, ap-south). The frontier annotates each URL with a `region_hint` based on the host's geo IP. When dispatched, the URL prefers a fetcher in the closest region. The frontier remains globally sharded. Only the IO leg is regional. Cost: 3x deployment, but only fetcher pools are duplicated, not the frontier or stores. Typical fetch latency for Asian sites drops from 300ms to 50ms.

---

### 14. Trade-offs worth saying out loud

**BFS vs PageRank-prioritized.** Pure BFS spends capacity equally on everything. PageRank prioritization focuses on useful pages but can starve the long tail. Most production crawlers run weighted: ~80% priority-driven, ~20% exploration budget for low-priority URLs to avoid blind spots.

**URL dedup only, or also content dedup.** URL dedup catches 95% of duplicates cheaply (Bloom + KV). Content dedup catches the rest but only after fetching. Content-hash dedup is free at write time. Most crawlers do both.

**Strict robots.txt or lenient.** Strict means respect every directive, refresh every 24 hours, and fail closed on unreachable robots.txt. Lenient means cache longer and fail open. Strict is the only defensible answer in interviews and in practice. Webmaster relations are a real cost.

**Synchronous fetch-parse-dedup vs decoupled pipeline.** Decoupled is harder to operate but lets each stage scale independently and fail independently. At this scale, decoupled wins.

**What you would revisit at 10x scale.** Shard by TLD first, then by host within TLD, so country-specific shards can become regional. Move to streaming PageRank (continuous update rather than daily batch) so quality scores reflect link-graph changes faster. Adopt a learned model for per-host adaptive rate rather than a static token bucket. Introduce a federated frontier (top-level coordinator + regional frontiers) so the system survives entire-region outages.

---

### 15. Common mistakes

**"Just BFS from a seed."** No priority, no politeness, no dedup. This is a homework crawler, not a production one.

**Hashing by URL instead of by host.** Politeness becomes an N-squared coordination problem. The interviewer will catch this immediately.

**Forgetting robots.txt.** Politeness is the load-bearing constraint. If you skip robots.txt and per-host rate limits, you skipped the most important part.

**Treating recrawl as an afterthought.** "Just recrawl daily" does not work for news (too slow) or for dormant pages (too wasteful). Adaptive scheduling is the expected answer.

**Ignoring content dedup.** The web has massive duplication from mirrors, CDN variants, and template pages. Without content-hash dedup, you waste 30% of storage and pollute the index.

**No mention of crawler traps.** Calendars, session tokens, infinite pagination. Every real crawler has trap detection. Without it, the frontier fills with junk within days.

**A single big queue.** Sharding is non-negotiable at this scale. A single queue limits throughput and is a single point of failure.

**Overengineering dedup.** Some candidates propose perfectly-consistent distributed sets. A Bloom filter with 1% false positive rate is fine. Strong consistency on dedup is over-budget.

**No JS rendering plan.** Without a render pipeline you miss a large fraction of the modern web. Name the pipeline and say it is a separate fleet, even if you do not design it in detail.

**Skipping geo-distribution.** Crawl latency to far-side hosts is real. Regional fetcher pools are a cheap win that experienced candidates name.

If you hit 9 of these in a 45-minute slot, you are interviewing well. The three that separate strong from average answers: host-sharded frontier for politeness, adaptive recrawl scheduling, and crawler trap handling. Those three together cover about half the design's real complexity.
{% endraw %}
