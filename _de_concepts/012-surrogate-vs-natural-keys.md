---
concept_id: 12
slug: surrogate-vs-natural-keys
title: "Surrogate keys vs natural keys"
tease: "When the warehouse owns the key, vs when the source does."
section: "Data Modeling"
status: draft
---

A natural key is the ID the business already has: an order number, an email address, a SKU. A surrogate key is a meaningless integer (or UUID) the warehouse generates. Both work. Picking the right one per table is one of those quiet modeling decisions that matters more than it looks.

```mermaid
flowchart LR
    NK["Natural key<br/>'AB-2026-00342'"]:::a --> Pro1["Human-readable<br/>Joinable to source"]
    NK --> Con1["Changes when source changes<br/>Often longer in storage"]
    SK["Surrogate key<br/>871429"]:::b --> Pro2["Stable forever<br/>Tiny in storage<br/>Needed for SCD Type 2"]
    SK --> Con2["No meaning to humans<br/>Extra lookup to find a row"]

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- Why dimension tables with Type 2 SCD must use surrogate keys (the natural key is no longer unique).
- The fact-table convention: surrogate keys to dimensions, natural key as a "degenerate dimension".
- Auto-incrementing vs hash-based surrogate keys (and why hash beats auto-increment for distributed warehouses).
- Composite natural keys: when one column isn't enough.
- The trap of using emails or phone numbers as natural keys (they change).

*Page coming soon.*

This concept sits in **Stage 2 (Data modeling and warehousing)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
