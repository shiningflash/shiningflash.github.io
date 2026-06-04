---
concept_id: 55
slug: output-validation-before-side-effects
title: "Output validation before side effects: the 'never let the model delete' rule"
tease: "Output validation before side effects: the 'never let the model delete' rule"
section: "Production AI systems"
status: draft
---

The model can suggest anything. Your code decides what actually happens. Every side-effecting tool needs validation, allow-listing, and (for destructive operations) confirmation. The model's output is input to your validator, not an instruction to your database.

```mermaid
flowchart LR
    M[/"Model output"/]:::v --> V[/"Validator"/]:::v
    V -->|allowed| A[/"Action"/]:::v
    V -->|denied| R[("Refuse + log")]:::y
    A --> D[("Side effect")]:::g
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- Why the model is a suggestion, not a command
- Allow-lists vs deny-lists for tool actions
- Two-step confirmation for destructive actions
- Logging every action the model attempted, not just the ones that ran
- How to design tools so the model cannot do harm even on a worst-case output

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
