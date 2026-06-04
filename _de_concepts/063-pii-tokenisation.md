---
concept_id: 63
slug: pii-tokenisation
title: "PII tokenisation and pseudonymisation"
tease: "Replace the email with a stable random token. Keep the analytics. Lose the leak."
section: "Security & Privacy"
status: draft
---

Tokenisation replaces a piece of personal data with a stable, random-looking token: `alice@example.com` becomes `tok_8f3a2b1c`. The token is consistent (the same email always produces the same token) so joins still work. The original value lives only in a vault. The warehouse holds tokens. If the warehouse leaks, the leak does not include PII.

```mermaid
flowchart LR
    Src[("Source: alice@example.com")]:::a --> Tok[/"Tokeniser"/]:::t
    Tok --> Vault[("Vault: token ↔ real email")]:::v
    Tok --> WH[("Warehouse: tok_8f3a2b1c")]:::g
    WH --> Q["Analytics queries (no PII)"]:::ok

    classDef a fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef t fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef v fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef g fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef ok fill:#bbf7d0,stroke:#16a34a,color:#14532d
```

**What this page will cover.**

- Tokenisation vs hashing vs encryption: when to use each.
- Deterministic vs random tokens (and why analytics needs deterministic).
- Format-preserving encryption (FPE) when systems need the token to look like the original.
- The vault: who has access, how it is logged, what audit trail it produces.
- Re-identification: when you legitimately need to look up the real value.
- The GDPR connection: tokenisation is recommended; pseudonymisation is a specific legal term.

*Page coming soon.*

This concept sits in **Stage 6 (Reliability, debugging, cost)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
