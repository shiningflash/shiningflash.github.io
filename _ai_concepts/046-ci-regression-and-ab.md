---
concept_id: 46
slug: ci-regression-and-ab
title: "CI regression and A/B in production: fail the build, shadow the traffic"
tease: "CI regression and A/B in production: fail the build, shadow the traffic"
section: "Evaluation"
status: draft
---

Two eval moments matter: CI before merge and A/B in production after deploy. CI catches regressions on the golden set. A/B catches what the golden set missed. Without both, every release is a guess. With both, prompt changes feel like normal code changes.

```mermaid
flowchart LR
    PR[("PR")]:::a --> CI[/"Golden-set CI run"/]:::v
    CI -->|pass| D[("Deploy to shadow")]:::g
    D --> AB[/"Shadow A/B in prod"/]:::v
    AB -->|win| F[("Roll forward")]:::g
    AB -->|loss| R[("Roll back")]:::y
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- What to fail the CI build on
- Shadow traffic: comparing old and new without user impact
- Online A/B for LLM outputs: what metrics actually move
- Rollback as a first-class operation
- Closing the loop: production fails become golden-set entries

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
