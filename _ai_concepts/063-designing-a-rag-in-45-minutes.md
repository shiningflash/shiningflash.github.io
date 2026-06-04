---
concept_id: 63
slug: designing-a-rag-in-45-minutes
title: "Designing a RAG in 45 minutes: the senior outline"
tease: "Designing a RAG in 45 minutes: the senior outline"
section: "Interview craft"
status: draft
---

If you can sketch a production RAG system in 45 minutes, end to end, you have the senior signal. The outline is the same every time: scope, data, chunking, embedding, store, retrieval, generation, eval, failure modes, cost. Knowing the outline lets you spend the time on the parts the interviewer cares about.

```mermaid
flowchart LR
    S[("Scope")]:::a --> D[("Data + chunking")]:::g
    D --> E[("Embed + store")]:::g
    E --> R[("Retrieve + rerank")]:::g
    R --> G[("Generate + cite")]:::g
    G --> EV[("Eval + monitoring")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The seven-block outline you can draw in 90 seconds
- Which blocks senior interviewers probe and why
- Numbers to know: chunk size, top-K, embedding cost
- Where to volunteer tradeoffs the interviewer has not asked for
- Common interview RAG prompts and the canonical answers

*Page coming soon.*

This concept sits in **Stage 7 (Interview craft)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
