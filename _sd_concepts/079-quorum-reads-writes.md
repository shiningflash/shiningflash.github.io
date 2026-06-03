---
concept_id: 79
slug: quorum-reads-writes
title: "Quorum reads and writes (R + W > N)"
tease: "Tunable consistency the Dynamo way — pick how strict you want to be, per query."
section: "Consistency & Distribution"
status: draft
---

A replicated store has N copies of each piece of data. A write succeeds when W of them acknowledge. A read returns whatever the freshest of R of them says. If R + W > N, every read overlaps every recent write, so reads are guaranteed to see them. If R + W ≤ N, reads can lag — and sometimes that is exactly what you want, because reads are faster and writes are cheaper. This page will walk through the maths plainly, the canonical settings (N=3, W=2, R=2 is the default in DynamoDB and Cassandra and explains why), how sloppy quorums and hinted handoff make the system available during partial failures, where the model breaks (read repair, conflict resolution, last-writer-wins is not what you think), how this maps onto Dynamo, Cassandra, ScyllaDB, and Riak, and the rule of thumb for when you tune R and W per query instead of per cluster.

*Page coming soon.*
