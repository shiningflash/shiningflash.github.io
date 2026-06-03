---
concept_id: 74
slug: websockets-vs-sse-vs-polling
title: "WebSockets vs Server-Sent Events vs long polling"
tease: "Three ways to push data to a client, and which one you actually want."
section: "Foundations"
status: draft
---

If the server needs to tell the browser that something changed, you have three real options: have the browser keep asking (polling), have the browser keep a connection open one way (Server-Sent Events), or have both sides hold a connection that talks in either direction (WebSockets). The choice shapes everything else: how many concurrent connections your gateway can hold, how you survive a network blip, whether you can run behind plain HTTP/2 infrastructure, and how badly your bill scales. This page will walk through the three protocols, the latency and resource trade-offs at 1K / 100K / 10M concurrent users, when SSE is the quietly correct answer (live dashboards, server-to-client streams), why WebSockets dominate chat and collaborative apps, the reconnection patterns that actually work, and how WebSocket gateways like the one in the chat-system problem handle disconnects without losing messages.

*Page coming soon.*
