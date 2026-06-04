---
concept_id: 34
slug: memory-and-state
title: "Agent memory and state: short-term, session, persistent"
tease: "Agent memory and state: short-term, session, persistent"
section: "Agents and tool use"
status: draft
---

Agents have three kinds of memory: the current scratchpad, the current session, and persistent user-level memory. Most teams build the first one accidentally, the second one badly, and the third one not at all. Each has a different purpose and a different storage choice.

```mermaid
flowchart TB
    A[("Agent run")]:::a --> S[("Short-term:<br/>current step scratchpad")]:::g
    A --> SE[("Session:<br/>this conversation")]:::g
    A --> P[("Persistent:<br/>across sessions")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- Three layers of memory and what each one is for
- When session memory needs summarisation vs full retention
- Persistent memory: when it earns the privacy headache
- Memory as retrieval: embedding past turns and looking them up
- Forgetting on purpose: TTLs and explicit deletion

*Page coming soon.*

This concept sits in **Stage 4 (Agents and tool use)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
