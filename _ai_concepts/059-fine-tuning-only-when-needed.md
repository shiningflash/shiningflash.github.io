---
concept_id: 59
slug: fine-tuning-only-when-needed
title: "Fine-tuning, only when needed: LoRA, QLoRA, the synthetic-data trap"
tease: "Fine-tuning, only when needed: LoRA, QLoRA, the synthetic-data trap"
section: "Production AI systems"
status: draft
---

Fine-tuning is a power tool that solves a narrow class of problems: style adherence, format consistency at scale, latency-sensitive small-model deployment. It does not add knowledge well (that is RAG's job). LoRA and QLoRA make it cheap. Synthetic training data is tempting and dangerous.

```mermaid
flowchart LR
    B[("Base model")]:::a --> FT[/"LoRA / QLoRA fine-tune"/]:::v
    D[("Curated examples")]:::g --> FT
    FT --> T[("Tuned adapter")]:::y
    T --> S[("Serve with adapter")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- When fine-tuning actually helps (style, format, small-model speed)
- Why it does not help for adding facts (that is RAG)
- LoRA, QLoRA, full fine-tune: cost and quality differences
- The synthetic-data trap: model collapse and bias amplification
- Eval before, during, and after: never ship a tune you cannot measure

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
