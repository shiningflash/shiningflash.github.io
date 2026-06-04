---
concept_id: 62
slug: column-masking
title: "Column masking and dynamic data masking"
tease: "Email addresses show as a***@example.com unless you're allowed to see the real thing."
section: "Security & Privacy"
status: draft
---

Column masking replaces a sensitive column's value at query time with a masked or tokenised version, depending on who is asking. An analyst sees `a***@example.com`. A compliance officer sees the real email. The masking is enforced by the warehouse, not by the application, so the original value never leaks into a downstream BI tool by accident.

```mermaid
flowchart LR
    Q["SELECT email FROM customers"]:::q
    Q --> U1["analyst (no PII access)"]:::u --> M1[("a***@example.com")]:::g
    Q --> U2["compliance (full access)"]:::u --> M2[("alice@example.com")]:::r

    classDef q fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef u fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Snowflake masking policies (`CREATE MASKING POLICY`).
- BigQuery column-level access control + data masking.
- Databricks dynamic views and column-level security.
- Common masks: redact (`***`), partial (`first 3 chars + ***`), hash, tokenise.
- The "join through a masked column" trap and how each warehouse handles it.
- The audit log: who queried what unmasked, when.

*Page coming soon. Until then, see [#083 PII masking and right to be forgotten](/practice/data-engineering/083-pii-masking-and-right-to-be-forgotten/) for the practice problem.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
