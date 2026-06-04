---
concept_id: 51
slug: output-length-caps
title: "Output length caps and token trimming: keeping bills bounded"
tease: "Output length caps and token trimming: keeping bills bounded"
section: "Production AI systems"
status: draft
---

Output tokens cost more than input tokens and a long-winded model can blow a budget fast. `max_tokens` is the hard cap. Prompt design is the soft cap. Without both you ship a feature whose worst case is 10x its average case. With both, costs become predictable.

```mermaid
flowchart LR
    P[("Prompt with brevity rule")]:::a --> M[/"Model"/]:::v
    M --> MX[/"max_tokens cap"/]:::v
    MX --> O[("Bounded output")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- How `max_tokens` actually interacts with the request
- Prompt patterns that produce short answers reliably
- What happens when output is truncated mid-JSON
- Per-feature output budgets and how to enforce them
- Detecting the long-tail-output user pattern early

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
