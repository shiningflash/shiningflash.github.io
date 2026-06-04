---
concept_id: 55
slug: data-sli-slo-error-budgets
title: "SLI / SLO / error budgets for data"
tease: "The SRE vocabulary, applied to pipelines. The 'how fresh, how correct, how much is acceptable' contract."
section: "Observability & SLOs"
status: draft
---

In software, an SLI is what you measure (latency, error rate). An SLO is the target (99.9% of requests under 300ms). An error budget is what is left (0.1% can be late or wrong). For data, the same vocabulary applies but the SLIs are different: freshness, completeness, accuracy. The data team has not adopted this as widely as it should.

```mermaid
flowchart LR
    SLI["SLI: 'data freshness'<br/>(measured: max(loaded_at) lag)"]:::a
    SLO["SLO: 'fresh within 2 hours, 99% of days'"]:::b
    EB["Error budget: 3 days per year<br/>can miss the SLO"]:::g
    SLI --> SLO --> EB

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef g fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

**What this page will cover.**

- The three SLI categories that fit data: freshness, completeness (no rows missing), accuracy (no rows wrong).
- Picking an SLO that matches user expectations, not an aspirational round number.
- The error budget conversation: when you run out, you slow down on features and harden the pipeline.
- The "burn rate" alert: 14-day window vs 1-hour window for fast vs slow burns.
- Why every dashboard owner should be told the SLO for the data behind it.
- The cross-link to [SD #077 SLI, SLO, SLA, and error budgets](/practice/system-design/concepts/077-sli-slo-sla-error-budgets/) for the general framing.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
