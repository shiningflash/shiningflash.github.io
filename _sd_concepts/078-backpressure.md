---
concept_id: 78
slug: backpressure
title: "Backpressure and flow control"
tease: "What a slow consumer should do to a fast producer that doesn't take 'no' for an answer."
section: "Reliability"
status: draft
---

A fast producer pointed at a slow consumer is the most boring outage to debug and the easiest one to ship. The queue between them fills, memory grows, the next service in the chain inherits the pressure, and eventually something falls over. Backpressure is the umbrella term for everything you can do at the consumer to tell the producer "slow down": blocking the producer until you're ready (TCP-style flow control), bounded queues with rejection (HTTP 429, Kafka quotas), credit-based protocols (Reactive Streams, gRPC), or dropping load at the edge before it enters the system at all (load shedding). This page will walk through the four strategies, when each is the right answer, why "infinite buffers" is the textbook wrong answer that production systems still ship with, how to measure backpressure (queue depth, time-in-queue, rejection rate), and the canonical patterns in Kafka, gRPC, and Reactive frameworks.

*Page coming soon.*
