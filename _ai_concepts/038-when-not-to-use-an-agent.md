---
concept_id: 38
slug: when-not-to-use-an-agent
title: "When NOT to use an agent: the prompt chain that solves it instead"
tease: "When NOT to use an agent: the prompt chain that solves it instead"
section: "Agents and tool use"
status: draft
---

Agents are the most over-applied pattern in AI engineering. A static prompt chain (do A, then B, then C) is cheaper, faster, more debuggable, and produces better results for any task with a known structure. Reach for an agent only when the steps genuinely depend on the previous step's outcome.

```mermaid
flowchart LR
    T[("Task")]:::a --> S{"Steps known<br/>in advance?"}:::y
    S -->|yes| C[("Static prompt chain")]:::g
    S -->|no| A[("Agent loop")]:::v
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The deterministic-flow test: if steps are known, skip the agent
- Pipeline vs agent vs router: picking the right shape
- Cost and debuggability differences
- Examples where teams reached for agents and regretted it
- When the agent is genuinely the right answer

*Page coming soon.*

This concept sits in **Stage 4 (Agents and tool use)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
