---
concept_id: 36
slug: frameworks-vs-bare-metal
title: "Frameworks vs bare-metal: LangChain, LangGraph, LlamaIndex, custom"
tease: "Frameworks vs bare-metal: LangChain, LangGraph, LlamaIndex, custom"
section: "Agents and tool use"
status: draft
---

The framework debate is older than the field. LangChain optimises for prototyping. LangGraph optimises for stateful workflows. LlamaIndex optimises for RAG. Bare-metal optimises for understanding what your code does. Most senior engineers ship custom thin wrappers and pick framework pieces sparingly.

```mermaid
flowchart TB
    C[("Codebase")]:::a --> F1[("LangChain: chains & agents")]:::g
    C --> F2[("LangGraph: stateful flows")]:::g
    C --> F3[("LlamaIndex: RAG-first")]:::g
    C --> BM[("Bare-metal: direct SDK")]:::y
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
```

**What this page will cover.**

- What each framework is actually good at
- The hidden cost of abstraction layers in LLM code
- When LangGraph's state machine is the right tool
- When the SDK and 200 lines is the right tool
- Avoiding the common framework anti-patterns

*Page coming soon.*

This concept sits in **Stage 4 (Agents and tool use)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
