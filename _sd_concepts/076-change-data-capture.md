---
concept_id: 76
slug: change-data-capture
title: "Change Data Capture (CDC)"
tease: "Stream every change out of your database without dual writes."
section: "Databases"
status: draft
---

CDC lets one team write to a database and lets every other team see those writes as a stream of events, in order, with at-least-once delivery. It is the modern alternative to dual writes (write to DB and Kafka and pray) and to polling-with-`updated_at` (slow, misses deletes, breaks under load). This page will cover the two implementation styles (log-based CDC reading from the WAL, and trigger-based for databases that do not expose a log), why log-based is almost always what you want, how Debezium plugs into Postgres logical replication / MySQL binlog / SQL Server CDC, the outbox pattern that makes "publish an event when this DB transaction commits" actually atomic, the operational edges (slot bloat, replication lag, schema changes, exactly-once illusions), and where CDC sits in a real architecture vs Kafka producers and CDC vs ETL.

*Page coming soon.*
