---
concept_id: 43
slug: reference-free-evals
title: "Reference-free evals: groundedness, refusal correctness, JSON validity"
tease: "Reference-free evals: groundedness, refusal correctness, JSON validity"
section: "Evaluation"
status: draft
---

You do not always have a reference answer. You can still evaluate. Groundedness asks 'is the answer supported by the retrieved context?' Refusal correctness asks 'should the model have refused?' JSON validity asks 'is this parseable?' These checks scale because they need no labels.

```mermaid
flowchart LR
    A[("Answer + context")]:::a --> G[/"Groundedness check"/]:::v
    A --> R[/"Refusal check"/]:::v
    A --> J[/"JSON validity check"/]:::v
    G --> S[("Per-example scores")]:::g
    R --> S
    J --> S
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- What reference-free evals are good for
- Groundedness: the most useful RAG eval that needs no labels
- Refusal correctness as a real safety metric
- JSON / schema validity as a continuous signal
- Combining reference-free checks into a quality dashboard

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
