---
concept_id: 56
slug: pii-redaction-and-data-residency
title: "PII redaction and data residency: keeping the LLM out of the audit log"
tease: "PII redaction and data residency: keeping the LLM out of the audit log"
section: "Production AI systems"
status: draft
---

Sending PII to a third-party model has legal consequences. Redaction at the boundary, residency controls on the provider, and a clear separation between what the model sees and what gets logged are the standard pattern. Skipping this work is a GDPR or HIPAA incident waiting to happen.

```mermaid
flowchart LR
    U[("User input with PII")]:::a --> R[/"Redactor"/]:::v
    R --> S[("Sanitised input")]:::g
    S --> M[/"Model"/]:::v
    M --> O[("Sanitised output")]:::g
    O --> H[/"Rehydrate placeholders"/]:::v
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- What counts as PII in your jurisdiction
- Redact-and-rehydrate as the standard pattern
- Provider residency: EU, US, on-prem options
- Logging policy: what gets stored, what gets hashed, what gets dropped
- GDPR, HIPAA, and the AI Act in one paragraph each

*Page coming soon.*

This concept sits in **Stage 6 (Production AI systems)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
