---
concept_id: 72
slug: transactions-isolation-levels
title: "Transactions and isolation levels"
tease: "Read committed, repeatable read, serializable, snapshot — what each protects against."
section: "Databases"
status: draft
---

A transaction is the database's promise that a group of operations either all happen or none of them happen, and that other transactions running at the same time will not see your half-finished work. Isolation levels are the dial that controls how serious that second promise actually is, and they all sit on a spectrum between "fast and slightly wrong" and "correct but slower". This page will walk through Read Uncommitted, Read Committed, Repeatable Read, Serializable, and Snapshot Isolation, the three anomalies they each prevent (dirty reads, non-repeatable reads, phantom reads), how MVCC implements most of this in Postgres, where the defaults are dangerous, and the rule of thumb for picking a level for a real workload.

*Page coming soon.*
