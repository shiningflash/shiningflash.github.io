---
concept_id: 22
slug: time-clocks-ordering
title: "Time, clocks, and ordering"
tease: "NTP, logical clocks, vector clocks."
section: "Consistency & Distribution"
status: live
---

In a distributed system, "what happened first?" is a harder question than it looks. Wall clocks on different machines disagree by tens or hundreds of milliseconds. Network delays scramble the order events arrive in. The famous bugs in distributed systems often come down to assuming you can order events by timestamps, when in fact you cannot. This page covers the three tools you actually use: NTP-synchronised wall clocks, logical clocks, and vector clocks. Each one answers a different version of "did A happen before B?"

## Why wall clocks lie

Every server has a clock. None of them agree exactly. The clock drifts, the operating system corrects it, NTP nudges it, virtualisation pauses it, and occasionally an admin moves it. Two events that look "1 millisecond apart" by timestamp might actually be 30 ms apart in real time, or the other way around.

```mermaid
flowchart TB
    subgraph T0["Real time t = 0"]
        direction LR
        A1[("Server A clock<br/>12:00:00.000")]:::store
        B1[("Server B clock<br/>11:59:59.953  (47 ms behind)")]:::store
        C1[("Server C clock<br/>12:00:00.018  (18 ms ahead)")]:::store
    end

    subgraph T1["NTP adjusts. New offsets."]
        direction LR
        A2[("Server A<br/>12:00:00.029  (29 ms ahead)")]:::store
        B2[("Server B<br/>12:00:00.001  (1 ms ahead)")]:::store
        C2[("Server C<br/>11:59:59.998  (2 ms behind)")]:::store
    end

    T0 --> T1

    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

NTP keeps clocks within a few tens of milliseconds of each other on a normal day. PTP can get to microseconds inside a data centre. Google's TrueTime uses GPS plus atomic clocks to bound uncertainty to single-digit milliseconds globally. None of them give you nanosecond-perfect agreement, and none of them give you "this happened before that" with certainty when events are close in time.

## The "happened-before" relation

In 1978, Lamport defined the only thing you can actually know:

> An event A "happened before" event B if A could have caused B.

That is true if:

1. A and B happened on the same node, and A came first.
2. A was a "send" and B was the matching "receive" on another node.
3. A happened-before X, and X happened-before B.

If neither A happened-before B nor B happened-before A, the events are **concurrent**. No timestamp can tell you which came first because the question has no answer.

## Lamport timestamps: a single counter per node

A Lamport clock is one number per node. The rules:

1. On any local event, the counter goes up by 1.
2. When sending a message, include the current counter.
3. When receiving a message, set the local counter to `max(local, received) + 1`.

```mermaid
sequenceDiagram
    autonumber
    participant A as Node A  (clock = 0)
    participant B as Node B  (clock = 0)
    participant C as Node C  (clock = 0)

    Note over A: local event<br/>clock = 1
    A->>B: send (timestamp = 1)
    Note over B: receive. clock = max(0, 1) + 1 = 2
    Note over B: local event<br/>clock = 3
    B->>C: send (timestamp = 3)
    Note over C: receive. clock = max(0, 3) + 1 = 4
    Note over C: local event<br/>clock = 5
```

If event X has Lamport timestamp 3 and event Y has timestamp 5, you can be sure: if X happened-before Y, then 3 < 5. The reverse is **not** guaranteed: 3 < 5 does **not** prove X happened-before Y. They might be concurrent.

Lamport clocks give you a total order that respects causality, which is enough for many systems (Kafka offsets, Raft log indexes, dictionary order of operations). They cannot distinguish "truly before" from "looks before but actually concurrent."

## Vector clocks: full causality

A vector clock is one counter **per node**, kept by every node. When a node sends a message, it sends its whole vector. When receiving, the receiver takes the element-wise maximum and bumps its own entry.

```mermaid
sequenceDiagram
    autonumber
    participant A as Node A  [A:0, B:0, C:0]
    participant B as Node B  [A:0, B:0, C:0]
    participant C as Node C  [A:0, B:0, C:0]

    Note over A: local event<br/>[A:1, B:0, C:0]
    A->>B: send [A:1, B:0, C:0]
    Note over B: receive + bump B<br/>[A:1, B:1, C:0]
    B->>C: send [A:1, B:1, C:0]
    Note over C: receive + bump C<br/>[A:1, B:1, C:1]
    Note over C: local event<br/>[A:1, B:1, C:2]

    Note over A: independent local event<br/>(A doesn't know about B or C yet)<br/>[A:2, B:0, C:0]
```

Given any two vector clocks V1 and V2, you can decide:

- **V1 happened-before V2** if every element of V1 is `<=` the corresponding element of V2, and at least one is strictly less.
- **V1 and V2 are concurrent** otherwise.

That last bullet is the win. Vector clocks **detect** concurrent events. You can now hand the conflict to application code, a human, or a CRDT to resolve. This is how Riak and Cassandra know that two writes were concurrent and need merging.

The cost is size: a vector grows with the number of writers. For a small cluster (tens of nodes), this is fine. For millions of clients, it is not.

## Which clock for which job

```mermaid
flowchart TB
    Q{"What do you need?"}:::query
    L1["Lightly-ordered timestamps,<br/>sloppy is fine"]:::weak
    L2["Total order that respects causality"]:::mid
    L3["Detect concurrent events,<br/>merge conflicts intelligently"]:::strong

    Q -->|"audit logs, eventual cleanup"| L1
    Q -->|"distributed log, queue offsets"| L2
    Q -->|"multi-master writes, CRDTs, version vectors"| L3

    L1 --> N1["NTP wall clock"]:::store
    L2 --> N2["Lamport clock"]:::store
    L3 --> N3["Vector clock"]:::store

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

NTP-synced wall clocks for most application code (logs, traces, anything humans read). Lamport clocks for internal ordering (Kafka offsets, Raft logs). Vector clocks for multi-master replication and conflict detection. Spanner's TrueTime is wall-clock-with-bounded-uncertainty and is one of the few production systems that can give you "true" external ordering.

## What this enables

- **Total ordering of events in a queue.** Lamport timestamps or sequential offsets.
- **Detecting conflicts in multi-leader replication.** Vector clocks (Riak, Dynamo).
- **Strongly consistent reads across data centres.** TrueTime + Paxos (Spanner).
- **Correctly ordering log lines after the fact.** NTP plus sanity (sometimes manually correcting for clock drift in post-processing).

## What this connects to

- **Causal consistency.** Built directly on the happened-before relation. See [Consistency models](/practice/system-design/concepts/017-consistency-models/).
- **Consensus.** Raft logs use sequence numbers (a form of Lamport clock). See [Consensus: Raft and Paxos](/practice/system-design/concepts/018-consensus-raft-paxos/).
- **Delivery semantics.** Exactly-once delivery often requires the producer to attach a deterministic sequence number. See [Delivery semantics](/practice/system-design/concepts/034-delivery-semantics/).

## Common mistakes

- **Ordering events by wall-clock timestamps.** Clocks drift. Two events that look 1 ms apart might be in the wrong order. Never use wall clocks for causality decisions in code.
- **Trusting the client's clock.** A mobile device's clock can be wrong by hours, set by the user, or even moved backward.
- **Assuming NTP is perfect.** NTP keeps clocks roughly in sync, not exactly. If your code branches on "is event A before B by less than 100 ms?", you are in trouble.
- **Ignoring clock skew in a distributed test.** Integration tests that pass on one machine may fail on another because the clock difference matters.
- **Designing for vector clocks where Lamport is enough.** Vector clocks are powerful but expensive. Use the simpler tool until you actually need conflict detection.

## Quick recap

- Wall clocks drift; NTP keeps them close, never identical.
- Lamport timestamps give a total order that respects causality.
- Vector clocks detect concurrent events; needed for multi-master conflict resolution.
- "Happened before" is the only thing you can know for certain in a distributed system without atomic clocks.
- For application code, prefer sequence numbers from a single ordering authority (a queue, a log) over wall-clock timestamps whenever possible.

This concept sits in **Stage 5 (Distributed systems hard parts)** of the [System Design Roadmap](/practice/system-design/roadmap/).
