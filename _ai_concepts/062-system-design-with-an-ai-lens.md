---
concept_id: 62
slug: system-design-with-an-ai-lens
title: "System design with an AI lens: model and cost first, not last"
tease: "System design with an AI lens: model and cost first, not last"
section: "Interview craft"
status: draft
---

An AI system-design round is a normal system-design round with extra dimensions: model choice, cost per request, latency budget, eval strategy, and failure modes specific to LLMs. The senior signal is naming these dimensions early, not bolting them on at the end.

```mermaid
flowchart LR
    R[("Requirements")]:::a --> M[("Model + cost choice")]:::g
    R --> L[("Latency budget")]:::g
    R --> E[("Eval strategy")]:::g
    M --> A[("Architecture")]:::v
    L --> A
    E --> A
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The dimensions a normal SD round skips
- Why model and cost choice belongs in the first 5 minutes
- Talking about evaluation as a design constraint
- Avoiding the LangChain box on the whiteboard
- Bringing the same rigor you bring to a non-AI design

*Page coming soon.*

This concept sits in **Stage 7 (Interview craft)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
