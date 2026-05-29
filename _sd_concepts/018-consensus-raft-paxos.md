---
concept_id: 18
slug: consensus-raft-paxos
title: "Consensus: Raft and Paxos in plain English"
tease: "Why we need them and how leader-follower really works."
section: "Consistency & Distribution"
status: live
---

Consensus is how a group of computers agree on a single value when none of them can be fully trusted to be alive and reachable. Paxos was the first famous algorithm; Raft was designed later to be easier to understand. They solve the same problem and ship in almost everything modern: etcd, ZooKeeper, Spanner, Kafka, CockroachDB. You almost never implement consensus yourself. You do need to understand what it gives you and what it costs.

## The problem consensus solves

Five servers. They want to agree on a sequence of operations: "add user 1", "delete user 2", "update user 3", in this order. Any one of them can crash. The network can drop messages. Two of them might be temporarily unreachable.

The naive answer "just have a leader" raises immediate questions. Who is the leader? What if the leader dies? What if two nodes both think they are the leader? Consensus is the answer to all of these.

```mermaid
flowchart TB
    C(["Client"]):::client
    L[("Leader<br/>node 1")]:::leader
    F1[("Follower<br/>node 2")]:::store
    F2[("Follower<br/>node 3")]:::store
    F3[("Follower<br/>node 4")]:::store
    F4[("Follower<br/>node 5")]:::store

    C ==>|"writes"| L
    L ==>|"replicate"| F1
    L ==>|"replicate"| F2
    L ==>|"replicate"| F3
    L ==>|"replicate"| F4

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef leader fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:2px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

One leader. All writes go through it. Replication to followers. If the leader dies, the followers elect a new one. If a majority is alive, the cluster keeps making progress. If only a minority can talk to each other, they refuse to act, to prevent split brain.

## Raft: the three states

A Raft node is always in one of three states.

```mermaid
flowchart LR
    F["Follower<br/>(default state)<br/>accepts replication from leader"]:::store
    C["Candidate<br/>(transient)<br/>requests votes from peers"]:::infra
    L["Leader<br/>(one per term)<br/>handles writes,<br/>replicates to followers"]:::leader

    F -->|"timeout: no leader heard from"| C
    C -->|"got majority of votes"| L
    C -->|"saw a higher term"| F
    L -->|"saw a higher term"| F

    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef leader fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:2px
```

Time is divided into **terms**. Each term has at most one leader. Followers listen for heartbeats from the leader. If a follower goes long enough without hearing a heartbeat, it bumps its term and starts a vote.

## The write path: replicate, then commit

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant L as Leader
    participant F1 as Follower 1
    participant F2 as Follower 2
    participant F3 as Follower 3
    participant F4 as Follower 4

    C->>L: write x = 5
    Note over L: append to local log<br/>(not yet committed)

    par replicate
        L->>F1: append x = 5
        L->>F2: append x = 5
        L->>F3: append x = 5
        L->>F4: append x = 5
    end

    F1-->>L: ack
    F2-->>L: ack
    Note over L: 2 followers acked + leader =<br/>3 of 5 = majority

    L->>L: commit x = 5
    L-->>C: ok, committed

    par notify
        L-)F1: commit index advanced
        L-)F2: commit index advanced
        L-)F3: commit index advanced
        L-)F4: commit index advanced
    end
```

The leader only acknowledges the client **after** a majority of nodes have stored the write. This is what gives Raft its safety: even if the leader crashes the moment after acknowledging, a majority of nodes still have the entry. The next leader will find it and finish committing.

## Leader election: when the current leader dies

```mermaid
sequenceDiagram
    autonumber
    participant L as Leader (dead)
    participant F1 as Follower 1
    participant F2 as Follower 2
    participant F3 as Follower 3
    participant F4 as Follower 4

    Note over L: leader crashes,<br/>heartbeats stop

    Note over F1: timeout. Become candidate for term N+1.
    F1->>F2: request vote (term N+1)
    F1->>F3: request vote (term N+1)
    F1->>F4: request vote (term N+1)

    F2-->>F1: yes
    F3-->>F1: yes

    Note over F1: 2 votes + own vote = 3 of 5.<br/>Becomes leader for term N+1.

    F1->>F2: heartbeat
    F1->>F3: heartbeat
    F1->>F4: heartbeat
    Note over F2,F4: New leader installed,<br/>cluster makes progress again.
```

Election typically takes hundreds of milliseconds to a few seconds. During that time the cluster cannot accept writes. The trade is well worth it: when a node dies in production, the cluster recovers on its own without paging anyone.

## Why a majority? Why not just two?

A majority guarantees that any two majorities overlap by at least one node. That overlap is what prevents split brain.

```mermaid
flowchart TB
    subgraph PART["Network partition into two groups"]
        direction LR
        subgraph G1["Side A — 2 nodes"]
            A1[("Node 1")]:::store
            A2[("Node 2")]:::store
        end
        subgraph G2["Side B — 3 nodes (majority)"]
            B1[("Node 3")]:::store
            B2[("Node 4")]:::store
            B3[("Node 5")]:::store
        end
    end

    NB["Side A cannot elect a leader<br/>(no majority).<br/>Side B can. One leader, no split brain."]:::infra

    PART --> NB

    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

This is why consensus systems run with an odd number of nodes (3, 5, 7) and why "we have two data centres" is a famous gotcha. Two equal sides can never form a majority during a partition; you need a tie-breaker (a third witness node) somewhere.

## Paxos vs Raft

Both solve the same problem. The differences:

- **Paxos** (1989) is older and famously hard to understand. It is described in pieces (basic Paxos, multi-Paxos, Fast Paxos) and most implementations are partial.
- **Raft** (2014) was designed explicitly to be teachable. Same guarantees, clearer structure: term-based leader election, append-only log, majority commit.

Most modern systems pick Raft for readability and tooling. Paxos lives on inside older systems (Chubby, Spanner) and in research.

## What you actually use this for

You will almost certainly not write a consensus algorithm. You will use a system that has one inside it:

- **etcd, Consul, ZooKeeper.** Coordination services. Sit underneath Kubernetes, service discovery, distributed locks.
- **CockroachDB, TiDB, YugabyteDB.** Distributed SQL. Raft per shard.
- **Kafka (KRaft mode), Pulsar.** Cluster metadata.
- **Spanner.** Strongly consistent across data centres using TrueTime + Paxos.

When you reach for "I need distributed locks" or "I need a strongly consistent counter" or "I need leader election", you reach for a consensus-backed system. You do not roll your own.

## What this connects to

- **Leader election.** The election machinery from Raft, isolated as a concept. See [Leader election](/practice/system-design/concepts/019-leader-election/).
- **CAP theorem.** Consensus systems are CP under partition. See [CAP theorem](/practice/system-design/concepts/016-cap-theorem/).
- **Strong consistency.** Built on consensus. See [Strong, eventual, causal consistency](/practice/system-design/concepts/017-consistency-models/).
- **Idempotency.** Replicated state machines depend on operations being safe to re-apply. See [Idempotency](/practice/system-design/concepts/021-idempotency/).

## Common mistakes

- **Rolling your own consensus.** Almost certainly wrong. Use etcd, ZooKeeper, or a database that has it inside.
- **Running two-node clusters.** Cannot form a majority during a partition. Always three, five, or seven.
- **Putting the whole cluster in one data centre.** Defeats the point. Spread across availability zones or regions with a tie-breaker.
- **Ignoring election storms.** Misconfigured timeouts can cause repeated elections that freeze the cluster. Defaults are usually right; do not tune blindly.
- **Treating consensus as free.** Every write pays for a round trip to a majority. Across regions, that is 100 ms minimum. Plan for it.

## Quick recap

- Consensus = a group of nodes agreeing on a sequence of operations despite crashes and partitions.
- Raft = the easier-to-explain modern algorithm. Paxos = the older one with the same guarantees.
- One leader per term. Writes need a majority to commit.
- If only a minority can talk, no one acts. This is the price of safety, not a bug.
- You use it via etcd, ZooKeeper, distributed databases, and Kafka. You do not implement it.

This concept sits in **Stage 5 (Distributed systems hard parts)** of the [System Design Roadmap](/practice/system-design/roadmap/).
