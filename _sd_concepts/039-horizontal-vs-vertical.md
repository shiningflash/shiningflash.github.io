---
concept_id: 39
slug: horizontal-vs-vertical
title: "Horizontal vs vertical scaling"
tease: "Trade-offs and where each breaks down."
section: "Scaling"
status: live
---

Vertical scaling makes the box bigger: more CPU, more memory, faster disk. Horizontal scaling adds more boxes. Both work. They have completely different ceilings, different costs, and different failure modes. The trick is knowing which one you are actually hitting the wall on, because the right answer is often "do both, in this order, for this reason."

## The picture

```mermaid
flowchart TB
    subgraph V["Vertical scaling — make one box bigger"]
        direction LR
        V1[("4 vCPU<br/>16 GB RAM")]:::server
        V2[("16 vCPU<br/>64 GB RAM")]:::server
        V3[("96 vCPU<br/>768 GB RAM")]:::server
        V1 ==> V2 ==> V3
    end

    subgraph H["Horizontal scaling — add more boxes"]
        direction LR
        HA[("1 box")]:::server
        HB[("2 boxes")]:::server
        HC[("4 boxes")]:::server
        HD[("8 boxes")]:::server
        HA ==> HB ==> HC ==> HD
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

Same goal (more capacity), two completely different shapes. Vertical scales one node; horizontal multiplies nodes.

## Vertical scaling: easy until it isn't

Buy a bigger machine. Move the workload to it. Done.

- No code changes. The application thinks it is still on one box.
- No coordination problems. The database is the database.
- No new failure modes. Same single point of failure as before.

That last point is the catch. A bigger machine is still **one** machine. If it dies, everything is down. And there is a ceiling: the biggest cloud instance has a maximum, and beyond it you cannot pay for more, no matter the budget.

```mermaid
flowchart TB
    Q["Need more capacity"]:::query
    A1["Buy bigger instance"]:::strong
    A2["Hit instance-family ceiling"]:::mid
    A3["Hit price-per-marginal-unit cliff<br/>(largest instances cost much more per vCPU)"]:::weak
    A4["Hit the hard ceiling — no bigger instance exists"]:::dead

    Q --> A1 --> A2 --> A3 --> A4

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
    classDef dead fill:#fecaca,stroke:#b91c1c,color:#7f1d1d,stroke-width:1.5px
```

Vertical scaling is great while it works. The marginal cost climbs sharply at the high end (the biggest instances cost 3x what their size suggests). And there is no answer to "the biggest box is not big enough."

## Horizontal scaling: cheap per box, complicated overall

Add more boxes, route traffic across them. Capacity is now roughly N times one box.

```mermaid
flowchart LR
    U(["Traffic"]):::client
    LB[["Load balancer"]]:::infra
    S1[("Box 1")]:::server
    S2[("Box 2")]:::server
    S3[("Box 3")]:::server
    SN[("Box N")]:::server

    U ==> LB
    LB ==> S1
    LB ==> S2
    LB ==> S3
    LB ==> SN

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

- Capacity scales near-linearly with box count (within reason).
- A single box dying is a non-event; others absorb its load.
- You can grow and shrink with traffic.

But there is a tax:

- You need a load balancer in front. See [Load balancer: why, how, when](/practice/system-design/concepts/028-load-balancer-basics/).
- The service has to be stateless, or you need shared state. See [Stateless vs stateful services](/practice/system-design/concepts/040-stateless-vs-stateful/).
- Coordination problems appear (cache invalidation across nodes, distributed locks, leader election).
- Observability gets harder. "Which box served this request?" becomes a real question.

## Where each one falls over

```mermaid
flowchart TB
    subgraph VC["Vertical scaling ceiling"]
        direction LR
        VC1["Hard limit on instance size"]:::weak
        VC2["Marginal cost of vCPU spikes<br/>at the top of the family"]:::weak
        VC3["Single failure domain"]:::dead
    end

    subgraph HC["Horizontal scaling ceiling"]
        direction LR
        HC1["Coordination cost rises<br/>with node count"]:::weak
        HC2["Shared dependencies become bottlenecks<br/>(database, cache, queue)"]:::weak
        HC3["Stateful workloads resist scaling out"]:::dead
    end

    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
    classDef dead fill:#fecaca,stroke:#b91c1c,color:#7f1d1d,stroke-width:1.5px
```

Vertical hits a hardware ceiling. Horizontal hits a coordination ceiling. Most production systems use both: vertical for the database (until you have to shard), horizontal for the stateless layers (application servers, workers).

## The right order

For 95% of systems:

1. **Build stateless services.** Even at one instance, design for many. Externalise state to a database or cache. See [Stateless vs stateful services](/practice/system-design/concepts/040-stateless-vs-stateful/).
2. **Vertical-scale the database** until it hurts. Modern Postgres on a serious machine handles workloads people would have called "web-scale" ten years ago.
3. **Horizontal-scale the application layer** as soon as traffic justifies more than one instance.
4. **Add read replicas** when reads dominate. See [Read replicas](/practice/system-design/concepts/011-read-replicas/).
5. **Shard the database** only when the primary truly can't keep up. See [Sharding strategies](/practice/system-design/concepts/012-sharding-strategies/).

Skipping step 1 makes everything else harder. Jumping to step 5 too early adds operational complexity for a problem that did not need solving yet.

## Two scenarios

**Scenario one: a SaaS app at 100k users.**

One m5.2xlarge Postgres handles everything. The application runs on three m5.large boxes behind an ALB. Traffic doubles? Add three more application boxes (horizontal). Database hot? Move to m5.4xlarge (vertical). No sharding. No microservices. The team focuses on product.

**Scenario two: a real-time bidding platform at 50,000 QPS.**

Vertical scaling at the application layer is a non-starter; one box cannot do that throughput. Horizontal everything: hundreds of stateless boxes behind a high-capacity LB. The database is sharded by partner ID. Caching is distributed (Redis cluster). State lives in shared stores, never on the boxes. This is what horizontal scaling unlocks; you cannot get here vertically.

## What this connects to

- **Stateless vs stateful services.** The precondition for horizontal scaling. See [Stateless vs stateful services](/practice/system-design/concepts/040-stateless-vs-stateful/).
- **Load balancers.** Required for horizontal anything-with-traffic. See [Load balancer: why, how, when](/practice/system-design/concepts/028-load-balancer-basics/).
- **Read replicas.** Vertical-scale's cheap cousin: more read capacity without sharding. See [Read replicas](/practice/system-design/concepts/011-read-replicas/).
- **Sharding strategies.** The final horizontal move for a database. See [Sharding strategies](/practice/system-design/concepts/012-sharding-strategies/).
- **CAP theorem.** Horizontal scaling introduces partitions, which forces consistency trade-offs. See [CAP theorem](/practice/system-design/concepts/016-cap-theorem/).

## Common mistakes

- **Jumping to horizontal scaling too early.** Three nodes when one would do means three times the operational surface for the same throughput.
- **Vertical-scaling forever without a plan.** The cliff at the top of the instance family is real. Have a horizontal story before you need it.
- **Horizontal-scaling a stateful service.** Without externalised state, more nodes means more pinned users, more sticky sessions, more failure modes. See [Sticky sessions](/practice/system-design/concepts/031-sticky-sessions/).
- **Forgetting the database's shared-dependency problem.** Ten application servers all talking to one Postgres just moves the bottleneck. Pool connections; read from replicas; shard when necessary.
- **Measuring throughput, ignoring tail latency.** Adding nodes raises throughput but does not lower p99 unless the per-request slowness is also fixed.

## Quick recap

- Vertical: bigger box, no code change, single failure domain, hard ceiling.
- Horizontal: more boxes, near-linear capacity, coordination tax, requires statelessness.
- Real systems use both. Default order: stateless code → vertical DB → horizontal app → replicas → shards.
- The right answer is rarely "all horizontal" or "all vertical." It is "which bottleneck am I actually hitting right now?"

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
