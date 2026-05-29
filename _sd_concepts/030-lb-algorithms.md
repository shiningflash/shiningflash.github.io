---
concept_id: 30
slug: lb-algorithms
title: "Load balancing algorithms"
tease: "Round robin, least connections, consistent hash."
section: "Load Balancing"
status: live
---

A load balancer's algorithm is the rule it uses to pick a backend for each incoming request. Pick the wrong one and you can have a "load balancer" that sends 80% of traffic to one backend while the others sit idle, or one that scrambles a user's session every 30 seconds, or one that has to rebalance the entire pool every time a single backend dies. The four algorithms below cover almost every real production choice.

## Round robin: take turns

Send request 1 to backend A, request 2 to B, request 3 to C, request 4 back to A. Cycle forever.

```mermaid
sequenceDiagram
    autonumber
    participant LB as Load balancer
    participant A as Backend A
    participant B as Backend B
    participant C as Backend C

    Note over LB: Round-robin cursor starts at A

    LB->>A: request 1
    LB->>B: request 2
    LB->>C: request 3
    LB->>A: request 4
    LB->>B: request 5
    LB->>C: request 6
    Note over LB,C: Each backend gets ~1/N of requests, regardless of effort.
```

**Strength.** Stateless, trivial, no per-backend bookkeeping needed.

**Weakness.** Assumes every request costs the same and every backend is equally fast. In reality, requests vary by 1000x in cost (a thumbnail vs a search) and backends drift (one box has a hot cache, one is GC'ing). Round robin keeps sending the slow box its share anyway.

When to use: low-variance workloads, identical backends, simplest possible setup.

## Weighted round robin: take turns, with bias

Same idea, but the LB skips lower-weight backends more often. Useful when backends have different capacity (e.g., during a rolling upgrade with bigger machines online).

```mermaid
sequenceDiagram
    autonumber
    participant LB as Load balancer
    participant A as Backend A  (weight 3)
    participant B as Backend B  (weight 1)
    participant C as Backend C  (weight 1)

    LB->>A: request 1
    LB->>A: request 2
    LB->>A: request 3
    LB->>B: request 4
    LB->>C: request 5
    LB->>A: request 6
    LB->>A: request 7
    LB->>A: request 8
    LB->>B: request 9
    LB->>C: request 10
```

A gets three times as many requests as B or C. Same trade-offs as plain round robin; a small upgrade to take backend size into account.

## Least connections: send to the least busy

The LB tracks how many active requests each backend currently has and sends the new one to whichever has the fewest. Reacts to real load instead of assuming uniformity.

```mermaid
flowchart LR
    LB[["Load balancer<br/>tracks active count per backend"]]:::infra
    A[("Backend A<br/>40 active")]:::server
    B[("Backend B<br/>12 active  ← winner")]:::server
    C[("Backend C<br/>28 active")]:::server
    REQ([New request]):::client

    REQ ==> LB
    LB ==>|"pick the smallest count"| B

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

**Strength.** Adapts automatically to slow backends, GC pauses, and uneven request costs. The single best default for variable workloads.

**Weakness.** Needs per-backend state on the LB. New backends look "empty" briefly and get hammered until they catch up. (Power-of-two-choices is a clever fix: pick two backends at random, then pick the less loaded of those two. Same effect, much less bookkeeping.)

When to use: most variable, real-world web workloads. This is the right default for L7 LBs in front of HTTP services.

## Consistent hashing: same key, same backend

Hash a key from the request (often the user ID, session ID, or full URL) onto a circular ring. Hash each backend onto the same ring. Each request goes to the next backend clockwise from its hash.

```mermaid
flowchart TB
    subgraph RING["Consistent hash ring (12 o'clock = 0, clockwise)"]
        direction LR
        A[("Backend A<br/>at hash 1500")]:::server
        B[("Backend B<br/>at hash 4500")]:::server
        C[("Backend C<br/>at hash 8000")]:::server
        K1["key 'user:42' → hash 3200<br/>next clockwise = B"]:::client
        K2["key 'user:99' → hash 7800<br/>next clockwise = C"]:::client
        K3["key 'product:88' → hash 1100<br/>next clockwise = A"]:::client
        A --- B --- C --- A
    end

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

**Strength.** Same key always goes to the same backend, with no central state. The killer feature is what happens when a backend is added or removed: only the keys in that arc move, not the whole pool.

```mermaid
flowchart TB
    subgraph BEFORE["Before adding backend D"]
        direction LR
        A1[("A")]:::server
        B1[("B")]:::server
        C1[("C")]:::server
        A1 --- B1 --- C1 --- A1
    end

    subgraph AFTER["After adding D (only D's arc moves)"]
        direction LR
        A2[("A")]:::server
        D2[("D — new")]:::infra
        B2[("B")]:::server
        C2[("C")]:::server
        A2 --- D2 --- B2 --- C2 --- A2
    end

    BEFORE --> AFTER

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

With a naive `hash mod N`, going from 3 backends to 4 reshuffles about 75% of all keys. With consistent hashing, only 1/4 of keys move. This is why every modern distributed system uses consistent hashing for sharding and cache routing.

In practice, each backend hashes to many points on the ring (virtual nodes), so the distribution is more even and the impact of adding/removing a backend is smoothed across the ring.

**Weakness.** Uneven distribution if the hash points are not well-spread (mitigated by virtual nodes). Hot keys still go to one backend; the algorithm balances uniformly across keys, not across actual work.

When to use: caches where the same key should hit the same backend, sticky routing without server-side state, sharded systems.

## Picking an algorithm

```mermaid
flowchart TB
    Q1{"Do all requests cost roughly the same<br/>and do backends behave identically?"}:::query
    Q2{"Do request costs vary a lot,<br/>or do backends differ?"}:::query
    Q3{"Do you need the same key<br/>to land on the same backend?"}:::query
    Q4{"Do backends have different capacity<br/>during a rollout or transition?"}:::query

    A1["Round robin.<br/>Simplest possible. Fine for uniform pools."]:::strong
    A2["Least connections (or power-of-two-choices).<br/>The default for real-world HTTP."]:::strong
    A3["Consistent hashing.<br/>Sharded caches, session affinity, partitioned services."]:::strong
    A4["Weighted round robin.<br/>Temporary or permanent capacity asymmetry."]:::mid

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
```

For 80% of HTTP applications, least connections (or its modern variant, power-of-two-choices) is the right default. Reach for consistent hashing when you need affinity. Round robin is fine for simple pools but rarely the best choice in production.

## Two scenarios

**Scenario one: an API behind an L7 ALB.**

Mixed request costs (quick GETs alongside slow searches). Backends sometimes pause for GC. Pick least connections so the LB always sends new requests to the box that is least busy right now. Hit rate of slow backends stays low.

**Scenario two: a Memcached cluster.**

Five cache nodes. You want `user:42` to always hash to the same node so the cache hit rate stays high. Consistent hashing. When you add a sixth node, only ~1/6 of keys move; the rest still hit warm caches.

## What this connects to

- **Load balancer basics.** Algorithm choice is part of LB configuration. See [Load balancer: why, how, when](/practice/system-design/concepts/028-load-balancer-basics/).
- **L4 vs L7.** L4 can do round robin and consistent hashing on the 5-tuple; L7 can do all four, plus header-aware variants. See [L4 vs L7 load balancing](/practice/system-design/concepts/029-l4-vs-l7/).
- **Sticky sessions.** Sometimes implemented via consistent hashing of a session cookie. See [Sticky sessions](/practice/system-design/concepts/031-sticky-sessions/).
- **Sharding strategies.** Consistent hashing is also the standard for sharding databases and caches. See [Sharding strategies](/practice/system-design/concepts/012-sharding-strategies/).

## Common mistakes

- **Round robin on variable workloads.** A slow box and a fast box get the same number of requests; p99 latency suffers because the slow one piles up.
- **Least connections without a warmup grace period.** A freshly-added backend has zero active connections, so the LB dumps everything on it. Add a slow-start period that ramps it up.
- **Consistent hashing without virtual nodes.** Three real backends mean three points on the ring. Uneven arcs cause uneven load. Use 100+ virtual nodes per real backend.
- **Hashing on the wrong key.** Hashing on the user ID is great for affinity. Hashing on a near-unique key like a request ID gives you random distribution, not consistent hashing.
- **Forgetting health-aware variants.** All these algorithms should skip unhealthy backends. The LB needs to combine the algorithm with active health checking.
- **Picking by reputation.** "Consistent hashing is the modern one." Not for stateless HTTP. Match the algorithm to the workload.

## Quick recap

- Round robin: take turns. Simple, fine for uniform pools.
- Weighted round robin: take turns with bias. Useful during transitions.
- Least connections: send to the least busy backend. Default for real HTTP.
- Consistent hashing: same key, same backend, minimal disruption when the pool changes.
- Most production HTTP LBs default to least connections or power-of-two-choices for variable workloads.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
