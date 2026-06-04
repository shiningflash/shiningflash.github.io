---
concept_id: 50
slug: model-routing
title: "Model routing: cheap-and-fast vs smart-and-expensive with a classifier"
tease: "Model routing: cheap-and-fast vs smart-and-expensive with a classifier"
section: "Production AI systems"
status: draft
---

Most queries do not need the biggest model. A small classifier (or even a simple heuristic) routes easy queries to a cheap model and hard ones to a smart model. This is one of the highest-ROI patterns in 2026. The router itself becomes a product surface that needs its own evaluation.

```mermaid
flowchart LR
    Q[("Query")]:::a --> R[/"Router (classifier or LLM)"/]:::v
    R --> E[("Easy: small model")]:::g
    R --> H[("Hard: large model")]:::y
    R --> S[("Special: tool / agent")]:::b
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The cost-quality dial and where routing fits
- Heuristic vs classifier vs LLM-based routers
- Measuring router accuracy as a first-class metric
- Fallback when the small model fails
- Routing across providers, not just within one

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
