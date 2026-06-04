---
concept_id: 52
slug: open-vs-closed-models
title: "Open vs closed models: when self-hosting actually pays off"
tease: "Open vs closed models: when self-hosting actually pays off"
section: "Production AI systems"
status: draft
---

Open-weights models are great, free, and not free. Self-hosting buys you privacy, residency, and customisation. It costs you GPU bills, ops time, and a quality gap to the top closed models. The break-even is at higher volumes than vendors imply and lower than self-hosting evangelists imply.

```mermaid
flowchart LR
    N[("Need")]:::a --> C{"Residency or<br/>custom weights?"}:::y
    C -->|yes| O[("Self-host open model")]:::g
    C -->|no| API[("Hosted API")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
```

**What this page will cover.**

- What you actually get from open-weights vs hosted
- Cost model: GPU rental, utilisation, ops overhead
- Quality gap as of 2026 between top open and top closed
- Compliance, residency, audit as the real driver
- Hybrid: closed model in front, open model for fallback or specific tasks

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
