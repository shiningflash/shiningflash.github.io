---
concept_id: 59
slug: service-discovery
title: "Service discovery: DNS vs registry vs sidecar"
tease: "Trade-offs across the three approaches."
section: "Operational"
status: live
---

Service A wants to call service B. In a static world, B's address is in a config file. In the real world, B has 30 pods, spread across 3 availability zones, and the pods come and go every few minutes during rolling deploys, autoscaling, and node failures. Service discovery is how A finds the current set of B's pods, fast enough to be useful and accurate enough not to keep talking to dead ones. Three patterns dominate: **DNS-based**, **registry-based (client- or server-side)**, and **service mesh / sidecar**. Each one trades simplicity for accuracy.

## The problem

```mermaid
flowchart LR
    A(["Service A"]):::client
    Q{"Where is B?"}:::query
    B1[("B pod 1<br/>10.0.1.5")]:::server
    B2[("B pod 2<br/>10.0.1.6")]:::server
    B3[("B pod 3<br/>10.0.1.7")]:::server

    A ==> Q
    Q -.-> B1
    Q -.-> B2
    Q -.-> B3

    NOTE["Pods come and go.<br/>The list of addresses changes constantly.<br/>How does A keep up?"]:::infra

    Q --> NOTE

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

## DNS-based discovery: cheap, slow to update

A DNS name resolves to one or more IPs. The DNS server is the source of truth; clients ask DNS and trust the answer. This is how the world has worked since 1983.

```mermaid
sequenceDiagram
    autonumber
    participant A as Service A
    participant DNS as DNS server
    participant B as Service B pod

    A->>DNS: A record for service-b.internal?
    DNS-->>A: [10.0.1.5, 10.0.1.6, 10.0.1.7]
    A->>B: HTTP request to 10.0.1.5
    Note over A,DNS: client caches the IPs<br/>(typical TTL: 30-300 seconds)
```

In Kubernetes, every service has an internal DNS name (`service-b.namespace.svc.cluster.local`); the cluster's DNS (CoreDNS) keeps it updated as pods join and leave.

**Strength.** Every language has a DNS client. Zero application code needed. The cluster does the work.

**Weakness.** DNS caches. A pod that died 10 seconds ago may still be in the client's cache for another minute. Clients keep hammering dead IPs until the TTL expires. Cannot do health-aware routing (DNS just returns IPs; it does not know which are healthy beyond a coarse "are they registered").

Used for: internal Kubernetes service-to-service for simple cases, traditional infrastructure, anything where eventual consistency at minute-granularity is acceptable.

## Registry-based discovery: more accurate, more moving parts

A central registry (Consul, etcd, Eureka, Kubernetes itself) holds the current set of healthy instances per service. Clients consult the registry directly, or via a server-side load balancer that does.

```mermaid
flowchart LR
    subgraph CLIENT["Client-side discovery"]
        direction LR
        AC(["Service A"]):::client
        REG[("Registry<br/>(Consul, etcd)")]:::infra
        BS[("Service B pods")]:::server
        AC ==>|"who is B?"| REG
        REG ==>|"[healthy pods]"| AC
        AC ==>|"call directly"| BS
    end

    subgraph SERVER["Server-side discovery"]
        direction LR
        AS(["Service A"]):::client
        LB[["Load balancer<br/>watches registry"]]:::infra
        REG2[("Registry")]:::infra
        BS2[("Service B pods")]:::server
        AS ==>|"call B's LB endpoint"| LB
        REG2 -.->|"healthy pods"| LB
        LB ==> BS2
    end

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

Each service instance registers on startup ("I am service B, here is my address, here is my health check") and the registry removes it when it fails or goes away. Clients (or LBs) get fresh information within seconds, not minutes.

**Strength.** Fast updates, health-aware. Rich metadata (tags, version, region).

**Weakness.** The registry is itself a critical service. Every client needs registry-aware code (or a sidecar; see below). Server-side load balancing adds a hop.

Used for: traditional microservices on VMs (Consul + load balancer), some Kubernetes setups that use etcd directly through the API server.

## Service mesh / sidecar: the modern default

Every pod gets a sidecar proxy (Envoy is the canonical implementation; used by Istio, Linkerd, and others). The application makes plain HTTP calls to `service-b`; the sidecar intercepts, looks up the current healthy endpoints, and forwards. The application never deals with discovery at all.

```mermaid
flowchart LR
    subgraph PODA["Pod A"]
        direction TB
        AAPP(["Service A app code"]):::client
        AENV[["Envoy sidecar"]]:::infra
    end

    subgraph PODB["Pod B"]
        direction TB
        BENV[["Envoy sidecar"]]:::infra
        BAPP[("Service B app code")]:::server
    end

    CP[("Control plane<br/>(Istio, Linkerd)<br/>discovery + routing config")]:::store

    AAPP -->|"localhost: call b"| AENV
    AENV ==>|"mTLS, retries, LB"| BENV
    BENV --> BAPP

    CP -.->|"push current endpoints"| AENV
    CP -.->|"push current endpoints"| BENV

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

**Strength.** Discovery is free at the application level. The mesh also handles mTLS, retries, circuit breaking, traffic shifting, and observability. Polyglot teams stop worrying about library support per language.

**Weakness.** Operationally heavy: a control plane to maintain, sidecar per pod (memory and CPU overhead), a steeper learning curve, more moving parts during incidents. Sidecars also add a hop to every request, costing a small amount of latency.

Used for: production Kubernetes deployments at scale, mixed-language microservices, anywhere you want service-to-service mTLS and traffic policies as a platform capability.

## Side by side

```mermaid
flowchart TB
    subgraph D["DNS-based"]
        direction LR
        D1["update lag: 30s - 5min"]:::weak
        D2["health awareness: none"]:::weak
        D3["complexity: trivial"]:::strong
    end

    subgraph R["Registry-based"]
        direction LR
        R1["update lag: seconds"]:::strong
        R2["health awareness: explicit"]:::strong
        R3["complexity: registry to operate"]:::mid
    end

    subgraph M["Service mesh / sidecar"]
        direction LR
        M1["update lag: seconds, sometimes sub-second"]:::strong
        M2["health awareness: rich, with retries and breakers"]:::strong
        M3["complexity: significant; full control plane"]:::weak
    end

    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## Picking an approach

```mermaid
flowchart TB
    Q1{"Is the system small,<br/>and Kubernetes default service<br/>routing enough?"}:::query
    Q2{"Do you need service mesh features<br/>(mTLS, traffic shifting, retries) as platform capabilities?"}:::query
    Q3{"Are you on traditional VMs<br/>or hybrid infra?"}:::query

    A1["DNS-based<br/>(Kubernetes Service + CoreDNS).<br/>Good default."]:::strong
    A2["Service mesh.<br/>Istio, Linkerd, Consul Connect.<br/>Platform-grade."]:::strong
    A3["Registry-based<br/>(Consul, Eureka).<br/>Works across VMs and k8s."]:::mid

    Q1 -->|"yes"| A1
    Q1 -->|"no"| Q2
    Q2 -->|"yes"| A2
    Q2 -->|"no"| Q3
    Q3 -->|"yes"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

Most teams' progression: start with DNS-based (Kubernetes Service + CoreDNS), graduate to a service mesh once mTLS, traffic shifting, or per-service retries become real requirements.

## Two scenarios

**Scenario one: a small SaaS on Kubernetes, ~10 services.**

Built-in Kubernetes services with CoreDNS. Each service has a stable DNS name. Pods come and go; CoreDNS keeps the records updated. No mesh, no sidecar. Operational simplicity wins.

**Scenario two: a fintech with 200 services across 4 languages and mandatory mTLS.**

Istio with Envoy sidecars. Service-to-service mTLS is automatic. Traffic-shifting between versions during deploys is a platform capability. Per-service circuit breakers and retries are configured in the mesh, not in code. The complexity is real but every service inherits the resilience patterns for free.

## What this connects to

- **Load balancer basics.** Discovery feeds the LB pool. See [Load balancer: why, how, when](/practice/system-design/concepts/028-load-balancer-basics/).
- **Health checks.** What the discovery layer uses to decide who is healthy. See [Health checks: liveness vs readiness vs startup](/practice/system-design/concepts/057-health-checks/).
- **mTLS.** Service mesh's killer feature for security. See [API key vs OAuth vs mTLS](/practice/system-design/concepts/054-api-key-oauth-mtls/).
- **Circuit breaker.** Often configured in the mesh sidecar. See [Circuit breaker](/practice/system-design/concepts/045-circuit-breaker/).
- **Microservices vs monolith.** Discovery is a problem you only have once you have many services. See [Microservices vs monolith](/practice/system-design/concepts/041-microservices-vs-monolith/).

## Common mistakes

- **DNS TTL too high.** Dead pods stay in client caches for minutes. Drop TTL to 5-30 seconds for service discovery DNS.
- **No health-based removal.** Discovery returns IPs but does not know if they are healthy. Pair with readiness probes; let the discovery layer filter.
- **Sidecar without a control plane.** Envoy without Istio's control plane is just Envoy. The discovery part is missing.
- **Service mesh without a real need.** A mesh adds operational load; without mTLS, traffic shifting, or polyglot microservices, you are paying for capability you do not use.
- **Custom service discovery code.** Almost always wrong. The platform's primitives are tested by thousands of teams; your handwritten code is not.
- **Cross-cluster discovery as an afterthought.** Multi-cluster discovery is genuinely hard; pick a mesh that supports it explicitly if you need it.

## Quick recap

- DNS-based: simple, slow to update, no health awareness. Fine for many setups.
- Registry-based: faster updates, health-aware. Common on VM-based microservices.
- Service mesh / sidecar: discovery plus mTLS, retries, circuit breaking, traffic shifting as platform capabilities. Heavy but powerful.
- Default to Kubernetes' built-in DNS. Graduate to a mesh when you need its features, not because it sounds modern.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
