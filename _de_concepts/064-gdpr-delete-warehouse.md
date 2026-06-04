---
concept_id: 64
slug: gdpr-delete-warehouse
title: "GDPR right-to-delete in a columnar warehouse"
tease: "A user asks to be forgotten. You have their data in 47 tables. Now what?"
section: "Security & Privacy"
status: draft
---

GDPR Article 17 ("right to erasure") gives users the right to have their personal data deleted. Sounds simple. Becomes one of the hardest engineering problems in a data warehouse, because the user's data is in fact tables, dimension tables, raw landing zones, archived files, backups, and probably a dashboard cache somewhere.

```mermaid
flowchart LR
    Req[("Delete request:<br/>user_id = 12345")]:::r
    Req --> Live["Live tables<br/>(DELETE / UPDATE)"]:::g
    Req --> Hist["Historical / SCD type 2<br/>(redact, keep row)"]:::y
    Req --> Raw["Raw landing files<br/>(rewrite Parquet)"]:::y
    Req --> Bak["Backups<br/>(out of scope or<br/>delete on next cycle)"]:::y
    Req --> Audit[("Audit log:<br/>request, who acted, when")]:::a

    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

**What this page will cover.**

- The 30-day window: GDPR allows reasonable time, not instant.
- The "what to delete vs what to retain" decision: legal retention can outweigh deletion.
- Hard delete vs redact (overwrite with NULL or `[DELETED]`).
- Lakehouse formats (Delta, Iceberg) and their `DELETE FROM` support.
- Raw Parquet: rewriting partition files is the only path.
- The vault approach: delete the token-to-real mapping, and the warehouse is effectively anonymised.

*Page coming soon. Until then, see [#083 PII masking and right to be forgotten](/practice/data-engineering/083-pii-masking-and-right-to-be-forgotten/) for the practice problem.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
