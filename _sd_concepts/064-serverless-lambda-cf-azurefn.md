---
concept_id: 64
slug: serverless-lambda-cf-azurefn
title: "Serverless: Lambda vs Cloud Functions vs Azure Functions"
tease: "Cold starts, limits, pricing."
section: "Cloud Comparisons"
status: live
---

Serverless functions ("functions as a service") let you ship a function and have the cloud run it on demand, scaling automatically, billing per millisecond. AWS Lambda set the template; Google Cloud Functions and Azure Functions followed with similar shapes. The differences live in cold start behaviour, runtime support, limits per invocation, and how each integrates with the rest of its cloud. For some workloads, serverless is a magic productivity win. For others, it is a tax for a problem you do not have.

## The three at a glance

```mermaid
flowchart TB
    subgraph LAM["AWS Lambda"]
        direction LR
        L1[("most mature, widest language support")]:::server
        L2[("event sources: API Gateway, SQS, S3,<br/>DynamoDB Streams, EventBridge, ...")]:::server
        L3[("max 15 min execution, 10 GB memory,<br/>provisioned concurrency for cold-start mitigation")]:::server
    end

    subgraph CF["GCP Cloud Functions / Cloud Run"]
        direction LR
        G1[("Cloud Functions: classic FaaS<br/>Cloud Run: container-based serverless")]:::server
        G2[("event sources: Pub/Sub, GCS, Firestore,<br/>HTTPS triggers")]:::server
        G3[("Cloud Run is what most teams use today;<br/>longer requests, full container flexibility")]:::server
    end

    subgraph AF["Azure Functions"]
        direction LR
        A1[("strong .NET / C# story,<br/>also Node, Python, Java, PowerShell")]:::server
        A2[("event sources: Event Grid, Service Bus,<br/>Cosmos DB change feed, HTTP")]:::server
        A3[("Durable Functions for stateful orchestration<br/>(a unique capability)")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## Cold starts: the single most important number

A cold start happens the first time a function is invoked (or after the runtime has been idle long enough to be evicted). The cloud has to provision a container, load the runtime, load your code, and run your initialiser before the actual request runs. Cold starts dominate latency for low-traffic functions.

```mermaid
sequenceDiagram
    autonumber
    participant U as Caller
    participant FAAS as Function platform
    participant FN as Function instance

    rect rgba(220, 38, 38, 0.06)
    Note over U,FN: Cold start
    U->>FAAS: invoke
    FAAS->>FN: provision container (50-1000ms)
    FAAS->>FN: load runtime (50-500ms)
    FAAS->>FN: load your code + dependencies (50-2000ms)
    FAAS->>FN: run initialiser
    FN-->>FAAS: ready
    FAAS->>FN: invoke handler
    FN-->>U: response
    Note over U: total: 200ms to several seconds
    end

    rect rgba(22, 163, 74, 0.06)
    Note over U,FN: Warm invocation (instance already running)
    U->>FAAS: invoke
    FAAS->>FN: invoke handler (~1-10ms)
    FN-->>U: response
    end
```

Cold start costs vary by language and dependency size:

- **Compiled / lightweight runtimes** (Go, Rust, small Node): 100-300 ms.
- **JVM / .NET**: 500 ms to several seconds.
- **Python with heavy imports**: 1-3 seconds.

All three clouds offer mitigations: **provisioned concurrency** (Lambda), **min instances** (Cloud Run / Cloud Functions Gen 2), **Premium plan** (Azure). They keep N instances warm at all times at a cost — at which point you have re-invented a small fleet of always-on containers and might want to ask whether serverless was the right shape.

## What actually differs

```mermaid
flowchart TB
    F1["Container-based vs zip-based<br/>Cloud Run is fully container-native<br/>Lambda accepts containers or zip<br/>Functions accept zip / containers depending on plan"]:::infra
    F2["Max execution time<br/>Lambda: 15 minutes<br/>Cloud Run: 60 minutes<br/>Azure Functions Premium: unlimited"]:::infra
    F3["Concurrent executions<br/>Lambda: 1000+ per account, raisable<br/>Cloud Run: scales to many thousands<br/>Azure: depends on plan"]:::infra
    F4["State<br/>All three are stateless by design<br/>Azure Durable Functions add orchestration (unique)"]:::infra
    F5["Pricing<br/>All three charge per invocation + per GB-second of memory<br/>Provisioned tiers charge per hour of warm capacity"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

## When serverless is the right shape

- **Bursty, unpredictable traffic.** A cron job that runs once an hour, a webhook receiver, a fan-out from an event bus.
- **Glue between cloud services.** "When a file lands in S3, do this thing." Lambda is exactly this pattern.
- **Low traffic where provisioning a VM is overhead.** Internal tools, infrequent admin tasks.
- **Bursty fan-out.** Image resizing, video thumbnailing, document processing.

## When serverless is overhead

- **Steady, high-traffic workloads.** A VM or container is cheaper at sustained load.
- **Latency-critical paths** where cold starts are unacceptable.
- **Long-running work.** Encoding, ML training, batch processing.
- **Stateful sessions** beyond the function's lifetime.

## When to pick which

```mermaid
flowchart TB
    Q1{"Which cloud is the rest of your stack on?"}:::query
    Q2{"Do you need very long runs<br/>or container-native serverless?"}:::query

    A1["Lambda.<br/>AWS default, broadest event-source integration,<br/>widest language support."]:::strong
    A2["Cloud Run.<br/>GCP's modern default for serverless.<br/>Use Cloud Functions Gen 2 for simple HTTP/event triggers."]:::strong
    A3["Azure Functions.<br/>Best for Microsoft ecosystems.<br/>Durable Functions for stateful orchestration."]:::strong

    Q1 -->|"AWS"| A1
    Q1 -->|"GCP"| Q2
    Q2 -->|"yes"| A2
    Q1 -->|"Azure / Microsoft"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## Common mistakes

- **Reach for serverless for steady-state APIs.** A container behind a load balancer is usually cheaper at sustained traffic.
- **Heavy startup work in the handler.** Move it to module-level initialisation so it runs once per container, not per request.
- **Big dependency trees.** Larger code = slower cold starts. Tree-shake aggressively.
- **No timeout / retry policy.** Failed invocations either lose work or retry forever depending on the trigger source. Always configure both.
- **Stateful logic in stateless functions.** Use a queue + worker pattern; do not assume the function instance survives.
- **Forgetting cost at scale.** A function running 100M times a month at 200 ms each is significant. Run the numbers; compare to a container.
- **Provisioned concurrency for everything.** At that point, you are paying for always-on infra without the convenience.

## Quick recap

- Lambda, Cloud Functions/Run, Azure Functions: same primitive, similar pricing model, different language support and event sources.
- Cold starts dominate latency for low-traffic functions; mitigations exist but cost.
- Serverless wins for bursty, event-driven, glue-style workloads.
- Serverless loses for steady-state high-traffic APIs and long-running jobs.
- Pick by cloud first; pick the right serverless shape (FaaS vs container-serverless) second.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
