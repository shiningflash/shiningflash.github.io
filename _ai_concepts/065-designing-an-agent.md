---
concept_id: 65
slug: designing-an-agent
title: "Designing an agent: tools, guards, observability, the loop"
tease: "Designing an agent: tools, guards, observability, the loop"
section: "Interview craft"
status: draft
---

Agent design questions usually surface in interviews as 'build me an X assistant.' The senior outline: tools, guards, observability, the loop itself, then the eval. Most candidates jump to the loop and skip the guards. The guards are what makes the agent safe to ship.

```mermaid
flowchart LR
    G[("Goal")]:::a --> T[("Tools (idempotent)")]:::g
    G --> GU[("Guards (limits + validation)")]:::g
    G --> O[("Observability")]:::g
    G --> L[("Loop")]:::v
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The four blocks of an agent design
- Why guards matter more than the loop
- Designing tools the model can use safely
- Observability as a design constraint, not an add-on
- How to handle the 'what if it loops forever' question

*Page coming soon.*

This concept sits in **Stage 7 (Interview craft)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
