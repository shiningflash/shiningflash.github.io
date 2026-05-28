---
layout: practice-problem
track: system-design
problem_id: 4
title: Design a Rate Limiter
slug: 004-rate-limiter
category: Reliability
difficulty: Medium
topics: [token bucket, sliding window, distributed counters, redis, fail-open]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/004-rate-limiter"
solution_lang: markdown
---

{% raw %}
## The scene

You sit down for the second round of an onsite. The interviewer runs the API gateway team at a SaaS company. She writes one line on the whiteboard.

> *"Design a rate limiter for our public API."*

Then she adds: *"We have free, pro, and enterprise tiers. Each tier has a different limit. The API runs on 200 gateway servers."*

That sounds simple. It is not.

The word "rate limiter" sounds like a counter. The real questions are different:

- Where does the counter actually live when 200 gateway nodes all handle the same client?
- What happens when the counter store goes down?
- How do you avoid making every API call slower because of the check itself?
- How do you handle a burst in the first second of a minute without punishing the client?
- When you reject a request, what do you send back so the client can recover?

We will start with the simplest possible thing. Then we add one pressure at a time.

---

## Step 1: Picture one request hitting a limit

Before any boxes, just picture what a rate check *is*. A client sends a request. You count it. If the count is too high, you stop it. That is it.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Arrives: request comes in
    Arrives --> CheckCount: look up counter
    CheckCount --> Allowed: count < limit
    CheckCount --> Rejected: count >= limit
    Allowed --> Counted: increment counter
    Counted --> [*]
    Rejected --> [*]
```

Everything we add later (shared Redis, local caches, fail-open modes, burst allowances) is a complication on top of this single diagram.

> **Take this with you.** A rate limiter is a counter lookup, an increment, and a yes-or-no decision. All the engineering is in making those three steps fast, shared, and fault-tolerant.

---

## Step 2: Ask the right questions

In a real interview, sit quietly for two minutes. Write down the questions that change the design if the answer changes. Not twenty. Five.

<details markdown="1">
<summary><b>Show: 5 questions that change the design</b></summary>

1. **What do you limit on?** Per IP? Per API key? Per user? Some combination? *This is the biggest question. Per-IP fails the moment 10,000 employees at one company share a NAT address. Per-API-key is the right default for a public API. Layered checks catch more abuse vectors.*

2. **What does "100 requests per minute" mean exactly?** Does the window reset on the clock at :00, or does it roll with the client? *Fixed windows are simpler but have a boundary problem: a client can send 100 at 11:59:59 and 100 at 12:00:00 and get 200 in two seconds.*

3. **What happens when the counter store goes down?** Let everything through (fail-open)? Block everything (fail-closed)? *A business question, not a technical one. Most public read APIs fail-open. Payment endpoints fail-closed.*

4. **Are all requests the same cost?** One search query versus one health check? *Cost-based limits add real complexity. "100 units per minute, a search costs 5, a lookup costs 1" is a common pattern at scale.*

5. **How much latency can the check add?** Under 1ms means in-process only. Under 5ms means one Redis round trip. *This sets the latency budget for the whole design.*

The two that matter most: **what do you limit on**, and **what happens when the store is down**. If you skip those, you are answering a smaller, easier problem.

</details>

---

## Step 3: How big is this thing?

The interviewer gives you the numbers.

| Dimension | Value |
|-----------|-------|
| Peak QPS | 300,000 |
| Distinct API keys | 100,000 |
| Free tier limit | 100 req/min |
| Pro tier limit | 1,000 req/min |
| Enterprise tier limit | 10,000 req/min |
| Gateway nodes | 200 |
| Latency budget for the check | 2ms at P99 |

<details markdown="1">
<summary><b>Show: what the numbers mean</b></summary>

**Counter writes per second.**
Every request bumps a counter. 300K QPS at peak means 300K writes per second to start. Keep a few counters per client (per-minute, per-hour, per-route) and it becomes roughly 1 million Redis ops per second at peak.

**Memory for all the counters.**
100K clients x 3 counters each x 100 bytes per counter = **30MB**. Tiny. Fits comfortably on one Redis node. We shard for availability, not capacity.

**Per-node QPS.**
300K / 200 nodes = **1,500 checks per second per gateway**. Easy in-process. The risk is not CPU, it is the number of Redis round trips.

**Redis ops if every check is a round trip.**
300K req/sec x 2 ops per check (read + conditional increment) = 600K ops/sec. One Redis instance handles about 100K ops/sec comfortably. So we either shard, or we cut the number of round trips, or both.

The state is small. The challenge is **how often we touch the store**, not how much we store.

</details>

> **Take this with you.** State is not the problem. Round trips are. Every design decision that follows is about cutting the number of Redis calls.

---

## Step 4: The smallest thing that works

Forget 200 gateway nodes. We are a 10-person company. One gateway. One Redis. One table of limits.

```mermaid
flowchart LR
    C([Alice's app]):::user --> GW["Gateway<br/>(check + increment)"]:::app
    GW --> R[("Redis<br/>counter")]:::cache
    GW --> API["API service"]:::app

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

```mermaid
sequenceDiagram
    autonumber
    participant Alice as Alice's app
    participant GW as Gateway
    participant R as Redis
    participant API as API service

    Alice->>GW: GET /api/search
    GW->>R: GET counter for Alice's key
    R-->>GW: count = 47

    alt count < limit
        GW->>R: INCR counter
        GW->>API: forward request
        API-->>GW: 200 OK
        GW-->>Alice: 200 + X-RateLimit-Remaining: 52
    else count >= limit
        GW-->>Alice: 429 Too Many Requests, Retry-After: 28
    end
```

That is the whole product in one picture. Everything we add from here is a response to a real problem.

> **Take this with you.** Start from this. The interesting part of the interview is what breaks when you add the second gateway node.

---

## Step 5: The first crack - two nodes, one counter

The next morning, the team deploys a second gateway node for redundancy.

Now you have a problem. Each node has its own in-memory counter. Alice sends 100 requests. 50 land on node 1, 50 land on node 2. Node 1 sees 50, node 2 sees 50. Both say "still under the 100 limit." Alice actually sent 100, but neither node blocked her.

With 200 nodes, Alice could send 100 requests to each node and get 20,000 through. This is the core problem. **A counter that is not shared is not a rate limiter.**

```mermaid
flowchart TB
    Alice([Alice]):::user --> LB["Load Balancer"]:::edge
    LB --> GW1["Gateway 1<br/>(count: 50)"]:::app
    LB --> GW2["Gateway 2<br/>(count: 50)"]:::app
    GW1 -.each thinks Alice is fine.-> Note["Problem: 50 + 50 = 100<br/>Neither node blocks her"]
    GW2 -.-> Note

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
```

The fix: move the counter to Redis. All 200 gateways share one counter per client. The math stays honest.

<details markdown="1">
<summary><b>Show: the shared counter approach</b></summary>

The gateway runs an atomic Lua script on Redis. One call does the read, the comparison, and the increment. Atomic means two gateways cannot both read count=99 and both increment to 100. One wins. The other sees 100 and rejects.

```lua
-- KEYS[1] = "rl:apikey:sk_live_xyz:1716381600"
-- ARGV[1] = limit, ARGV[2] = window_seconds, ARGV[3] = cost
local count = tonumber(redis.call('GET', KEYS[1])) or 0
local limit = tonumber(ARGV[1])
local cost  = tonumber(ARGV[3])
if count + cost > limit then
    return {0, 0}
end
local new = redis.call('INCRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return {1, limit - new}
```

This is a fixed-window counter: the key includes the minute-aligned timestamp. It is simple and it works. Section 6 covers why a sliding window counter is better.

</details>

> **Take this with you.** Shared state is required. The question is how to share it without making every API call slow.

---

## Step 6: Build the architecture, one layer at a time

We need shared Redis. Now build the rest. One layer at a time.

### v1: gateway calls Redis on every request

```mermaid
flowchart TB
    C([Client]):::user --> GW["Gateway<br/>(200 nodes)"]:::app
    GW --> R[("Redis")]:::cache

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

This works. But 300K req/sec x 1 round trip each = 300K Redis ops/sec. One Redis node handles 100K comfortably. We need sharding.

### v2: shard Redis by client key

```mermaid
flowchart TB
    C([Client]):::user --> GW["Gateway<br/>(200 nodes)"]:::app
    GW --> R1[("Redis shard 1<br/>keys a-f")]:::cache
    GW --> R2[("Redis shard 2<br/>keys g-m")]:::cache
    GW --> R3[("Redis shard 3<br/>keys n-z")]:::cache

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

One client's counters always land on the same shard. The Lua script can read current-window and previous-window keys atomically, because they are on the same shard. Six shards with one replica each handles 300K op/sec with headroom.

### v3: local LRU cache to cut Redis traffic

The most abusive clients are the ones pounding you 1,000x over their limit. They are also the ones you most need to stop *without* burning Redis bandwidth. Add a tiny in-process LRU cache on each gateway. If a key was over-limit 50ms ago, fast-fail without calling Redis at all.

```mermaid
flowchart TB
    C([Client]):::user --> GW["Gateway"]:::app
    GW --> LRU["Local LRU cache<br/>(10K entries, 100ms TTL)"]:::cache
    LRU -.cache miss.-> R[("Redis Cluster<br/>(sharded)")]:::cache
    LRU -.over limit cached.-> Rej["429 immediately"]

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

For a client hammering at 100x their limit, only the first few requests per window hit Redis. Everything else fast-fails on the local cache. Redis traffic drops by 80-90% for exactly the clients who would otherwise flood it.

### v4: config service, decision log, full picture

Limits come from a config table (tiers, overrides). Rejections go to a decision log so customer support can answer "why was I blocked yesterday?"

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        C([Web / SDK / batch job]):::user
        LB["Load Balancer / WAF"]:::edge
    end

    subgraph GWLayer["Gateway layer (200 nodes)"]
        GW["Gateway<br/>(limiter middleware + local LRU)"]:::app
    end

    subgraph State["Counter state"]
        R[("Redis Cluster<br/>sharded by client key")]:::cache
        CFG[("Config store<br/>Postgres · tiers · overrides")]:::db
    end

    subgraph Async["Async path"]
        K{{"Kafka"}}:::queue
        CH[("ClickHouse<br/>decision log · forensics")]:::db
    end

    API["API Service"]:::app

    C --> LB
    LB --> GW
    GW --> R
    GW -.config refresh 60s.-> CFG
    GW -->|allowed| API
    GW -.reject event.-> K
    K --> CH

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Each box in one line:

| Box | What it does |
|-----|--------------|
| **Load Balancer / WAF** | TLS termination, IP-level blocking, distributes to gateway nodes. |
| **Gateway + limiter middleware** | Runs the check. Library, not a separate service. |
| **Local LRU** | Fast-fails known-over-limit keys. Cuts Redis load by 80%+ for abusers. |
| **Redis Cluster** | Shared counters. Sharded by client key. Lua script for atomic check-and-increment. |
| **Config store** | Tiers, per-client overrides, route costs. Refreshed every 60 seconds by each gateway. |
| **Kafka + ClickHouse** | Every rejection event. Answers "why was customer X blocked at 3pm yesterday?" |

> **Take this with you.** The limiter is a library running inside the gateway, not a separate service. Adding a network hop would blow the 2ms latency budget.

---

## Step 7: One request, all the way through

Alice has a pro account. Limit is 1,000 req/min. She is at count 847. She sends another request.

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant LB as Load Balancer
    participant GW as Gateway
    participant LRU as Local LRU
    participant R as Redis
    participant API as API Service

    Alice->>LB: GET /api/search (key: sk_pro_alice)
    LB->>GW: forward

    GW->>LRU: check sk_pro_alice
    LRU-->>GW: not cached (or stale)

    rect rgb(241, 245, 249)
        Note over GW,R: one atomic Lua call
        GW->>R: EVALSHA(script, cur_key, prev_key, limit=1000, now_ms, cost=5)
        R-->>GW: allowed=1, remaining=148, retry_after_ms=0
    end

    GW->>LRU: update cache (count=852, exp=100ms)
    GW->>API: forward request
    API-->>GW: 200 OK
    GW-->>Alice: 200 + X-RateLimit-Remaining: 148
```

Now Alice sends one more request after she has hit the limit exactly:

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant GW as Gateway
    participant LRU as Local LRU
    participant R as Redis

    Alice->>GW: GET /api/search
    GW->>LRU: check sk_pro_alice
    LRU-->>GW: count=1000, over limit (cached 40ms ago)
    GW-->>Alice: 429 Too Many Requests, Retry-After: 12
    Note over GW: no Redis call at all
```

Two details to notice:

1. The search query costs 5 units. The Lua script does `INCRBY 5` not `INCR 1`. A health check would cost 0 (free pass).
2. The second flow never touches Redis. The LRU absorbed it. This is what cuts Redis load during an abuse spike.

---

## Step 8: The algorithm choice

There are five common rate limiting algorithms. The choice is not obvious.

```mermaid
flowchart TD
    Start([I need a rate limiter]) --> Q1{"Need exact accuracy?"}
    Q1 -- yes, small N --> SWLog["Sliding Window Log"]:::ok
    Q1 -- no, approx ok --> Q2{"Want explicit burst control?"}
    Q2 -- yes --> TB["Token Bucket"]:::ok
    Q2 -- no --> Q3{"Care about boundary doubling?"}
    Q3 -- no, simple is fine --> FW["Fixed Window"]
    Q3 -- yes --> SWC["Sliding Window Counter"]:::ok

    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
```

<details markdown="1">
<summary><b>Show: algorithm comparison and why sliding window counter wins</b></summary>

| Algorithm | Memory per client | Burst behavior | Boundary problem | When to pick it |
|-----------|-------------------|----------------|------------------|-----------------|
| **Token bucket** | ~16 bytes | Explicit: bucket_size burst, then throttles to R | None | When you want a burst ceiling with a steady rate after |
| **Leaky bucket** | ~16 bytes + queue | Smooths spikes by queuing them | None | Network shaping, not APIs: queuing adds latency |
| **Fixed window** | ~16 bytes | Burst at start of window | Doubles at boundary: 100 at 11:59 + 100 at 12:00 = 200 in 2s | Advisory limits where doubling is acceptable |
| **Sliding window log** | 8 bytes per request | Ideal | None | Low-traffic, small N, high-value endpoints |
| **Sliding window counter** | ~24 bytes | Close to ideal, no jump | ~1% inaccuracy vs true sliding | Almost everything else |

**The sliding window counter** is the right default. O(1) memory, no boundary doubling, fits in a 15-line Lua script, 1% inaccuracy is invisible.

**How it works.** Keep two fixed-window counters: current and previous. Weight the previous by how much time is left in the window.

```
estimated = current + previous * (1 - elapsed / window)
```

At 30 seconds into the current minute, with 80 requests in the previous minute and 40 in the current:

```
estimated = 40 + 80 * (1 - 30/60) = 40 + 40 = 80
```

No boundary jump. As the window turns over, the previous minute's contribution decays from 100% to 0% smoothly.

**Token bucket** is a strong second choice. AWS, Stripe, and most public clouds use it. Pick it when you want an explicit burst: "200 requests in the first second, then 1 per second after."

</details>

<details markdown="1">
<summary><b>Show: the full sliding window Lua script</b></summary>

```lua
-- KEYS[1] = current window key   e.g. "rl:apikey:sk_xyz:search:1716381660"
-- KEYS[2] = previous window key  e.g. "rl:apikey:sk_xyz:search:1716381600"
-- ARGV[1] = limit
-- ARGV[2] = window_seconds
-- ARGV[3] = now_ms
-- ARGV[4] = cost (default 1)
-- Returns: { allowed (0|1), remaining, retry_after_ms }

local limit          = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])
local now_ms         = tonumber(ARGV[3])
local cost           = tonumber(ARGV[4])

local current  = tonumber(redis.call('GET', KEYS[1])) or 0
local previous = tonumber(redis.call('GET', KEYS[2])) or 0

local window_ms   = window_seconds * 1000
local elapsed_ms  = now_ms % window_ms
local prev_weight = (window_ms - elapsed_ms) / window_ms

local estimated = current + math.floor(previous * prev_weight)

if estimated + cost > limit then
    local need_to_shed   = (estimated + cost) - limit
    local retry_after_ms = math.ceil((need_to_shed / math.max(previous, 1)) * window_ms)
    return { 0, 0, retry_after_ms }
end

local new_current = redis.call('INCRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], window_seconds * 2)

local remaining = math.max(0, limit - (estimated + cost))
return { 1, remaining, 0 }
```

Five things worth pointing at:

- One Redis round trip: two GETs, one conditional INCRBY, one EXPIRE, all inside one Lua execution.
- Atomic: two concurrent requests cannot both pass the check at count = limit - 1.
- Clock from the caller, not Redis. If Redis decides "now," clock skew during failover maps the same key to different windows.
- `cost` supports cost-based limits at zero extra cost.
- `retry_after_ms` is computed, not a fixed guess.

</details>

---

## Step 9: What Redis dying actually means

This question separates senior from mid-level. Most candidates have not thought it through.

Three failure modes:

**One Redis shard fails.** Its replica gets promoted. There is a 10-30 second window where some counters serve stale data. Acceptable. Redis Sentinel or Redis Cluster handles this automatically.

**One gateway loses its Redis connection.** Others still have it. That node falls back to in-process counters. It under-counts. A client can get extra requests through it. Bound the damage with a stricter local ceiling. The load balancer should fail that node's health check and stop sending traffic to it.

**The whole Redis cluster is down.** This is the interesting one.

<details markdown="1">
<summary><b>Show: fail-open vs fail-closed, by route</b></summary>

| Route class | Fail mode | Why |
|-------------|-----------|-----|
| `/api/search`, `/api/list` (reads) | fail-open | API uptime matters more than perfect enforcement |
| `/api/transfer`, `/api/pay` (money) | fail-closed | Abuse risk is bigger than downtime risk |
| `/api/login` (auth) | fail-closed | Brute-force protection is the whole point |
| `/api/webhook` (callbacks) | fail-open with stricter local cap | Webhooks must keep flowing |

Set the fail mode per route, not globally. The config service owns this. Engineering and security sign off on any fail-closed route.

Whatever mode you pick, make the failure loud: page on Redis cluster down, emit a `limiter.degraded_mode` metric from each gateway, run a canary test that verifies the limiter rejects over-limit requests.

</details>

> **Take this with you.** "What happens when Redis dies?" is the question. "We just use Redis" is not an answer.

---

## Step 10: What to return on a reject

The request is over-limit. What do you send back?

**Status code: 429 Too Many Requests.** Not 503. 503 means "the server is overloaded, try again anywhere." 429 means "*you* specifically are over your limit; other clients are fine."

**Headers:**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 28
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1716381660
```

**JSON body:**

```json
{
  "error": "rate_limited",
  "message": "Request exceeds rate limit of 1000 requests per minute.",
  "retry_after_seconds": 28,
  "doc_url": "https://api.example.com/docs/rate-limits"
}
```

Three things that matter here:

- **Send `X-RateLimit-*` on every response, not just 429s.** Good clients self-throttle using these. They never get to 429 in the first place.
- **`Retry-After` is computed, not guessed.** For a sliding window: the time until enough of the previous window rolls off. For a token bucket: time until the next token refills.
- **Include a doc URL.** It is the single most effective thing you can do to cut support tickets.

---

## Follow-up questions

Try answering each in 2 or 3 sentences before opening the solution.

1. **Multiple keys per request.** A request has an IP, an API key, and a user_id. Do you check all three limits in parallel or one after the other? What if the API key limit allows it but the IP limit does not?

2. **Limits per route.** `/api/search` is expensive. `/api/health` is cheap. Same client, same tier. How do you express this in the data model?

3. **Cost-based limits.** Instead of "1,000 requests per minute," the limit is "1,000 units per minute." A search costs 5 units. A lookup costs 1. What changes in the limiter?

4. **Burst allowance.** A client should be able to send 200 in the first 10 seconds, but still hit a total of 1,000 per minute. Which algorithm? How do you configure it?

5. **IP rotation (botnet).** An attacker rotates through 10,000 different home IPs. Per-IP limits do nothing. What do you do?

6. **Customer override.** An enterprise customer negotiated a 100x limit. Where do you store the override? How fresh must it be? What if the override service is down?

7. **Distributed accuracy.** Two requests from the same client land on two gateway nodes within 1ms. Both check Redis. Both see count = 99 (under a 100 limit). Both INCR. Now count = 101 and both were allowed. What stops this?

8. **Pre-warming a known burst.** A customer says they will run a batch job at 2 AM that needs 10,000 requests in 60 seconds, well above their normal limit. How do you let them through without raising their permanent limit?

9. **"User got popular."** A blog post hits the front page. A user's API endpoint sees 10x traffic. The limiter blocks them. Is that correct? How would you build a smarter signal?

10. **The limiter is the bottleneck.** Your dashboard shows the limiter middleware adds 8ms to P99 latency. Your budget was 2ms. Where do you look first?

---

## Related problems

- **[URL Shortener (001)](../001-url-shortener/question.md).** The `POST /links` endpoint sits behind exactly this kind of limiter. The design plugs in directly.
- **[Distributed Cache (009)](../009-distributed-cache/question.md).** The Redis cluster backing the limiter is a distributed cache. The eviction, sharding, and replication choices there set the limiter's failure modes.
- **[News Feed (002)](../002-news-feed/question.md).** Both the `POST /posts` endpoint and the timeline read path need rate limiting. The cost-based pattern in follow-up 3 is exactly how feeds throttle expensive ranking queries.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Rate Limiter

### The short version

A rate limiter is a counter lookup with a yes-or-no decision. The algorithm is the easy part. What actually matters:

- **Where does the check run?** In-process middleware on each gateway, not a separate service. A separate service adds one network hop per API call, which blows the latency budget.
- **How do nodes share state?** Redis Cluster, one atomic Lua script per check, sharded by client key.
- **What happens when Redis dies?** Configurable per route. Public reads fail-open. Payment and auth endpoints fail-closed.
- **How do you avoid Redis becoming the bottleneck?** A tiny per-node LRU cache that fast-fails over-limit clients without touching Redis.

The best algorithm for almost every case is the **sliding window counter**: O(1) memory, no boundary doubling, fits in 15 lines of Lua. Token bucket is a strong second when you want explicit burst ceilings.

---

### 1. The two questions that matter most

If you only get to ask two clarifying questions, ask these.

**What do you limit on?** Per IP? Per API key? Per user? All three? Per IP fails immediately against corporate NAT and IP rotation. Per API key is the right default. Layered keys (IP + API key + user) catch more abuse vectors.

**What happens when the counter store is down?** This is a business question. Public read APIs usually fail-open (enforce nothing, keep serving). Payment and auth endpoints fail-closed (stop serving rather than allow abuse). If you do not have an answer to this, you have not finished the design.

---

### 2. The math, in plain numbers

| Number | Value | Why it matters |
|--------|-------|----------------|
| Peak QPS | 300,000 | Drives Redis sizing |
| Counter writes/sec | 300K to 1M (multiple counters per client) | One Redis handles ~100K/sec, so sharding is required |
| Total state | ~30MB | Tiny. Shard for availability, not capacity |
| Per-node QPS | 1,500 | Easy in-process. The cost is round trips, not compute |
| Wire bytes per check | ~120 | Negligible. Round trips are what hurt |

State is small. Requests are many. Every request must touch the limiter. Everything else is a consequence of those three facts.

---

### 3. The API and headers

The limiter is internal middleware. It does not have a public API. It does produce headers on every API response.

**Allowed:**

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1716381660
```

**Rejected:**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 28
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1716381660
Content-Type: application/json

{
  "error": "rate_limited",
  "message": "Request exceeds rate limit of 1000 requests per minute.",
  "retry_after_seconds": 28,
  "doc_url": "https://api.example.com/docs/rate-limits"
}
```

Four choices worth defending:

- **429 not 503.** 503 means "the server is overloaded; try anywhere." 429 means "*you* are over your limit; others are fine."
- **`Retry-After` is required.** Well-written SDKs respect it. Either way, sending it costs nothing.
- **Headers on success too.** Good clients self-throttle. They never reach 429.
- **Include a doc URL.** The single most effective way to cut support tickets.

---

### 4. The data model

Two storage layers. Live counters in Redis. Config in Postgres.

**Live counters (Redis keys):**

```
rl:{scope}:{identifier}:{route_class}:{window_start_ts}
```

Examples:

```
rl:apikey:sk_live_xyz789:search:1716381600    -> integer count, TTL 120s
rl:ip:198.51.100.42:default:1716381600        -> integer count, TTL 120s
rl:user:user_42:write:1716381600              -> integer count, TTL 120s
```

The sliding window counter reads two keys per check: current window and previous window. TTL is 2x the window length so the previous key is still readable. A key without TTL is a memory leak.

**Config store (Postgres):**

<details markdown="1">
<summary><b>Show: the config schema</b></summary>

```sql
CREATE TABLE rate_limit_tiers (
    tier_name        VARCHAR(32) PRIMARY KEY,
    default_limit    INTEGER NOT NULL,
    window_seconds   INTEGER NOT NULL,
    burst_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00
);

CREATE TABLE rate_limit_overrides (
    api_key        VARCHAR(64) NOT NULL,
    route_class    VARCHAR(32) NOT NULL,
    limit_value    INTEGER NOT NULL,
    window_seconds INTEGER NOT NULL,
    valid_until    TIMESTAMPTZ,
    reason         TEXT,
    PRIMARY KEY (api_key, route_class)
);

CREATE TABLE rate_limit_route_costs (
    route_pattern  VARCHAR(128) NOT NULL,
    route_class    VARCHAR(32) NOT NULL,
    cost_units     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (route_pattern)
);
```

Three things doing real work:

- Tiers are a tiny static table. Each gateway loads it at startup and refreshes every 60 seconds. A tier change takes up to one minute to spread. Acceptable: limits are not security boundaries.
- Overrides are keyed by (api_key, route_class). An enterprise customer with raised search limits but default write limits is two rows, not one JSON blob.
- Route costs are in a separate table. Pricing team owns costs. Sales team owns overrides. Separate tables prevent merge conflicts and confused ownership.

</details>

---

### 5. The algorithm

The **sliding window counter** is the right default. Keep two fixed-window counters (current window, previous window) and compute a weighted blend.

If we are 30 seconds into the current minute, with 80 requests in the previous minute and 40 in the current:

```
estimated = current + previous * (1 - elapsed / window)
          = 40 + 80 * (1 - 30/60)
          = 80
```

No boundary jump. As time passes, the previous window's contribution decays from 100% to 0% smoothly.

The full Lua script is in `question.md` Step 8. Key properties:

- One Redis round trip per check (two GETs + one conditional INCRBY, all inside one Lua execution).
- Atomic at the shard level. Two concurrent requests cannot both pass the check at count = limit - 1.
- Clock from the caller, not Redis. Prevents window mismatches during failover.
- `cost` parameter supports cost-based limits at zero extra Redis calls.

For explicit burst control (200 requests in the first 10 seconds, then 1/second after), use **token bucket** instead. Two knobs: `bucket_size` (max burst) and `refill_rate` (sustained).

```mermaid
stateDiagram-v2
    direction LR
    [*] --> HasTokens
    HasTokens --> HasTokens: refill at R/sec, capped at bucket_size
    HasTokens --> Empty: last token taken
    Empty --> HasTokens: refill drips in
    HasTokens --> Allowed: request arrives, take 1 token
    Empty --> Rejected: request arrives, no tokens, 429
    Allowed --> [*]
    Rejected --> [*]
```

---

### 6. Resolving a check on the gateway

The limiter is in-process middleware. Per-request flow:

1. Auth middleware extracts `(api_key, user_id, ip)` from the request.
2. Limiter computes rate limit keys: typically 2-4 per request (per-API-key, per-IP, per-user, per-API-key-per-route).
3. For each key, check the **local LRU**. If any key is over-limit and the cache entry is fresh, reject immediately. No Redis call.
4. If no fast-path hit, run all checks against Redis in one **pipelined batch**: one EVALSHA per key, one round trip total.
5. Take the most restrictive result. If any key is rejected, the request is rejected.
6. Update the local LRU with the new counts.
7. If allowed: forward to the API service, attach `X-RateLimit-*` headers to the response.
8. If rejected: return 429, emit a rejection event to Kafka.

<details markdown="1">
<summary><b>Show: gateway-side limiter code</b></summary>

```python
SCRIPT_HASH = redis.script_load(LUA_SCRIPT)

class Limiter:
    def __init__(self, redis_client, local_cache_size=10000):
        self.redis = redis_client
        self.lru = LRUCache(local_cache_size)

    def check(self, api_key, route_class, cost=1):
        tier = config.get_tier_for(api_key)
        limit, window_s = tier.limit, tier.window_seconds

        now_ms = time.time_ns() // 1_000_000
        window_start = (now_ms // 1000 // window_s) * window_s
        prev_start = window_start - window_s

        cur_key  = f"rl:apikey:{api_key}:{route_class}:{window_start}"
        prev_key = f"rl:apikey:{api_key}:{route_class}:{prev_start}"

        cached = self.lru.get(cur_key)
        if cached and cached.count_estimate >= limit and cached.exp_ms > now_ms:
            return RateLimitResult(allowed=False, remaining=0,
                                   retry_after_ms=cached.exp_ms - now_ms)

        try:
            allowed, remaining, retry_ms = self.redis.evalsha(
                SCRIPT_HASH, 2, cur_key, prev_key,
                limit, window_s, now_ms, cost)
        except RedisError:
            return self._fail_mode(api_key, route_class, cost)

        self.lru.set(cur_key, CachedCount(
            count_estimate=limit - remaining,
            exp_ms=now_ms + 100
        ))

        return RateLimitResult(allowed=bool(allowed),
                               remaining=remaining,
                               retry_after_ms=retry_ms)

    def _fail_mode(self, api_key, route_class, cost):
        if config.fail_open_for(route_class):
            metrics.increment("limiter.degraded.fail_open")
            return RateLimitResult(allowed=True, remaining=-1, retry_after_ms=0)
        else:
            metrics.increment("limiter.degraded.fail_closed")
            return RateLimitResult(allowed=False, remaining=0, retry_after_ms=5000)
```

The LRU has a 100ms TTL per entry. Short enough that a real recovery is honored. Long enough to absorb the next 5-10 requests from an abusive client without hitting Redis.

</details>

---

### 7. The architecture

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        C([Web / SDK / batch job]):::user
        LB["Load Balancer / WAF<br/>(TLS, IP-level blocking)"]:::edge
    end

    subgraph GWLayer["Gateway layer (200 nodes)"]
        GW["Gateway<br/>(limiter middleware + local LRU)"]:::app
    end

    subgraph CounterState["Counter state"]
        R[("Redis Cluster<br/>6 shards · 1 replica each<br/>sharded by client key")]:::cache
        CFG[("Config store<br/>Postgres · tiers · overrides")]:::db
    end

    subgraph Async["Async path"]
        K{{"Kafka"}}:::queue
        CH[("ClickHouse<br/>decision log · forensics")]:::db
    end

    API["API Service"]:::app

    C --> LB
    LB --> GW
    GW --> R
    GW -.config refresh 60s.-> CFG
    GW -->|allowed| API
    GW -.reject event.-> K
    K --> CH

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Five things to notice:

- The limiter is **in-process middleware**. A separate "rate limiter service" adds one network hop per API call. That doubles the latency budget.
- The **local LRU** on each gateway cuts Redis traffic by 80%+ for abusive clients. The clients you most need to stop are the ones least likely to hit Redis after the first few requests.
- **Redis is sharded by client key.** All counters for one client land on the same shard. The Lua script reads current-window and previous-window keys atomically, with no cross-shard coordination needed.
- The **config service** is read-mostly. Each gateway refreshes every 60 seconds. If the config service dies, gateways use their last-known config.
- The **decision log** captures every rejection. When customer support asks "why was customer X blocked at 3pm yesterday?", you have an answer. Redis counters have already expired by then.

---

### 8. A request, end to end

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant LB as Load Balancer
    participant GW as Gateway
    participant LRU as Local LRU
    participant R as Redis
    participant API as API Service

    Alice->>LB: GET /api/search (key: sk_pro_alice)
    LB->>GW: forward

    GW->>LRU: check sk_pro_alice:search
    LRU-->>GW: not cached

    rect rgb(241, 245, 249)
        Note over GW,R: one pipelined round trip
        GW->>R: EVALSHA(script, cur_key, prev_key, limit=1000, now_ms, cost=5)
        R-->>GW: allowed=1, remaining=148, retry_after_ms=0
    end

    GW->>LRU: update cache (count=852, exp=100ms from now)
    GW->>API: forward request
    API-->>GW: 200 OK
    GW-->>Alice: 200 + X-RateLimit-Remaining: 148
```

Target latencies:

| Operation | P99 |
|-----------|-----|
| Allowed request (LRU hit, no Redis) | ~0.5ms |
| Allowed request (LRU miss, Redis call) | ~2ms |
| Rejected (LRU hit) | ~0.3ms |

---

### 9. The scaling journey: 10 users to 1 million

```mermaid
flowchart LR
    S1["Stage 1<br/>10-100 users<br/>in-memory counters<br/>~$80/mo"]:::s1
    S2["Stage 2<br/>~1,000 users<br/>+ Postgres config table<br/>+ admin UI<br/>~$250/mo"]:::s2
    S3["Stage 3<br/>10k-100k users<br/>+ Redis Cluster<br/>+ local LRU<br/>+ decision log<br/>~$2-5k/mo"]:::s3
    S4["Stage 4<br/>1M+ users<br/>+ per-region Redis<br/>+ cost-based limits<br/>+ time-limited overrides"]:::s4

    S1 --> S2 --> S3 --> S4

    classDef s1 fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef s2 fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s3 fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef s4 fill:#fce7f3,stroke:#be185d,color:#831843
```

#### Stage 1: 10 to 100 users

One app instance. In-memory counter dictionary. No Redis. Limits are constants in code. About $80/month.

Enough because you see ten requests a minute. Building more is over-engineering.

#### Stage 2: 1,000 users

What breaks: a customer asks for a higher limit and you have to deploy code to give it to them.

Move limits to a `rate_limit_tiers` Postgres table. Add a simple admin UI for overrides. Still one app instance, so in-memory counters are fine. ~$250/month.

#### Stage 3: 10,000 to 100,000 users

Multiple app instances. In-memory counters drift. A client can get Nx their limit, where N is the number of instances.

Add Redis. Atomic Lua script for check + increment. Add the local LRU. Shard Redis by client key with 6 primary shards, one replica each. Add the decision log to Kafka and ClickHouse. Add per-route fail mode. Cost: $2-5K/month.

#### Stage 4: 1 million users

New problems: EU data residency, expensive-vs-cheap route costs, enterprise batch bursts, botnet attacks rotating IPs.

Add per-region Redis clusters (counters are not synced cross-region: a client using two regions can get up to 2x their limit, which is acceptable and documented). Add cost-based limits via the `cost` parameter. Add time-limited overrides via `valid_until`. Add layered keys and an abuse-detection pipeline.

The core architecture has not changed since Stage 3. You added regions, knobs, and a separate abuse pipeline.

---

### 10. Reliability

**Redis shard failure.** Sentinel or Cluster promotes the replica. During the 10-30 second window, some counters serve stale data. The gateway falls into degraded mode. Fail-open or fail-closed per route.

**Network partition.** One gateway loses Redis while others keep it. That gateway should fail its health check and stop receiving traffic. Serving rate-limited traffic from a node that cannot enforce limits is worse than taking it out of rotation.

**Slow Redis.** Use a per-call timeout (5ms) with a circuit breaker. After N consecutive timeouts the gateway flips to degraded mode. This prevents Redis latency from bleeding into API latency.

**Full cluster outage.**

| Route class | Fail mode | Why |
|-------------|-----------|-----|
| `/api/search`, `/api/list` | fail-open | Uptime matters more than enforcement |
| `/api/transfer`, `/api/pay` | fail-closed | Abuse risk is bigger than downtime |
| `/api/login` | fail-closed | Brute-force protection is the whole point |
| `/api/webhook` | fail-open with stricter local cap | Webhooks must keep flowing |

**Counter drift after failover.** If a Redis primary dies before AOF sync, some counters reset to zero. Affected clients get a small extra allowance. Acceptable.

**Lua script bug.** A bad script can lock a Redis shard. Scripts are versioned. The gateway sends a `SCRIPT_HASH` it can roll back. Canary new scripts to one gateway, watch metrics for 10 minutes, then roll out.

---

### 11. Observability

| Metric | Why it matters |
|--------|----------------|
| `limiter.check.latency.p99` per gateway | Over 5ms means slow Redis, bad Lua, or connection pool exhaustion |
| `limiter.rejections_per_sec` by tier | Spike means abuse or a customer hitting their cap |
| `limiter.local_cache_hit_rate` | Should be >50% for hot keys. Drop suggests key churn or a rotating-key attack |
| `limiter.redis_op_rate` | Tracks Redis load, drives sharding decisions |
| `limiter.degraded_mode.fail_open_count` | Critical: Redis unreachable from at least one node |
| `limiter.degraded_mode.fail_closed_count` | Critical: same, on a fail-closed route |
| `limiter.script_eval_errors` | Lua failures (script update bugs) |
| `config.refresh.lag_seconds` | Stale config means wrong limits |

Page on: `limiter.check.latency.p99 > 5ms for 5 minutes`. Any `limiter.degraded_mode.*` sample. Any `script_eval_errors`.

Ticket on: rejection rate spike on any tier. Cache hit rate sustained drop.

---

### 12. Follow-up answers

**1. Multiple keys per request.**

Check all three (per-IP, per-API-key, per-user) in **parallel via one Redis pipeline**: one round trip, three EVALSHAs. Take the most restrictive result. Each key catches a different abuse vector. Checking sequentially adds 3x latency. Checking only one leaves a gap.

**2. Limits per route.**

Map URL patterns to a `route_class`:

```
/api/v1/search    -> "search"
/api/v1/transfer  -> "write"
/health           -> "free"   (cost = 0, always passes)
```

The rate limit key includes `route_class`. Each client has multiple parallel counters. Search consumption does not eat into write consumption.

**3. Cost-based limits.**

The Lua script takes a `cost` parameter. The gateway looks up the cost for the matched route. The script does `INCRBY cost` instead of `INCR 1`. The check becomes `estimated + cost > limit`. Cost weights should reflect real backend cost. A search hitting Elasticsearch is 50x more expensive than a Postgres lookup, so search costs 50.

**4. Burst allowance.**

Switch the route to **token bucket**. Config:

```yaml
tier: pro
limits:
  default:
    algorithm: token_bucket
    bucket_size: 200
    refill_rate: 16.67
```

The bucket holds 200 tokens and refills at 16.67/sec (1,000/min). The first 200 requests go through immediately. Then throttled to 16.67/sec. The switch is one branch in the limiter. Both algorithms have Lua scripts.

**5. IP rotation (botnet).**

Per-IP limits fail against botnets. Defense is layered:

- API-key-level limits catch a botnet rotating IPs with one stolen key.
- Behavioral signals across IPs: user-agent stability, request path patterns, inter-request timing. 10,000 IPs all hitting `/api/login` with the same user-agent and exactly 1.0s between requests is one attacker. Feed this into a fraud-detection pipeline that writes to a `blocked_keys` Redis set.
- Subscribe to a commercial IP reputation feed. Apply stricter limits to known-botnet ranges.

The limiter is one defense, not the only one. Treat it as a speed bump.

**6. Customer override.**

Stored in `rate_limit_overrides` (Postgres). Each gateway pulls a snapshot every 60 seconds. Staleness of 60 seconds is fine: limits are not transactional. If the config service is down, gateways use last-known config indefinitely.

For emergency changes ("block this customer NOW"), a separate `blocked_keys` Redis set is consulted on every request. Writing to it propagates in milliseconds. Not the everyday path.

**7. Distributed accuracy.**

The Lua script is **atomic at the Redis shard level**. Only one of two concurrent requests can read count = 99 and increment to 100. The other reads count = 100 and is rejected. Lua atomicity is the whole defense.

The only race the design accepts is the local LRU's 100ms inconsistency window. Theoretical max overshoot with 200 nodes: 400 extra requests per window. Practical overshoot in load tests: under 10. Documented. No one has complained.

**8. Pre-warming a known burst.**

Write a row to `rate_limit_overrides` with `valid_until = 2026-05-27 02:01:00`. Active only for that minute. The gateway picks it up within 60 seconds. For recurring batch use cases, a separate `/batch` endpoint with its own higher limits (backed by a separate API key) is cleaner.

**9. "User got popular."**

The limit enforced correctly if set to protect the API. Whether it was the *right* call depends on whether the goal is protecting the API or protecting the customer from runaway cost.

Smarter signals: compare the current minute's rate against the customer's 7-day P95. A 10x step-change sustained for 2 minutes triggers an automated email: "Your API saw a 10x spike. You've been temporarily throttled. Click here to raise your limit." Self-service relief. If the traffic pattern is bot-like (single user-agent, one geo, repeated path), throttle. If it is human (mixed UAs, geo-distributed, varied paths), that is real viral traffic and it is worth auto-raising the limit for a paid account.

**10. The limiter is the bottleneck.**

Limiter middleware is adding 8ms P99. Budget was 2ms.

1. **Redis latency.** Run `redis-cli --latency`. Check shard CPU, network path, AOF sync settings.
2. **Pipelining.** Are multiple-key checks sequential instead of pipelined? 3 sequential calls x 2ms each = 6ms. Should be one pipelined call.
3. **LRU miss rate.** If the cache misses on every request, every check hits Redis. Cache too small, or every request has a unique key (sign of a rotating-key attack).
4. **Lua complexity.** Has someone added expensive logic? Profile with `SLOWLOG`.
5. **Gateway CPU.** If the pod is pegged, even fast Redis responses queue.
6. **Connection pool exhaustion.** If the Redis connection pool is small, requests wait. Raise the pool or add gateway nodes.

The first three explain ~90% of latency regressions in practice.

---

### 13. Trade-offs worth saying out loud

**Per-region vs global limits.** Per-region is the default. Cross-region counter sync adds 100ms+ to every check. Global limits exist only for enterprise contracts that require them. Document the trade-off explicitly. A client using two regions can get up to 2x their limit. That is not a bug; it is the price of low latency.

**Why the limiter is a library, not a service.** A separate rate-limiter service adds one network hop per API call. At 2ms budget, one hop already takes 1-2ms. You have no room for another.

**Why Lua, not application-level transactions.** A read followed by a conditional write in two separate Redis calls is not atomic. Two concurrent requests can both read count = 99, both pass the check, and both increment. Lua runs serially within a Redis shard. No coordination protocol needed.

**Why not the cloud provider's managed limiter.** AWS WAF, Cloudflare, and similar tools are good for IP-level and bot mitigation. They are not flexible enough for tiered customer pricing or cost-based limits. Most production APIs use both: cloud limiter as the outer ring for IP threats, custom limiter at the gateway for business-rule enforcement.

**What to revisit at 10x scale.** Move counter state from Redis to a purpose-built counter store (ScyllaDB or a custom in-memory grid) once Redis cost becomes meaningful. Push limit checks to the edge (PoPs) for global APIs, accepting gossip-driven inaccuracy. Move tier resolution into a sidecar proxy (Envoy) so gateway code does not need to know about tiers.

---

### 14. Common mistakes

Most weak answers fall into one of these:

**"Just use a token bucket in Redis" with nothing else.** Skipped clarification. Did not address shared state across nodes. Did not address failure mode. Stops the interview.

**No local LRU.** At 300K QPS, every check is a round trip. The local LRU is the cheapest, highest-impact optimization. A senior candidate names it without prompting.

**Per-IP only.** Fails against NAT (corporate offices, mobile carriers) and against IP rotation. Layered keys is the correct answer.

**No fail-open vs fail-closed distinction.** The interviewer will ask. Have a route-level opinion, not a single global choice.

**Forgetting `Retry-After`.** Polite clients respect it. Sending it signals you have built real public APIs.

**Limiter as a separate service.** Now every API call pays two network hops instead of one. The latency budget does not survive.

**Confusing fixed and sliding windows.** Fixed resets on the clock boundary: 100 at 11:59:59 plus 100 at 12:00:00 = 200 in two seconds. Sliding counts the last N seconds rolling. The boundary doubling problem is why sliding exists.

**One Redis box, no replication, no failure plan.** Half the design score is in operational reality.

If you name 8 of these without prompting, you are interviewing at staff level. The three that separate strong from average: the local LRU, layered keys, and per-route fail mode.
{% endraw %}
