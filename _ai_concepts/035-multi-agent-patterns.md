---
concept_id: 35
slug: multi-agent-patterns
title: "Multi-agent patterns: why most should be a router, not a debate"
tease: "Multi-agent patterns: why most should be a router, not a debate"
section: "Agents and tool use"
status: draft
---

Multi-agent setups are fashionable and usually unnecessary. The pattern that actually pays off is a router: one model classifies the request and dispatches to a specialised handler. Debate, swarm, hierarchical-team designs sound impressive and rarely beat a single well-prompted model.

```mermaid
flowchart LR
    Q[("Query")]:::a --> R[/"Router agent"/]:::v
    R --> S1[("Specialist A")]:::g
    R --> S2[("Specialist B")]:::g
    R --> S3[("Specialist C")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- Router pattern: the one multi-agent shape that earns its complexity
- Why debate and swarm rarely beat a single model
- Specialist agents with smaller, focused prompts
- Handoff protocols between agents
- When multi-agent is genuinely the right call

*Page coming soon.*

This concept sits in **Stage 4 (Agents and tool use)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
