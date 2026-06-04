---
concept_id: 4
slug: join-shapes
title: "The seven JOIN shapes (and which one you actually wanted)"
tease: "Inner, left, right, full, cross, semi, anti — each has a job."
section: "SQL Foundations"
status: draft
---

Most people use `INNER JOIN` and `LEFT JOIN`. That covers 80% of cases. The other five join shapes exist because there are five questions SQL needs to answer cleanly, and faking them with the first two leads to subtle bugs.

```mermaid
flowchart LR
    A["INNER JOIN<br/>both sides match"]:::g
    B["LEFT JOIN<br/>everything left + matching right"]:::g
    C["RIGHT JOIN<br/>everything right + matching left"]:::g
    D["FULL JOIN<br/>everything from both"]:::g
    E["CROSS JOIN<br/>every left × every right"]:::y
    F["SEMI JOIN<br/>left rows that have a match (no right cols)"]:::b
    G["ANTI JOIN<br/>left rows with NO match"]:::r

    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef b fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef r fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

**What this page will cover.**

- Each join shape with one concrete question it answers ("which customers placed an order this month?").
- `EXISTS` and `NOT EXISTS` as the SQL way to write semi and anti joins.
- The `IN` vs `EXISTS` vs `LEFT JOIN ... WHERE IS NULL` debate, settled.
- Why `CROSS JOIN` is sometimes the right answer and not a bug.
- The duplicate-row trap when you join on a non-unique key.
- How the planner picks hash vs nested-loop vs merge join.

*Page coming soon. Until then, see [#016 SELECT DISTINCT hiding join bugs](/practice/data-engineering/016-select-distinct-hiding-join-bugs/) for one of the most common JOIN traps.*

This concept sits in **Stage 1 (SQL fundamentals)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
