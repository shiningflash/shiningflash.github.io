---
concept_id: 28
slug: picking-a-vector-database
title: "Picking a vector database: the five real options"
tease: "Pinecone, Weaviate, Qdrant, pgvector, FAISS. Each fits a different shape of project. Most teams pick wrong."
section: "RAG and retrieval"
status: live
---

A vector database stores embeddings and lets you find the K nearest to a query vector. Functionally, every vector DB does the same job. The differences are operational: who hosts it, how it scales, how it integrates with the rest of your stack, what it costs. Most teams pick by hype. The right pick depends on volume, team size, existing infrastructure, and how much you want to operate. This concept is about how to pick.

## The five options that matter

```mermaid
flowchart TB
    A[Pinecone:<br/>managed cloud]:::mg
    B[Weaviate / Qdrant:<br/>self-hosted or cloud]:::mid
    C[pgvector:<br/>Postgres extension]:::sql
    D[FAISS:<br/>in-process library]:::lib

    classDef mg fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef sql fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef lib fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

**Pinecone.** Managed cloud only. Best zero-ops experience. Strong at large scale (billions of vectors). Most expensive of the options.

**Weaviate.** Open source, can be self-hosted or cloud. Strong feature set (hybrid search, filters, multiple data modalities). Mid-tier complexity.

**Qdrant.** Open source, self-host or cloud. Rust-based, fast. Slightly leaner than Weaviate, focused on vector search.

**pgvector.** A Postgres extension. Stores vectors alongside your relational data. The right choice when you already have Postgres and your scale is modest.

**FAISS.** Not a database. An in-process library. The right answer when you need a vector index inside your app, not a separate service.

There are dozens of others. Most teams pick from these five.

## When each one fits

**Pinecone.** You have a real team, real volume, and no patience for ops. You want it to just work. You can afford the bill. Common in mid-stage startups shipping AI features fast.

**Weaviate or Qdrant cloud.** You want managed but with more control than Pinecone. You may want to migrate to self-hosted later. You like more features (graph, multi-modal) or want the open-source community.

**Weaviate or Qdrant self-hosted.** You have ops capacity. You want to control costs. Your scale is large enough that the managed cost stings. You have privacy or residency requirements.

**pgvector.** You already run Postgres. Your corpus is under, say, 10 million vectors. You want to join vector search with SQL filters cleanly. The simplest possible architecture.

**FAISS.** Your corpus fits in process memory. The data is read-mostly. You do not want to run another service. Common for offline jobs and small embedded use.

## The "we already have Postgres" case

If you already run Postgres, pgvector is often the right starting point. You add the extension, create a column of type `vector`, and you can run similarity search in SQL.

```sql
-- Add the extension once
CREATE EXTENSION vector;

-- Add a column to your existing table
ALTER TABLE documents ADD COLUMN embedding vector(1536);

-- Search
SELECT id, title
FROM documents
ORDER BY embedding <-> '[0.1, 0.2, ...]'::vector
LIMIT 5;
```

The `<->` operator is cosine distance (or L2, depending on index type).

What this buys you: no new service to operate, no new infrastructure cost, easy joins between vectors and relational data, backups and replication you already know.

What it costs you: scale limits. pgvector handles tens of millions of vectors well with HNSW indexes (which the extension supports). Beyond that, dedicated vector DBs are faster.

For most non-enterprise RAG, pgvector covers the need. See concept 29.

## Pinecone: the fastest setup

```python
import pinecone

pinecone.init(api_key="...")
index = pinecone.Index("my-rag")

# Upsert
index.upsert([("doc_1", [0.1, 0.2, ...], {"title": "..."})])

# Query
results = index.query(vector=[0.1, 0.2, ...], top_k=5, include_metadata=True)
```

Six lines. The index is ready, scalable to a billion vectors, handles HNSW indexing internally. You pay for what you use.

Pinecone's pricing is per-pod (compute unit) plus storage. A small index is roughly $70 per month minimum. At larger scale, it adds up. Worth it when ops time is more valuable than the bill.

## Weaviate and Qdrant: middle ground

Both have a self-host story and a managed cloud option. Both are open source.

Weaviate adds features beyond pure vector search: hybrid search built in, graph relationships between objects, modular vectorisers that auto-embed text. The trade-off is more concepts to learn.

Qdrant focuses on vector search and adds filter expressions. Smaller surface area, often faster on raw vector operations.

A reasonable rule:

- Weaviate if you want batteries-included (auto-embedding, hybrid out of the box, multi-modal).
- Qdrant if you want a fast vector engine and will build the rest yourself.

Both run on a single VM up to clusters serving billions of vectors. The choice between self-hosted and cloud is usually about ops capacity.

## FAISS: when you do not want a service

FAISS is Facebook's vector library. You import it, you build an index in memory, you query it. No server, no API.

```python
import faiss
import numpy as np

vectors = np.array([...])  # shape (N, D)
index = faiss.IndexFlatL2(D)
index.add(vectors)

query = np.array([[...]])  # shape (1, D)
distances, indices = index.search(query, k=5)
```

Great for:

- Small corpora (under a million vectors) where the index fits in RAM.
- Offline jobs that load, query, and exit.
- Embedded use inside another application.
- Prototyping before you commit to a service.

Not great for:

- Multi-process or multi-machine setups (no shared state).
- Real-time updates (rebuilding the index is the only way to update).
- Persistence (you save and load files yourself).

Use FAISS as a library when a database would be overkill.

## Comparing on real numbers

A rough comparison for a 10-million vector RAG, illustrative:

| | Setup time | Monthly cost | Query latency | Scale ceiling |
| --- | --- | --- | --- | --- |
| pgvector (Postgres existing) | 1 hour | $0 incremental | 30-100ms | 50M vectors |
| FAISS in-process | 30 min | $0 | < 10ms (local) | RAM-bound |
| Pinecone | 1 hour | $70-$500 | 30-80ms | billions |
| Qdrant cloud | 2 hours | $25-$300 | 20-60ms | billions |
| Weaviate cloud | 2-3 hours | $30-$400 | 30-80ms | billions |
| Self-hosted Qdrant/Weaviate | 1-2 days | $25-$100 (VM) | 20-60ms | billions |

These are rough. Get current quotes for your real workload. The ranking is generally stable.

## Migration is harder than it looks

Switching vector DBs later is not just "copy the vectors." Each DB has its own metadata schema, filter syntax, retrieval API. Your code that calls the DB needs to be rewritten.

The senior pattern: a thin abstraction layer.

```python
class VectorStore:
    def upsert(self, items: list[VectorItem]): ...
    def query(self, query_vec, top_k, filter): ...
    def delete(self, ids: list[str]): ...
```

Implement the interface for each backend you support. Switching becomes swapping the implementation, not rewriting the code. Most teams write this once and benefit for the project's life.

## The "default to pgvector first" rule

If you do not know what you need, pgvector is usually the right first answer.

It has no operational overhead beyond Postgres you already run. The cost is zero incremental. The performance is acceptable for most non-enterprise scale. If you outgrow it, you have learned what you actually need and can pick the next DB with real data.

The wrong default is Pinecone-because-everyone-talks-about-it. Pinecone is excellent. It is also expensive and assumes a scale most projects do not have on day one.

## Filters and metadata

Almost all real RAG needs filtering: "only search documents this user can see," "only search docs from the last 90 days," "only search the API category."

Filter support varies.

- pgvector: full SQL. Anything you can query, you can filter.
- Pinecone, Weaviate, Qdrant: filter expressions per their schema. Less flexible than SQL, but cover most needs.
- FAISS: no built-in filter. You filter in Python after retrieval.

For complex filter needs, pgvector's SQL is hard to beat.

## Common mistakes

- **Picking Pinecone because everyone says so.** Often overkill. Try pgvector first.
- **No abstraction layer.** Switching later is expensive.
- **FAISS for a use case that needs persistence and updates.** Wrong tool.
- **Self-hosting Weaviate or Qdrant without ops capacity.** The first outage will hurt.
- **Ignoring filter needs.** Some DBs filter poorly. Test on your real queries.

## Quick recap

- Five real options: Pinecone, Weaviate, Qdrant, pgvector, FAISS.
- pgvector if you already have Postgres and scale is modest.
- Pinecone for zero-ops at scale, with budget for it.
- Weaviate or Qdrant for managed-or-self-hosted middle ground.
- FAISS as a library when a service is overkill.
- Write a thin abstraction layer so switching later is one PR.

This concept sits in **Stage 3 (RAG and retrieval)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
