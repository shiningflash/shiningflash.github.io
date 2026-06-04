---
concept_id: 47
slug: volume-tests-anomaly
title: "Volume tests and anomaly detection"
tease: "Yesterday: 5 million rows. Today: 1.2 million. Something broke. Catch it before users notice."
section: "Data Quality & Contracts"
status: draft
---

A volume test compares today's row count against expected. The expectation can be a hard threshold ("at least 1,000,000 rows") or a statistical bound ("within 3 standard deviations of the trailing 30-day average"). Sudden drops mean a source died. Sudden jumps mean a duplicate load. Both should page someone.

```mermaid
flowchart LR
    Today["Today: 1.2M rows"]:::t
    Hist["History: avg 5.1M ± 200K (last 30 days)"]:::h
    Today --> Check{"Within 3σ?"}:::q
    Hist --> Check
    Check -->|"yes"| Pass[("OK")]:::g
    Check -->|"no"| Alert[("Anomaly → page")]:::r

    classDef t fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef h fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef q fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef g fill:#bbf7d0,stroke:#16a34a,color:#14532d
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Hard threshold vs rolling-window vs ML-based anomaly detection.
- The "trailing 30 days" rule and why it adapts to seasonality automatically.
- Per-source vs aggregated volume tests: where each catches different bugs.
- The duplicate-load signature: row count exactly doubles.
- Quiet failure detection: zero-row days that pass freshness but fail volume.
- Tools that ship anomaly detection out of the box (Monte Carlo, Anomalo, Soda, Elementary).

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
