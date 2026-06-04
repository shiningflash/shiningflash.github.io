---
concept_id: 60
slug: cost-attribution
title: "Cost attribution per request, per user, per feature"
tease: "Cost attribution per request, per user, per feature"
section: "Production AI systems"
status: draft
---

A monthly bill from a provider tells you nothing actionable. A per-request, per-user, per-feature cost number tells you everything. Building this attribution early is cheap. Building it after a budget surprise is painful and incomplete.

```mermaid
flowchart LR
    R[("Request")]:::a --> T[/"Tagging middleware"/]:::v
    T --> M[/"LLM call"/]:::v
    M --> L[("Span with tokens + cost")]:::g
    L --> D[("Aggregations:<br/>per user, feature, tenant")]:::b
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- What tags every LLM call should carry
- Per-user vs per-feature vs per-tenant attribution
- Tying cost to revenue or business value
- Dashboards and alerts on cost-per-active-user
- Detecting the abusive user before the bill arrives

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
