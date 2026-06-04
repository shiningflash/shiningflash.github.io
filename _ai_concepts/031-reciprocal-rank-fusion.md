---
concept_id: 31
slug: reciprocal-rank-fusion
title: "Reciprocal rank fusion: combining lists without tuning"
tease: "A tiny formula that combines ranked lists from different sources without worrying about score scales. The senior default for hybrid retrieval."
section: "RAG and retrieval"
status: live
---

Reciprocal rank fusion, RRF, is a formula for combining ranked lists from different sources. You have a vector search top-20 and a BM25 top-20. RRF gives you one merged ranking from them. The formula is one line. It does not need tuning. It does not need normalized scores. It just works, well enough that most production hybrid retrieval defaults to it. This concept is the math, the use, and the limits.

## The formula

For each document `d` that appears in any of the source lists:

```
RRF_score(d) = sum over each list of 1 / (k + rank_in_list(d))
```

`rank_in_list(d)` is the position of `d` in that list (1-based). `k` is a small constant, usually 60.

In Python:

```python
def rrf(rankings: list[list[str]], k: int = 60) -> list[str]:
    scores = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0) + 1 / (k + rank)
    return sorted(scores.keys(), key=lambda d: scores[d], reverse=True)
```

That is the whole algorithm. You pass in the top-N from each retrieval method. It returns one merged ranking.

## What it does

```mermaid
flowchart LR
    V[Vector top 5:<br/>A, B, C, D, E]:::tx
    K[BM25 top 5:<br/>F, A, G, H, B]:::tx
    V --> RRF[RRF]:::ok
    K --> RRF
    RRF --> R[Merged:<br/>A (in both),<br/>B (in both),<br/>F (top of BM25),<br/>C (top of vector),<br/>...]:::ok

    classDef tx fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
```

Documents that appear in both lists get boosted; the high ranks add up. Documents that appear in only one list are still included but rank lower. Documents that rank high in either list move toward the top of the merged list.

The math gives each method a chance to contribute. No single method dominates unless it ranks something well that no other method found.

## Why it beats score-weighted combination

The naive way to combine two ranked lists is to add their scores. The problem: scores from different methods are not on the same scale.

```
Vector cosines:  range 0.0 to 1.0, top match might be 0.85
BM25 scores:     range 0 to ~50, top match might be 18
```

If you add them directly, BM25 dominates because its raw numbers are bigger. The right fix is to normalise scores to a common scale, then combine. But normalisation has its own problems: which range, min-max or sigmoid, per-query or global?

RRF skips all of this. It uses only ranks, not scores. Ranks are always comparable (position 1, 2, 3 means the same thing across methods). No normalisation needed.

This robustness is why RRF is the senior default.

## The constant k

`k = 60` is the value from the original RRF paper and is the de facto default. It works.

What `k` does: it controls how much top ranks dominate. Small `k` means top ranks matter a lot. Large `k` means the contribution flattens out, mid-ranks matter more.

```
k = 10:   1/11, 1/12, 1/13 ... top rank is heavily favoured
k = 60:   1/61, 1/62, 1/63 ... small differences between adjacent ranks
k = 200:  1/201, 1/202 ... even small differences
```

For most use cases, `k = 60` is fine. Tuning is rarely worth it. If you do want to tune, use a small eval set and try `k` in {30, 60, 100, 200}. You usually find a flat plateau and pick a default.

## Combining more than two lists

RRF generalises to any number of lists. You can fuse vector search, BM25, and a third method (say, a metadata-based filter) in one step.

```python
rankings = [
    vector_results,
    bm25_results,
    title_match_results
]
merged = rrf(rankings)
```

Each method contributes its rank. Documents that appear in multiple lists rise. This is useful when you have multiple complementary signals.

A common 2026 stack: vector + BM25 + entity-based search (for proper nouns), all fused by RRF.

## RRF vs reranking

RRF is fast. It is just arithmetic. No model calls.

A cross-encoder reranker (concept 32) is slower because it runs a model on each candidate. But the reranker scores each candidate against the query directly, often picking up subtleties RRF cannot.

The senior pattern in production:

1. Run vector and BM25, take top 20 from each.
2. RRF-merge to get a pool of, say, 30 unique candidates.
3. Rerank the 30 candidates with a cross-encoder.
4. Take the top 5 to the model.

RRF reduces 40 candidates to 30 (deduplicated, with strong ones at the top). The reranker now has fewer candidates to score, saving cost.

## Limits of RRF

Three cases where RRF is not enough.

**One method is dramatically better.** If vector search nails 90 percent of your queries and BM25 only helps on 10 percent, RRF's equal treatment dilutes the strong method.

**Very different result sets.** If the two methods rarely overlap, RRF cannot tell which is better. It is essentially a coin flip.

**You want fine-grained tuning.** RRF has one knob (`k`). For applications where you need precise control over the trade-off, weighted score combination with normalisation gives more levers.

For most cases, none of these apply. RRF is robust enough to be the default.

## A worked example

Three top-5 results:

```
Vector:  [doc_A, doc_B, doc_C, doc_D, doc_E]
BM25:    [doc_F, doc_A, doc_G, doc_C, doc_B]
```

RRF with `k = 60`:

```
doc_A: 1/(60+1) + 1/(60+2) = 0.01639 + 0.01613 = 0.03252
doc_B: 1/(60+2) + 1/(60+5) = 0.01613 + 0.01538 = 0.03151
doc_C: 1/(60+3) + 1/(60+4) = 0.01587 + 0.01563 = 0.03150
doc_D: 1/(60+4)            = 0.01563
doc_E: 1/(60+5)            = 0.01538
doc_F: 1/(60+1)            = 0.01639
doc_G: 1/(60+3)            = 0.01587
```

Final ranking: A, B, C, F, D, G, E.

Document A appears in both lists at high rank: clear winner. Documents that appear in only one list still rank, just lower.

## Using RRF in code

For most setups, write the function yourself. It is a one-liner.

```python
def rrf(rankings, k=60):
    scores = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0) + 1 / (k + rank)
    return sorted(scores.keys(), key=lambda d: scores[d], reverse=True)
```

Drop this into your retrieval code. Pass it the ranked lists from each method.

Some libraries (LangChain, LlamaIndex) have RRF helpers. They are the same function with more wrapping.

## A note on caching

The result of RRF depends only on the input rankings. If two different queries produce the same rankings, the RRF output is the same. In practice, queries rarely match exactly, so caching at the RRF level adds little.

Cache further upstream: cache the vector and BM25 search results per query. RRF on top is essentially free.

## Common mistakes

- **Combining raw scores instead of ranks.** Scores are on different scales. Use RRF or normalise first.
- **Skipping deduplication.** A document in both lists should count once. RRF handles this automatically because the score is summed by `doc_id`.
- **Tuning `k` without measurement.** The default works. Tune only if you have a clear signal it matters.
- **Treating RRF as a substitute for reranking.** RRF is fast and simple but does not understand the query content. Add a reranker for high-stakes use.

## Quick recap

- RRF combines ranked lists from different sources using rank, not score.
- The formula is one line. No normalisation needed.
- `k = 60` is the standard default. Tuning is rarely worthwhile.
- It is the senior default for hybrid retrieval because it is robust across scoring scales.
- For maximum quality, pair RRF with a downstream cross-encoder reranker.
- Generalises to any number of input lists.

This concept sits in **Stage 3 (RAG and retrieval)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
