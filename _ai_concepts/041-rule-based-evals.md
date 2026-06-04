---
concept_id: 41
slug: rule-based-evals
title: "Rule-based evals: regex, schema, exact match, cheap and deterministic"
tease: "Rule-based evals: regex, schema, exact match, cheap and deterministic"
section: "Evaluation"
status: draft
---

Before reaching for an LLM judge, exhaust the cheap deterministic checks. Does the output parse as JSON? Does it contain a required keyword? Does it match a regex? Rule-based evals are fast, free, reproducible, and catch most regressions. Save the judge for what rules cannot do.

```mermaid
flowchart LR
    O[("Model output")]:::a --> S[/"Schema check"/]:::v
    O --> R[/"Regex check"/]:::v
    O --> K[/"Keyword check"/]:::v
    S --> P{"Pass?"}:::y
    R --> P
    K --> P
    P -->|yes| OK[("Pass")]:::g
    P -->|no| F[("Fail")]:::y
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- When rule-based evals are enough
- Common rules: JSON validity, schema, keyword, length, format
- Composing rules into a single pass/fail per example
- Why rule-based evals belong in CI
- Where they break down and the judge takes over

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
