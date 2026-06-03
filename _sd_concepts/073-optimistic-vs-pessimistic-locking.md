---
concept_id: 73
slug: optimistic-vs-pessimistic-locking
title: "Optimistic vs pessimistic locking"
tease: "When to lock the row, when to bet that nobody else will, and how to detect the bet you lost."
section: "Databases"
status: draft
---

Two writers want the same row. The pessimistic approach locks the row the moment the first writer reads it, blocks the second one, and serialises them at the cost of throughput. The optimistic approach lets both read freely, then checks at commit time whether anyone else changed the row in between, and rolls one back if so. Both are correct. Both have failure modes. This page will cover when each fits, how to implement optimistic locking with a `version` column or `xmin` check, how `SELECT FOR UPDATE` and `SELECT FOR SHARE` actually behave, the difference between row, page, and table locks, deadlock detection, lock escalation in SQL Server vs Postgres, and why you almost always want optimistic locking for user-facing writes and pessimistic for batch jobs.

*Page coming soon.*
