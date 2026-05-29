---
concept_id: 40
slug: stateless-vs-stateful
title: "Stateless vs stateful services"
tease: "Why stateless is easier to scale, and when you can't be."
section: "Scaling"
status: live
---

A stateless service forgets the user the moment the response goes out. Anything the next request needs has to come back in the request itself or be looked up from somewhere shared. A stateful service remembers between requests by keeping data in its own memory or on its own disk. Stateless is the default for almost every modern web service, because it scales trivially. Stateful is sometimes unavoidable, and the pain it causes is the reason "make it stateless" is one of the first refactors any growing system goes through.

## The shape of each

```mermaid
flowchart TB
    subgraph SL["Stateless — any instance can serve any request"]
        direction LR
        U1(["User"]):::client
        LB1[["LB (round robin)"]]:::infra
        I1[("instance A")]:::server
        I2[("instance B")]:::server
        I3[("instance C")]:::server
        S[("Shared state<br/>Redis / DB")]:::store

        U1 ==> LB1
        LB1 ==> I1
        LB1 ==> I2
        LB1 ==> I3
        I1 -.->|"read/write session"| S
        I2 -.->|"read/write session"| S
        I3 -.->|"read/write session"| S
    end

    subgraph SF["Stateful — state lives on a specific instance"]
        direction LR
        U2(["User"]):::client
        LB2[["LB (sticky)"]]:::infra
        SI1[("instance A<br/>session in memory")]:::server
        SI2[("instance B<br/>session in memory")]:::server
        SI3[("instance C<br/>session in memory")]:::server

        U2 ==>|"cookie pins to A"| LB2
        LB2 ==> SI1
        LB2 -.->|"not used by this user"| SI2
        LB2 -.->|"not used by this user"| SI3
    end

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

In the stateless world, every instance is identical and interchangeable. In the stateful world, every user has "their" instance, and losing that instance loses their state.

## Why stateless scales so well

- **Add a node, get capacity.** No warm-up, no pinning, no rebalancing. The load balancer starts sending requests; the new node serves them.
- **Lose a node, lose nothing.** The other nodes have all the same code and reach the same state stores. Users do not notice.
- **Rolling deploys are easy.** Take one node out, redeploy, return. Repeat. No session loss.
- **Autoscaling works.** Scale up during a spike; scale down at night. No drama.
- **Crashes are recoverable.** Restart the service; everything keeps working.

The cost is that every request pays for state lookup somewhere else. A read from Redis is 0.5 ms; a read from a database is a few milliseconds. That cost adds up at scale, which is why distributed caches exist.

## Why stateful is sometimes the only honest answer

Some workloads have state by their nature:

- **WebSockets and long-lived TCP connections.** The connection is, by definition, pinned to one process. You cannot pretend it is stateless.
- **In-process caches that take minutes to warm.** Throwing away the cache on every request is too expensive.
- **In-memory ML feature lookups, embedding tables, sketches.** Built up over time, expensive to rebuild.
- **Databases, message brokers, search engines.** These are the canonical stateful services. They scale through replication and sharding, not by being stateless.

```mermaid
flowchart TB
    Q1{"Does the work need to remember<br/>something from the previous request?"}:::query
    Q2{"Can that memory live<br/>in shared storage<br/>(Redis, database)?"}:::query
    Q3{"Is the cost of looking it up<br/>each time acceptable?"}:::query

    A1["Stateless.<br/>Default choice for almost every service."]:::strong
    A2["Stateless with shared state.<br/>The most common production shape."]:::strong
    A3["Stateful.<br/>WebSockets, in-memory caches, brokers."]:::mid

    Q1 -->|"no"| A1
    Q1 -->|"yes"| Q2
    Q2 -->|"yes"| A2
    Q2 -->|"no, too expensive"| Q3
    Q3 -->|"no, must be local"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

For a typical web application, the answer is almost always "stateless with shared state". Most state is small enough that a Redis or a database lookup per request is cheap, and the operational simplicity is worth far more than the few milliseconds of latency.

## The migration most teams do

A monolith starts stateful. Sessions in process memory, in-memory caches, file uploads on local disk. It works fine until the second instance shows up. Then:

1. **Move sessions to Redis.** First step is also the highest-impact. Stickiness disappears.
2. **Move uploads to object storage.** No more "this file lives on box 7." S3, GCS, or Azure Blob.
3. **Move caches to a shared cache.** App-instance caches are replaced by Redis or Memcached.
4. **Move file-based processing to queues.** A worker reads from a queue instead of from a local watch.

By the time you finish, the service is fully stateless and any instance can handle any request. From here, horizontal scaling, rolling deploys, autoscaling, and disaster recovery all become routine.

## What this connects to

- **Horizontal vs vertical scaling.** Stateless is the precondition for cheap horizontal scaling. See [Horizontal vs vertical scaling](/practice/system-design/concepts/039-horizontal-vs-vertical/).
- **Sticky sessions.** What you reach for when the service is stateful and you have not externalised state yet. See [Sticky sessions](/practice/system-design/concepts/031-sticky-sessions/).
- **Caching.** Shared caches are how you make a stateless service feel fast. See [Why cache and what to cache](/practice/system-design/concepts/023-why-cache-what-cache/).
- **Microservices vs monolith.** Stateless services compose into microservices much more easily. See [Microservices vs monolith](/practice/system-design/concepts/041-microservices-vs-monolith/).

## Common mistakes

- **In-memory sessions in production.** Works for one box. Breaks the moment you add a second.
- **Local file storage on application servers.** A box dies and the files are gone. Use object storage from day one.
- **Stateful caches that take 10 minutes to warm.** A rolling deploy now causes a 10-minute latency hit per instance. Either accept it explicitly or warm caches from a shared source.
- **Pretending WebSockets are stateless.** They are not. Plan for the connection-pinning reality (graceful drain, reconnection).
- **Storing state on autoscaled instances.** Autoscaling assumes interchangeability. Stateful + autoscaled is a recipe for lost data.
- **Reaching for sticky sessions instead of fixing state.** Stickiness is a bridge, not a destination.

## Quick recap

- Stateless: any instance handles any request. Trivial to scale, deploy, and replace.
- Stateful: state lives on a specific instance. Necessary for some workloads (WebSockets, brokers, databases) but a liability for typical web services.
- The pragmatic shape is "stateless services + shared state stores (Redis, DB, object storage)."
- The migration from stateful to stateless is one of the first investments any growing system makes, and the one that pays off the most.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
