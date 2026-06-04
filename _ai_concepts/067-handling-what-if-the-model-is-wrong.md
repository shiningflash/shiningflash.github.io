---
concept_id: 67
slug: handling-what-if-the-model-is-wrong
title: "Handling 'what if the model is wrong?' with layered defence"
tease: "Handling 'what if the model is wrong?' with layered defence"
section: "Interview craft"
status: draft
---

Every senior interview includes 'what if the model returns the wrong answer?' The bad answer is 'we'll tune the prompt.' The good answer is layered: validation at the output, confirmation for destructive actions, citations for traceability, eval to catch the class of failure, monitoring to detect it in production.

```mermaid
flowchart TB
    O[("Model output")]:::a --> V[("Validation")]:::g
    O --> CF[("Confirmation for risky actions")]:::g
    O --> C[("Citations")]:::g
    O --> E[("Eval coverage")]:::g
    O --> M[("Production monitoring")]:::g
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
```

**What this page will cover.**

- The five layers of defence against wrong answers
- Why prompt tuning alone is the wrong reply
- Citations as a UX commitment
- Eval coverage for the class of failure
- Monitoring for the patterns evals will not catch

*Page coming soon.*

This concept sits in **Stage 7 (Interview craft)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
