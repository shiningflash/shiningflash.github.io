---
concept_id: 47
slug: streaming-ux
title: "Streaming UX: perceived latency, partial rendering, when to start the stream"
tease: "Streaming UX: perceived latency, partial rendering, when to start the stream"
section: "Production AI systems"
status: draft
---

Streaming is a UX feature, not just a backend feature. The decisions are when to start showing tokens, how to render partial output, what to do on cancellation, and how to handle JSON or tool calls that need to be complete before they make sense. Done well it feels instant. Done badly it flickers.

```mermaid
flowchart LR
    R[("Request")]:::a --> M[/"Model streaming"/]:::v
    M --> P[("Partial tokens")]:::y
    P --> U[/"UI buffer + flush"/]:::v
    U --> D[("Displayed text")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- When to start the stream vs wait for first sentence
- Smoothing token bursts on the client
- Cancellation and partial-billing for cut streams
- Streaming structured output: defer rendering until valid
- Streaming tool calls without leaking half-built JSON

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
