---
concept_id: 37
slug: tool-design-principles
title: "Tool design principles: idempotent, validating, actionable errors"
tease: "Tool design principles: idempotent, validating, actionable errors"
section: "Agents and tool use"
status: draft
---

Tool design is API design with a model as the caller. The model retries, gets the schema wrong, and reads your error messages. Tools should be idempotent, validate their inputs aggressively, and return errors that tell the model how to fix the call. Most tool failures are tool-design failures.

```mermaid
flowchart LR
    M[/"Model call"/]:::v --> V[/"Schema validation"/]:::v
    V -->|invalid| E[("Actionable error<br/>back to model")]:::y
    V -->|valid| T[/"Idempotent action"/]:::v
    T --> R[("Result")]:::g
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- Why every tool needs an idempotency key
- Input validation messages that the model can act on
- Naming and description: what the model is reading
- Side-effecting tools and the dry-run pattern
- Per-tool authorisation and least-privilege

*Page coming soon.*

This concept sits in **Stage 4 (Agents and tool use)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
