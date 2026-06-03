---
concept_id: 80
slug: materialized-views
title: "Materialized views"
tease: "A view that's actually a table, refreshed on a schedule or by trigger."
section: "Databases"
status: draft
---

A regular view rewrites your query each time you read it. A materialized view runs the query once, stores the result as a real table, and you read that table directly. You trade staleness for speed. For read-heavy dashboards, leaderboards, aggregations, joins across denormalised tables, this can be the difference between a 12-second query and a 12-millisecond query, with no application change. This page will walk through the implementation styles (full refresh, incremental refresh, transactional materialization), the trade-offs in Postgres vs Snowflake vs BigQuery vs ClickHouse, when a materialized view is the right answer vs a separate read replica vs a denormalised cache vs CDC into a search index, the operational concerns (refresh windows, lock behaviour, what happens when the underlying schema changes), and the failure mode every team hits at least once: the materialized view that quietly stops refreshing and serves stale data for two weeks before anyone notices.

*Page coming soon.*
