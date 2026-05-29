---
concept_id: 62
slug: object-storage-s3-gcs-blob
title: "Object storage: S3 vs GCS vs Azure Blob"
tease: "Consistency, durability, lifecycle, cost models."
section: "Cloud Comparisons"
status: live
---

All three are "infinite buckets of files." The interface is essentially the same: put an object with a key, get it back later, list by prefix. The differences are in pricing tiers, lifecycle automation, consistency guarantees that historically diverged but have now converged, and the surrounding ecosystem (IAM, signed URLs, event triggers). S3 set the template; the others followed but with their own quirks.

## The three at a glance

```mermaid
flowchart TB
    subgraph S3["AWS S3"]
        direction LR
        S1[("11 nines of durability")]:::server
        S2[("strong read-after-write since 2020")]:::server
        S3a[("rich storage classes:<br/>Standard, IA, One Zone, Glacier, Deep Archive")]:::server
    end

    subgraph GCS["Google Cloud Storage"]
        direction LR
        G1[("11 nines of durability")]:::server
        G2[("strong consistency from day one")]:::server
        G3a[("classes:<br/>Standard, Nearline, Coldline, Archive")]:::server
    end

    subgraph BLOB["Azure Blob Storage"]
        direction LR
        B1[("11+ nines of durability<br/>(varies with redundancy)")]:::server
        B2[("strong consistency")]:::server
        B3[("tiers:<br/>Hot, Cool, Cold, Archive")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

All three claim 11 nines of durability (loss of one object per 100 billion per year). All three are now strongly consistent for reads after writes. The mental model is the same.

## What actually differs

```mermaid
flowchart TB
    F1["Storage class names<br/>(S3 'Glacier' = GCS 'Coldline' = Azure 'Cold')<br/>Same idea, different brand"]:::infra
    F2["Lifecycle rules<br/>All three let you tier and delete automatically<br/>S3 has the most expressive policy language"]:::infra
    F3["Egress + request pricing<br/>The hidden bill. Egress costs more than storage above a threshold.<br/>Read-heavy workloads can be dominated by GET pricing."]:::infra
    F4["Signed URLs<br/>All three offer them. S3 + CloudFront integration is deepest."]:::infra
    F5["Event triggers<br/>S3 → Lambda / SNS / SQS<br/>GCS → Cloud Functions / Pub/Sub<br/>Blob → Event Grid / Functions"]:::infra
    F6["Object lock / immutability<br/>S3 Object Lock, GCS retention policies, Blob immutable storage<br/>All compliance-grade"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

For an application developer, the biggest day-to-day differences are how the SDK presents itself (similar shape, different conventions) and the IAM model (very different across the three; see [IAM](/practice/system-design/concepts/069-iam-aws-gcp-azure/)).

## Storage tiers compared

| Tier (use case) | S3 | GCS | Azure |
|---|---|---|---|
| Frequent access | Standard | Standard | Hot |
| Infrequent access | Standard-IA | Nearline | Cool |
| Rare access | Glacier Instant | Coldline | Cold |
| Archive | Glacier Flexible | Archive | Archive |
| Deep archive | Glacier Deep Archive | Archive (with retrieval delay) | Archive |

Prices are within striking distance across the three, and the lifecycle automation works similarly. Picking by tier alone is rarely the right axis.

## When to pick which

```mermaid
flowchart TB
    Q1{"What ecosystem are you in?"}:::query
    A1["S3.<br/>Default for AWS. Best ecosystem integration.<br/>Most third-party tools target S3 first."]:::strong
    A2["GCS.<br/>Default for GCP. Strong consistency by default.<br/>Native BigQuery integration."]:::strong
    A3["Azure Blob.<br/>Default for Microsoft cloud.<br/>Best for enterprise + AD-integrated workflows."]:::strong

    Q1 -->|"AWS"| A1
    Q1 -->|"GCP"| A2
    Q1 -->|"Azure"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

Many third-party tools (Snowflake, Databricks, Iceberg, Delta) speak S3 as their first-class storage; GCS and Azure work but sometimes have lower-quality drivers. If you are building a data lake intended for many third-party engines, the S3-compatible API is a small but real advantage.

## Common mistakes

- **No lifecycle rules.** Data lives in the hottest, most expensive tier forever. Tier old data automatically; see [Hot, warm, cold storage tiers](/practice/system-design/concepts/044-storage-tiers/).
- **Egress surprise.** Pulling 10 TB out of the bucket to your laptop or to another region costs real money. Set budgets and alerts.
- **GET fees on read-heavy workloads.** Per-request fees add up. Static content benefits from CDN caching; see [CDN](/practice/system-design/concepts/027-cdn-when-you-need-it/).
- **Public buckets by mistake.** S3, GCS, and Azure all default to private now, but legacy configs and mistakes happen. Block public access at the account level.
- **No versioning.** A bad `aws s3 cp` overwrites the file. Versioning gives you an undo button.
- **Cross-cloud replication done manually.** All three have native cross-region replication; cross-cloud needs careful tooling.
- **Treating object storage as a database.** No partial updates, no transactions, no rich queries. Use a database for relational data.

## Quick recap

- All three offer the same primitive: infinite durable buckets of objects, strongly consistent, 11+ nines of durability.
- Tier names differ; the structure is the same: hot, cool, cold, archive.
- Pick by cloud and ecosystem, not by storage capability. The interesting differences live elsewhere (IAM, lifecycle policy expressiveness, third-party tooling).
- Lifecycle rules and egress budgets are the two operational must-dos.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
