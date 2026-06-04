---
concept_id: 54
slug: prompt-injection-defences
title: "Prompt injection defences: layered, never trust user input"
tease: "Prompt injection defences: layered, never trust user input"
section: "Production AI systems"
status: draft
---

Prompt injection has no single fix. The defence is layered: untrusted-content delimiters, output validation, separate models for parsing vs acting, least-privilege tools, and human-in-the-loop on destructive actions. Each layer catches a different class of attack. Skipping any one of them is how you get embarrassed.

```mermaid
flowchart TB
    I[("User / retrieved input")]:::r --> D[/"Delimit + tag as untrusted"/]:::v
    D --> M[/"Model 1: parse intent"/]:::v
    M --> V[/"Output validator"/]:::v
    V --> T[/"Tool call (least-privilege)"/]:::v
    T --> H{"Destructive?"}:::y
    H -->|yes| HU[/"Human approval"/]:::v
    H -->|no| E[("Execute")]:::g
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- Layered defence: no single mitigation is enough
- Tagging untrusted content and what models actually respect
- Dual-LLM pattern: parse with one, act with another
- Least-privilege tool design
- Human-in-the-loop for destructive actions

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
