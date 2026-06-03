---
concept_id: 81
slug: batch-vs-stream
title: "Batch vs stream processing (Lambda vs Kappa)"
tease: "Two ways to compute the same number, and the architecture that picks both."
section: "Messaging & Events"
status: draft
---

Batch processes a finite chunk of data on a schedule: yesterday's sales, last hour's logs, this month's invoices. Stream processes an unbounded sequence of events as they arrive: every click, every transaction, every sensor reading. Most real systems need both — batch for the canonical, replayable, expensive-but-accurate computation, stream for the up-to-the-second view your dashboard reads. The Lambda architecture runs them in parallel and reconciles. The Kappa architecture skips batch entirely and treats everything as a replayable stream. This page will walk through both, the watermark / event-time / processing-time distinction that makes streaming non-trivial, why exactly-once is more nuance than promise, the canonical tools (Spark batch + structured streaming, Flink, Beam, Kafka Streams, dbt for batch transforms), how a real architecture lets you change your mind between batch and stream without rewriting the pipeline, and where each style breaks down.

*Page coming soon.*
