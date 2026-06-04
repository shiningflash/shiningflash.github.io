---
concept_id: 39
slug: the-non-determinism-problem
title: "The non-determinism problem: why assert breaks LLM tests"
tease: "The non-determinism problem: why assert breaks LLM tests"
section: "Evaluation"
status: draft
---

A function returning '42' is easy to test. A model returning 'The answer is 42' or 'forty-two' or 'After some thought, 42' is not. Exact-match assertions break. The whole field of LLM eval exists because the output is text and the test has to be tolerant without being meaningless.

```mermaid
flowchart LR
    P[("Prompt")]:::a --> R1[("Run 1: 'The answer is 42'")]:::y
    P --> R2[("Run 2: 'It's 42.'")]:::y
    P --> R3[("Run 3: 'Forty-two.'")]:::y
    R1 --> A[/"assert == '42'?"/]:::r
    R2 --> A
    R3 --> A
    A --> F[("All fail")]:::r
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Why exact-match tests do not work for LLM output
- The three eval families: rule-based, judge-based, reference-free
- Why `temperature=0` does not actually solve this
- How to think about flakiness as signal, not noise
- What a 'passing test' even means in an LLM context

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
