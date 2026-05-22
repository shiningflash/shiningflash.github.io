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
## Scene

It is the second round of an onsite. The interviewer manages the API gateway team at a SaaS company. They put one sentence in the doc:

> *Design a rate limiter for our public API.*

They add, almost as an afterthought: "We have free, pro, and enterprise tiers. Each tier has different limits. The API is behind a fleet of gateway servers. Make it work."

This is a deceptively small problem. Candidates often dive into "use a token bucket in Redis" within 30 seconds and then run out of things to say. The interesting parts are not the algorithm. They are: where the limiter sits, what happens when Redis dies, how you share counters across N gateway nodes, and how you avoid making the API slower by checking rate limits on every request.

## Step 1: clarify before you design

Take 5 minutes. Write down at least six questions you would ask before drawing anything. The interviewer is watching whether you treat "rate limiter" as a small problem or as the cross-cutting concern it really is.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Traffic shape.** "What is total API QPS? What is the P99 per-client QPS? How many distinct clients?" Without this you cannot size Redis, decide between in-memory and shared state, or know whether a single shard is enough. A typical answer: 100K total QPS, 100K distinct clients, P99 client at 100 req/sec.
2. **What to limit on.** "Per IP? Per API key? Per user_id? Per route? Some combination?" This is the most important question. A limiter on IP fails the moment a corporate NAT puts 10,000 employees behind one address. A limiter on API key is invisible to abusers who rotate keys. Real systems layer several keys.
3. **Limit semantics.** "Is the limit 100 requests per minute, or 100 in a rolling 60-second window? Bursts allowed?" Fixed windows are easier; sliding windows are more accurate. Bursts are usually allowed (the API needs to feel responsive on short spikes).
4. **Tiers.** "Are limits per-tier static, or per-customer with overrides?" Most real systems have both: a default per tier, plus per-customer overrides for enterprise accounts that negotiated higher limits.
5. **Failure mode.** "If the limiter's backing store is down, do we fail-open (allow everything) or fail-closed (reject everything)?" This is a business question disguised as a technical one. Most public APIs fail-open; payment APIs fail-closed.
6. **Response format.** "When a request is throttled, do we return 429 with `Retry-After`? Are we expected to expose `X-RateLimit-Remaining` to good citizens?" Standardized headers are table stakes for any public API.
7. **Granularity.** "Is the limit on requests, or also on cost? An expensive search query should count more than a cheap lookup." Cost-based limits are common at scale but add complexity.
8. **Latency budget.** "How many milliseconds can the limiter add to each request?" Under 1ms means in-process. Under 5ms means a local Redis hop. Over 10ms is a problem.

If you walked in asking only "what is the limit?" you missed the architecture-defining questions. The granularity (what to limit on) and the failure mode (fail-open vs closed) shape everything that follows.

</details>

## Step 2: capacity estimates

Suppose the interviewer answers:

- 100K total API QPS, peak 300K
- 100K distinct API keys
- Limits: 100 req/min free, 1000 req/min pro, 10000 req/min enterprise
- Most clients are at 1-10% of their limit; a small fraction sit at 80%+
- The gateway fleet has 200 nodes
- Limit checks must add no more than 2ms P99 to each request

Compute these before revealing:

1. Counter updates per second
2. State size: how much memory to track 100K clients
3. Per-node QPS the limiters must handle locally
4. Redis read+write rate if every check is a round trip
5. The wire cost of one check (request + response bytes)

<details>
<summary><b>Reveal: the math</b></summary>

**Counter updates per second.**
Every request increments a counter. 300K QPS peak = **300K counter writes/sec**. If we keep a few counters per client (per-minute, per-hour, per-route), multiply by 3 to 5. Call it ~1M Redis ops/sec at peak across the cluster.

**State size.**
100K clients × ~3 counters each × ~100 bytes per counter record (key + integer value + TTL metadata) = **30MB**. Negligible. Fits in one Redis node. We will still shard for availability, not capacity.

**Per-node QPS.**
300K / 200 gateway nodes = **1500 QPS per gateway node**. Each node must perform 1500 rate limit checks per second. Trivial in-process, but each one talking to Redis is 1500 network round trips per node, per second.

**Redis read+write rate.**
If every check is a Redis call: 300K req/sec × ~2 ops (read counter + conditional increment) = **600K ops/sec**. A single Redis instance does ~100K ops/sec comfortably, so we need to shard, or batch, or cache locally.

**Wire cost per check.**
Redis INCR + EXPIRE pipelined: ~80 bytes request, ~40 bytes response. At 300K QPS that is **~36MB/sec of internal traffic**. Not a problem, but worth noting that the limiter generates real load on its own dependencies.

**Key insight from the math.** State is tiny. The cost is round-trip count, not data volume. The whole design pressure is around *how many times we touch the backing store per request*, not how much we store.

</details>

## Step 3: choose the algorithm

There are five common rate-limiting algorithms. Each makes a different trade between memory, accuracy, and burst handling. Before reading on, list them and the trade-off each makes. Then write a one-line scenario where each one is the wrong choice.

The five:

- **Token bucket**
- **Leaky bucket**
- **Fixed window counter**
- **Sliding window log**
- **Sliding window counter**

<details>
<summary><b>Reveal: comparison table</b></summary>

| Algorithm | How it works | Memory per client | Burst behavior | Boundary accuracy | When wrong |
|-----------|-------------|------------------|----------------|-------------------|-----------|
| **Token bucket** | A bucket holds up to N tokens. Refilled at rate R tokens/sec. Each request consumes one token; if empty, reject. | ~16 bytes (token count + last refill ts) | Allows bursts up to bucket size, then throttles to refill rate. | N/A (continuous) | When you want strict no-bursts (a leaky bucket is better). |
| **Leaky bucket** | Requests queue into a bucket. Bucket drains at fixed rate R. If bucket is full, reject. | ~16 bytes + the queue itself | Smooths spikes by queuing, not rejecting. Output is strictly constant. | N/A (continuous) | When latency matters more than smoothing. Queues add delay. |
| **Fixed window counter** | Count requests in the current N-second window. Window resets at fixed clock boundaries. | ~16 bytes | Allows 2x burst at boundary. | Bad: a client can send N requests at 11:59:59 and N more at 12:00:00. | When you advertise "100/min" and clients notice the boundary doubling. |
| **Sliding window log** | Store the timestamp of every request in the last window. Count >= N → reject. | O(N) per client (can be MB for high limits) | Exact. | Best possible. | When N is large. 10,000 timestamps × 8 bytes = 80KB per client × 100K clients = 8GB. |
| **Sliding window counter** | Weighted average of current and previous fixed window. Approximates true sliding without storing every request. | ~24 bytes (two counters + ts) | Close to ideal, no boundary doubling. | ~99% accurate vs true sliding window. | When you need exact correctness (rare; the approximation is fine for billing-grade APIs). |

**The recommendation: sliding window counter.**

Reasons:

- Memory is O(1) per client, like fixed window. No per-request storage.
- Boundary doubling is gone. The weighted average smooths across the boundary.
- Implementable in a Redis Lua script in ~10 lines, atomic, P99 under 1ms.
- The 1% inaccuracy is invisible to clients and acceptable for almost every use case.

Token bucket is a strong second choice and is what AWS, Stripe, and most production APIs actually use. It is harder to implement atomically in a distributed setting (the refill calculation is stateful) but maps cleanly onto a Lua script too.

The interviewer is testing whether you know *why* a sliding window counter exists, not which algorithm has the prettiest name. The "why" is: fixed window has a boundary problem, sliding window log uses too much memory, and the counter is the cheap approximation that fixes both.

</details>

## Step 4: incomplete architecture diagram

Fill in the `[ ? ]` placeholders. Decide:

- Where the rate limiter sits (gateway, sidecar, in-process library?)
- Where state lives (in-process map, local Redis, central Redis, both?)
- What happens when the state store is unreachable
- How counters are kept consistent across N gateway nodes

```
   Client ────►   ┌────────────┐
                  │  [ ? ]     │  (terminates TLS, routes by host)
                  └──────┬─────┘
                         │
                         ▼
                  ┌────────────┐
                  │   [ ? ]    │  (where does the limiter run?)
                  │            │  ┌───────────────┐
                  │            ├─►│  [ ? ]        │  (shared state? local? both?)
                  │            │  └───────────────┘
                  └──────┬─────┘
                         │  allowed? → forward
                         │  rejected? → 429
                         ▼
                  ┌────────────┐
                  │ API Service│
                  └────────────┘

   Failure path: if [ ? ] is unreachable, the limiter must decide:
                 fail-open (allow) or fail-closed (reject)?
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
   Client ────►   ┌────────────────┐
                  │  Load Balancer │  Anycast IP, TLS termination
                  │  (L7)          │  Health-checks gateway nodes
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  API Gateway   │  Stateless. Runs the rate limiter
                  │  (200 nodes)   │  as an in-process middleware.
                  │                │  Each node has a small local LRU
                  │  ┌──────────┐  │  cache of recent counter values.
                  │  │ Limiter  │  │
                  │  │ middlewar│──┼─────────┐
                  │  └──────────┘  │         │ Lua script:
                  └────────┬───────┘         │ atomic INCR + EXPIRE +
                           │                 │ window math, returns
                           │ allowed         │ (allowed, remaining, reset_at)
                           ▼                 ▼
                  ┌────────────────┐  ┌────────────────────┐
                  │  API Service   │  │   Redis Cluster    │
                  │                │  │  Sharded by key    │
                  └────────────────┘  │  hash. Replicated. │
                                      │  6 primary shards, │
                                      │  one replica each. │
                                      └─────────┬──────────┘
                                                │
                                                │ async dump
                                                ▼
                                      ┌────────────────────┐
                                      │  Cold counter      │  For abuse forensics:
                                      │  archive (S3 + CH) │  reconstruct a bad
                                      │                    │  actor's rate history.
                                      └────────────────────┘

   Failure path: if Redis cluster is unreachable from a gateway node,
   that node falls back to per-node in-process counters with a stricter
   tier-based ceiling (e.g. burst × 1.5). This is fail-open with a safety
   net: we keep serving, but each node enforces independently with no
   coordination. Reports a critical alert immediately.
```

Why each piece is here:

- **L7 load balancer.** Not the place for rate limiting. LBs operate at connection level; rate limiting needs application-level identity (API key, user_id). Putting limits at the LB only covers per-IP, which is the weakest defense.
- **Gateway with in-process middleware.** The limiter is a library, not a service. Calling out to a separate "rate limiter service" adds a network hop per request, doubling the latency budget. In-process middleware + remote Redis is the standard.
- **Per-node LRU.** A tiny local cache of "this key was just at N requests, no need to ask Redis again for 100ms" cuts Redis QPS by 80%+ for hot clients. We come back to this in Step 5.
- **Redis cluster.** Shared state across nodes. Sharded by client key hash, replicated for failover. Lua scripts are evaluated atomically, which is what makes "check counter and decrement" safe under concurrent requests.
- **Cold archive.** When you need to investigate why client X got blocked yesterday, in-Redis counters with TTL have already expired. Stream the rejected events to S3 + ClickHouse for forensics.

</details>

## Step 5: distributed state

You have 200 gateway nodes. Each one is processing rate limit checks. How do you share counters across them so a client cannot get N requests through each node and effectively get 200N total?

Three approaches. Write the pros and cons of each, then read on.

- **Central Redis. Every check is a remote call.**
- **In-process counters with periodic gossip.** Each node keeps its own counters; nodes broadcast their counts every few seconds.
- **Local-first with remote reconciliation.** Each node has a local counter, drains to Redis on a short interval, reads back the global value periodically.

<details>
<summary><b>Reveal: comparison and recommended approach</b></summary>

| Approach | Accuracy | Latency overhead | Failure behavior | When to use |
|----------|---------|------------------|------------------|------------|
| **Central Redis every check** | Exact (Lua script makes it atomic) | 1-2ms per request | Redis down = limiter down. Must fail-open or fail-closed. | Default. The right answer at this scale. |
| **Periodic gossip** | Lags. A client can burst N×200 before the gossip catches up. | Sub-millisecond | No coordination needed; nodes survive independently. | When latency budget is brutally tight and limits are soft (advisory, not security). |
| **Local-first with reconciliation** | Approximate. Drift bounded by reconcile interval. | Sub-millisecond on hot path; one Redis hop per N requests in background. | Survives short Redis outages. Drift grows linearly with outage length. | When you want both low latency and central state but can tolerate ~10% drift. |

**The recommendation: central Redis with Lua scripts, plus per-node LRU to suppress hot-key check traffic.**

The flow on every request:

1. Compute the rate limit key, e.g. `rl:{api_key}:{route}:{minute_window}`.
2. Check local LRU. If the key is in the cache and the cached count is already over the limit, reject immediately. **No Redis call.**
3. Else, execute the Lua script on Redis. Script does: `INCR key; if new value > limit, return rejected; else EXPIRE key window_seconds; return allowed + remaining`. Atomic.
4. Update local LRU with the new count. Used for fast-path rejection on the next request.

The local LRU is the trick. For a client hammering at 100x their limit, only the first few requests in each window hit Redis; everything else fast-fails locally. Cuts Redis QPS by 90%+ for abusive clients, which is exactly when you need the savings.

For accuracy: requests within the same millisecond can race past the LRU before its update lands. This means a client might briefly exceed their limit by ~1-2 requests per node before being throttled. With 200 nodes and a 100/min limit, the theoretical overshoot is 400 requests in a window. In practice, well under 10. We accept this; the user-visible difference is invisible.

When Redis fails: see Step 5.5 below.

</details>

## Step 5.5: what happens when Redis dies

This is the question that separates senior from mid-level candidates. Walk through the system behavior in three scenarios:

1. One Redis primary shard goes down. Its replica takes over.
2. The whole Redis cluster is unreachable from a specific gateway node (network partition).
3. The whole Redis cluster is unreachable from every gateway node.

<details>
<summary><b>Reveal: failure handling</b></summary>

**Scenario 1: single shard failover.** The replica is promoted. There is a ~5 to 30 second window where some keys may be served stale. Acceptable. Mitigation: use Redis Sentinel or Redis Cluster's automatic failover; the gateway library retries on connection errors.

**Scenario 2: one node loses Redis connectivity but others have it.** That node alone has no shared state. Its limiter must fall back to per-node counters. The other nodes are unaffected. The single broken node now under-counts (it does not see traffic from the other 199 nodes), so a client routed to it can effectively get N×(some multiplier) requests through. Mitigation: the node's limiter sets a stricter local ceiling (e.g. burst × 1.5 of the tier limit) to bound the damage. Also: the load balancer marks the node unhealthy if it loses Redis, and traffic shifts to healthy nodes.

**Scenario 3: Redis cluster fully down.** This is the disaster scenario. Two choices:

- **Fail-open.** Every gateway node continues using its local LRU as the source of truth. Limits become per-node, not global. A user might get 200x their stated limit. The API stays up. **This is the right default for public read APIs.**
- **Fail-closed.** Every check returns "rejected." The API stops serving traffic. **This is the right default for write-heavy payment-grade APIs** where the limits are protecting against abuse that could cost real money.

The choice should be configurable per route. `/api/search` fails open; `/api/transfer-money` fails closed.

Whichever choice you make, the failure must be loud:
- Page on Redis cluster availability.
- Emit a `limiter.degraded_mode` metric per gateway node. If it spikes, you know.
- A separate canary client tests the limiter actually rejects when over limit; alerts if the limiter is silently broken.

The bad answer: "we just use Redis." Cannot answer "what happens when Redis goes down" and the interview is over.

</details>

## Step 6: response and headers

The limiter has decided to reject the request. What do you return? What do well-behaved clients need from you so they can back off correctly?

<details>
<summary><b>Reveal: response format</b></summary>

**HTTP status:**

- `429 Too Many Requests`. The standard. Do not use 503; that signals server overload, which is different.

**Response headers (required):**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 28                          # seconds until they can retry
X-RateLimit-Limit: 100                   # the limit for this key+route
X-RateLimit-Remaining: 0                 # always 0 on a 429
X-RateLimit-Reset: 1716381660            # unix ts when the window resets
Content-Type: application/json
```

**Response body:**

```json
{
  "error": "rate_limited",
  "message": "Request exceeds rate limit of 100 requests per minute.",
  "retry_after_seconds": 28,
  "doc_url": "https://api.example.com/docs/rate-limits"
}
```

**Headers on allowed requests too:**

Send `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every response, not just 429s. Good clients use these to self-throttle before they ever get rejected. The cost is ~30 extra bytes per response, which is nothing.

**Retry-After semantics:**

- For a sliding window: `Retry-After` is the time until enough of the current window has rolled off that the next request would succeed. Not the time until the entire window resets.
- For a token bucket: `Retry-After` is the time until the next token is refilled.
- Compute it server-side; do not make the client guess.

**Doc URL:**

Always include a link to the rate-limit documentation. This is the single most effective thing you can do to reduce support tickets. When developers see the URL in the error response, half of them go read the docs instead of opening a ticket.

</details>

## Follow-up questions

Try answering each in 3 to 4 sentences before reading the solution.

1. **Multiple keys per request.** A request has an IP, an API key, and a user_id. Do you check all three rate limits in parallel or in sequence? What if the API key limit allows it but the IP limit doesn't?
2. **Limits per route.** `/api/search` is expensive; `/api/health` is cheap. Same client. How do you express this in your data model and check logic?
3. **Cost-based limits.** Instead of "100 requests per minute," the limit is "100 units per minute" and a search query costs 5 units while a lookup costs 1. How does the limiter change?
4. **Burst allowance.** A client should be able to send a burst of 200 in the first 10 seconds of a minute but still total 1000 in that minute. Which algorithm supports this and how do you configure it?
5. **IP rotation.** An abuser is rotating through 10,000 residential IPs (botnet). Per-IP limits are useless. What do you do? Hint: layered keys, behavioral signals.
6. **Customer override.** Enterprise customer X negotiated a 100x limit. Where is that override stored? How fresh must it be? What if the override service is down?
7. **Distributed accuracy.** Two requests from the same client land on two gateway nodes within 1ms. Both check Redis, both get count=99 (under 100 limit), both INCR. Now count=101 and both were allowed. What is your defense?
8. **Pre-warming a known burst.** A customer says they will run a batch job at 2:00 AM that needs 10,000 requests in 60 seconds, way over their normal limit. How do you accommodate it without raising their permanent limit?
9. **Telling the difference between "user spam" and "user got popular".** A blog post gets posted on HN and suddenly receives 10x traffic to a user's API endpoint. The limiter blocks them. Is that correct? How would you build a smarter signal?
10. **Limiter is the bottleneck.** Observability shows the limiter middleware itself is adding 8ms to P99 latency. Where do you look first?

## Related problems

- **[URL Shortener (001)](../001-url-shortener/question.md)**. The `POST /links` endpoint sits behind exactly this kind of rate limiter; the design integrates directly with that system.
- **[Distributed Cache (009)](../009-distributed-cache/question.md)**. The Redis cluster backing the limiter is itself a distributed cache; the eviction, sharding, and replication choices there determine the limiter's failure modes.
- **[News Feed (002)](../002-news-feed/question.md)**. The `POST /posts` endpoint and the timeline read path both benefit from rate limiting; the cost-based limit pattern in follow-up 3 is what feeds use to throttle expensive ranking queries.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Rate Limiter

### TL;DR

A rate limiter is a small piece of code with a big blast radius. The algorithm is rarely the interesting part; what matters is where the check runs (in-process middleware on the gateway), how state is shared across nodes (Redis with an atomic Lua script), what happens when state is unreachable (configurable fail-open vs fail-closed per route), and how you keep the limiter itself from becoming the bottleneck (per-node LRU to suppress check traffic for hot keys).

The right algorithm for almost every production case is **sliding window counter**, implemented as a Lua script that atomically increments a per-window counter and computes a weighted blend of current and previous window. It is O(1) memory per client, has no fixed-window boundary doubling, and is implementable in 15 lines of Lua. Token bucket is the strong second choice and is what most public clouds actually run; it is what you use when you want explicit burst allowance.

The interesting engineering is at the seams: layered keys (IP + API key + user_id), per-route cost weighting, customer-specific override storage with a sane staleness policy, and the operational stuff (429 headers, abuse forensics, fail-open vs fail-closed for the route's risk profile).

### 1. Clarifying questions and why each matters

Covered in `question.md`. The two that matter most: **what do you limit on?** (the identification key choice shapes the data model) and **what happens when Redis is down?** (the failure-mode choice shapes the operational story). Candidates who answer "use a token bucket in Redis" without addressing either are answering a different, simpler question.

### 2. Capacity estimates (full working)

- 300K peak QPS → **300K counter writes/sec** baseline, ~1M Redis ops/sec when you count per-minute + per-hour + per-route counters per client.
- 100K clients × 3 counters × 100 bytes = **30MB of state**. Tiny. We shard for availability, not capacity.
- 1500 limit checks per second per gateway node. Sub-millisecond in-process, ~1-2ms with a Redis hop.
- Wire cost is negligible; this system's bottleneck is round-trip count, not bytes.

The math says: state is small, requests are many, every request must touch the limiter. Everything else is consequence.

### 3. API and headers

The limiter is internal middleware, not a public API. But it produces public-facing response headers on every API request that passes through it.

**On allowed requests:**

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1716381660
...response body...
```

**On rejected requests:**

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

Notes:

- **429 not 503.** 503 means the server is overloaded and the request might succeed later anywhere. 429 means *this client* is over its limit; other clients are fine.
- **`Retry-After` is mandatory.** Some clients respect it (well-written SDKs, browser fetch retries); others ignore it and hammer. Either way, server-computed retry-after costs you nothing.
- **Headers on success too.** Lets good clients self-throttle. The 30 bytes per response are worth it; one ticket-avoided pays for billions of headers.
- **Status header values must be honest.** `X-RateLimit-Remaining` after a rejected request is 0, not -1 or the raw counter value. Do not leak implementation details.

For internal services (not the public API): use a stricter format with `X-Internal-RateLimit-*` prefix so internal callers can distinguish their own limit from a downstream public-API limit they may also have hit.

### 4. Data model

The limiter has two distinct storage layers: hot counters in Redis and config in a separate config store.

**Hot counters (Redis):**

Keys are composite. The shape is:

```
rl:{scope}:{identifier}:{route_class}:{window_start_ts}
```

For example:

```
rl:apikey:sk_live_xyz789:search:1716381600    → integer count, TTL 120s
rl:ip:198.51.100.42:default:1716381600        → integer count, TTL 120s
rl:user:user_42:write:1716381600              → integer count, TTL 120s
```

`window_start_ts` is the start of the current fixed window (e.g. minute-aligned). The sliding window counter (Section 6) reads both the current window's counter and the previous window's counter, so we keep two keys per scope alive at a time.

TTL is set to `2 × window_length` so old keys clean themselves up. We never write a counter without an EXPIRE in the same Lua script.

**Config store (Postgres or DynamoDB):**

```sql
CREATE TABLE rate_limit_tiers (
    tier_name      VARCHAR(32) PRIMARY KEY,    -- 'free', 'pro', 'enterprise'
    default_limit  INTEGER NOT NULL,           -- requests per window
    window_seconds INTEGER NOT NULL,           -- typical 60
    burst_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00
);

CREATE TABLE rate_limit_overrides (
    api_key        VARCHAR(64) NOT NULL,
    route_class    VARCHAR(32) NOT NULL,       -- 'default', 'search', 'write', etc.
    limit_value    INTEGER NOT NULL,
    window_seconds INTEGER NOT NULL,
    valid_until    TIMESTAMPTZ,                -- NULL = permanent
    reason         TEXT,                       -- audit trail, never NULL in practice
    PRIMARY KEY (api_key, route_class)
);

CREATE TABLE rate_limit_route_costs (
    route_pattern  VARCHAR(128) NOT NULL,      -- '/api/v1/search'
    route_class    VARCHAR(32) NOT NULL,       -- which counter to charge
    cost_units     INTEGER NOT NULL DEFAULT 1, -- search = 5, lookup = 1
    PRIMARY KEY (route_pattern)
);
```

Design notes:

- **Tiers in a tiny static table** loaded into every gateway at startup and refreshed on a 60-second timer. A tier change applies cluster-wide within a minute, not instantly. This is intentional; rate limits are not security boundaries.
- **Overrides indexed by `(api_key, route_class)`** so an enterprise customer with raised search limits but default write limits is two rows, not one. Avoids embedding policy in JSON.
- **Route costs are a separate table** so the cost model is decoupled from per-customer overrides. The pricing team owns the cost table; sales owns the overrides table.

### 5. The five algorithms in detail

#### a. Token bucket

```
state = (tokens, last_refill_ts)

on_request:
    now = current_time()
    elapsed = now - last_refill_ts
    tokens = min(bucket_size, tokens + elapsed * refill_rate)
    last_refill_ts = now
    if tokens >= 1:
        tokens -= 1
        return allowed
    else:
        return rejected
```

Two parameters: `bucket_size` (max burst) and `refill_rate` (sustained rate). A bucket of size 200 refilled at 1 token/sec allows a burst of 200, then 1/sec sustained.

Pros: explicit burst control, conceptually simple, what most clouds use.

Cons: the refill calculation is stateful in a way that is awkward under contention. Two requests reading `(tokens, last_refill_ts)` simultaneously can both add the refill amount and both consume a token, double-spending the refill window. Atomic Lua handles this but the script is longer than the sliding window equivalent.

#### b. Leaky bucket

Same shape, but instead of refilling tokens, you "drain" the bucket at a fixed rate. Requests enter the bucket; if the bucket is full, reject. The bucket drains continuously.

Equivalent to token bucket in steady state, but burst behavior is different: leaky bucket smooths bursts by queuing them (output is constant rate). Token bucket allows bursts at the input.

Almost no one uses leaky bucket for API rate limiting because the queuing adds latency. Used in network traffic shaping where smoothing matters.

#### c. Fixed window counter

```
key = "rl:apikey:xyz:1716381600"   # minute-aligned timestamp
count = INCR(key)
EXPIRE(key, 120)
if count > limit: reject
```

Three lines of Redis. Beautiful. And broken at boundaries: a client can send `limit` requests at 11:59:59 and `limit` more at 12:00:00, giving them `2 × limit` in two seconds.

For loose advisory limits (block obvious abusers) this is fine. For limits you advertise to customers, it is embarrassing.

#### d. Sliding window log

```
key = "rl:apikey:xyz"
ZREMRANGEBYSCORE(key, 0, now - window)        # drop expired
count = ZCARD(key)
if count < limit:
    ZADD(key, now, request_id)
    EXPIRE(key, window)
    return allowed
else:
    return rejected
```

Stores every request timestamp. Exactly correct. Memory: 8 bytes per request × N requests in window × M clients. At 1000 limit × 100K clients = **80GB**. Unworkable above small N.

#### e. Sliding window counter

The right answer for most production systems. We deep-dive in Section 6.

### 6. Core algorithm: sliding window counter

#### The idea

The fixed window counter has a boundary problem because the count resets instantly. A true sliding window solves this exactly but uses O(N) memory. The sliding window counter is the cheap approximation: keep two fixed-window counters (current and previous), and compute an estimated count as a weighted blend.

If we are 30 seconds into the current minute and the previous minute had 80 requests, the current minute so far has 40, the estimate is:

```
estimated_count = current_count + previous_count × (1 - elapsed_in_current_window / window)
                = 40 + 80 × (1 - 30/60)
                = 40 + 40
                = 80
```

This is an average that smooths the boundary. At the exact boundary (elapsed = 0), the estimate is `0 + previous × 1.0 = previous`, so there is no doubling. As time passes, the previous window contribution decays linearly, and by the end of the current minute the estimate is `current + 0 = current`.

#### The Lua script

The whole limiter logic in one atomic Lua script:

```lua
-- KEYS[1] = current window key, e.g. "rl:apikey:xyz:1716381660"
-- KEYS[2] = previous window key, e.g. "rl:apikey:xyz:1716381600"
-- ARGV[1] = limit (e.g. 1000)
-- ARGV[2] = window_seconds (e.g. 60)
-- ARGV[3] = now_ms (current time in milliseconds)
-- ARGV[4] = cost (units to charge, default 1)
-- Returns: { allowed (0|1), remaining, retry_after_ms }

local limit          = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])
local now_ms         = tonumber(ARGV[3])
local cost           = tonumber(ARGV[4])

local current = tonumber(redis.call('GET', KEYS[1])) or 0
local previous = tonumber(redis.call('GET', KEYS[2])) or 0

-- How far into the current window are we, as a fraction [0,1)?
local window_ms      = window_seconds * 1000
local elapsed_ms     = now_ms % window_ms
local prev_weight    = (window_ms - elapsed_ms) / window_ms

local estimated      = current + math.floor(previous * prev_weight)

if estimated + cost > limit then
    -- Time until enough of previous window has rolled off.
    local need_to_shed = (estimated + cost) - limit
    local retry_after_ms = math.ceil((need_to_shed / math.max(previous, 1)) * window_ms)
    return { 0, 0, retry_after_ms }
end

-- Allowed. Increment the current window counter.
local new_current = redis.call('INCRBY', KEYS[1], cost)
-- Set TTL to 2x window so previous-window keys live long enough to be read.
redis.call('EXPIRE', KEYS[1], window_seconds * 2)

local remaining = math.max(0, limit - (estimated + cost))
return { 1, remaining, 0 }
```

A few things to highlight:

- **One Redis round trip.** Two GETs, one conditional INCRBY, one EXPIRE, all inside one Lua execution. The gateway makes one call.
- **Atomic.** Two concurrent requests cannot both pass the check at count=limit-1. Lua scripts execute serially within a Redis shard.
- **No clock from Redis.** The caller passes `now_ms`. This is intentional: if you let Redis decide "now" (via TIME), clock skew between Redis nodes during failover can cause the same window key to be interpreted as different windows. The caller's clock is the authority.
- **`cost` parameter.** Supports cost-based limits (an expensive query charges 5 units; a cheap one charges 1) with no extra Redis calls.
- **`retry_after_ms` is computed, not guessed.** Even though it is approximate (assumes the rejected window's previous count is the rate going forward), it gives the client a much better hint than a fixed value.

#### Gateway-side code (Python-ish pseudocode)

```python
SCRIPT_HASH = redis.script_load(LUA_SCRIPT)   # done once at startup

class Limiter:
    def __init__(self, redis_client, local_cache_size=10000):
        self.redis = redis_client
        self.lru = LRUCache(local_cache_size)  # key → (count_estimate, exp_ms)

    def check(self, api_key, route_class, cost=1):
        tier = config.get_tier_for(api_key)
        limit, window_s = tier.limit, tier.window_seconds

        now_ms = time.time_ns() // 1_000_000
        window_start = (now_ms // 1000 // window_s) * window_s
        prev_start = window_start - window_s

        cur_key  = f"rl:apikey:{api_key}:{route_class}:{window_start}"
        prev_key = f"rl:apikey:{api_key}:{route_class}:{prev_start}"

        # Fast-path: if local LRU says we are already over, reject without Redis.
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

        # Update LRU so the next request can fast-fail without Redis.
        self.lru.set(cur_key, CachedCount(
            count_estimate=limit - remaining,
            exp_ms=now_ms + 100  # 100ms TTL on the cache entry
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

The LRU has a 100ms TTL on entries. This is short enough that genuine recovery (client backs off and returns later) is honored, but long enough to absorb the next 5-10 requests from an abusive client without hitting Redis.

### 7. Architecture (detailed)

```
                              Client (browsers, SDKs, batch jobs)
                                          │
                                          ▼
                                ┌─────────────────────┐
                                │   Global LB / WAF   │  TLS termination, basic
                                │                     │  L4/L7 distribution.
                                └──────────┬──────────┘
                                           │
                          ┌────────────────┼────────────────┐
                          │                │                │
                          ▼                ▼                ▼
                  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                  │  Gateway 1   │ │  Gateway 2   │ │  Gateway N   │  200 stateless
                  │              │ │              │ │              │  nodes.
                  │ ┌──────────┐ │ │ ┌──────────┐ │ │ ┌──────────┐ │
                  │ │ Limiter  │ │ │ │ Limiter  │ │ │ │ Limiter  │ │  In-process
                  │ │  + LRU   │ │ │ │  + LRU   │ │ │ │  + LRU   │ │  middleware,
                  │ └─────┬────┘ │ │ └─────┬────┘ │ │ └─────┬────┘ │  per-node LRU.
                  └───────┼──────┘ └───────┼──────┘ └───────┼──────┘
                          │                │                │
                          └────────────────┼────────────────┘
                                           │  EVALSHA Lua script
                                           ▼
                                ┌─────────────────────┐
                                │   Redis Cluster     │  6 primary shards,
                                │   sharded by         │  one replica each.
                                │   {client_key}      │  Hash tags route
                                │                     │  same-client keys
                                └──────────┬──────────┘  to the same shard.
                                           │
                                           │ AOF persistence + RDB snapshots
                                           ▼
                                ┌─────────────────────┐
                                │  Redis Disk Backup  │  For forensic
                                │  + S3 archive       │  reconstruction.
                                └─────────────────────┘

                          ┌──────────────────────────────┐
                          │  Config Service              │  Tiers, overrides,
                          │  (Postgres + 60s refresh on  │  route costs.
                          │   gateway side)              │  Read-mostly.
                          └──────────────────────────────┘

                          ┌──────────────────────────────┐
                          │  Decision log → Kafka →      │  Every reject + every
                          │  ClickHouse                  │  rare-event allow goes
                          │                              │  to a stream for
                          │                              │  forensics and analytics.
                          └──────────────────────────────┘
```

Component responsibilities:

- **Gateway with in-process limiter.** The limiter is a library, not a separate service. Avoids a network hop per request.
- **Local LRU.** Cuts Redis QPS for hot keys (abusive clients, popular endpoints). Critical at scale.
- **Redis Cluster sharded by client key.** All counters for one client land on the same shard, so the Lua script reads both current and previous window keys without cross-shard fan-out. Hash tag syntax `{api_key}` forces this in Redis Cluster.
- **Config service.** Tiers, overrides, costs. Read-mostly. Refresh on a 60-second timer on each gateway. If it is down, gateways use their last-known config.
- **Decision log.** Every rejected request goes to Kafka with `{client_key, route, limit, count, ts}`. Streamed to ClickHouse for "why was customer X rate-limited yesterday?" investigations. Sample of allowed requests goes too for baseline traffic profile.

### 8. Read and write paths

For a rate limiter, "read" and "write" both happen on every request. The check itself is an atomic read-and-conditional-write.

**Per-request path:**

1. Request arrives at gateway. TLS already terminated by LB.
2. Auth middleware runs first; extracts `(api_key, user_id, ip)` from the request.
3. Limiter middleware computes the rate limit keys. Typically 3-4 keys to check: per-API-key, per-IP, per-user, per-API-key-per-route.
4. For each key, fast-path check against local LRU. If any key is already known-over-limit, **reject immediately**. No Redis call.
5. If no fast-path hit, run all checks against Redis in parallel using a pipelined batch. One EVALSHA per key. Latency: ~1-2ms total (parallel).
6. Take the most restrictive result. If any key rejected, the request is rejected.
7. Update local LRU with each key's new count.
8. If allowed: forward to API service, attach `X-RateLimit-*` headers to the response.
9. If rejected: return 429 with headers and JSON body. Emit decision event to Kafka.

**Cost-based variation:**

- The Lua script takes a `cost` parameter (Section 6).
- The route table tells the limiter how many units to charge: `cost = route_cost_table[matched_route]`.
- A search request costs 5 units; a health check costs 0 (free pass).

**Background config refresh:**

- Every 60 seconds, each gateway pulls the config snapshot from the config service.
- Config is loaded into a versioned in-memory map. Lookups are O(1).
- On parse error or fetch failure, gateway keeps the last-known-good config; logs a warning.

### 9. Scaling

#### a. Redis sharding

- Shard by client key hash. `rl:apikey:{xyz}:search:...` routes all of client xyz's counters to the same shard, because the `{xyz}` hash tag forces it.
- Why same-shard for one client: the Lua script needs both current and previous window keys atomically. If they were on different shards, you'd need a multi-shard transaction, which Redis Cluster does not support.
- 6 shards at the start. ~50K ops/sec per shard, well under Redis limits. Scaling is by adding shards and migrating keys via Redis Cluster reshard.
- One replica per shard for failover.

#### b. Read replicas

- Counter reads (just GET, no INCR) can hit replicas. We do not, because the Lua script needs both reads and writes atomically and Redis replicas are eventually consistent. Single-primary per shard is the model.

#### c. Per-node LRU

- 10K-entry LRU per gateway node. At 100 bytes per entry = 1MB per node. Trivial.
- Entry TTL: 100ms. Long enough to absorb a burst from one client; short enough that a recovering client is not penalized.
- Hit rate: highest for abusers (every request to a known-over-limit client fast-fails) and for popular API keys with sustained traffic.

#### d. Pipelining

- For requests with multiple keys to check, all EVALSHAs go in one Redis pipeline call. One network round trip for N checks.
- For high-volume endpoints, the gateway can batch checks across multiple incoming requests within a 1ms window, but this adds latency that often is not worth it.

#### e. Geo-distribution

- Per-region Redis cluster. Counters are not synced across regions.
- A client routed to us-east has a separate counter from the same client routed to eu-west. This is intentional: cross-region sync adds 100ms+ to every check.
- The practical effect: a client using two regions concurrently could get up to 2x their limit. Most clients use one region; the 2x is academic.
- For "global" enterprise limits (rare): use a separate central counter store, accept the latency penalty, document the trade-off.

### 10. Reliability

The interesting failure modes:

**Redis primary failure.** Sentinel or Cluster promotes the replica. ~10-30s window of failover. During this window, Lua scripts fail; gateway falls into degraded mode. Choose fail-open or fail-closed per route.

**Network partition between gateway and Redis.** Treat as Redis-down from that gateway's perspective. Other gateways still have Redis. The partitioned gateway should also fail its health check so the LB stops routing to it. This is the single most effective defense: do not serve traffic from a node that cannot enforce limits.

**Slow Redis.** P99 latency on the Lua script climbs to 50ms. The whole API is slower. Mitigation: a per-call timeout (e.g. 5ms) with a circuit breaker. After N consecutive timeouts, the gateway flips to degraded mode for that key class.

**Full cluster outage.** Configurable per route:

| Route class | Fail mode | Rationale |
|-------------|-----------|-----------|
| `/api/search`, `/api/list` (read) | fail-open | API uptime matters more than precise limit enforcement |
| `/api/transfer`, `/api/pay` (money) | fail-closed | Abuse risk outweighs uptime |
| `/api/login` (auth) | fail-closed | Brute force protection is the whole point |
| `/api/webhook` (callback) | fail-open with stricter local cap | Webhooks must keep flowing; cap to prevent runaway |

The fail-mode for each route is in the config service, defaulting to fail-open. Engineering manager and security team both sign off on any fail-closed designation; it is a deliberate choice.

**Memory pressure on Redis.** Keys have a 2× window TTL, so old keys self-evict. We do not use `maxmemory-policy allkeys-lru` for the limiter cluster; we want explicit TTLs. If memory pressure is real, we have too many active clients, not a configuration problem.

**Lua script bug.** A bad script update could lock up Redis. Mitigation: scripts are versioned; gateway can roll back the SCRIPT_HASH it sends. Canary the new script to one gateway, watch metrics for 10 minutes, then roll out.

**Counter drift after failover.** If a Redis primary fails before AOF sync, a few counters are lost on failover. The lost counters reset to 0; affected clients get a tiny extra allowance. Acceptable.

### 11. Observability

| Metric | Why |
|--------|-----|
| `limiter.check.latency.p99` per gateway | If this climbs over 5ms, something is wrong (slow Redis, bad LUA, etc.) |
| `limiter.rejections_per_sec` by tier | Spikes indicate abuse or a legitimate customer hitting their cap |
| `limiter.allowed_per_sec` by route | Baseline traffic per route |
| `limiter.local_cache_hit_rate` | Should be > 50% for hot keys. Drop suggests churn or attack with varied keys. |
| `limiter.redis_op_rate` | Tracks Redis cluster load; drives sharding decisions |
| `limiter.degraded_mode.fail_open_count` / `fail_closed_count` | Critical alert; means Redis is unreachable from at least one node |
| `limiter.script_eval_errors` | Lua failures (e.g. due to script update bugs) |
| `config.refresh.lag_seconds` | Stale config = wrong limits |
| `redis.cluster.shard_lag` | Replica lag (matters if we ever start reading from replicas) |

**Alerts:**
- Page on: `limiter.check.latency.p99 > 5ms for 5min`; `limiter.degraded_mode.* > 0 for any 1min sample`; `script_eval_errors > 0`.
- Ticket on: rejection rate spike on any tier (could be legitimate growth or an attack); local cache hit rate sustained drop (key churn = attack pattern).

**Dashboards by client:**

A per-client dashboard showing their request rate, rejection rate, headroom against limit, and their tier. This is what the customer success team uses when "the customer says they are being throttled but they should not be." 90% of those tickets resolve with "your client is sending more than your tier allows; here are the headers you ignored."

### 12. Follow-up answers

**1. Multiple keys per request.**

Three keys typically: per-IP, per-API-key, per-user. Check all three in parallel via a single Redis pipeline (one network round trip, three EVALSHAs). Take the **most restrictive** result: if any key rejected, the request is rejected.

The reason for layered keys: each protects against a different abuse vector. Per-API-key protects against a single key hammering. Per-IP protects against a single IP rotating keys. Per-user protects against a single user creating multiple keys.

If you only check one key, you have a gap. If you check all three sequentially, you add 3x the latency. Parallel pipelining is the answer.

**2. Limits per route.**

The route table maps URL patterns to a `route_class`:

```
/api/v1/search         → "search"
/api/v1/users/:id      → "default"
/api/v1/transfer       → "write"
/health                → "free" (always allowed)
```

The rate limit key includes `route_class`:

```
rl:apikey:xyz:search:1716381600   → counter for search calls only
rl:apikey:xyz:default:1716381600  → counter for default calls only
```

Per-tier configs specify limits per route_class:

```yaml
tier: pro
limits:
  search:  100/min
  write:   50/min
  default: 1000/min
```

A single API key has multiple parallel buckets. Search consumption does not eat into default consumption.

The cost of separate buckets: more Redis keys per client. With 4 route classes and 100K clients, that is 400K keys, ~40MB. Still tiny.

**3. Cost-based limits.**

The limit becomes "units per minute" instead of "requests per minute." A search query costs 5 units; a lookup costs 1.

Implementation: the Lua script's `cost` parameter is passed by the gateway. The gateway looks up the cost for the matched route in the cost table:

```python
cost = route_cost_table.get(matched_route_pattern, 1)
result = limiter.check(api_key, route_class, cost=cost)
```

The Lua script does `INCRBY cost` instead of `INCR`, and the "would this push me over?" check is `estimated + cost > limit`.

Cost weights are not arbitrary. They should reflect actual backend cost: search hits Elasticsearch which is 50x more expensive than a Postgres lookup, so search costs 50. The hard part is keeping the cost table aligned with reality; teams change service costs and forget to update the table.

**4. Burst allowance.**

The sliding window counter allows a burst implicitly: at the start of a window when the previous window had zero, the full window's limit is immediately available. For an explicit burst above the window limit, switch the route to **token bucket**.

Configure: `bucket_size = 200, refill_rate = 1000/60 = 16.67 per sec`. The bucket holds 200 tokens; refills at the sustained rate. The first 200 requests in 0 seconds are all allowed. Then the client is throttled to 16.67/sec.

Express in config:

```yaml
tier: pro
limits:
  default:
    algorithm: token_bucket
    bucket_size: 200       # max burst
    refill_rate: 16.67     # per second (= 1000 / 60)
```

Implementation switch is one branch in the limiter: route lookup tells you which algorithm; both have Lua scripts.

**5. IP rotation.**

Per-IP limits fail against botnets. The defense is layered:

- **Account/API-key-level limits.** A botnet rotating IPs but using one stolen API key gets caught at the key level.
- **Behavioral signals.** Across IPs, look at user-agent stability, request path patterns, timing. If 10K IPs all hit `/api/login` with the same UA and pause exactly 1.0s between requests, that is one attacker. Feed this signal into a separate fraud-detection pipeline; have it write to a `blocked_keys` set in Redis that the limiter consults.
- **IP reputation.** Subscribe to a botnet/proxy IP list (commercial feed, e.g. MaxMind). Pre-classify residential proxies and known malicious ASNs. Apply stricter limits to those buckets.
- **Proof-of-work or CAPTCHA challenges.** For unauthenticated endpoints, ask suspicious traffic to solve a challenge before being counted as a normal request. The rate limiter does not implement this; it just hands off to a challenge service when the threshold is hit.

The rate limiter is one defense, not the only one. Treat it as a speed bump, not a wall.

**6. Customer override.**

Stored in `rate_limit_overrides` (Postgres). Gateway pulls a snapshot every 60 seconds.

Staleness: 60 seconds is fine. A customer who buys an upgrade sees their new limit within a minute, not instantly. This is acceptable because (a) limits are continuous, not transactional, and (b) customer success can manually flush the gateway config cache on upgrade if needed.

If the config service is down: gateways use last-known config. The override is "remembered" indefinitely. The risk: a downgrade (override removed) takes effect when the next config fetch succeeds. We accept this.

For very critical override changes (security incident, "we need to block this customer NOW"), there is a separate `blocked_keys` Redis set that the limiter consults on every request. Writing to that set propagates instantly. It is the emergency channel; not the everyday path.

**7. Distributed accuracy / race conditions.**

Two requests at count=99, both arrive at different gateway nodes within 1ms. Both call EVALSHA on Redis.

Because the Lua script is atomic at the Redis shard level, only one of them will read count=99 and increment to 100. The other will read count=100 and reject (assuming limit=100). **The Lua atomicity is the whole defense.** If you used GET + conditional SET from the gateway side, you would have a race. The script bundles read+write into one atomic operation, which is precisely why we use it.

Edge case: the two requests land on two different Redis shards (because they are checking different keys, e.g. per-IP vs per-API-key). They each succeed independently. This is correct: they are checking different limits.

The only race the design does not prevent is the local LRU's brief inconsistency window (~100ms). During that window, a client might get 1-2 extra requests through per gateway node. With 200 nodes, theoretical max overshoot is 400 requests. Practical overshoot in load tests is under 10. We document this; nobody has ever complained.

**8. Pre-warming a known burst.**

Customer says: "at 2 AM tomorrow, we will run a batch job. 10K requests in 60 seconds. Our normal limit is 1K/min."

Three options:

- **Permanent raise.** Set their limit higher. Bad: they could abuse it the rest of the time.
- **Temporary override with `valid_until`.** Write a row to `rate_limit_overrides` with `valid_until = 2026-05-22 02:01:00`. The override is active for that 1-minute window only. Cleaner. **Recommended.**
- **Out-of-band batch endpoint.** Provide a separate `/batch` endpoint with its own (higher) limits, only accessible to customers with a special API key. The customer points their batch job at the batch endpoint. **Best for recurring batch use cases.**

The temporary override is the cleanest mechanism for one-off pre-announced bursts.

A separate concern: pre-warming the limiter itself. If we know a burst is coming, we can pre-populate the local LRU on every gateway so the burst does not stampede Redis. In practice this is overkill for 10K requests over 60 seconds.

**9. "User spam" vs "user got popular".**

A blog post hits Hacker News. The blog's API endpoint sees 10x normal traffic. The limiter blocks them.

Was the block correct? It depends on whether the rate limit was protecting the API or the customer's budget.

- If protecting the API: the limit was set with peak in mind. 10x is over peak. Block is correct.
- If protecting the customer from their own runaway costs: blocking is what they would want, but maybe not at this specific moment of viral attention.

Smarter signals:

- **Trend detection.** Compare the current minute's rate against the customer's 7-day P95. If it is 10x and sustained, that is a step-change, not a normal spike. Send an automated email: "Your API saw a 10x traffic spike; you have been temporarily auto-throttled. Click here to raise your limit." Self-service relief.
- **Distinguish bot from human.** If the 10x is human traffic (mixed user-agents, geo-distributed, varied request paths), it is probably legitimate viral attention. If it is bot traffic (one UA, one geo, repeated path), it is scraping.
- **Cost signal.** If their account balance can pay for the bursting, raise the limit automatically. If they are free-tier, throttle them and tell them.

The smart-signal layer sits next to the limiter, feeds in via config overrides, and is opt-in per customer. It is not the limiter's job to be clever; the limiter just enforces.

**10. Limiter is the bottleneck.**

Observability says the limiter middleware adds 8ms P99. The latency budget was 2ms. Where to look:

1. **Redis latency.** Is the Lua script slow? Run a Redis latency profile (`redis-cli --latency`). If Redis is the bottleneck, check shard CPU, network path, AOF settings (sync writes can stall everything).
2. **Pipelining.** Are checks for multiple keys being done sequentially instead of pipelined? One round trip per key × 3 keys = 3x latency. Should be one pipelined call.
3. **Local LRU misses.** If the local cache is missing on every request, every check hits Redis. Either the cache is too small (raise size) or every request has a unique key (signal of an attack with varied identifiers; investigate).
4. **Lua script complexity.** Has someone added expensive logic to the script? Profile with `SLOWLOG`.
5. **Gateway CPU.** If the gateway pod is CPU-pegged, even fast Redis responses queue. Scale out.
6. **Connection pool exhaustion.** If the Redis connection pool on the gateway is small, requests wait for a free connection. Raise pool size or add nodes.

The first three explain ~90% of latency regressions in practice. The senior answer touches all six.

### 13. Trade-offs and what a senior would mention

- **Per-region vs global limits.** Per-region is the default because cross-region sync is too slow. Global limits exist only for enterprise contracts that require them; implemented via a central counter store with explicit added latency. Document the trade-off; do not pretend global is free.
- **Tier complexity grows.** "Just 3 tiers" becomes 3 tiers × N routes × custom overrides × time-limited bursts. The data model in Section 4 handles this; do not collapse it into one JSON blob per customer because debugging will be miserable.
- **Abuse detection is a separate system, not part of the limiter.** The limiter enforces; the abuse system decides who to enforce against. Keeping them separate lets each scale independently and lets the abuse system iterate on signals without touching the hot path.
- **Why not put the limiter in front of the load balancer.** Tempting: catch abuse before it costs us a load balancer connection. But the limiter needs application identity (API key, user_id) which is inside the HTTP request. The LB does not parse HTTP. You could put a thin L7 limiter at the edge for IP-only checks and the full limiter at the gateway; this is what big clouds do.
- **Why not use the cloud provider's managed limiter.** AWS WAF, Cloudflare, etc., all offer rate limiting. They are good for IP-level and bot-mitigation use cases. They are not flexible enough for tiered customer pricing or cost-based limits. Most production APIs use both: cloud limiter as outer ring, custom limiter at the gateway as inner ring.
- **What I would revisit at 10x scale.**
  - Move counter state out of Redis to a purpose-built counter store (e.g. ScyllaDB or a custom in-memory grid) once Redis Cluster cost becomes meaningful.
  - Push limit checks to the edge (PoPs) for global APIs. Each PoP has a partial counter; gossip merges them periodically. Accept the inaccuracy.
  - Probabilistic counting (HyperLogLog) for the "distinct clients" signals that feed abuse detection.
  - Move tier resolution into a sidecar proxy (Envoy) so the gateway code does not have to know about tiers at all.

### 14. Common interview mistakes

- **"Just use a token bucket in Redis" with no further structure.** Skipped clarification, did not address sharing across nodes, did not address failure mode. Loses the candidate.
- **Implementing the algorithm at the application layer, not the gateway.** Now every service has to know about rate limits. Centralize at the gateway.
- **Per-IP only.** Fails against NAT (corporate offices, mobile carriers) and against IP rotation. Must mention layered keys.
- **No mention of fail-open vs fail-closed.** The interviewer will ask. Have an opinion.
- **Forgetting `Retry-After`.** Polite clients respect it. You signal you have written real public APIs by including it.
- **"Just put it behind a load balancer with rate limiting built in."** Fine for IP-level. Not fine for tier-based or API-key-based. The interviewer will ask how you handle the tier; if your only answer is "the LB doesn't do that," you have left the bulk of the problem unsolved.
- **No mention of the local LRU / per-node cache.** At 300K QPS, the round-trip count is the bottleneck. Local caching is the cheapest, biggest win and a senior candidate names it without prompting.
- **Confusing fixed window with sliding window.** A fixed window resets at clock boundaries (100 requests at 11:59:59 + 100 at 12:00:00). A sliding window counts the last N seconds rolling. The boundary doubling problem is the reason sliding exists.
- **Ignoring abuse detection.** Rate limiting and abuse detection are different systems. Acknowledge both even if asked only about the limiter.
- **Drawing one Redis box with no replication, no sharding, no failure plan.** Half the design score is in operational reality.

If you can hit 8 of these, you are interviewing at staff level. Most candidates miss the local LRU, the layered keys, and the fail-mode-per-route designs.
{% endraw %}
