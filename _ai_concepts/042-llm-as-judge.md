---
concept_id: 42
slug: llm-as-judge
title: "LLM-as-judge: picking a judge, calibrating it, the judge as its own product"
tease: "LLM-as-judge: picking a judge, calibrating it, the judge as its own product"
section: "Evaluation"
status: draft
---

When rules cannot answer 'is this answer good?', a model can. LLM-as-judge is one prompt scoring another model's output. Done well it correlates with human judgement. Done poorly it produces correlated bias and a false sense of progress. The judge is its own product and needs its own evaluation.

```mermaid
flowchart LR
    O[("Model output")]:::a --> J[/"Judge model + rubric"/]:::v
    R[("Reference / question")]:::a --> J
    J --> S[("Score + reasoning")]:::g
    S --> H[/"Calibrate against human labels"/]:::v
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- When to reach for a judge vs rules
- Picking a judge model: bigger than the system under test
- Rubric design: clear criteria, calibration examples
- Calibrating judge agreement against human labels
- Known biases (position, length, self-preference)

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
