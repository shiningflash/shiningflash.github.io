---
concept_id: 19
slug: leader-election
title: "Leader election"
tease: "When, how, and what happens during a partition."
section: "Consistency & Distribution"
status: live
---

Leader election is how a cluster picks exactly one node to be the boss for some period of time. The leader handles writes, coordinates work, owns a resource, or runs a scheduled job that should only run once. It sounds simple. It is not, because nodes crash, networks split, and two nodes can briefly both believe they are the leader. Every interesting consensus system has a leader election protocol underneath, and most production bugs in this space are about the corner cases.

## Why we need a leader at all

Most distributed problems get much easier when one node owns the decision:

- **Writes go through one place** so the order is unambiguous.
- **A scheduled job runs exactly once** because exactly one node thinks it is the leader.
- **Locks and counters have a single source of truth.**
- **Replication is one-to-many** instead of many-to-many.

The cost is that the leader is a critical node. If it dies, the cluster halts until a new one is chosen. Election speed is therefore a real performance number.

```mermaid
flowchart TB
    C(["Client requests"]):::client
    L[("Leader<br/>handles writes,<br/>coordinates")]:::leader
    F1[("Follower")]:::store
    F2[("Follower")]:::store
    F3[("Follower")]:::store

    C ==> L
    L ==>|"replicate"| F1
    L ==>|"replicate"| F2
    L ==>|"replicate"| F3
    F1 -.->|"heartbeat reply"| L
    F2 -.->|"heartbeat reply"| L
    F3 -.->|"heartbeat reply"| L

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef leader fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:2px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

The leader sends heartbeats. Followers respond. If a follower stops hearing heartbeats, it suspects the leader is dead and starts an election.

## The election: how it works in practice

This is the Raft version. Paxos is similar in spirit; ZooKeeper uses its own algorithm called Zab. The mechanics differ; the shape is the same.

```mermaid
sequenceDiagram
    autonumber
    participant Old as Old leader (dead)
    participant F1 as Follower 1
    participant F2 as Follower 2
    participant F3 as Follower 3
    participant F4 as Follower 4

    Note over Old: crash. heartbeats stop.

    Note over F1: timeout. become candidate.<br/>bump term to N+1. vote for self.
    F1->>F2: request vote (term N+1)
    F1->>F3: request vote (term N+1)
    F1->>F4: request vote (term N+1)

    F2-->>F1: yes (haven't voted yet this term)
    F3-->>F1: yes
    F4-->>F1: no (already voted for someone else)

    Note over F1: 3 of 5 = majority.<br/>Become leader for term N+1.
    F1->>F2: heartbeat (term N+1)
    F1->>F3: heartbeat (term N+1)
    F1->>F4: heartbeat (term N+1)

    Note over F2,F4: New leader installed. Writes can resume.
```

Two key rules keep elections safe:

1. **One vote per node per term.** A follower votes "yes" at most once each term. This is what prevents two candidates from both winning.
2. **Majority required to win.** A candidate needs more than half the cluster to vote for it. This rules out the split-brain case where two halves of a partition both elect a leader.

## What happens during a partition

A partition splits the cluster. The minority side cannot form a majority, so it cannot elect a leader. The majority side can.

```mermaid
flowchart TB
    subgraph PART["Network split"]
        direction LR
        subgraph MIN["Minority — 2 nodes, cannot elect"]
            M1[("Node 4")]:::store
            M2[("Node 5")]:::store
        end
        subgraph MAJ["Majority — 3 nodes, elects a leader"]
            J1[("Node 1")]:::leader
            J2[("Node 2")]:::store
            J3[("Node 3")]:::store
        end
    end

    NOTE["Minority side blocks all writes.<br/>Majority side keeps the cluster running.<br/>When the partition heals, the minority<br/>re-syncs from the new leader."]:::infra

    PART --> NOTE

    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
    classDef leader fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:2px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

If the old leader was on the minority side, it sees no heartbeat acks and eventually steps down. If a client kept talking to it during the partition, those writes will fail (they cannot reach a majority). This is the price of safety, and it is the right price.

## Split brain: the failure mode everyone is afraid of

A split brain happens when two nodes simultaneously believe they are the leader, both accept writes, and the cluster diverges into two histories.

Consensus protocols **prevent** split brain by requiring majority votes. The trap is when teams write a "lightweight" leader election (e.g., "ping each other, lowest IP wins") that does not require a majority. During a partition, both sides can pick a leader and accept writes. The cluster will need a painful, manual conflict resolution when it heals.

The lesson: never roll your own leader election. Use Raft, ZooKeeper, etcd, or a system that already has it.

## What leader election is good for

- **Distributed locks.** "I am the leader of this lock" means exactly one client holds it at a time.
- **Singleton background jobs.** "Run this cleanup task once a minute" needs exactly one runner.
- **Shard ownership.** Each shard has one owner that handles writes. The mapping is itself maintained by a consensus group.
- **Cluster coordinators.** Kafka controllers, Mesos masters, Kubernetes API server.

## Two scenarios

**Scenario one: a scheduled cleanup job.**

Twenty pods run your application. Each one would happily run the cleanup task. You need exactly one to do it, otherwise the job runs twenty times. Solution: every pod tries to acquire an etcd lease. Whoever gets it is the leader; they run the job. The lease auto-expires; whoever renews it stays leader; if the leader pod dies, the lease expires and a new pod takes over.

**Scenario two: a database with one writeable primary.**

Three Postgres nodes managed by Patroni. One is the leader (writes); two follow. If the leader VM is replaced or crashes, Patroni (which uses etcd or Consul) detects it via a missed heartbeat, promotes a healthy follower, points the load balancer at the new leader, and the application reconnects. Typical failover time: 10 to 30 seconds. Without leader election, this would be a manual page in the middle of the night.

## What this connects to

- **Consensus.** Leader election is the first stage of every consensus protocol. See [Consensus: Raft and Paxos](/practice/system-design/concepts/018-consensus-raft-paxos/).
- **CAP theorem.** A cluster without a leader cannot accept writes; this is the C side of CAP under partition. See [CAP theorem](/practice/system-design/concepts/016-cap-theorem/).
- **Read replicas.** A primary-replica setup is leader-election in microcosm; failover promotes a replica to leader. See [Read replicas](/practice/system-design/concepts/011-read-replicas/).
- **Health checks.** Leader heartbeats and follower replies are health checks at the cluster level. See [Health checks](/practice/system-design/concepts/057-health-checks/).

## Common mistakes

- **Rolling your own.** A "leader election" written over an evening is almost always wrong during a real partition.
- **Two-node clusters.** Two nodes cannot form a majority during a partition. Pick odd numbers; 3 or 5 is normal.
- **Treating elections as instant.** A failover takes seconds. Your application needs to handle the unavailable window gracefully, often with a small retry budget.
- **Forgetting about fencing.** When a new leader takes over, the old leader may not know it has been deposed yet. Without fencing tokens, the old leader can corrupt state while the new one tries to make progress.
- **Tuning timeouts without measurement.** Heartbeat timeouts too low cause election storms; too high cause slow failover. Defaults are usually right.
- **Putting the whole cluster in one rack or one AZ.** A single power event takes the whole quorum down. Spread across failure domains.

## Quick recap

- Leader election picks exactly one node to coordinate, for some period (a term).
- Followers detect a missing leader via heartbeat timeout and trigger a new election.
- Majority votes prevent split brain.
- Use a battle-tested system (etcd, ZooKeeper, Raft library). Do not roll your own.
- Expect a few seconds of unavailability during a real failover; plan the application around it.

This concept sits in **Stage 5 (Distributed systems hard parts)** of the [System Design Roadmap](/practice/system-design/roadmap/).
