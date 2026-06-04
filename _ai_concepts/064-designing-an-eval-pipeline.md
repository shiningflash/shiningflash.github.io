---
concept_id: 64
slug: designing-an-eval-pipeline
title: "Designing an eval pipeline: golden set, judge, CI, the metric that decides"
tease: "Designing an eval pipeline: golden set, judge, CI, the metric that decides"
section: "Interview craft"
status: draft
---

An eval pipeline question separates the AI engineer from the prompt enthusiast. The senior outline: golden set, deterministic checks, judge for the rest, CI gating, A/B in production, and a single headline metric that decides whether the change ships. Anything else is decoration.

```mermaid
flowchart LR
    G[("Golden set")]:::a --> R[/"Rule-based checks"/]:::v
    G --> J[/"LLM judge"/]:::v
    R --> S[("Scores")]:::g
    J --> S
    S --> CI{"Gate the merge?"}:::y
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The pipeline blocks every senior answer has
- Defining the headline metric that decides ship / no-ship
- Golden-set provenance and labelling discipline
- Judge calibration as a separate problem
- Closing the loop from production back to the golden set

*Page coming soon.*

This concept sits in **Stage 7 (Interview craft)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
