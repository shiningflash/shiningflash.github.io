---
concept_id: 48
slug: provider-prefix-caching
title: "Provider-side prefix caching: free wins on long system prompts"
tease: "Provider-side prefix caching: free wins on long system prompts"
section: "Production AI systems"
status: draft
---

Every major provider caches stable prompt prefixes server-side. A 5000-token system prompt that does not change across calls becomes nearly free after the first hit. The discount is 50% to 90% off the prefix. The catch is the prefix has to be byte-identical and the variable part has to be at the end.

```mermaid
flowchart LR
    P[("Prompt")]:::a --> S[("Stable system + tools<br/>(cacheable)")]:::g
    P --> V[("Variable user input")]:::y
    S --> C[/"Provider cache"/]:::v
    V --> M[/"Model"/]:::v
    C --> M
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- How prefix caching works at OpenAI, Anthropic, Google
- Cache hit requirements: byte-identical prefix, minimum length
- Prompt structure for maximum cache hit rate
- Cost math: when caching breaks even vs trimming the prompt
- Measuring cache hit rate as a production metric

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
