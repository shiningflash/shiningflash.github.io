---
concept_id: 53
slug: rate-limiting-strategies
title: "Rate limiting strategies"
tease: "Token bucket, leaky bucket, fixed window, sliding window."
section: "Security"
status: live
---

Rate limiting caps how many requests a caller may make in a given window. The reasons are familiar: protect the service from abuse, share capacity fairly across users, enforce contractual quotas, prevent runaway scripts from bringing down the system. The four classic algorithms (token bucket, leaky bucket, fixed window, sliding window) each shape that cap differently, and the difference matters at the boundary. The mistake is using one when another would have been smoother for the same workload.

## What "100 requests per minute" actually means

Imagine the limit is 100 requests per minute per user. A caller sends 100 requests in the first second of the minute. Are they under the limit or over? The answer depends entirely on the algorithm. Each one shapes the same nominal limit into a different actual experience.

```mermaid
flowchart TB
    subgraph FW["Fixed window — counts reset on a clock boundary"]
        direction LR
        F1[("0-60s: 100 ok<br/>then refuse")]:::weak
        F2[("60-120s: counter resets,<br/>100 more allowed immediately")]:::dead
    end

    subgraph SW["Sliding window — looks at the last 60 seconds always"]
        direction LR
        S1[("rolling: max 100 in any 60s span")]:::strong
    end

    subgraph TB["Token bucket — bursts allowed up to bucket size"]
        direction LR
        T1[("bucket of 100 tokens,<br/>refills at ~1.67 tokens/sec")]:::strong
    end

    subgraph LB["Leaky bucket — smoothed, fixed-rate output"]
        direction LR
        L1[("queue of requests<br/>drains at fixed rate (~1.67/s)")]:::strong
    end

    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef dead fill:#fecaca,stroke:#b91c1c,color:#7f1d1d,stroke-width:1.5px
```

Same nominal limit; four different shapes of "allowed."

## Token bucket: bursts are okay

A bucket holds N tokens. Each request takes one token. Tokens refill at a steady rate (e.g., one every 600 ms for a 100/min limit). Requests are allowed if a token is available; otherwise rejected.

```mermaid
flowchart LR
    R1(["request 1"]):::client
    R2(["request 2"]):::client
    R3(["request N"]):::client

    B[("Bucket<br/>capacity 100<br/>currently 73 tokens")]:::infra
    REF[["Refill: 1.67 tokens/s"]]:::infra

    OK(["allow"]):::ok
    BAD(["reject 429"]):::dead

    R1 ==> B
    R2 ==> B
    R3 ==> B
    REF -.-> B

    B ==>|"token available"| OK
    B -.->|"empty"| BAD

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef dead fill:#fecaca,stroke:#b91c1c,color:#7f1d1d,stroke-width:1.5px
```

**Strength.** Allows short bursts (full bucket) followed by sustained operation at the refill rate. Matches how users actually behave: occasional clusters of activity, mostly idle.

**Weakness.** A caller who saves up tokens can flood briefly. For the protected service, brief floods may be the thing you wanted to prevent.

Used by: AWS, Stripe, most modern APIs. Configurable per-key with separate "burst" and "sustained" rate.

## Leaky bucket: smooth output

Requests enter a queue. They leave the queue at a fixed rate. If the queue is full, new requests are dropped. The output is perfectly smooth.

```mermaid
flowchart LR
    IN(["incoming requests<br/>(bursty)"]):::client
    Q[("Queue / bucket<br/>holds up to N")]:::infra
    OUT(["output at fixed rate<br/>(steady)"]):::ok
    DROP(["overflow → 429"]):::dead

    IN ==> Q
    Q ==> OUT
    Q -.->|"if full"| DROP

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef dead fill:#fecaca,stroke:#b91c1c,color:#7f1d1d,stroke-width:1.5px
```

**Strength.** Output is provably bounded and steady. Good for protecting a downstream that genuinely cannot handle bursts.

**Weakness.** Bursty callers must wait (latency penalty) instead of being allowed through quickly. Less friendly to user-facing flows where occasional bursts are normal.

Used by: network traffic shaping, some database write-throttling.

## Fixed window: simple, with edge problems

Count requests within fixed time buckets (e.g., per minute). When the bucket overflows, reject. When the clock turns over, reset.

```mermaid
flowchart LR
    T1[("0-60s<br/>count: 0 → 100")]:::strong
    T2[("60-120s<br/>count: 0 → 100")]:::strong
    T3[("120-180s<br/>count: 0 → 100")]:::strong

    T1 -->|"reset at 60s"| T2
    T2 -->|"reset at 120s"| T3

    EDGE["Edge problem:<br/>caller sends 100 at 59s,<br/>100 more at 61s,<br/>= 200 in 2 seconds."]:::dead

    T1 -.-> EDGE
    T2 -.-> EDGE

    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef dead fill:#fecaca,stroke:#b91c1c,color:#7f1d1d,stroke-width:1.5px
```

**Strength.** Trivial to implement: one counter per user, reset on the minute. One Redis INCR per request.

**Weakness.** The window edge. A caller can double their "allowed" rate by hammering at the boundary. For a 100/min limit, the worst case is 200 in two seconds, every minute.

Used by: simple APIs, internal services where the edge effect does not matter.

## Sliding window: smooth and accurate

Always consider the last N seconds, not a fixed boundary. A naive implementation stores a timestamp per request and counts how many fall in the window. A more efficient one (sliding-window log, or sliding-window counter) approximates.

```mermaid
flowchart LR
    NOW(["request at time T"]):::client
    WIN[("window: T-60s to T<br/>count requests in this span")]:::infra
    OK(["under 100: allow"]):::ok
    BAD(["over 100: reject"]):::dead

    NOW ==> WIN
    WIN ==> OK
    WIN ==> BAD

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef dead fill:#fecaca,stroke:#b91c1c,color:#7f1d1d,stroke-width:1.5px
```

**Strength.** No edge effects. The rate is genuinely "100 per minute, always."

**Weakness.** More bookkeeping than fixed window. Naive implementations store every timestamp; efficient ones use weighted counters across two adjacent windows.

Used by: Cloudflare, many edge services, anything where the fixed-window edge would be exploitable.

## Picking a strategy

```mermaid
flowchart TB
    Q1{"Is the caller a human?<br/>Bursts are part of normal use?"}:::query
    Q2{"Is downstream sensitive to bursts<br/>and you need provably smooth output?"}:::query
    Q3{"Do you need exact rate enforcement<br/>across the window edge?"}:::query

    A1["Token bucket.<br/>Allows occasional bursts.<br/>The everyday default."]:::strong
    A2["Leaky bucket.<br/>Smooth output, queues bursts.<br/>For traffic-shaping."]:::mid
    A3["Sliding window.<br/>Accurate, no edge exploit.<br/>For abuse-prevention."]:::strong
    A4["Fixed window.<br/>Cheapest. Fine for soft limits."]:::weak

    Q1 -->|"yes"| A1
    Q1 -->|"no, downstream protection"| Q2
    Q2 -->|"yes"| A2
    Q2 -->|"no"| Q3
    Q3 -->|"yes"| A3
    Q3 -->|"no"| A4

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
```

In practice, **token bucket** dominates user-facing APIs because real users come in bursts. **Sliding window** dominates security and abuse-prevention because the fixed-window edge is exploitable. **Leaky bucket** is for shaping output to a sensitive downstream.

## Where the limit lives

The same algorithm can be applied at many layers:

- **Edge / CDN.** Cloudflare, Fastly, AWS WAF. Cheap to enforce, blocks abuse before it reaches the origin.
- **API gateway.** Kong, Envoy, AWS API Gateway. Per-route, per-user limits.
- **Application code.** Fine-grained limits per endpoint, per tenant.
- **Database / external service.** A separate quota system to protect the dependency.

A real system layers multiple limits: a generous edge limit catches obvious abuse; per-user limits inside catch quota violations; downstream-protection limits guard expensive operations.

## Two scenarios

**Scenario one: a public API with paid tiers.**

Free users: 100 requests per minute, token bucket. Pro users: 1,000 requests per minute. Enterprise: custom. Token bucket fits because users naturally burst (loading a page makes 10 calls; idling makes 0). When users exceed, return `429 Too Many Requests` with `Retry-After: 15`.

**Scenario two: a login endpoint defending against credential stuffing.**

Per-IP and per-account limits, both sliding window. 5 attempts per 5 minutes. Sliding window because attackers exploit fixed-window edges. After lockout, send a captcha challenge instead of just rejecting; humans can solve it, scripts cannot.

## What this connects to

- **Bulkheads and rate limiting.** Rate limits protect against abuse; bulkheads protect against bad downstreams. See [Bulkheads and rate limiting](/practice/system-design/concepts/047-bulkheads-and-rate-limiting/).
- **Retry with backoff.** Clients should respect `Retry-After` and apply jitter; rate-limited retries are still retries. See [Retry with exponential backoff and jitter](/practice/system-design/concepts/046-retry-backoff-jitter/).
- **Authentication.** Rate limits often differ by authenticated identity vs anonymous. See [Authentication vs authorization](/practice/system-design/concepts/051-authn-vs-authz/).
- **CDN.** Edge rate limiting is one of a CDN's main jobs. See [CDN](/practice/system-design/concepts/027-cdn-when-you-need-it/).
- **Load balancing algorithms.** Consistent hashing on user id makes per-user limits actually work in a clustered limiter. See [Load balancing algorithms](/practice/system-design/concepts/030-lb-algorithms/).

## Common mistakes

- **One limit at the edge, nothing inside.** A noisy authenticated user inside the limit can still abuse expensive operations.
- **Per-IP only.** Many users share IPs (corporate NAT, ISP CGNAT). Per-IP limits punish good users in bulk.
- **No 429 response or Retry-After header.** Clients cannot back off intelligently. They retry harder.
- **Fixed window on a login endpoint.** Attackers time their attempts to the window edge and double their effective rate.
- **Limits stored only in memory.** Multi-instance services need a shared counter (Redis). Otherwise the limit is per-instance, not per-user.
- **Same limit for all endpoints.** A cheap `/health` and an expensive `/search` should not share quota.
- **Treating limits as security.** Limits slow abuse, they don't stop a determined attacker. Pair with authentication, MFA, and behavioural detection.

## Quick recap

- Token bucket: bursts allowed; the everyday default.
- Leaky bucket: smooth output; for protecting fragile downstreams.
- Fixed window: simple; vulnerable at the edge.
- Sliding window: accurate; better for abuse prevention.
- Layer limits at the edge, in the gateway, and inside the application.
- Always return 429 + Retry-After; clients are part of the contract.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
