---
layout: practice-problem
track: system-design
problem_id: 5
title: Design Typeahead / Autocomplete Search
slug: 005-typeahead-autocomplete
category: Search
difficulty: Medium
topics: [trie, prefix tree, ranking, caching, low-latency]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/005-typeahead-autocomplete"
solution_lang: markdown
---

{% raw %}
## What we are building

Alice types "new yo" into the Google search box. Before she finishes, a dropdown appears: "new york weather", "new york times", "new yorker". She picks one and never types the last three letters.

That dropdown is typeahead autocomplete. Every keystroke sends a request. The suggestions must appear before the next keystroke, so the budget is around 100ms end to end, including the network trip. At Google's scale that is 2 million such requests per second.

There are four hard problems hiding in this product:

1. **The 100ms budget.** A database query takes 5 to 50ms. With network overhead, a database alone cannot fit inside the budget. The lookup must come from memory.
2. **Trie size at scale.** Storing the top 10 suggestions for every possible prefix takes roughly 90 GB. That does not fit on one machine.
3. **Top-N ranking.** For the prefix "fa" there are thousands of matching queries. "facade" comes before "facebook" alphabetically. The system has to know that "facebook" should win.
4. **Hot prefix handling.** The prefix "y" is typed by billions of users. At peak, one shard might see 400,000 requests per second.

We will start with the smallest thing that works, then add pressure one layer at a time.

---

## The lifecycle of one keystroke

Every suggestion request takes one of two paths: it hits a cache, or it falls through to the trie.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Keystroke: Alice types a letter
    Keystroke --> CacheHit: prefix cached at CDN or Redis
    Keystroke --> TrieLookup: cache miss
    CacheHit --> Suggestions: return top 10
    TrieLookup --> Suggestions: walk trie, return top 10
    Suggestions --> [*]: shown in < 100ms
```

A keystroke spends microseconds in the trie itself. Almost all of the 100ms budget is network. The design goal is to eliminate as many network hops as possible for the most common prefixes.

> **Take this with you.** A typeahead is a ranked prefix lookup served from memory, behind a cache. Speed is the whole design.

---

## How big this gets

| Input | Tiny startup | Google scale |
|-------|-------------|--------------|
| Active users | 1,000 | 1 billion |
| Searches per day | 10,000 | 5 billion |
| Keystrokes per search | ~10 | ~10 |
| Suggest requests per second (steady) | ~1 | ~580,000 |
| Suggest requests per second (peak) | ~5 | ~2,000,000 |
| Latency target P99 end-to-end | < 300ms | < 100ms |

<details markdown="1">
<summary><b>Show: the derived numbers at Google scale</b></summary>

| Metric | Value | How |
|--------|-------|-----|
| Requests per second, steady | ~580,000 | 5B × 10 / 86,400 |
| Requests per second, peak | ~2,000,000 | ~3.5x steady |
| Top 10 million queries cover | ~95% of traffic | Zipf distribution |
| Trie memory for top 10M queries | ~90 GB | ~9 KB per query node chain |
| Hot working set in Redis | ~5 GB | top prefixes per locale |

Three observations:

1. The 95/5 split is what makes caching so powerful. Cache the answer for "y" once and a billion requests get it for free.
2. At 580,000 requests per second, a database query averaging 10ms can serve at most 100 requests per second per core. This is why the lookup must come from memory.
3. 90 GB does not fit on one machine with headroom for the OS and other processes. Sharding by first letter is the natural split.

</details>

> **Take this with you.** When 95% of traffic falls on 5% of prefixes, cache layering is not an optimization. It is the design.

---

## The smallest version that works

Forget Google. A startup with 1,000 users searching a product catalog needs none of this complexity.

```mermaid
flowchart LR
    A([Alice]):::user --> API[/"Suggest API"/]:::app
    API --> DB[("Postgres\npg_trgm index")]:::db
    DB -.top 10.-> API
    API -.suggestions.-> A

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

One table, one GIN index on the query column. Lookups come back in 5 to 20ms. One endpoint:

| Endpoint | What it does |
|----------|--------------|
| `GET /suggest?q=new+yo&locale=en-US` | Return the top 10 matching queries |

<details markdown="1">
<summary><b>Show: the Postgres query</b></summary>

```sql
CREATE INDEX idx_queries_text ON queries USING gin (query gin_trgm_ops);

SELECT query, score
  FROM queries
 WHERE query LIKE $1 || '%'
 ORDER BY score DESC
 LIMIT 10;
```

This works up to around 100,000 users. Above that, 20ms per query starts to show on fast typers.

</details>

This is enough for the first few months. The interesting question is what breaks first as usage grows.

---

## Decision 1: what data structure stores the prefixes?

At 100,000 users the Postgres prefix query hits 50ms P99. That is already half the budget with no network time counted. The same handful of prefixes appear millions of times per day. Running the same query billions of times is wasteful.

Two options:

```mermaid
flowchart TB
    subgraph A["Option A: Hash map of every prefix"]
        A1["f -> [facebook, fashion, fast food...]"]
        A2["fa -> [facebook, fashion, face id...]"]
        A3["fac -> [facebook, face id, face mask...]"]
        A4["Problem: no shared storage. Each prefix<br/>stores its own copy. ~150 GB total."]:::bad
    end
    subgraph B["Option B: Trie with precomputed top-N"]
        B1["Root -> f -> a -> c -> e -> b -> o -> o -> k"]
        B2["Each node stores its own top 10 list."]
        B3["Lookup: walk K letters, return saved list.<br/>Microseconds. No sorting at read time."]:::ok
    end

    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
```

The trie wins because it shares prefixes. "facebook", "fashion", and "fast food" all share the "f" and "fa" nodes. The critical trick: precompute the top 10 at every node during the build. A lookup for "fa" is just: walk root -> f -> a, return the saved list. No subtree traversal, no sorting, constant time.

Without precomputing top-N, a lookup for "f" would require walking millions of child nodes, collecting every query, sorting by score, then taking the top 10. That takes seconds.

```mermaid
flowchart LR
    subgraph Node["Trie node at 'fa'"]
        N1["children: {c: ..., s: ..., t: ...}"]
        N2["top_10: [facebook, fashion, fast food,\nface id, fasting, facade, facts, ...]"]
    end
    subgraph Build["How it gets there"]
        B1["Build inserts every query"] --> B2["Propagate upward:<br/>each node collects top 10<br/>from all children"]
    end
```

Build is slow (30 minutes on a Spark cluster). Reads are constant time. That trade is worth it when reads outnumber builds by a billion to one.

> **Take this with you.** Precomputing the top 10 at every node is the central trick. The trie does not search at read time. It returns a pre-built list.

---

## Decision 2: where does the trie live?

The trie is 90 GB. Two options:

```mermaid
flowchart TB
    subgraph A["Option A: One machine"]
        A1["Single 128 GB machine"]
        A2["Problem: one machine handles 580K req/s at peak.<br/>CPU melts. Single point of failure."]:::bad
    end
    subgraph B["Option B: Shard by first letter"]
        B1["'f' shard: facebook, fashion, face..."]
        B2["'y' shard: youtube, yahoo, yelp..."]
        B3["'n' shard: netflix, new york, nba..."]
        B4["~26 primary shards, 3 replicas each.<br/>Hot letters get more replicas."]:::ok
    end

    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
```

Sharding by first letter is natural: the Suggest API reads the first character of the prefix and routes to the right shard. Each shard holds roughly 3 to 5 GB of trie data and handles a fraction of total traffic.

The "y" shard is still hot because "youtube" and "yahoo" dominate. The fix is more replicas for hot shards, not a different sharding scheme. We will revisit this in the hot prefix section.

> **Take this with you.** Shard by first letter. Each shard is an in-memory trie that handles one slice of the prefix space. Hot letters get more replicas.

---

## Decision 3: how do we keep the trie fresh?

The trie is built once per day from 90 days of search logs. Two problems:

1. Building takes 30 to 45 minutes. We cannot mutate the live trie while building.
2. A celebrity trend starts at 2 PM. The daily rebuild ran at midnight. Users expect it to appear within minutes, not tomorrow.

```mermaid
flowchart TB
    subgraph Daily["Daily full rebuild"]
        L[("Query logs\n90 days")] --> Spark["Spark job\n30-45 min"]
        Spark --> S3[("S3: versioned\ntrie snapshots")]
        S3 -.pull new version.-> T["Trie Service shards"]
        T --> Swap["Atomic pointer swap\n(validate first, then swap)"]
    end
    subgraph Delta["Delta pipeline: every 5 min"]
        K{{"Kafka\nlast 1 hour"}} --> Trend["Trending scorer\nvelocity threshold"]
        Trend --> DL["Delta file in S3\n(thousands of entries)"]
        DL -.merge at lookup.-> T
    end

    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    class L,S3 db
    class Spark,Trend,T db
    class K queue
```

The atomic swap: the Trie Service downloads the new snapshot in the background, validates it (size sanity check, spot-check popular prefixes, confirm at least 90% of yesterday's top suggestions are still present), then swaps a pointer in one CPU instruction. Readers see either the old or new trie, never a mix.

The delta layer is tiny (a few thousand entries) and adds about 1 microsecond per lookup.

> **Take this with you.** Never mutate the live trie. Build offline, validate, swap atomically. Delta handles freshness in between.

---

## Decision 4: how do we rank the suggestions?

For "fa" there are thousands of matching queries. Which ten appear?

Alphabetical order is wrong. "facade" beats "facebook" alphabetically. Frequency alone is wrong. "facebook ipo 2012" has more lifetime searches than "facebook layoffs 2026" but not right now.

Six signals feed the score:

| Signal | What it captures |
|--------|-----------------|
| Total frequency | Lifetime search volume. The baseline. |
| Recent frequency | Last 7 days weighted more than last 90. "facebook layoffs 2026" beats "facebook ipo 2012" today. |
| Click-through rate | When shown, did users click it? High CTR = genuinely useful. |
| Trending velocity | Spike in the last hour. Catches breaking news before the daily rebuild. |
| Personalization | Queries the user has searched before get a boost (logged-in users only). |
| Safety penalty | Harmful queries are dropped or demoted. |

The trie stores the **global** top 10 at each node. Personalization happens at the Suggest API, not inside the trie. Storing a personalized trie per user would mean billions of tries at 3 GB each, which is not feasible. Instead, the API fetches the user's top-100 recent queries (5 KB per user in Redis), boosts any prefix matches, re-ranks, and returns the top 10.

> **Take this with you.** Ranking is half the product. A trie with bad ranking gives alphabetical suggestions and a useless box.

---

## The full architecture

Putting the four decisions together:

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        A([Web / Mobile]):::user
        CDN["CDN\n(~80% hit rate, TTL 60-600s)"]:::edge
    end

    subgraph ReadPath["Read path (per region)"]
        LB["Load Balancer\n(anycast, nearest region)"]:::edge
        API["Suggest API\n(stateless pods)"]:::app
        Cache[("Regional Redis\n(~15% hit rate, TTL 60s)")]:::cache
        T["Trie Service\n(sharded by first letter,\n3-10 replicas per shard)"]:::app
        P[("Personalization\nRedis\n(user history, 5 KB/user)")]:::cache
    end

    subgraph BuildPath["Build path (offline, global)"]
        Logs[("Query Logs\nS3 Parquet, 30d hot")]:::db
        Builder["Trie Builder\n(Spark, daily + 5-min delta)"]:::app
        Store[("Object Storage\nS3 trie snapshots,\nversioned per locale/shard)"]:::db
    end

    A --> CDN
    CDN -.miss.-> LB
    LB --> API
    API --> Cache
    Cache -.miss.-> T
    API -.logged-in.-> P
    T -.pulls new version.-> Store
    Logs --> Builder
    Builder --> Store

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

Each component in one line:

| Component | Purpose |
|-----------|---------|
| CDN | Caches responses for popular prefixes at the edge. Absorbs ~80% of traffic. |
| Load Balancer | Anycast routes to nearest region. |
| Suggest API | Stateless. Routes to the right trie shard, blends personalization, enforces safety blacklist. |
| Regional Redis | Hot cache for prefixes that miss the CDN but are still common per region. ~15% hit rate. |
| Trie Service | In-memory trie sharded by first letter. 3 to 10 replicas per shard. Read-only at runtime. |
| Personalization Redis | Per-user top-100 recent queries. 5 KB per user. Used to boost personal results. |
| Trie Builder | Spark job. Reads logs, scores queries, builds trie files, uploads to S3. |
| Object Storage | Versioned trie snapshot files. Trie Service downloads new versions from here. |
| Query Logs | Every past search. Parquet files in S3. 30 days hot, 5 years cold. |

---

## Walk: one keystroke, end to end

Alice is in London. She types "new yo" into the search box. The sixth keystroke sends a request.

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant CDN as CDN (London edge)
    participant API as Suggest API
    participant R as Regional Redis
    participant T as Trie shard (n)
    participant P as Personalization Redis

    Note over Alice: types "new yo"
    Alice->>CDN: GET /suggest?q=new+yo&locale=en-GB (~2ms to edge)
    alt CDN hit (~80%)
        CDN-->>Alice: top 10 suggestions (~10ms total)
    else CDN miss (~20%)
        CDN->>API: forward (already ~15ms spent)
        API->>R: GET prefix:new+yo:en-GB
        alt Redis hit (~15% of total)
            R-->>API: top 10 (~3ms)
        else Redis miss (~5% of total)
            rect rgb(241, 245, 249)
                Note over API,T: trie lookup (microseconds)
                API->>T: lookup("new yo", locale=en-GB)
                T-->>API: global top 10
            end
            API->>P: user history for "new"
            P-->>API: 0 personal matches
            API->>R: SET prefix:new+yo:en-GB (TTL 60s + jitter)
        end
        API-->>CDN: top 10 + Cache-Control: public, max-age=60
        CDN-->>Alice: top 10 suggestions (~50-80ms total)
    end
```

Target latencies:

| Path | P99 |
|------|-----|
| CDN hit (~80% of requests) | ~10ms |
| Regional Redis hit (~15%) | ~30ms |
| Trie Service hit (~5%) | ~50-80ms |
| End-to-end budget | 100ms |

The trie lookup itself takes 50 microseconds. The 50ms for the slow path is almost entirely TCP and TLS. Getting fast means getting closer to the user, not making the trie faster.

---

## The hot prefix problem

The prefix "y" is typed by hundreds of millions of users per day. At 2 million requests per second fleet-wide, the "y" shard alone might receive 400,000 requests per second. Other shards are fine. This one is on fire.

```mermaid
flowchart TD
    Start([400K req/s for prefix 'y']) --> CDN{"CDN hit?"}
    CDN -->|"~95% for single-letter prefixes\n(10-min TTL)"| OK1["302 from edge\n~20K req/s reach origin"]:::ok
    CDN -->|"5% miss"| InProc{"In-process\nLRU hit?"}
    InProc -->|"~70% of misses"| OK2["serve from pod memory\n~6K req/s reach Redis"]:::ok
    InProc -->|"30% miss"| Replica{"Redis hit?"}
    Replica -->|"~90%"| OK3["serve from Redis\n~600 req/s reach trie"]:::ok
    Replica -->|"10% miss"| Shards["10 'y' shard replicas\n~60 req/s per replica"]:::ok

    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
```

Four fixes, used together:

1. **Aggressive CDN TTL for short prefixes.** "y" returns nearly the same answer for 10 minutes. Cache it that long at the edge. 400,000 per second drops to ~20,000 at origin.
2. **In-process LRU on the Suggest API.** Each pod keeps a small LRU (1,000 entries, 10-second TTL). Absorbs flash spikes before they hit Redis.
3. **More replicas for hot shards.** The "y" shard gets 10 replicas instead of 3.
4. **Finer sharding.** Split the "y" shard into "ya", "ye", "yi", "yo", "yu". Five shards share the load.

Cache layer math at 2M peak requests per second:

| Layer | Hit rate | Requests absorbed |
|-------|----------|------------------|
| CDN | ~80% | 1,600,000/s |
| Regional Redis | ~15% | 300,000/s |
| Trie Service | ~5% | ~100,000/s across ~150 shards |

100,000 requests per second across 150 shards is ~700 per shard. A 16 GB machine handles tens of thousands per second. Without caching, the trie alone would need to absorb 2,000,000 per second.

> **Take this with you.** Hot shard problems appear in every sharded system. The fix is always: cache higher up, add replicas, split the hot key.

---

## Follow-up questions

Try answering each in 2 or 3 sentences before opening the solution.

1. **Typos.** Alice types "facbook" instead of "facebook". The trie returns nothing because "facb" has no children. How do you still suggest "facebook"?

2. **Sub-minute trending.** A celebrity passes away at 2:00 PM. By 2:05 PM the world is searching their name. The daily rebuild ran at midnight. How quickly can you make their name appear as a suggestion?

3. **Hot shard failure.** The "y" shard loses one of its three replicas. What happens? How do you protect against a cascade?

4. **Personalization without a per-user trie.** Alice has searched "deep learning" three times. When she types "d", "deep learning" should rank high for her. How do you do this without storing a 3 GB trie per user?

5. **Bad suggestion goes live.** The trie shows something hateful for the prefix "j". The safety filter missed it. How do you remove it within 5 minutes globally?

6. **Multilingual user.** A French user sometimes searches in English. When they type "b", they want French suggestions but also want "BBC" to appear. How do you mix two language tries?

7. **Brand new query.** A new query starts trending but is not in the trie yet. Without waiting for tomorrow's rebuild, how do you make it appear?

8. **New language launch.** You launch in Vietnamese. There are no query logs yet. How do you bootstrap suggestions?

9. **Privacy.** Personalization uses past searches. How do you avoid leaking one user's queries to another? What happens when a user clicks "delete my history"?

10. **Snapshot swap memory pressure.** When a new trie loads, both old and new live in memory at the same time. That doubles your RAM briefly. How do you avoid running out?

11. **GET vs POST.** Why must the suggest endpoint be GET and not POST?

12. **CDN partial outage.** The CDN drops from 80% hit rate to 50% for one region. Origin load almost doubles. Are you provisioned for that?

13. **Mobile clients.** Mobile networks add 100 to 300ms of latency on their own. The 100ms budget is gone before the request reaches your data center. What can you do?

14. **Bot traffic.** A bot sends 100,000 requests per second for nonsense prefixes. It pollutes your query logs and skews rankings. How do you detect and filter it?

15. **A/B testing ranking.** Product wants to test a new ranking formula on 1% of users. How do you do this without rebuilding two whole tries?

---

## Related problems

- **[URL Shortener (001)](../001-url-shortener/question.md).** Same heavy read pattern. Same tiered caching (CDN + Redis + in-memory). Start there to learn cache layering.
- **[Distributed Cache (009)](../009-distributed-cache/question.md).** The regional Redis cache here uses the same eviction, replication, and hot-key patterns.
- **[Web Crawler (008)](../008-web-crawler/question.md).** Both have an offline batch pipeline that produces a serving index on a schedule. Same build-and-swap pattern.
- **[News Feed (002)](../002-news-feed/question.md).** Both use two-stage retrieval: cheap candidates first, smarter re-rank second.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Typeahead / Autocomplete Search

### What this system is

Typeahead autocomplete is a ranked prefix lookup served from memory behind layered caches. Every keystroke is a request. At Google scale that is about 2 million requests per second at peak, with a 100ms budget that includes the network trip.

The lookup structure is a sharded in-memory trie (a prefix tree where each branch is one letter). At every node we precompute the top 10 suggestions for that prefix. A lookup is: walk K letters, return the saved list. No searching. No sorting. Microseconds.

In front of the trie we stack two caches. A CDN at the edge catches about 80% of traffic. A regional Redis catches about 15%. The trie itself sees the remaining 5%.

The trie is built offline by a Spark job that reads search logs, computes scores, and writes finished snapshot files to S3. Trie Service shards pull new versions and swap them in atomically. For trending queries, a delta job runs every 5 to 15 minutes and patches fresh suggestions in without a full rebuild.

The interesting work is in the layers: cache layering (95% of traffic must be absorbed before the trie), ranking (frequency, recency, trending, click-through, personalization, safety), hot shards (the "y" shard handles 20% of all traffic alone), and the edge cases (typos, new languages, cold start, privacy).

---

### 1. The two questions that matter most

**Latency budget per keystroke.** Anything over 200ms admits a database (Elasticsearch completion suggester, Postgres prefix index). Under 100ms forces in-memory tries, sharding, and aggressive caching. This number decides the entire architecture.

**Personalization scope.** Per-user data on the hot path roughly doubles the system and kills CDN cacheability. Most companies pick "globally ranked, with light personalization blended in at request time" because that keeps the edge cache useful.

Everything else (languages, freshness, typos, safety) follows from those two answers.

---

### 2. The math

| Scale | Requests/second | Trie size | Hot cache size |
|-------|-----------------|-----------|----------------|
| Tiny startup (1k users) | ~1 sustained | A few MB | Not needed |
| Google (1B users) | 580k sustained, 2M peak | ~90 GB | ~5 GB hot working set |

A few numbers that drive the design:

- 95% of traffic comes from the top 5% of queries. Heavy Zipf distribution. This is what makes caching so powerful.
- Top 10 million queries cover 95% of volume. The other 90 million are long-tail.
- Cache hit rate dominates capacity. If CDN drops from 80% to 70% hit rate, origin load nearly doubles.
- The trie is 90 GB. Does not fit on one machine. Shards naturally by first letter.

> **Take this with you.** When 95% of work falls on 5% of data, your job is making sure that 95% never reaches the slow path. Cache layering is not an optimization. It is the design.

---

### 3. The API

One endpoint carries the whole product.

```
GET /api/v1/suggest?q=new+yo&locale=en-US&limit=10
Cookie: user_session=...   # optional, for personalization

200 OK
{
  "prefix": "new yo",
  "suggestions": [
    { "query": "new york weather",   "type": "global",   "score": 0.97 },
    { "query": "new york times",     "type": "global",   "score": 0.95 },
    { "query": "new yorker",         "type": "global",   "score": 0.91 }
  ],
  "request_id": "req-abc-123"
}
```

Small but load-bearing choices:

- **GET, not POST.** CDNs cache GETs. A POST defeats the entire edge layer. If this is a POST, 80% of your capacity plan falls apart.
- **`limit` is capped at 10 on the server.** The UI rarely shows more. Bigger limits waste bandwidth.
- **`locale` is required.** Different tries per language.
- **`type` on each suggestion** tells the client where it came from. Useful for UI badges ("Recent" vs "Trending").
- **Anonymous users get identical responses** for identical prefix + locale. That is what lets the CDN cache them.
- **Personalized responses use `Cache-Control: private, max-age=10`.** The CDN must not share them across users.

A separate admin endpoint for emergency blacklists:

```
POST /admin/blacklist
{
  "locale": "en-US",
  "queries": ["harmful query here"],
  "reason": "policy-2026-05-28",
  "ttl": "PT720H"
}
```

The Suggest API reloads the blacklist every 30 seconds. Globally effective within about 60 seconds.

---

### 4. The data model

#### The trie node (lives in RAM on Trie Service)

```
TrieNode {
    children:        HashMap<char, TrieNode*>   // next letter -> next node
    top_suggestions: [Suggestion; 10]           // precomputed top 10 for this prefix
    is_terminal:     bool                       // is this prefix itself a full query?
}

Suggestion {
    query_id: u32   // 4 bytes; resolves to display string via a side table
    score:    f32   // 4 bytes
    flags:    u8    // safety, locale, type
}
```

Using `query_id` (4 bytes) instead of the full string (30 bytes average) at every node saves roughly 50% of trie memory. For 300 million nodes with 10 suggestions each, that is the difference between 90 GB and 200 GB.

#### The side table (query_id to display string)

```
QueryRecord {
    display_string: String   // original query text, properly cased
    locale:         u8
    total_count:    u64
    last_seen_ts:   u32
    safety_flags:   u8
}
```

About 50 bytes per record. 100 million queries = ~5 GB. Loaded once per Trie Service instance.

#### The query log (input to the builder)

```json
{
  "query": "new york weather",
  "ts": 1748390400,
  "user_id_hash": "abc123",
  "locale": "en-US",
  "shown_suggestions": ["new york weather", "new york times"],
  "clicked_position": 0,
  "country": "US"
}
```

Stored in S3 as Parquet, partitioned by date and locale. 30 days hot. 5 years cold (analytics only). User IDs are hashed with a rotating salt before the builder reads them. The trie has no user-identifying data.

---

### 5. The engine: lookup and build

#### The hot-path lookup

```python
def suggest(prefix: str, locale: str, k: int = 10) -> list[Suggestion]:
    root = trie_for(locale)
    node = root
    for ch in normalize(prefix):
        node = node.children.get(ch)
        if node is None:
            return []
    return node.top_suggestions[:k]
```

Walk K letters (typically 5 to 15). Each step is a hash lookup. Return the saved list. Total: 1 to 10 microseconds in a warm cache. The bottleneck at every layer is network, not computation.

<details markdown="1">
<summary><b>Show: the build function (propagating top 10 upward)</b></summary>

```python
def build_trie(queries: list[ScoredQuery]) -> TrieNode:
    root = TrieNode()

    for q in queries:
        node = root
        for ch in q.normalized:
            node = node.children.setdefault(ch, TrieNode())
        node.is_terminal = True
        node.terminal_score = q.score
        node.query_id = q.id

    def propagate(node):
        candidates = []
        if node.is_terminal:
            candidates.append((node.query_id, node.terminal_score))
        for child in node.children.values():
            propagate(child)
            candidates.extend(child.top_suggestions)
        node.top_suggestions = heapq.nlargest(10, candidates, key=lambda s: s.score)

    propagate(root)
    return root
```

Propagation is bottom-up. Each node collects the best candidates from all its children and keeps the top 10. For a 90 GB trie this runs in about 30 minutes on a 100-node Spark cluster. It runs in a separate batch cluster and never touches the live Trie Service.

</details>

---

### 6. The architecture

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        A([Web / Mobile]):::user
        CDN["CDN\n(CloudFront / Fastly)\nTTL 60-600s, ~80% hit rate"]:::edge
    end

    subgraph ReadPath["Read path (per region)"]
        LB["Load Balancer\n(anycast, routes to nearest)"]:::edge
        API["Suggest API\n(stateless pods)"]:::app
        Cache[("Regional Redis\n(~15% hit rate, TTL 60s)")]:::cache
        T["Trie Service\n(sharded by first letter,\n3-10 replicas per shard)"]:::app
        P[("Personalization Redis\n(user history, 5 KB/user)")]:::cache
    end

    subgraph BuildPath["Build path (offline, global)"]
        Logs[("Query Logs\nS3 Parquet, 30d hot")]:::db
        Builder["Trie Builder\n(Spark, daily full rebuild +\n5-min delta for trending)"]:::app
        Store[("Object Storage\nS3 trie snapshots,\nversioned per locale/shard)"]:::db
    end

    A --> CDN
    CDN -.miss.-> LB
    LB --> API
    API --> Cache
    Cache -.miss.-> T
    API -.logged-in.-> P
    T -.pulls new version.-> Store
    Logs --> Builder
    Builder --> Store

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

Five things to notice:

- The CDN is the cheapest compute you can buy. Every response cached at the edge is a response your trie never has to compute.
- The Suggest API is stateless. Auth, locale routing, optional personalization. Scale horizontally. Store nothing.
- Trie Service shards are read-only at runtime. No mutations. New tries replace old via snapshot swap. This avoids a whole class of concurrency bugs.
- The builder runs offline. Trie Service never builds anything. It only downloads finished snapshots.
- All regions share one set of trie files. One global ranking. Each region serves it locally.

---

### 7. A keystroke, end to end

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant CDN as CDN (London)
    participant API as Suggest API
    participant R as Regional Redis
    participant T as Trie shard (n)
    participant P as Personalization Redis

    Note over Alice: types "new yo"
    Alice->>CDN: GET /suggest?q=new+yo&locale=en-GB (~2ms to edge)
    alt CDN hit (~80%)
        CDN-->>Alice: top 10 suggestions (~10ms total)
    else CDN miss
        CDN->>API: forward (already ~15ms spent)
        API->>R: GET prefix:new+yo:en-GB
        alt Redis hit (~15% of total)
            R-->>API: top 10 (~3ms)
        else Redis miss (~5% of total)
            rect rgb(241, 245, 249)
                Note over API,T: trie lookup (microseconds)
                API->>T: lookup("new yo", locale=en-GB)
                T-->>API: global top 10
            end
            API->>P: Alice's history for "new"
            P-->>API: 0 personal matches
            API->>R: SET prefix:new+yo:en-GB (TTL 60s + jitter)
        end
        API-->>CDN: top 10 + Cache-Control: public, max-age=60
        CDN-->>Alice: top 10 suggestions
    end
```

Target latencies:

| Path | P99 |
|------|-----|
| CDN hit (~80% of requests) | ~10ms (mostly network to edge) |
| Regional Redis hit (~15%) | ~30ms |
| Trie Service hit (~5%) | ~50-80ms |
| End-to-end P99 budget | 100ms |

The trie lookup takes 50 microseconds. The 50ms for the slow path is almost entirely TCP and TLS. Getting fast means getting closer to the user, not making the trie faster.

---

### 8. The scaling journey: 1,000 users to 1 billion

```mermaid
flowchart LR
    S1["Stage 1\n1k users\nPostgres + GIN\n~$50/mo"]:::s1
    S2["Stage 2\n100k users\nElasticsearch +\nRedis cache\n~$500/mo"]:::s2
    S3["Stage 3\n10M users\n+ CDN, custom trie\n+ delta pipeline\n+ multi-region\n~$5-10k/mo"]:::s3
    S4["Stage 4\n1B users\nFull sharded trie\n+ 80% CDN hit rate\n+ GDPR-split build\n~$500k+/mo"]:::s4

    S1 --> S2 --> S3 --> S4

    classDef s1 fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef s2 fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s3 fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef s4 fill:#fce7f3,stroke:#be185d,color:#831843
```

#### Stage 1: 1,000 users

One Postgres with a `pg_trgm` GIN index. One app server. No caching. About $50/month. Two weeks to ship.

Enough because you see 1 request per second. Anything more is over-engineering.

#### Stage 2: 100,000 users

What breaks: prefix queries take 50ms P99. Fast typers see visible lag.

Bring in Elasticsearch with its completion suggester. About 20ms lookups, decent ranking out of the box. Add Redis in front of the Suggest API for hot prefixes. About $500/month.

Still no CDN, no multi-region, no custom trie. Elasticsearch handles this scale without complaint.

#### Stage 3: 10 million users

Several things break at once. Elasticsearch hits 50ms P99 at peak. Users in Asia have 300ms round-trips to your US region. Trending queries from today appear tomorrow at the earliest.

Fixes in order: CDN in front (60% hit rate cuts Elasticsearch load by 60%), custom in-memory trie for the top 1 million queries (falls back to Elasticsearch for long-tail), a second region (CDN routes by location), a delta pipeline every hour for trending. Cost jumps to $5-10k/month.

#### Stage 4: 1 billion users

New problems: 2 million requests per second at peak, a single "y" shard cannot keep up, GDPR requires EU search logs to stay in EU, and a celebrity trend must appear within 5 minutes.

The full design from Section 6: trie sharded by first letter across ~50 shards, replicated 3x. Hot letters ("y", "f") get 10 replicas each. CDN tuned to ~80% hit rate. Regional Redis for another 15%. Multi-region build with an EU-only log path for GDPR. Delta pipeline runs every 5 minutes via Kafka.

The basic shape (CDN -> API -> cache -> trie) appears at Stage 2 and never changes. We add sharding, replicas, and edge coverage. The core data model stays the same.

---

### 9. Sharding and hot shards

**Sharding:** shard by first character. About 26 letters plus digits plus common UTF-8 prefixes gives ~50 shards for English. For multiple languages, shard by `(locale, first_character)`. Each shard is a separate process on a dedicated machine, replicated 3x for availability and read throughput.

A small config table in the Suggest API maps `{locale: {first_char: shard_address}}`. On request, the API reads the first character of the prefix and routes to the right shard.

**Hot shards:** the "y" shard handles "youtube" and "yahoo". At 2 million peak requests per second, "y" alone might see 400,000 per second. Four fixes used together:

1. CDN caches single-character prefixes for 10 minutes. 400,000/s drops to ~5,000/s at origin.
2. 10 replicas of the "y" shard instead of 3.
3. In-process LRU on each Suggest API pod (1,000 entries, 10-second TTL).
4. Finer sharding: "y" splits into "ya", "ye", "yi", "yo", "yu".

**Cache layer math:**

| Layer | Hit rate | Requests absorbed at 2M peak |
|-------|----------|-------------------------------|
| CDN | 80% | 1,600,000/s |
| Regional Redis | 15% | 300,000/s |
| Trie Service | 5% | ~100,000/s across ~150 shards |

100,000 requests per second across 150 shards is ~700 per shard. A 16 GB machine handles tens of thousands per second easily.

> **Take this with you.** The CDN hit rate is your leading indicator of capacity stress. Watch it closely. A 10-point drop nearly doubles origin load.

---

### 10. Build pipeline, in detail

<details markdown="1">
<summary><b>Show: daily full rebuild timeline</b></summary>

```
00:00 UTC  Snapshot last 90 days of query logs.
00:10 UTC  Spark job starts on 200-executor cluster.

  Stage 1: Filter and normalize.
           Drop bots (user-agent + volume signature).
           Drop PII patterns (credit card numbers, SSN-like strings).
           Drop queries under 2 or over 100 characters.
           Lowercase, normalize whitespace, strip extra diacritics.
           Output: ~400B cleaned rows.

  Stage 2: Aggregate.
           Group by (normalized_query, locale).
           Compute total count, recency-weighted count (exponential
           decay, tau=30 days), CTR, trending velocity.
           Output: ~100M unique (query, locale) rows.

  Stage 3: Score.
           Apply ranking formula. Run each through the safety
           classifier. Output: ~100M scored rows.

  Stage 4: Build trie per locale.
           Group by locale, then build trie + propagate top 10
           upward. Output: ~30 locale tries, ~3 GB each on average.

  Stage 5: Shard.
           Split each locale trie by first character.
           Output: ~30 locales x 30 shards = ~900 files.

  Stage 6: Upload to S3 with version tag.
           Path: trie/v=2026-05-28/locale=en-US/shard=n.trie

00:45 UTC  Build done. ~35 min on 200-executor cluster.
00:45 UTC  Trie Service instances begin polling, download shards.
00:50 UTC  Validate snapshot: check size, sample 1,000 lookups,
           compare against previous version. Reject if >50% change.
00:52 UTC  Atomic pointer swap. Old trie freed after grace period.
```

</details>

<details markdown="1">
<summary><b>Show: delta pipeline for trending queries</b></summary>

The delta pipeline runs every 5 minutes:

1. Read the last hour of query logs from Kafka (not S3, too slow).
2. Aggregate and score, weighting trending velocity heavily.
3. For each (locale, prefix) where a new candidate beats the current top 10, emit a delta entry.
4. Write delta file to S3.
5. Trie Service shards pull the delta and merge it at lookup time.

```python
def lookup_with_delta(prefix, locale):
    static_top10 = trie[locale].lookup(prefix)
    delta_entries = delta_layer[locale].get(prefix, [])
    return merge_and_rerank(static_top10, delta_entries)[:10]
```

The delta layer is tiny (a few thousand entries at any moment). Merge adds ~1 microsecond per lookup.

After the next daily rebuild includes the trending queries naturally, delta entries expire automatically.

</details>

---

### 11. Reliability

| Failure | What happens | Mitigation |
|---------|--------------|------------|
| One Trie shard replica down | Other replicas absorb load. CPU jumps. | Run hot shards at <50% CPU baseline. Leave headroom for failures. |
| Regional Redis down | Reads fall through to trie shards. Trie load spikes 5x. | Trie shards carry headroom for exactly this. |
| CDN partial outage (80% to 50% hit) | Origin load almost doubles. | Provision for 50% CDN hit rate, not 80%. Fallback: serve cached top-100 popular queries. |
| Bad snapshot fails validation | Old trie keeps serving. | Validation step before swap; page on-call. |
| Object storage down | Existing tries keep serving. New snapshots cannot pull. | Trie ages slowly. ~24 hours of staleness is acceptable. |
| Trie Builder fails | Most recent valid trie serves. | Alert if no new snapshot in 26 hours. |
| Personalization service down | Suggest API skips personalization. Global top 10 returned. | Invisible degradation for most users. |

The pattern: every layer degrades gracefully. The user always sees something, even if not the best something.

---

### 12. Observability

| Metric | Why it matters |
|--------|----------------|
| `suggest.latency_p99` per region | Headline SLO. Target <100ms. |
| `suggest.cdn_hit_rate` | Leading indicator of capacity. Alert below 70%. |
| `suggest.regional_cache_hit_rate` | Drop here means trie shards take the hit. |
| `trie.shard_qps` per shard | Spot hot shards before they melt. |
| `trie.shard_cpu` per shard | Cardinal CPU signal. |
| `trie.snapshot_age` per shard | Alert if over 26 hours. |
| `delta.lag` | Time from query trending to appearing. Target under 15 minutes. |
| `builder.run_duration` | Daily build should finish under 60 minutes. |
| `builder.input_row_count` | Sudden drop means broken log pipeline. |
| `safety.blacklisted_query_serve_count` | Must always be 0. Page immediately if non-zero. |

Page on: `suggest.latency_p99 > 200ms` for 5 minutes; `trie.snapshot_age > 26h`; `safety.blacklisted_query_serve_count > 0`.

Ticket on: CDN hit rate drift, delta lag spike, build duration regression.

One specific dashboard: a hot shard heatmap, a grid of all shards colored by current QPS. The on-call sees at a glance whether load is balanced or one shard is on fire.

---

### 13. Follow-up answers

**1. Typos.**

Plain trie traversal fails because "facb" has no children. Three approaches:

- **BK-tree (Burkhard-Keller tree).** A separate structure indexed by edit distance. Find candidate corrections within edit distance 1 or 2, then look up suggestions for each corrected candidate.
- **Symspell.** Precompute all single-deletion variants of every common query at build time. Fast at query time but bloats the index 4 to 5x.
- **Two-pass fallback.** Try clean trie lookup first. If 0 results, hit a spell-correction service for a corrected prefix, then re-lookup. Adds latency only on misses.

Put a small BK-tree at the Suggest API, fired only when the trie returns 0 results. It indexes only the top ~1 million most popular queries. Edit distance cap of 2. Cost: ~5ms per fallback lookup. Frequency: ~3% of requests. Net latency impact: small.

**2. Sub-minute trending.**

The delta pipeline. Every 5 minutes, read the last hour of logs from Kafka, find queries with high trending velocity, write a delta file. Trie Service shards pull and merge.

For faster paths: skip the file and push deltas via pub/sub directly to each shard. Latency drops to ~2 minutes.

The hard part is the threshold. High enough to ignore spam (one bot sending 1,000 queries should not move ranking), low enough that real news events get picked up. Typical formula: velocity > 10x baseline AND total volume > 100 in 5 minutes AND from more than 10 distinct `user_id_hash` values.

**3. Hot shard failure.**

If the "f" shard loses one replica, the others absorb its load. If the shard was already at 80% CPU, remaining replicas may hit 100%. P99 latency degrades. Some requests time out.

Mitigations in order: run hot shards at <50% CPU baseline; autoscale on shard CPU; aggressive in-process LRU on Suggest API absorbs short spikes; circuit breaker: if shard timeouts exceed 1% over 30 seconds, open the circuit and return a fallback (cached top-100 always-popular queries); pre-warm replacement replicas after snapshot swap.

**4. Personalization without a per-user trie.**

A per-user trie would be 3 GB x billions of users. Not feasible.

Instead, store per-user a small list of their most-issued queries (top 100, with counts), keyed by `user_id_hash` in Redis.

At request time: fetch user's top-100 list (~2ms), filter to those starting with the current prefix (usually 0-5 hits), get global top 10 from the trie, merge with boosted personal matches, return top 10.

Memory: 100 entries x 50 bytes = 5 KB per user. 1 billion users = 5 TB. Sharded Redis handles it.

**5. Bad suggestion in production.**

Immediate action: admin posts to `/admin/blacklist`. Suggest API reloads the blacklist every 30s and filters within ~60 seconds globally. CDN still serves the bad suggestion from edge cache until purged. Issue a CDN purge for the affected prefix. About 30 to 90 seconds to clear globally.

Total time to clean: 2 to 3 minutes.

Preventing recurrence: the blacklist persists across rebuilds. The Trie Builder reads the blacklist and drops blacklisted queries during scoring. The safety classifier gets retrained on the new example.

**6. Multilingual user.**

Two layers: primary trie defaults to the user's UI locale; for users with multilingual history (detected from past queries), mix in the top 1 to 2 results from a secondary locale.

Anonymous users: use `Accept-Language`. Some queries are global across locales ("facebook", "youtube", brand names). Tag them as "global" during build. Every locale trie includes them.

**7. Brand new query, not yet in trie.**

Delta pipeline handles it. 5 to 15 minute lag.

If even 5 minutes is too slow: a streaming Flink job updates the delta layer in real time. Sub-minute lag. Reserve this for domains where freshness is critical (news, e-commerce flash sales).

**8. Cold start for a new language.**

Bootstrap from: Wikipedia titles for that language ranked by pageview (~10 million entities per major language), translated top 100k English queries (brand names stay in original form), and product catalog names if this is e-commerce search.

Combine all three sources and let real logs take over within 30 days. Human reviewers spot-check the top 10 for common prefixes during the first month.

**9. Privacy and deletion.**

Risks: leaking queries across users (per-user history is keyed by hashed user_id and never mixed across users; cross-user signals come from the aggregated trie only), user IDs in build logs (hash with a rotating salt at ingestion; the trie has no user-identifying data), and delete requests (delete the user's entry from `user:history:{user_id_hash}`, scrub their rows in the next compaction; their contribution to global trends is already pseudonymous and aggregated).

For minors and sensitive accounts: never store personalization at all. User-controlled setting.

**10. Snapshot swap memory pressure.**

When a new trie loads, both old and new live in memory briefly. 3 GB x 2 = 6 GB per shard during swap.

Mitigations: stagger swaps across replicas (one replica at a time enters swap mode and is briefly removed from the load balancer; peak memory increase is per-replica, not fleet-wide) and memory-map the trie file (the OS reclaims old pages gradually rather than freeing them all at once).

**11. GET vs POST.**

GET is required because CDNs cache GETs. A POST is not cacheable at the edge. If suggest were a POST, the ~80% of traffic that currently stops at the edge would hit your origin instead. The whole capacity plan collapses. GETs are also easier to debug (shareable URL) and play well with browser back-button behavior.

**12. CDN partial outage.**

CDN drops from 80% to 50% hit rate. Origin load almost doubles.

Capacity planning rule: always provision for 50% CDN hit rate. Never assume 80%. If you provision for 80% and it drops, you fall over.

Backup plan: at the Suggest API layer, serve a "degraded mode" response when origin is overwhelmed. Cached top-100 most popular queries per locale. Not personalized. Not perfect. But the box still works.

**13. Mobile clients.**

Mobile networks add 100 to 300ms of latency. The 100ms budget is gone before the request reaches your data center.

Tricks: ship a tiny trie to the client (top ~10k queries plus the user's recent history; first 1 to 2 keystrokes resolve on-device with zero network), pre-fetch on focus (when the user taps the search box, fire a warm-up request before they type), drop the request when the user types fast (if keystroke N+1 happens before N's response returns, cancel N), and use HTTP/2 or HTTP/3 for multiplexed connections.

**14. Bot traffic.**

Detection: volume signature (100 keystrokes per second is not human), user-agent filtering (known bot UAs blocked at the load balancer), behavior signature (real users dwell on suggestions and click; bots do not), and per-IP and per-`user_id_hash` rate limiting.

Filtering at log ingestion: drop bot rows before they reach the builder. The builder only sees clean logs.

Ranking protection: any single `user_id_hash` contributes at most one vote per (query, day), regardless of how many times they searched. One bot cannot dominate global rankings.

**15. A/B testing ranking.**

Do not rebuild two whole tries.

Instead: build one trie with top 50 candidates per node instead of 10. At the Suggest API, apply the ranking formula on the candidate set per request. Different formulas pick different top 10 results from the same candidates. Route 1% of users to the experimental formula via a feature flag. Compare click-through rates over a week.

If the new formula wins, ship it. The trie is unchanged.

---

### 14. Trade-offs worth saying out loud

**Why not Elasticsearch's completion suggester?** It works and gets you to 10 million users with minimal code. The downside is per-shard JVM memory pressure and tail latency at Google scale. For startup-scale, Elasticsearch is the right answer. Build the custom trie when you can measure the difference.

**Why not real-time updates to the live trie?** Mutating a tree while readers walk it requires locking, which kills throughput. Snapshot swap sidesteps this entirely. The cost is a freshness lag of ~24 hours for the full rebuild, which the delta pipeline reduces to ~5 to 10 minutes for trending queries.

**Why not per-user tries for personalization?** Billions of users x 3 GB per trie is not feasible. Blending personalization on top of a global trie at request time costs 5ms and produces good-enough quality.

**Why CDN at all if some responses are personalized?** Split it. Anonymous and short-prefix responses cache at the CDN (60 to 80% of traffic). Personalized responses bypass it with `Cache-Control: private`. The CDN is not all-or-nothing.

**Why not vector search?** Vector search handles typos and semantic intent better. The cost is latency (10 to 30ms per lookup) and weaker exact-prefix recall. Trie plus BK-tree is faster and more predictable. Vector search shows up as a secondary candidate re-ranker at the next level of design.

---

### 15. Common mistakes

Most weak answers fall into one of these:

- **"Just use a trie."** Without acknowledging memory cost, top-N precomputation, the offline rebuild, or cache layering. That is a junior answer.
- **Forgetting the CDN.** At 2 million requests per second, every byte cached at the edge is a byte not served by your origin. Mention CDN early.
- **Not computing trie size.** The 90 GB number is what justifies sharding. Without it you sound like you have not thought about scale.
- **Storing full strings at every node.** Use query_ids and a side dictionary. Saves 50%+ of memory.
- **Ignoring ranking.** Alphabetical or pure frequency is wrong. Recency, CTR, trending, personalization, and safety all matter.
- **Live writes to the trie.** Snapshot swap is the standard. Mutating a live trie is a concurrency bug waiting to happen.
- **No mention of typos.** Real users misspell things. A BK-tree or spell fallback is expected at staff level.
- **No mention of safety.** Real product concern. Mention it unprompted.
- **Per-user trie for personalization.** Then unable to defend the memory math. The standard answer is "boost user history on top of global rank at request time."
- **Underweighting CDN hit rate as the capacity driver.** At 95% cache hit rate, the trie sees 100k requests per second (easy). At 80%, it sees 400k per second (painful). The whole capacity plan rests on the edge layer.

The three answers that separate strong from average: why precompute top-N at every node, why atomic snapshot swap instead of live updates, and how personalization blending actually works. Those are the answers a senior architect listens for.
{% endraw %}
