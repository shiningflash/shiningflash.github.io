---
concept_id: 45
slug: eval-tooling
title: "Eval tooling: Ragas, Promptfoo, Braintrust, LangSmith, Phoenix"
tease: "Eval tooling: Ragas, Promptfoo, Braintrust, LangSmith, Phoenix"
section: "Evaluation"
status: draft
---

The eval tooling space changed twice in 2025 and will change again. The honest map: Ragas for RAG metrics, Promptfoo for prompt sweeps and CI, Braintrust and LangSmith for hosted runs, Phoenix for open-source tracing. Pick one for batch evals and one for tracing; everything else is optional.

```mermaid
flowchart LR
    E[("Eval need")]:::a --> B[("Batch suite:<br/>Ragas / Promptfoo")]:::g
    E --> H[("Hosted runs:<br/>Braintrust / LangSmith")]:::g
    E --> T[("Tracing:<br/>Phoenix / LangSmith")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- What each tool is genuinely good at
- Batch suite vs hosted vs tracing as orthogonal needs
- Open-source vs hosted: where to draw the line
- Integrating with CI: what to fail builds on
- Migrating between tools without re-curating your golden set

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
