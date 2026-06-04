---
concept_id: 44
slug: rag-specific-evals
title: "RAG-specific evals: recall@K, faithfulness, context precision"
tease: "RAG-specific evals: recall@K, faithfulness, context precision"
section: "Evaluation"
status: draft
---

A RAG system can fail at retrieval, generation, or both. The eval suite has to separate them. Recall@K asks if retrieval found the right chunk. Faithfulness asks if generation stuck to the retrieved context. Context precision asks if the retrieved chunks were actually relevant. Without these three you cannot debug RAG.

```mermaid
flowchart LR
    Q[("Query")]:::a --> R[/"Retrieve"/]:::v
    R --> K[("Top-K chunks")]:::y
    K --> G[/"Generate"/]:::v
    G --> A[("Answer")]:::g
    R -.-> M1[("Recall@K")]:::b
    K -.-> M2[("Context precision")]:::b
    A -.-> M3[("Faithfulness")]:::b
    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef b fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef y fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

**What this page will cover.**

- The three RAG metrics and why you need all of them
- Separating retrieval failures from generation failures
- Building a retrieval golden set vs an answer golden set
- Context precision as the early warning for chunking problems
- Hooking the metrics into CI so regressions block merges

*Page coming soon.*

This concept sits in **Stage 5 (Evaluation)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
