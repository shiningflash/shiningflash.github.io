---
concept_id: 40
slug: golden-datasets
title: "Golden datasets: the most valuable asset on the team"
tease: "Golden datasets: the most valuable asset on the team"
section: "Evaluation"
status: draft
---

A golden dataset is a curated set of inputs and expected behaviour. It is the closest thing an AI team has to a test suite. Building one is slow, boring, and one of the most useful things a senior can spend a week on. Without it, every prompt change is a vibe check.

```mermaid
flowchart LR
    P[("Production logs")]:::a --> S[/"Sample + label"/]:::v
    S --> G[("Golden set:<br/>inputs + expected behaviour")]:::g
    G --> E[/"Eval runs"/]:::v
    E --> D[("Decisions")]:::b
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- What belongs in a golden set: easy cases, hard cases, regressions
- Starting small: 30 examples is enough to begin
- Curating from production logs without leaking PII
- Versioning the golden set as code
- When to expand and when to prune

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
