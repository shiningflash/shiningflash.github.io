---
concept_id: 49
slug: semantic-caching
title: "Semantic caching: embed the query, look up similar past answers"
tease: "Semantic caching: embed the query, look up similar past answers"
section: "Production AI systems"
status: draft
---

Semantic caching embeds the incoming query, checks if a sufficiently similar one was answered recently, and returns the cached answer. It can cut bills 30 to 60 percent on chat workloads and zero percent on others. The hard part is the similarity threshold and the staleness policy.

```mermaid
flowchart LR
    Q[("Query")]:::a --> E[/"Embed"/]:::v
    E --> L[/"Vector lookup"/]:::v
    L --> S{"Similarity above threshold?"}:::y
    S -->|yes| C[("Return cached answer")]:::g
    S -->|no| M[/"Call LLM, cache result"/]:::v
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- When semantic caching pays off and when it does not
- Threshold tuning: false positives hurt more than misses
- Staleness: TTL, content-change invalidation, user-scoped caches
- Tools and embedding choices for the cache
- Measuring cache hit rate vs answer quality

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
