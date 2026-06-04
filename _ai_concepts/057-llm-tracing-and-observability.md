---
concept_id: 57
slug: llm-tracing-and-observability
title: "LLM tracing and observability: end-to-end spans across model calls"
tease: "LLM tracing and observability: end-to-end spans across model calls"
section: "Production AI systems"
status: draft
---

A single user request can fan out to embedding calls, retrieval, multiple model calls, and tool invocations. Without tracing, debugging a slow or wrong answer is guesswork. OpenTelemetry-style spans with prompt, completion, latency, and cost per call is the table stakes setup.

```mermaid
flowchart LR
    U[("User request")]:::a --> T[/"Trace root"/]:::v
    T --> E[/"Embedding span"/]:::v
    T --> R[/"Retrieval span"/]:::v
    T --> L1[/"LLM span 1"/]:::v
    T --> L2[/"LLM span 2"/]:::v
    L1 --> TL[("Tool call span")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- What a good LLM span contains
- OpenTelemetry semantic conventions for LLMs
- Tools: LangSmith, Phoenix, Langfuse, Braintrust, Honeycomb
- Correlating cost and quality at the span level
- Sampling strategies for high-volume systems

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
