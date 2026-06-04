---
concept_id: 58
slug: failover-and-circuit-breakers
title: "Failover and circuit breakers: routing around a down provider"
tease: "Failover and circuit breakers: routing around a down provider"
section: "Production AI systems"
status: draft
---

Provider outages happen. A production system needs a failover plan: secondary provider, model fallback, or a graceful 'try again in a minute' for non-critical flows. Circuit breakers stop you from hammering a degraded provider and making everyone's day worse.

```mermaid
flowchart LR
    R[("Request")]:::a --> P[/"Primary provider"/]:::v
    P -->|ok| OK[("Response")]:::g
    P -->|fail| CB{"Circuit breaker"}:::y
    CB -->|open| F[/"Failover provider"/]:::v
    F --> OK
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- Failure modes that actually happen with LLM providers
- Same-provider model failover vs cross-provider failover
- Circuit breakers and exponential backoff
- Quality differences across providers: when failover is degradation
- Graceful degradation as a product decision

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
