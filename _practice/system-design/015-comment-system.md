---
layout: practice-problem
track: system-design
problem_id: 15
title: Design a Comment System (Threaded + Voted + Moderated)
slug: 015-comment-system
category: User Content
difficulty: Easy
topics: [nested data, voting, moderation, soft delete, ranking]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/015-comment-system"
solution_lang: markdown
---

{% raw %}
## Scene

The interviewer puts down their coffee and says:

> *"We run a news site. Every article has a comment section. People reply to each other, they upvote and downvote, mods remove spam, sometimes a comment goes viral and gets 5000 replies. Design the comment system. Think Disqus, HackerNews, Reddit-style."*

This looks like a CRUD problem. It is not. Comments are the smallest possible piece of user content but they have every hard property packed in: nested data (a comment that replies to a reply to a reply), heavy reads with bursty writes (everyone refreshes when something gets popular), voting with hot-row contention, soft-delete that has to preserve thread structure, ranking algorithms beyond simple chronological order, and a moderation pipeline that has to keep up with abuse.

Candidates who jump to "comments table with parent_id, done" miss every interesting question. The interesting questions are: how do you fetch a 5000-node thread without 5000 database round-trips, how do you count 1000 upvotes in 5 seconds without a hot row, how do you delete a comment that has 200 replies under it without orphaning them, and how does the moderation pipeline decide what is spam without humans reviewing everything.

We walk this from a 10-article blog to a viral site with 1M comments per day. At each stage something breaks.

## Step 1: clarify before you design

Take 5 to 7 minutes. Eight questions minimum.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Depth limit.** "Can a reply to a reply to a reply go on forever, or is there a cap?" Reddit caps at ~10 visible levels. HackerNews has no hard cap but indents stop after 8. Without a cap, a recursive tree can produce huge fetch latency and abusive nesting (one user replying to themselves 200 times deep).
2. **Edit history.** "Can users edit their comments? Forever or only for a window? Do we keep the history?" 5-minute edit window is the common pattern. Permanent editability with no history breaks accountability ("that's not what they said"). HackerNews lets you edit for ~2 hours.
3. **Voting model.** "Upvote-only (like Facebook reactions) or up + down? Anonymous votes or named? Can a user change their vote?" Down-votes change moderation incentives and require dedup logic.
4. **Sort orders.** "What sort orders does the UI need? Newest, oldest, top, controversial, 'best'?" Each one has different storage and caching needs. "Best" (Reddit's confidence-bound formula) is expensive to compute live.
5. **Moderation model.** "Auto-detect spam? Human moderators? User reports? All three? Pre-publish review or post-publish takedown?" Pre-publish (every comment waits for a mod) is a different system from post-publish (every comment is live immediately, mods react).
6. **Delete semantics.** "When a user deletes a comment with 50 replies, what happens? Tombstone? Hard delete? Children orphaned?" Almost always: soft delete with tombstone so the thread structure survives.
7. **Read vs write ratio.** "How many reads per write? Are comments cached?" News article comments are read 100x to 1000x more than they are written. Caching the rendered tree dominates the architecture.
8. **Real-time updates.** "When someone posts a new reply, does my screen update live, or only on refresh?" Real-time (WebSocket fan-out) is a different design from refresh-driven (poll).
9. **Auth model.** "Anonymous comments allowed? Pseudonymous? Required login?" Anonymous changes the abuse story dramatically.
10. **Notifications.** "When someone replies to me, do I get notified?" This is usually a separate service consuming events, not built into the comment system itself.

If you walk in asking only "how many comments per day" you have lost the interesting design space. Depth limit, sort order, and moderation model are the three that change the architecture the most.

</details>

## Step 2: capacity estimates

The interviewer hands you two scenarios, a small blog and a viral site.

**Small blog:**
- 10 articles published per day
- 100 comments per day total across all articles
- Each article live for ~7 days of meaningful traffic
- Average comment: 200 bytes

**Viral site:**
- 100,000 articles in the active set
- 1M comments per day across all articles
- Top 1% of articles get 80% of comments (so ~1000 articles see 800k comments per day)
- Each comment: 300 bytes average, but some long-form replies hit 5KB
- Read-to-write ratio: 1000:1

Compute for the viral site:

1. Writes per second sustained and peak
2. Reads per second sustained
3. Storage for one year of comments
4. Working set: hottest 1000 articles, how much data
5. Peak comments per article per second on the single hottest article in a viral moment

<details>
<summary><b>Reveal: the math at both scales</b></summary>

**Small blog:**

- 100 comments/day = ~1 comment per 15 minutes. Trivial.
- Reads at 1000:1 = 100k page loads per day = ~1 per second. A laptop handles this.
- Storage: 100 × 365 × 200 bytes = ~7MB per year. Nothing.
- Total system: one Postgres, no cache, single app instance. You ship it in a weekend.

**Viral site:**

- 1M comments/day / 86400 = ~12 writes/sec sustained. Peak ~3 to 5x: ~40 to 60 writes/sec.
- Reads at 1000:1 = 1B reads/day = ~12,000 reads/sec sustained, peak ~40k reads/sec.
- Storage: 1M × 365 × 300 bytes = ~110GB/year for comments alone. Plus votes, flags, edits: round to ~250GB/year.
- Hottest 1000 articles, 800 comments each on average over their lifetime = 800k comments × 300 bytes = ~240MB. Fits in Redis easily.
- A single viral moment: one article gets posted to the front page, 10k concurrent users, 50 comments per second on that one article, 1000 votes per second. This is the hot-spot you must handle.

**Key insights:**

- Steady-state load is small. The system is dominated by **read amplification** (1000:1) and by **burst behavior** (viral moments produce 100x sustained load on a single row).
- Storage is small enough that you do not need to think about sharding for capacity. You think about sharding for *blast radius* and to isolate hot articles from cold ones.
- The single hardest number: **40k reads/sec at peak** for one article's comment tree. A naive recursive query against Postgres for every page load would crater the DB. The cache layer is mandatory.
- Vote throughput on a hot comment can hit 1000 votes/second. That is a hot-row problem at the DB level.

</details>

## Step 3: storing nested data

This is the design decision that frames the entire system. You have a tree of comments. How do you store it in a relational database such that you can:

- Insert a new comment cheaply (the hot write path)
- Fetch an entire thread for an article cheaply (the hot read path)
- Delete a subtree cheaply (rare but happens)
- Move a subtree (very rare, almost never needed for comments)

Four classical approaches. Before peeking, sketch the pros and cons of each in your own words.

<details>
<summary><b>Reveal: the four approaches compared</b></summary>

**1. Adjacency list (parent_id pointer).**

```sql
CREATE TABLE comments (
    comment_id  BIGINT PRIMARY KEY,
    article_id  BIGINT NOT NULL,
    parent_id   BIGINT,                    -- NULL = top-level
    body        TEXT,
    created_at  TIMESTAMPTZ
);
CREATE INDEX idx_parent ON comments(parent_id);
CREATE INDEX idx_article ON comments(article_id);
```

- **Insert:** trivial. `INSERT INTO comments (..., parent_id) VALUES (..., 42)`.
- **Fetch subtree:** recursive CTE (`WITH RECURSIVE`). Postgres handles it but the query plan is a loop with a join per level. For a thread with 5000 comments and depth 8, this is 8 joins. Workable but not free.
- **Move subtree:** trivial. Update one parent_id.
- **The classic problem:** "give me the full thread for article X" is a recursive query, not a simple `WHERE article_id = X`.

**2. Materialized path.**

```sql
CREATE TABLE comments (
    comment_id  BIGINT PRIMARY KEY,
    article_id  BIGINT NOT NULL,
    path        TEXT NOT NULL,             -- "/123/456/789" = ancestors
    depth       INT NOT NULL,
    body        TEXT,
    created_at  TIMESTAMPTZ
);
CREATE INDEX idx_path ON comments(article_id, path);
```

- The `path` column encodes the full ancestor chain. A reply has path = parent's path + "/" + self.id.
- **Insert:** mostly trivial. You need the parent's path before you can compute your own. One extra SELECT or one cleverly written INSERT.
- **Fetch subtree:** `WHERE article_id = X AND path LIKE '/123/%'` is fast with a prefix index. One query, no recursion.
- **Fetch entire article's tree:** `WHERE article_id = X` (any path). One query.
- **Move subtree:** expensive. You have to rewrite the path of every descendant. Rare for comments so this is fine.
- **Sort children of a node:** `WHERE path LIKE '/123/%' AND depth = parent.depth + 1` plus an ORDER BY.

**3. Nested set (left/right values).**

```sql
CREATE TABLE comments (
    comment_id  BIGINT PRIMARY KEY,
    article_id  BIGINT NOT NULL,
    lft         INT NOT NULL,
    rgt         INT NOT NULL,
    body        TEXT,
    created_at  TIMESTAMPTZ
);
```

- Each node gets a left and right number such that descendants have left/right values between the parent's.
- **Fetch subtree:** very fast. `WHERE lft BETWEEN parent.lft AND parent.rgt`.
- **Insert:** brutally expensive at scale. Inserting a comment requires updating the lft/rgt of every comment to its "right" in the tree, which can be thousands of rows. Concurrent inserts contend on every row.
- Used in academic examples; almost no production comment system picks this. Comment workloads are insert-heavy and nested set is the wrong shape.

**4. Closure table.**

```sql
CREATE TABLE comments (
    comment_id  BIGINT PRIMARY KEY,
    article_id  BIGINT NOT NULL,
    body        TEXT,
    created_at  TIMESTAMPTZ
);

CREATE TABLE comment_ancestry (
    ancestor_id   BIGINT NOT NULL,
    descendant_id BIGINT NOT NULL,
    depth         INT NOT NULL,
    PRIMARY KEY (ancestor_id, descendant_id)
);
```

- Separate table holds every ancestor-descendant pair for every node.
- **Fetch subtree:** `WHERE ancestor_id = X` on the ancestry table, join back to comments.
- **Insert:** must insert one ancestry row per ancestor. A comment at depth 5 produces 5 ancestry rows.
- **Storage:** O(total tree depth) extra rows. For a 5000-comment thread averaging depth 4, that's 20,000 extra rows.
- **Flexible.** Closure tables make moves easy and let you ask "how deep is the subtree" cheaply.
- Used by Stack Overflow internally for some hierarchies. Solid but heavy on write amplification.

**Comparison table:**

| Approach | Insert | Fetch subtree | Fetch full article | Move | Storage overhead |
|----------|--------|---------------|--------------------|------|------------------|
| Adjacency list | Cheap | Recursive CTE | Single query, then assemble in app | Cheap | None |
| Materialized path | Cheap (one extra SELECT) | Single query, prefix scan | Single query | Expensive | One string per row |
| Nested set | Very expensive | Single range query | Single query | Very expensive | None |
| Closure table | O(depth) writes | Single join | Single join | Cheap to moderate | One row per ancestor pair |

**Recommendation for a comment system: adjacency list + materialized path hybrid.**

- Keep `parent_id` (adjacency list) because it is the natural shape for inserts and for "show me the parent of this comment."
- Also keep `path` (materialized path) for the hot read query "give me everything under this subtree" without recursion.
- Both are derived from each other so they cannot drift if you populate `path` from `parent_id` on insert.

The redundancy is cheap. You eat one TEXT column per row (~50 bytes average for paths under 10 levels) in exchange for never running a recursive CTE on the hot read path.

</details>

## Step 4: sketch the architecture

Fill in the placeholders. Each marks a major component.

```
                Client (web, mobile, embed iframe)
                              │
                              ▼
                    ┌──────────────────┐
                    │   [ ? ]          │  (auth, rate limit, abuse heuristics)
                    └────────┬─────────┘
                             │
        post comment / vote  │     load comments
                             │
              ┌──────────────┼──────────────┐
              │                             │
              ▼                             ▼
        ┌─────────────┐               ┌──────────────┐
        │  [ ? ]      │               │   [ ? ]      │  (rendered comment
        │ (validates, │               │              │   trees, hot articles
        │  persists,  │               │              │   served from memory)
        │  emits      │               │              │
        │  events)    │               │              │
        └──┬─────┬────┘               └──────┬───────┘
           │     │                           │
           │     │                           │
           │     ▼                           ▼
           │  ┌──────────────────┐    ┌──────────────────┐
           │  │  [ ? ]           │    │  Read Replica    │
           │  │ (vote counts     │    │  (Postgres)      │
           │  │  in-memory,      │    │                  │
           │  │  flushed to DB)  │    └──────────────────┘
           │  └──────────────────┘
           │
           ▼
        ┌──────────────────┐
        │  Comments DB     │  (source of truth: comments,
        │  (Postgres)      │   votes, flags, edits, moderation)
        └────────┬─────────┘
                 │
                 │ async (Kafka)
                 ▼
        ┌──────────────────┐
        │  [ ? ]           │  (spam/toxicity classifier,
        │                  │   user report queue, manual
        │                  │   moderation tools)
        └──────────────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
                Client (web, mobile, embed iframe)
                              │
                              ▼
                    ┌──────────────────┐
                    │   API Gateway    │  (auth, per-user rate limit,
                    │   + WAF          │   simple bot detection)
                    └────────┬─────────┘
                             │
        post comment / vote  │     load comments
                             │
              ┌──────────────┼──────────────┐
              │                             │
              ▼                             ▼
        ┌─────────────┐               ┌──────────────┐
        │  Comment    │               │  Read Cache  │
        │  Service    │               │  (Redis +    │
        │ (validates, │               │   CDN edge)  │
        │  persists,  │               │  rendered    │
        │  emits      │               │  trees per   │
        │  events)    │               │  article     │
        └──┬─────┬────┘               └──────┬───────┘
           │     │                           │
           │     │                           │
           │     ▼                           ▼
           │  ┌──────────────────┐    ┌──────────────────┐
           │  │  Vote Aggregator │    │  Read Replica    │
           │  │  (Redis INCR,    │    │  (Postgres)      │
           │  │  batch-flush to  │    │                  │
           │  │  DB every 5s)    │    └──────────────────┘
           │  └────────┬─────────┘
           │           │
           ▼           ▼
        ┌──────────────────┐
        │  Comments DB     │  (source of truth: comments,
        │  (Postgres,      │   votes, flags, edits,
        │   primary)       │   moderation_queue)
        └────────┬─────────┘
                 │
                 │ async (Kafka topic: comment.events)
                 ▼
        ┌──────────────────┐
        │  Moderation      │  (auto: profanity + ML toxicity +
        │  Pipeline        │   link detector. Manual: human queue.
        │                  │   Reactive: user report intake.)
        └──────────────────┘

        Other consumers of the event stream:
            - Notification service ("someone replied to you")
            - Analytics ("which articles drive engagement")
            - Search index (Elasticsearch for comment search)
```

Component responsibilities:

- **API Gateway + WAF.** First defense. Per-user rate limit (10 comments per minute, 100 votes per minute). Drop obvious bots (UA strings, missing headers, known bad IPs).
- **Comment Service.** Stateless. Validates body length, runs synchronous spam pre-check against bloom filter, writes to Postgres, emits `comment.created` to Kafka. Owns the write path for comments, votes, flags.
- **Read Cache.** Rendered comment trees per article, keyed by `(article_id, sort_order)`. Invalidated on writes that affect that article. CDN sits in front for popular articles.
- **Vote Aggregator.** Critical for hot comments. Votes hit Redis (atomic INCR) immediately, return success to the user. A background job batches the deltas and flushes to Postgres every 5 seconds.
- **Comments DB.** Source of truth. Sharded by `article_id` once you outgrow a single primary.
- **Read replica.** Serves the comment tree for cache misses. Multiple replicas; reads do not block on writes.
- **Moderation pipeline.** Async. Consumes every new comment from Kafka. Runs classifiers; based on confidence, auto-approves, queues for human review, or auto-removes. User-reported comments enter the same queue with higher priority.

</details>

## Step 5: vote aggregation under contention

A comment goes viral. 1000 users upvote it within 5 seconds. Your naive design is:

```sql
UPDATE comments SET score = score + 1 WHERE comment_id = 42;
INSERT INTO votes (user_id, comment_id, value) VALUES (?, 42, 1);
```

What happens? Why is this a problem? Design something that handles 1000 votes/sec on a single comment without the database melting.

<details>
<summary><b>Reveal: hot-row problem and the fix</b></summary>

**What happens with the naive design:**

Every UPDATE on the same row takes a row-level lock. The 1000 concurrent UPDATE statements serialize behind that lock. Postgres handles them, but:

- Each UPDATE waits for the previous one. Latency on every voter's request becomes the queue depth × per-update time.
- The transaction log fills with 1000 row-version entries for the same row.
- Other reads against that comment are also waiting on the lock if you use `SELECT FOR UPDATE` anywhere.
- Replication lag grows because the primary is busy.
- The DB CPU spikes for one row, while everything else slows down.

This is the **hot row problem**. The DB is doing work proportional to vote volume on a single key.

**The fix has three parts:**

**1. Decouple vote write from score update.**

The user's click does not need to update the DB row directly. It needs:
- Their vote recorded (so we can dedup).
- The score eventually correct.

Path:
- `POST /comments/42/vote {value: 1}` → Vote Aggregator.
- Aggregator: `INCRBY vote_delta:42 1` in Redis (constant-time, in-memory).
- Aggregator: writes the per-user vote to a `votes_pending` Redis hash (`HSET user:7:votes 42 1`) for dedup.
- Returns 200 to the user in ~5ms.

**2. Batch-flush to the database.**

A background worker runs every 5 seconds:
- Reads `vote_delta:*` keys.
- For each comment_id: `UPDATE comments SET score = score + <delta> WHERE comment_id = ?`. One UPDATE per comment, not per vote.
- Drains `votes_pending` and bulk-inserts into the `votes` table.
- Resets the delta keys.

1000 votes in 5 seconds become **1 DB update** instead of 1000. The hot row sees one write every 5 seconds.

**3. Dedup at the Redis layer.**

A user clicks Upvote twice. Or changes from Up to Down. The Redis hash holds the user's current vote on each comment. On submit:
- `HGET user:7:votes 42` to see existing value.
- Compute delta: if existing was 0 and new is 1, delta = +1. If existing was -1 and new is 1, delta = +2.
- `HSET user:7:votes 42 1` to record current state.
- `INCRBY vote_delta:42 <delta>`.

The delta path is what flushes to the DB. The user-vote map is what prevents double-counting.

**Trade-offs:**

- **Eventual consistency on score display.** The displayed score may lag the actual count by up to 5 seconds. Acceptable for a comment system; most users do not notice.
- **Data loss window if Redis dies.** Up to 5 seconds of votes could be lost. Mitigations: Redis AOF + replica, or write-ahead a vote-event to Kafka before Redis (then the worker reads from Kafka, not Redis, and Kafka is durable). For a comment system the 5s window is usually fine.
- **Score never goes negative more than briefly.** If a comment gets mass-downvoted and the delta flush is delayed, the cached score might show old value. Same trade-off as above.

This pattern is the standard answer for "high write rate on a single counter." It works for vote counts, view counts, like counts, anything that aggregates.

</details>

## Step 6: moderation pipeline

Comments get spam, NSFW content, hate speech, off-topic noise. The interviewer asks: "Walk me through how a comment gets moderated, from posted to either visible-to-everyone or removed."

Three input signals: automated detection at post time, user reports after the fact, manual scanning by mods. Sketch the pipeline and the states a comment moves through.

<details>
<summary><b>Reveal: moderation pipeline</b></summary>

**States a comment can be in:**

| State | Visible to | How it got here |
|-------|-----------|-----------------|
| `published` | Everyone | Posted and passed auto-checks |
| `pending_review` | Author only | Auto-checker flagged with medium confidence |
| `shadow_banned` | Author only | Author was flagged as bad actor; comment looks live to them but no one else |
| `removed_auto` | No one (tombstone for thread structure) | Auto-checker high-confidence spam/abuse |
| `removed_manual` | No one | Human mod removed |
| `removed_self` | No one | Author deleted |

**The pipeline:**

```
                    POST /comments
                          │
                          ▼
              ┌─────────────────────────┐
              │  Synchronous pre-check  │
              │  (must finish in <50ms) │
              │  - Length / format      │
              │  - URL allowlist        │
              │  - Bloom filter of      │
              │    banned phrases       │
              │  - Author reputation    │
              └────────────┬────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        clean │     suspect│            │ banned-phrase
              ▼            ▼            ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ published│  │ pending_ │  │ removed_ │
        │          │  │ review   │  │ auto     │
        └────┬─────┘  └────┬─────┘  └──────────┘
             │             │
             │             │
             │             ▼
             │       ┌──────────────────┐
             │       │  Human moderator │
             │       │  queue. Mod      │
             │       │  approves or     │
             │       │  removes.        │
             │       └──────────────────┘
             │
             └──────► Async: emit comment.created to Kafka
                              │
              ┌───────────────┼──────────────┐
              │               │              │
              ▼               ▼              ▼
        ┌──────────┐  ┌──────────────┐  ┌──────────────┐
        │ ML       │  │ Link scanner │  │ Notification │
        │ toxicity │  │ (phishing,   │  │ ("X replied  │
        │ classifier│ │  malware)    │  │  to you")    │
        └────┬─────┘  └──────┬───────┘  └──────────────┘
             │               │
             │ high confidence flag
             ▼               ▼
        ┌──────────────────────────────┐
        │  Mark comment for review     │
        │  (state → pending_review or  │
        │   removed_auto)              │
        └──────────────────────────────┘

        User-reported comments enter the human queue directly,
        sorted by report count + author reputation + content score.
```

**Synchronous pre-check is the only thing on the hot path.** It must finish in ~50ms because it blocks the user's POST. So it does cheap things: length checks, regex against a maintained banned-phrase list (loaded into a bloom filter for speed), reputation lookup ("is this user already shadow-banned"), simple URL allowlist.

**Async checks are slower and more expensive.** ML toxicity models take 100-500ms per inference. Link scanning involves an external API. These run after the comment is already visible, and if they flag it, the comment's state is updated (and cache invalidated). The user sees their comment briefly, then if it gets removed, sees a "your comment was removed" notice.

**User reports** are the third input. A "report" button on each comment lets users flag content. Reports queue into the same human-review queue, sorted by: report count, the reporter's own reputation (heavy users carry more weight), the content's auto-toxicity score, the author's reputation.

**Confidence-based routing.**

The auto-checker returns a confidence score 0.0 to 1.0. Thresholds:
- `< 0.2`: auto-publish, no flag.
- `0.2 to 0.7`: publish but queue for human review.
- `0.7 to 0.95`: hold in `pending_review`, only visible to author until a human approves.
- `> 0.95`: auto-remove, do not show to anyone.

The exact thresholds get tuned over time. False-positive rate (good comments wrongly removed) and false-negative rate (bad comments wrongly published) trade off against each other.

**Why not pre-publish review for everything.**

Two reasons:
1. Latency. Users expect comments to appear immediately.
2. Volume. At 1M comments/day, even 1 second per comment of human time would require ~10k mod hours per day. Not viable.

Post-publish with fast async takedown is the standard for high-volume sites. Pre-publish review is reserved for content from low-reputation users or articles flagged as sensitive.

**The shadow ban.**

A user posts spam repeatedly. You ban them, they create a new account. Instead, shadow-ban: their comments look published to them but invisible to everyone else. They spend energy posting comments that no one sees. Less likely to spawn alt accounts because the system gives them no signal.

The implementation is a per-user flag. On rendering the tree, if the requesting user is the shadow-banned user, include their comments. Otherwise filter them out. The author sees their full thread; everyone else sees a hole.

</details>

## Step 7: incomplete render flow

Walk through what happens when a user loads `/articles/news-of-the-day`. The article is hot, gets 10k loads per minute. Sketch the read path.

<details>
<summary><b>Reveal: read path with cache tiering</b></summary>

```
        GET /articles/news-of-the-day
                  │
                  ▼
        ┌───────────────────┐
        │   CDN edge        │
        │   (Cloudflare,    │
        │    Fastly)        │
        └────────┬──────────┘
                 │ miss
                 ▼
        ┌───────────────────┐
        │  Read Cache       │  key: article:42:tree:sort=hot
        │  (Redis)          │  value: rendered JSON of full
        │                   │  comment tree
        └────────┬──────────┘
                 │ miss
                 ▼
        ┌───────────────────┐
        │  Read Service     │
        │  - SELECT all     │
        │    comments       │
        │    WHERE          │
        │    article_id=42  │
        │  - Build tree in  │
        │    memory         │
        │  - Apply sort     │
        │  - Render JSON    │
        │  - Cache for 60s  │
        └────────┬──────────┘
                 │
                 ▼
        ┌───────────────────┐
        │  Read Replica     │
        │  (Postgres)       │
        └───────────────────┘
```

Cache key includes the sort order because the same article has different trees for "newest" vs "hot" vs "top." TTL is short (60s) because new comments arrive frequently. Writes invalidate the cache for the affected article.

For very hot articles, the CDN holds the rendered JSON. 99% of reads never touch your origin. The CDN refreshes from origin every 60 seconds.

For cold articles, every read goes to the read replica. Worst case a cold article has 0 comments and the response is trivially small.

</details>

## Follow-up questions

Try to answer each in 2 to 4 sentences before reading the solution.

1. **A comment with 200 replies under it gets deleted by its author.** What happens to the replies? Walk through the data and the UI.

2. **A user spams 1000 comments in 10 seconds via a script.** Where does this get caught? How do you avoid blocking a legitimate user who posts 5 comments in a minute during a hot discussion?

3. **Edit window vs immutable history.** A user edits their comment 3 hours after posting. The original said something they want to walk back. Should other users see "(edited)"? Should they be able to see the original? What about for moderation purposes?

4. **The "hot" sort algorithm.** Define Reddit's "hot" ranking formula. Why does it decay with time? What happens if you just sort by score?

5. **A new comment is posted. Your cached tree is now stale.** Do you invalidate the entire cache key, do partial updates, or accept staleness? What is the trade-off?

6. **A user reports a comment as spam. 50 other users report the same comment within 5 minutes.** Do you wait for a human, or do you auto-hide it? Where does the threshold come from?

7. **Real-time updates.** Someone wants the comment count to update live on the article page, and replies to appear without refresh. Sketch the WebSocket fan-out without melting the server when an article gets 10k concurrent viewers.

8. **Pagination on a 5000-comment thread.** You cannot send all 5000 to the client. What is your paging strategy and how do you handle "load more replies" when a child has 80 sub-replies?

9. **A comment thread suddenly attracts brigading from another site.** Sudden flood of accounts with no prior activity, all downvoting one comment. How do you detect this and what do you do?

10. **GDPR delete.** A user requests deletion of all their comments. They have 4000 comments going back 5 years, many of which have replies underneath. What happens?

## Related problems

- **[Approval Management (011)](../011-approval-management/question.md)**, the moderation queue is a workflow engine with the same state-machine plus role-routing patterns; the per-mod queue parallels the per-approver dashboard.
- **[Todo List Sharing (013)](../013-todo-list-sharing/question.md)**, the soft-delete-with-tombstone pattern shows up in any system where deletes must preserve structure.
- **[Notification System (010)](../010-notification-system/question.md)**, replies and mentions fan out through this exact notification pipeline; the comment system emits events, the notification system delivers.
- **[Write-Heavy System Patterns (018)](../018-write-heavy-patterns/question.md)**, the vote aggregation and Kafka-first write pattern are textbook examples from this problem area.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Comment System (Threaded + Voted + Moderated)

### TL;DR

A comment system looks like CRUD and is not. Five things make it interesting: storing nested data so that fetching a thread is not a recursive walk, surviving 1000 votes per second on a single hot comment, soft-deleting a comment that has 200 replies without orphaning them, ranking by something smarter than chronological, and keeping a moderation pipeline that scales past human review.

The base design is a Postgres table with two redundant pointers per row: `parent_id` (cheap inserts, natural shape) and a materialized `path` like `/123/456/789` (one-query subtree fetch with a prefix index). Votes do not write to the comment row directly; they go to Redis as atomic increments and a background worker batches them into Postgres every 5 seconds. Reads of the comment tree are served from a per-article cache (Redis + CDN) keyed by `(article_id, sort_order)`, with short TTL and invalidation on writes.

Moderation is a confidence-routed pipeline. A synchronous pre-check (length, banned phrases, author reputation, URL allowlist) runs on the hot write path and finishes in 50ms. Heavier checks (ML toxicity, link scanning) run async after publish; high-confidence flags update the comment state and invalidate caches. User reports queue into the same human review tool. Soft delete leaves a tombstone (`body = '[deleted]'`, `author = NULL`) so the thread structure survives.

The scaling story is read-amplification (1000:1 read:write) and burst behavior (one viral comment producing 100x sustained load on one row). Capacity is small. Caching, hot-row handling, and moderation throughput are what the architecture is built for.

### 1. Clarifying questions and why each matters

Covered in `question.md`. The three that most change the design:

1. **Depth limit.** Caps the worst-case recursion and the deepest path string. Without a cap, abusive nesting creates pathological queries.
2. **Sort orders.** "Newest" is one cache key. "Hot" is another, and "hot" requires periodic recomputation as time decays the score. Each sort order multiplies your cache footprint.
3. **Moderation model.** Pre-publish (every comment waits for a human) is a different system from post-publish (live immediately, mods react). Almost all high-volume sites pick post-publish with fast async takedown.

Asking only "comments per day" walks you into a CRUD answer and loses the interesting parts.

### 2. Capacity estimates (full working)

**Small blog (10 articles, 100 comments/day):**

- ~1 comment per 15 min. ~1 page load/sec at 1000:1 read ratio.
- ~7MB/year of comment data.
- One Postgres, one app pod, no cache. Build it in a weekend.

**Viral site (100k articles, 1M comments/day):**

- 1M / 86400 = ~12 writes/sec sustained, ~40-60 writes/sec peak.
- 1000:1 reads = ~12k reads/sec sustained, ~40k reads/sec peak.
- Storage: 1M × 365 × 300 bytes = ~110GB/year for comment bodies; ~250GB/year including votes, flags, edits.
- Hot working set: top 1000 articles × ~800 comments × ~300 bytes = ~240MB. Fits in one Redis node.
- Single-article hotspot: 50 comments/sec, 1000 votes/sec on the top comment.

The interesting number is **40k reads/sec at peak**, dominated by a few hundred hot articles. The cache layer handles that; the DB never sees most of it.

### 3. API design

**Post a comment:**

```
POST /api/v1/articles/{article_id}/comments
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <uuid>            # so mobile retries don't double-post

{
  "parent_id": null,                # null = top-level; or another comment_id
  "body": "What a take."
}
```

| Status | Meaning | Body |
|--------|---------|------|
| 201 Created | Comment created | `{"comment_id": "cmt_abc", "state": "published", ...}` |
| 200 OK | Idempotency-Key seen before, returning existing | same shape |
| 202 Accepted | Comment held for moderation review | `{"comment_id": "cmt_abc", "state": "pending_review"}` |
| 400 Bad Request | Body too long, parent_id missing/invalid | `{"error": "invalid_body"}` |
| 403 Forbidden | User shadow-banned or suspended | `{"error": "forbidden"}` |
| 409 Conflict | Parent comment was deleted, cannot reply | `{"error": "parent_gone"}` |
| 429 Too Many Requests | Rate limit hit | `{"error": "rate_limited", "retry_after": 30}` |

**List comments for an article:**

```
GET /api/v1/articles/{article_id}/comments?sort=hot&limit=50&cursor=...
```

Response is the rendered tree, paginated. Top-level comments are paged; each comment carries a `reply_count` and the first N replies inline, with a cursor to fetch more.

| Status | Meaning |
|--------|---------|
| 200 OK | Returns the tree (possibly empty) |
| 304 Not Modified | If `If-None-Match` matched the cached ETag |

**Vote on a comment:**

```
POST /api/v1/comments/{comment_id}/vote
{
  "value": 1 | -1 | 0       # 1 = upvote, -1 = downvote, 0 = clear vote
}
```

| Status | Meaning |
|--------|---------|
| 200 OK | Vote recorded |
| 403 | Not logged in or self-voting on own comment |
| 404 | Comment removed |

**Flag a comment:**

```
POST /api/v1/comments/{comment_id}/flags
{
  "reason": "spam" | "abuse" | "off_topic" | "other",
  "details": "optional context"
}
```

**Edit a comment:**

```
PATCH /api/v1/comments/{comment_id}
{
  "body": "new body"
}
```

Allowed only within the edit window (default 5 minutes). After that, edits require an admin override.

**Delete (soft):**

```
DELETE /api/v1/comments/{comment_id}
```

Marks the comment removed (state = `removed_self`), replaces the body with `[deleted]` on display. Replies underneath are preserved.

**Moderator endpoints:**

```
GET  /api/v1/moderation/queue?priority=high
POST /api/v1/moderation/comments/{comment_id}/action
     {"action": "approve" | "remove" | "ban_author"}
```

**Notes on the API:**

- **Idempotency-Key on POST.** Mobile retries plus double-clicks are common. The key is hashed and stored for 24h; same key returns the same response.
- **Pagination is cursor-based, not offset.** Hot articles get new comments while users scroll; offset pagination shifts entries under them.
- **Vote endpoint accepts 0.** Clearing a vote is a common interaction; do not require a separate DELETE.

### 4. Data model

```sql
-- Comments themselves.
CREATE TABLE comments (
    comment_id     BIGINT PRIMARY KEY,             -- snowflake-style ID, sortable by time
    article_id     BIGINT NOT NULL,
    parent_id      BIGINT,                          -- adjacency list pointer
    path           TEXT NOT NULL,                   -- materialized path: "/123/456/789"
    depth          INT NOT NULL,                    -- denormalized; helps with limits
    author_id      BIGINT,                          -- NULL after GDPR delete
    body           TEXT NOT NULL,                   -- "[deleted]" after soft delete
    score          INT NOT NULL DEFAULT 0,          -- cached vote total, eventually consistent
    reply_count    INT NOT NULL DEFAULT 0,          -- denormalized; helps with "load more"
    state          SMALLINT NOT NULL DEFAULT 1,     -- 1=published, 2=pending, 3=removed_auto,
                                                     -- 4=removed_manual, 5=removed_self, 6=shadow
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ,                     -- last edit time, NULL if never edited
    edit_count     SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_comments_article ON comments (article_id, created_at DESC);
CREATE INDEX idx_comments_path    ON comments (article_id, path text_pattern_ops);
CREATE INDEX idx_comments_parent  ON comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_comments_author  ON comments (author_id, created_at DESC);

-- Votes (one row per user per comment, current state).
CREATE TABLE votes (
    user_id     BIGINT NOT NULL,
    comment_id  BIGINT NOT NULL,
    value       SMALLINT NOT NULL,                  -- +1 or -1; row deleted when cleared
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX idx_votes_comment ON votes (comment_id);

-- Flags (user reports).
CREATE TABLE flags (
    flag_id      BIGINT PRIMARY KEY,
    comment_id   BIGINT NOT NULL,
    reporter_id  BIGINT NOT NULL,
    reason       SMALLINT NOT NULL,                  -- enum: spam, abuse, off_topic, other
    details      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    state        SMALLINT NOT NULL DEFAULT 1,        -- 1=open, 2=dismissed, 3=actioned
    UNIQUE (comment_id, reporter_id)                  -- one report per user per comment
);
CREATE INDEX idx_flags_open ON flags (comment_id, state) WHERE state = 1;

-- Edit history (only when body changes; not every UPDATE).
CREATE TABLE edit_history (
    edit_id      BIGINT PRIMARY KEY,
    comment_id   BIGINT NOT NULL,
    prior_body   TEXT NOT NULL,                       -- the body BEFORE this edit
    edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_by    BIGINT                               -- usually author; could be admin
);
CREATE INDEX idx_edits_comment ON edit_history (comment_id, edited_at DESC);

-- Moderation queue (items needing human attention).
CREATE TABLE moderation_queue (
    queue_id      BIGINT PRIMARY KEY,
    comment_id    BIGINT NOT NULL,
    priority      SMALLINT NOT NULL,                  -- 1=low, 2=med, 3=high
    reason        TEXT NOT NULL,                       -- "auto_toxicity_0.78", "user_reports_12", etc.
    queued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_to   BIGINT,                              -- moderator user_id, NULL = unclaimed
    resolved_at   TIMESTAMPTZ,
    resolution    SMALLINT                             -- 1=approved, 2=removed, 3=ban_author
);
CREATE INDEX idx_modq_unclaimed ON moderation_queue (priority DESC, queued_at)
    WHERE resolved_at IS NULL AND assigned_to IS NULL;
```

**Why each choice:**

- **`comment_id` as a snowflake-style BIGINT.** Sortable by time. Useful for cursor pagination ("comments after ID X" = "comments after time T").
- **Both `parent_id` and `path`.** Adjacency list keeps writes simple. Path enables `WHERE path LIKE '/123/%'` for fast subtree fetch with one query. The redundancy is cheap (one TEXT column, ~50 bytes average) and worth the read speedup.
- **`score` denormalized on comments.** Reads need the score immediately. Computing it from `votes` on every read would be a scan per comment. The vote aggregator keeps `score` close-to-current.
- **`reply_count` denormalized.** "Load more replies" needs to know how many exist without a SELECT COUNT.
- **`state` as SMALLINT not enum.** Adding new states (5=removed_self, 6=shadow) without schema migration.
- **`votes` PK is `(user_id, comment_id)`.** Enforces one vote per user. Update-in-place (or delete) when the user changes their mind.
- **`edit_history.prior_body`, not current body.** Stores what the comment used to say. The current body lives on `comments.body`. To reconstruct full history, walk `edit_history` in reverse time order.
- **`flags` has a unique constraint per `(comment_id, reporter_id)`.** Prevents a user from spamming reports on one comment to inflate the count.

**Why Postgres, not Cassandra/DynamoDB:**

- Tree fetches via path-prefix work in Postgres with a B-tree index. Cassandra cannot do range scans on arbitrary paths efficiently.
- Strong consistency on votes (no double-count if the user clicks twice fast) is free in Postgres.
- The total data is small (250GB/year). Cassandra's strengths (huge tables, multi-master writes) are not needed.

### 5. Core algorithm: nested data with adjacency list + materialized path

**Insert a top-level comment:**

```python
def insert_top_level(article_id, author_id, body):
    comment_id = snowflake.next()
    path = f"/{comment_id}"
    db.execute("""
        INSERT INTO comments (comment_id, article_id, parent_id, path, depth, author_id, body)
        VALUES (?, ?, NULL, ?, 0, ?, ?)
    """, comment_id, article_id, path, author_id, body)
```

**Insert a reply:**

```python
def insert_reply(article_id, parent_id, author_id, body):
    parent = db.fetch_one("SELECT path, depth FROM comments WHERE comment_id = ?", parent_id)
    if not parent:
        raise ParentGone()
    if parent.depth >= MAX_DEPTH:
        # Re-root the reply at the deepest allowed ancestor.
        parent_id, parent = find_anchor_ancestor(parent.path, MAX_DEPTH - 1)

    comment_id = snowflake.next()
    new_path = f"{parent.path}/{comment_id}"
    new_depth = parent.depth + 1

    with db.transaction():
        db.execute("""
            INSERT INTO comments (comment_id, article_id, parent_id, path, depth, author_id, body)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, comment_id, article_id, parent_id, new_path, new_depth, author_id, body)
        db.execute("UPDATE comments SET reply_count = reply_count + 1 WHERE comment_id = ?", parent_id)
```

**Fetch full tree for an article:**

```python
def fetch_tree(article_id, sort='hot'):
    rows = db.fetch_all("""
        SELECT comment_id, parent_id, path, depth, author_id, body, score, state, created_at
        FROM comments
        WHERE article_id = ?
          AND state IN (1, 3, 4, 5)             -- include tombstones for structure
        ORDER BY path                            -- pre-order traversal naturally
    """, article_id)

    # Build tree in app memory: O(n).
    by_id = {r.comment_id: {**r, "children": []} for r in rows}
    roots = []
    for r in rows:
        if r.parent_id is None:
            roots.append(by_id[r.comment_id])
        elif r.parent_id in by_id:
            by_id[r.parent_id]["children"].append(by_id[r.comment_id])

    # Tombstone bodies for removed comments.
    for r in by_id.values():
        if r['state'] in (3, 4, 5):
            r['body'] = '[deleted]'
            r['author_id'] = None

    # Sort children per node by chosen order.
    sort_tree(roots, by=sort)
    return roots
```

**Fetch a subtree (load more replies under a single comment):**

```python
def fetch_subtree(article_id, root_comment_id, limit=50):
    root = db.fetch_one("SELECT path FROM comments WHERE comment_id = ?", root_comment_id)
    rows = db.fetch_all("""
        SELECT comment_id, parent_id, path, depth, author_id, body, score, state, created_at
        FROM comments
        WHERE article_id = ?
          AND path LIKE ?                        -- prefix scan; index is text_pattern_ops
        ORDER BY path
        LIMIT ?
    """, article_id, root.path + '/%', limit)
    return assemble(rows)
```

The prefix scan is the win. `path LIKE '/123/%'` uses the B-tree index on `(article_id, path text_pattern_ops)`. No recursive CTE, no loop, no per-level join. One index seek plus a forward scan.

**Vote dedup and delta computation:**

```python
def cast_vote(user_id, comment_id, new_value):
    # new_value is -1, 0, or +1.
    if new_value not in (-1, 0, 1):
        raise InvalidValue()

    key_user = f"user:{user_id}:votes"
    key_delta = f"vote_delta:{comment_id}"

    # Redis transaction (MULTI/EXEC or Lua script for atomicity).
    with redis.pipeline() as p:
        existing = redis.hget(key_user, comment_id) or 0
        existing = int(existing)
        delta = new_value - existing

        if delta != 0:
            p.incrby(key_delta, delta)
            if new_value == 0:
                p.hdel(key_user, comment_id)
            else:
                p.hset(key_user, comment_id, new_value)
            p.execute()

    return {"score_delta_applied": delta}
```

The background flusher every 5 seconds:

```python
def flush_vote_deltas():
    # Atomically grab and clear the delta keys for this batch.
    keys = redis.keys("vote_delta:*")
    pipeline = redis.pipeline()
    for k in keys:
        pipeline.getset(k, 0)               # snapshot value, reset to 0
    deltas = pipeline.execute()

    with db.transaction():
        for k, d in zip(keys, deltas):
            d = int(d or 0)
            if d == 0:
                continue
            cid = int(k.split(":")[1])
            db.execute("UPDATE comments SET score = score + ? WHERE comment_id = ?", d, cid)

    # Drain the pending votes hash into the votes table (bulk insert with ON CONFLICT).
    drain_votes_hash_to_db()
```

**Soft delete with tombstone:**

```python
def delete_comment(comment_id, by_user_id):
    db.execute("""
        UPDATE comments
        SET state = 5,                          -- removed_self
            body = '[deleted]',
            author_id = NULL,
            updated_at = NOW()
        WHERE comment_id = ? AND author_id = ?
    """, comment_id, by_user_id)
    invalidate_cache_for(article_id_of(comment_id))
```

The row stays. The path stays. Children stay. The body becomes `[deleted]` and the author goes to NULL (so deletion + GDPR is one step). The thread above and below the deleted comment continues to render correctly.

**Why not hard delete:** if you removed the row, every reply with `parent_id = <deleted>` would orphan. The path strings of descendants reference the deleted ID. Rendering the tree would have to handle missing intermediate nodes. The tombstone keeps everything simple.

### 6. Architecture (already in question.md)

| Component | Stateful? | Scaling story |
|-----------|-----------|--------------|
| API Gateway + WAF | No | Horizontal pods |
| Comment Service | No (state in DB) | Horizontal pods |
| Read Cache (Redis) | Yes | Sharded by article_id |
| CDN | Yes (edge cache) | Vendor-managed |
| Vote Aggregator | Yes (Redis) | Per-region Redis cluster |
| Postgres primary | Yes | Sharded by article_id at high scale |
| Postgres read replicas | Yes | Per-region, multiple replicas |
| Kafka | Yes | Standard cluster scaling |
| Moderation pipeline | No (state in DB) | Horizontal workers per topic |

### 7. Read and write paths

**Write path (POST /comments):**

1. Client → API Gateway. Auth, rate limit (10 comments/min per user), idempotency lookup.
2. Comment Service runs synchronous pre-check (<50ms):
   - Length / format.
   - Banned phrases (bloom filter, in-memory).
   - URL allowlist (links must be to allowed domains, or get pending review).
   - Author reputation (good standing? recent strikes?).
   - Returns: `clean | suspect | banned`.
3. Banned phrase or banned-author: insert with `state = removed_auto`. Return 201 to the user. Their comment appears live to them only (UI: "Posted." They will not realize it was removed.).
4. Suspect: insert with `state = pending_review`. Return 202.
5. Clean: insert with `state = published`. Return 201.
6. All paths emit `comment.created` to Kafka.
7. All paths invalidate the article's cached tree.

P99 target: 200ms. Bottleneck is the synchronous pre-check; the DB insert is fast.

**Write path (POST /vote):**

1. Client → API Gateway. Auth, rate limit (100 votes/min per user).
2. Vote Aggregator:
   - Look up existing vote in Redis hash.
   - Compute delta.
   - INCRBY the comment's vote delta, HSET the user's vote.
3. Return 200 to the user.
4. Asynchronously (every 5s), the flusher batches deltas into Postgres.

P99 target: 50ms. Almost all in Redis.

**Read path (GET /articles/X/comments):**

1. Client → CDN. If cached for this article + sort order, return immediately.
2. CDN miss → Read Service.
3. Read Service checks Redis: `comments:article:42:tree:sort=hot`. If hit, return.
4. Redis miss → Read Replica. Fetch all rows for `article_id = 42`. Build tree in memory (O(n)). Apply sort. Render JSON. Write to Redis with 60s TTL + jitter.
5. Return to client.

P99 target: 100ms. Cache hit rate >95% for popular articles.

**Cache invalidation on write:**

When a comment is created, edited, deleted, or moderated, the affected article's cache keys are invalidated:
- Publish a pub/sub message: `cache_invalidate:article:42`.
- Read Service subscribers DEL the relevant Redis keys.
- CDN: shorter TTL (60s) means the CDN refreshes within a minute. For instant invalidation, call the CDN's purge API.

Trade-off: a comment posted now might not appear for any user for up to 60 seconds. For most comment UIs, acceptable. If not, use a tiered cache where the in-memory tier has shorter TTL and is invalidated synchronously.

### 8. Scaling journey: 10 to 1M users

The point of this section is that the architecture is built up in response to actual pain, not anticipated load. Each stage names what just broke.

#### Stage 1: 10 articles, 100 comments/day (a small blog)

**What you build:**

- One Postgres (db.t3.small, 2GB RAM).
- One application pod (Node, Python, Go, whatever).
- Single `comments` table with `parent_id`. No `path` column yet (you do not need it).
- Recursive CTE for fetching threads. Postgres handles it for trees up to a few hundred comments.
- No cache. No queue. No Redis.
- Moderation: a single email to the admin when a comment posts. They eyeball it.

**Why this is enough:**

- 100 comments/day. The DB is bored.
- The hottest article has maybe 30 comments. Recursive CTE finishes in 5ms.
- No moderation pipeline needed. Volume is so low one human handles all reports.

**What you do *not* build:**

- No materialized path. The adjacency list + recursive CTE is fast enough for trees of this size.
- No vote aggregator. Vote counts are an UPDATE on the comment row; nobody is racing.
- No real-time WebSocket updates. The UI polls every 30 seconds; nobody notices.
- No CDN for comment data. The whole site fits behind one origin.

**Cost:** ~$30/month for the DB, ~$20/month for the app. Build it in a weekend.

#### Stage 2: 1k articles, 5k comments/day (growing blog network)

**What just broke:**

- One article got 800 comments. The recursive CTE for that article takes 400ms. Page loads stall.
- A few users figured out the comment box has no rate limit and started spamming.
- Comment edits have no history. A reader screenshotted a comment, the author edited it, the discussion became confusing.

**What you add:**

- **Materialized path column.** Backfill `path` for existing rows. Switch the fetch query to a single `WHERE article_id = X` ordered by `path`. Recursive CTE retires.
- **Per-user rate limit.** API gateway tracks comments/min per user. 10/min cap.
- **Edit history table.** Every PATCH inserts the prior body into `edit_history`. The UI shows "(edited)" on any comment where `edit_count > 0` and offers a click-to-see-history.
- **Simple per-article cache.** Redis. Cache rendered tree per article with 60s TTL. Invalidate on writes to that article.
- **A second moderator.** Manual review still; queue is small.

**What you do *not* yet build:**

- No vote aggregator. Vote rate per comment is still low (<10/min on the hottest comment). Direct UPDATE is fine.
- No Kafka. The single notifier is a function call from the Comment Service.
- No sharding. One Postgres handles it.

**Why this is enough:**

- 5k comments/day = ~50 writes/min sustained. Postgres yawns.
- Reads: maybe 100k page loads/day = ~1.2/sec. Cache handles 95%.

**Cost:** ~$150/month (slightly bigger DB, small Redis, dual-pod app).

#### Stage 3: 100k articles, 100k comments/day (a mid-size publication or aggregator)

**What just broke:**

- An article hit the front page of a partner site. 10k concurrent viewers, 50 comments/min on that article, 500 votes/min on the top comment. The single comment row's UPDATE statement is the bottleneck; Postgres CPU at 90%.
- The moderation team can not keep up. They reviewed 50 comments yesterday; they need to review 2000. Hiring more mods is not the right answer.
- Cache hit rate dropped to 70% because trees are large and the cache evicts cold articles, then re-fetches them on the next view.
- One user reported a comment as spam. Then 10 more. The comment is still up because no human has gotten to the queue.

**What you add:**

- **Vote Aggregator with Redis + batch flush.** Votes hit Redis (atomic INCR), background worker flushes to DB every 5s. Vote on a hot comment becomes a single UPDATE per 5s, not per click. The DB stops being the bottleneck.
- **CDN in front of the comment read endpoint.** Cloudflare or Fastly, key by `(article_id, sort_order)`, TTL 60s. 99% of reads never hit your origin for popular articles.
- **Auto-moderation pipeline (Kafka).** New comments emit `comment.created` to Kafka. A worker runs ML toxicity classification asynchronously (a hosted API or your own model). High confidence → auto-remove. Medium confidence → queue for human. Reduces the human queue by ~80%.
- **User-report threshold auto-action.** If a comment hits 10+ reports within an hour, auto-hide it pending review. Frees mods from chasing the obvious cases.
- **Author reputation tracking.** Comment Service writes per-user counters (comments published, comments removed by mods, votes received). The pre-check uses these.
- **Read replica.** Primary + 2 read replicas. Reads go to replicas; writes go to primary. Replication lag ~1s, acceptable.

**What you do *not* yet build:**

- No DB sharding. 100GB of data fits comfortably on one machine.
- No WebSocket updates. UI still polls every 30s. Nobody is asking for sub-30s latency yet.
- No multi-region. Single region serves everything.

**Why this is enough:**

- 100k comments/day = ~1.2/sec sustained, ~5/sec peak.
- Read rate hits ~5k/sec at peak; CDN absorbs 95%+; origin sees ~250/sec which is fine.
- Hot comment vote rate (500/min = 8/sec) is absorbed by Redis; DB sees one UPDATE per 5s.

**Cost:** ~$1.5k/month (bigger DB + replicas, Redis cluster, CDN bill, ML toxicity API).

#### Stage 4: 1M comments/day (HackerNews scale, viral site)

**What just broke:**

- The hottest article in a viral moment now sees 1000 votes/sec on a single comment. Even your 5s batch flush is a 5000-delta UPDATE on one row; the row lock starts to matter.
- One article hits 5000 comments. Building the tree in memory and rendering JSON takes 800ms per cache miss. When the cache expires, a thundering herd hits the DB and OOMs the Read Service pods.
- Users on mobile complain the site feels "dead" without live updates. Competitors have real-time replies.
- The moderation queue still has 500-comment-per-day backlogs during news events. The team wants to "do something."
- The Postgres primary is at 70% of its CPU and you are out of vertical headroom. A single misbehaving query causes pages.

**What you add:**

- **Shard the comments table by `article_id`.** 16 to 64 shards via hash. Each shard is its own Postgres. Hot articles distribute across shards. One bad article does not slow down the others.
- **Kafka first, DB second on the write path.** A new comment writes to Kafka synchronously, returns 201, and a worker consumes Kafka and writes to Postgres. Lets the DB lag behind write spikes without blocking users. The cache is updated from the Kafka stream so reads are not behind. Trade-off: the comment exists in Kafka and the cache before it is in Postgres for up to a few seconds.
- **WebSocket fan-out for real-time updates.** A separate WebSocket service maintains per-article subscriptions. When a comment is posted, the comment.created Kafka event triggers a broadcast to all subscribers on that article. Subscribers see new replies appear without refresh. Vote counts update live.
- **In-process LRU cache on the Read Service.** A 10k-entry in-process cache in each Read Service pod. Hot articles never leave memory. Reduces Redis load. Stale-while-revalidate so the herd cannot pile up on expiry.
- **Sub-tree pagination.** A 5000-comment article does not return all 5000 at once. Top-level comments paged by cursor. Each top-level comment carries the first 3 replies inline, with a "show more replies" cursor.
- **Auto-action thresholds tighter.** Comments with very high toxicity scores auto-remove without queue. Mods only see the medium-confidence band. Queue size becomes manageable.
- **Multi-region read replicas.** Read Service runs in 3 regions, each with local Redis and local Postgres replica. Writes still go to the primary region (with cross-region async replication).
- **Brigading detection.** When a comment receives an unusually high vote velocity from accounts with low prior activity, dampen the votes (count them less) and flag the comment for review.

**Why this is enough:**

- 1M comments/day = ~12/sec sustained, ~50/sec peak. Across 16 shards = ~1/sec per shard average, ~5/sec peak per shard. Each shard is small.
- Hot comment: 1000 votes/sec absorbed by Redis. The DB sees one UPDATE per second on the row when the flusher runs.
- Cache: 99%+ hit rate at the CDN, ~95% at Redis. Origin pods see ~100 cache-miss reads/sec across all articles. Tiny.

**What you would do at 10M comments/day:**

- Dedicated counter store (separate from primary DB) for scores and reply_counts, never touched by the application path.
- Per-shard moderation workers (currently one pipeline; at 10M/day you partition the moderation pipeline too).
- Tiered storage: hot comments (last 30 days) in Postgres, cold comments in a separate read-optimized store (ClickHouse, S3 + Parquet). Most reads are for recent articles; old comments rarely re-render.
- A separate "search" service backed by Elasticsearch for comment search.

**Cost at Stage 4:** ~$20-50k/month depending on region count, CDN volume, and ML toxicity inference bill.

The lesson: at each stage the architecture is the *minimum* needed to handle the current pain. Building Stage-4 features at Stage-1 scale is the most common over-engineering mistake.

### 9. Reliability

**Vote double-counting.** Multiple requests, network retries, browser double-clicks. The dedup happens at the Redis hash level: existing value compared, delta computed, hash updated atomically (Lua script ensures atomicity). User clicks Upvote twice fast → the second click sees existing = 1, new = 1, delta = 0, no-op.

**Vote loss if Redis dies.** Up to 5 seconds of votes in the unflushed delta keys. Mitigations:
- Redis AOF + replica for crash recovery.
- For belt-and-suspenders: write vote events to Kafka before Redis. The flusher reads from Kafka, not Redis. Kafka is durable; if a vote made it to Kafka, it is not lost. Redis becomes a real-time counter cache only.
- For most comment systems, 5s vote loss in a crash is acceptable. Choose accordingly.

**Comment write loss if Kafka first, DB second.** If the worker consuming Kafka fails for an extended period, comments accumulate in Kafka but do not land in Postgres. Reads against the DB see a partial truth. Mitigations:
- Reads serve from cache + Kafka stream merged, not only from DB.
- Alert when worker lag exceeds 30 seconds.
- For ultimate consistency, can also synchronously write to DB and Kafka with a 2-phase pattern (outbox). Slower but no lag possible.

**Moderation backlog.** Mods overwhelmed during a news event. Auto-action thresholds tighten dynamically: if the queue exceeds N items, automatically promote comments with toxicity > 0.7 from "review" to "remove." Prevents the queue from spiraling.

**Cache stampede.** Hot article's cache expires. 10k concurrent reads hit the origin. Mitigation:
- Stale-while-revalidate: serve the stale cached value while one request refreshes.
- Per-key request coalescing in the Read Service: only one DB fetch per article in flight; the rest wait on a future.
- Jittered TTLs so all cache keys do not expire at the same second.

**DB primary failover.** Promote a replica. ~30-60s of write unavailability. During that window, comment posts queue in Kafka (in the Stage-4 design); they land after recovery. Votes hit Redis and flush whenever the DB is back.

**One bad comment cascading.** A user posts a comment that triggers a bug (e.g., contains a character sequence that crashes the renderer). One article's cache fails to build → users see no comments. Mitigation: render comments individually; failures isolated per comment, replaced with a "this comment could not be rendered" placeholder. Single bad row never blocks the tree.

### 10. Observability

| Metric | Why it matters |
|--------|----------------|
| `comment.created.rate` | Sudden spike = bot or viral moment. Sudden drop = auth broken. |
| `comment.pre_check.latency.p99` | Must stay under 50ms; if it grows, the write path slows. |
| `comment.auto_removed.rate` | Should stay <5% of total. Higher = pre-check too aggressive (false positives). |
| `comment.pending_review.rate` | The queue growth rate. Higher than `moderation.resolve.rate` means backlog growing. |
| `cache.hit_rate` (Redis tree cache) | <90% = cache too small or churn too high. |
| `cache.miss.fetch.latency.p99` | DB fetch + tree build time. >500ms = trees getting large. |
| `vote.delta.flush.lag` | Time since last successful flush. If >30s, votes piling up in Redis. |
| `vote.flush.batch_size` | Avg deltas per flush. Spikes during virality. |
| `flag.open.count` | Number of unresolved user reports. Should trend down. |
| `moderation.queue.depth` | Items awaiting human review. Page when >500 for 30 min. |
| `moderation.queue.age.p99` | How long items wait. SLO: <2 hours. |
| `tree.depth.p99` per article | Helps catch abusive nesting attempts. |
| `tree.size.p99` per article | Helps catch pathologically large threads. |
| `replica.lag.p99` | Must stay <2s for the dashboard to feel current. |

Alerts:
- Page: write error rate > 2% for 5 min, vote flush stalled > 60s, cache hit rate < 70% for 10 min.
- Ticket: moderation queue depth growing > 1 hour, edit history table growing faster than comment table (someone is iterating edits maliciously).

### 11. Common gotchas

1. **Deep threads.** Without a depth cap, the path string grows unbounded and one user replying to themselves 500 times deep can produce a 5KB path. Cap depth at ~10 visible levels; deeper replies get rendered as siblings at the cap level (Reddit's behavior).
2. **Deleting a comment with replies.** Hard delete orphans the children. Always soft-delete with a tombstone. Body becomes `[deleted]`, author goes to NULL, state changes, but the row and path stay.
3. **Rate limit too tight.** If you cap comments at 1/min you hurt power users in active discussions. 10/min per user is the typical balance. Per-IP rate limit catches bots; per-user catches griefers.
4. **Edit window vs immutable history.** A common pattern: free edit for 5 minutes (no history saved). After 5 min, edits are saved to history and the UI shows "(edited)". After 24 hours, edits are no longer allowed for non-admins. Strikes a balance between typo-fixing freedom and accountability.
5. **Vote on own comment.** Forbid by default. Some systems auto-upvote the author's comment; either way be explicit.
6. **Score going negative.** A comment downvoted to -100 should be auto-hidden ("This comment is hidden due to community score"). Show on click. Reddit calls this "below threshold."
7. **Pagination cursors stable under writes.** A new comment posted while a user scrolls should not shift their pagination. Cursor by `(score, comment_id)` is stable; offset is not.
8. **Edit during moderation review.** Author edits a comment while it sits in the moderation queue. Now the moderator is reviewing different content from what was reported. Either lock edits while in review, or display the version reported alongside the current version.
9. **Reply-count drift.** Denormalized `reply_count` can drift if updates are missed. Nightly reconciliation job recomputes from `parent_id` joins.
10. **Cache invalidation on comment-level changes.** Editing one comment in a 5000-comment tree should not invalidate the whole tree's cache. Use sub-tree cache keys (per-thread caching) or include the comment_id as part of the cache version, allowing partial refresh.

### 12. Follow-up answers

**1. A comment with 200 replies is deleted.**

Soft delete:
- `UPDATE comments SET state = 'removed_self', body = '[deleted]', author_id = NULL WHERE comment_id = ?`.
- The 200 replies are untouched. Their `parent_id` still points at the deleted comment. Their `path` strings still include the deleted comment's ID.
- On render, the deleted comment shows as `[deleted]` (italicized or grayed). The 200 replies render normally underneath.
- The user's other comments are unaffected. Their vote totals on the deleted comment remain (the votes table is untouched; only the comment body/author changed).
- Cache for the article is invalidated. Next read rebuilds the tree.

**2. A user spams 1000 comments in 10 seconds.**

Multiple defenses in order:
- API Gateway rate limit: 10 comments/min per user, 50/min per IP. The 1000 in 10 seconds gets stopped at request 11 (rate limit returns 429).
- If they rotate accounts: per-IP rate limit catches them.
- If they rotate IPs (botnet): the synchronous pre-check catches them via behavioral signals (account age, comment cadence, link density). New accounts posting links at high rate go to pending_review.
- After 3 strikes within an hour, account is auto-shadow-banned.

Legitimate user posting 5 comments in a minute during a hot discussion: 5 < 10 cap, passes. No friction.

**3. Edit window vs immutable history.**

Free edit window: first 5 minutes. No history saved, no "(edited)" badge. Typo fixes.

After 5 minutes:
- Edits allowed for up to 24 hours.
- Each edit saves the prior body to `edit_history`.
- The "(edited)" badge appears on the comment.
- Clicking the badge shows the edit timeline.

After 24 hours: edits no longer allowed for normal users. Admins can still edit (heavily audited).

For moderation: when a comment is reported, the version reported is snapshotted into the moderation queue record. The moderator sees both the reported version and the current version side by side. If the author edits the comment while it is in review, the moderator decides on what was reported.

Why this trade-off: trivial edit window lets users fix typos without polluting the history. Mid-term editability with history preserves accountability. Long-term immutability is required for context-stable discussion ("you can't see what they originally said" breaks comment threads).

**4. The "hot" sort algorithm.**

Reddit's classic "hot" formula:

```
def hot_score(ups, downs, created_at):
    score = ups - downs
    order = log10(max(abs(score), 1))
    sign = 1 if score > 0 else (-1 if score < 0 else 0)
    seconds = (created_at - epoch).total_seconds() - 1134028003   # Reddit's epoch
    return round(sign * order + seconds / 45000, 7)
```

Key properties:
- Logarithmic on score: 10 upvotes is 1 order of magnitude; 100 upvotes is 2. Diminishing returns.
- Linear in time: newer comments have higher base score. A comment posted now starts above one posted yesterday, even with fewer votes.
- The constant `45000` (seconds, ~12.5 hours) controls the half-life. After 12.5 hours of age, a comment needs ~10x more votes to outrank a fresh one.

If you sort purely by score (no time decay), the front page never changes. The first viral comment from yesterday stays at the top forever. New comments cannot break in. Time decay is what keeps the front page fresh.

For comments specifically, the same formula works. Most sites tune the half-life shorter (comments turn over faster than top-level posts).

**5. New comment, cached tree now stale.**

Trade-off: full invalidation vs partial update vs accept staleness.

- **Full invalidation:** simplest. DEL the cache key, next read rebuilds. Cost: rebuild time on next read. Fine if rebuilds are <100ms.
- **Partial update:** modify the cached value in place to add the new comment to the right subtree. Hard to get right (concurrent updates, ordering, sort recomputation). Usually not worth it.
- **Accept staleness:** TTL of 60s, new comments appear up to 60s late. The cheapest option; only viable if your UX tolerates the lag.

Most systems pick **full invalidation with stale-while-revalidate**. On write: invalidate. On next read: refresh in background, serve stale value during the refresh. Combines fresh updates with no cache-stampede risk.

**6. 50 users report a comment in 5 minutes.**

Threshold-based auto-action.

- Track reports per comment with a sliding window (Redis sorted set keyed by comment_id, members are flag_ids with timestamps as scores).
- If `reports_in_last_hour >= 10` and `reports_in_last_5_min >= 5`: auto-hide the comment (state changes to `pending_review`, no longer visible to other users). The comment goes to the front of the human moderation queue.
- If `reports_in_last_hour >= 25`: auto-remove. Skip the human (still queue for audit, but the comment is hidden immediately).

Where the thresholds come from: tuning over time, balancing false-positive (community brigading a legitimate comment) vs false-negative (real spam stays up too long). Account for the reporting users' own reputation: 10 reports from new accounts count less than 5 reports from established users.

**7. Real-time updates via WebSocket.**

Architecture:

```
        Client (WebSocket connection per browser tab)
                          │
                          ▼
        ┌──────────────────────────────┐
        │  WebSocket Gateway Pods      │  Holds the open connections.
        │                              │  Subscribes Pod → set of articles.
        └──────────────┬───────────────┘
                       │ subscribe(article_id)
                       ▼
        ┌──────────────────────────────┐
        │  Redis Pub/Sub               │  Channel per article:
        │                              │  comments:article:42
        └──────────────────────────────┘
                       ▲
                       │ publish on comment.created
        ┌──────────────────────────────┐
        │  Kafka consumer              │  Reads comment.created topic,
        │                              │  re-publishes to Redis pub/sub.
        └──────────────────────────────┘
```

When a comment is posted:
- Kafka event → consumer → Redis publish on channel `comments:article:42`.
- All Gateway pods subscribed to that channel receive the message.
- Each pod fans out to its locally connected clients viewing article 42.

How to handle 10k concurrent viewers on one article:
- 10k connections spread across ~10 Gateway pods (1000 each).
- Each pod gets one Redis pub/sub message and fans out to 1000 local clients. Cheap.
- The DB and Comment Service never see the read traffic.

Connection management: WebSockets are cheap idle but each consumes file descriptors. Cap per-pod at ~10k connections; scale horizontally. Heartbeat every 30s to clean up dead connections.

Vote count updates: vote aggregator publishes a delta event every 5s for each comment with changes. Clients update the displayed score from the event stream. They never poll.

**8. Pagination on a 5000-comment thread.**

Strategy:
- Top-level comments paged. Initial load: top 50 top-level comments. Each carries `reply_count` and the first 3 child replies inline. Cursor: `(score, comment_id)` for "hot" sort, `(created_at, comment_id)` for chronological.
- "Load more top-level": fetches next 50.
- "Load more replies under this comment": fetches the next batch under that specific subtree using the path prefix.

API:

```
GET /articles/42/comments?sort=hot&limit=50
  → returns top 50, each with first 3 replies and a cursor for more replies
GET /articles/42/comments?sort=hot&limit=50&cursor=...
  → next page of top-level
GET /comments/cmt_abc/replies?limit=50&cursor=...
  → more replies under one specific comment
```

The path-prefix index makes the "more replies under one" query a single index range scan. The 5000-comment tree is never loaded all at once.

**9. Brigading detection.**

Signals:
- Vote velocity: 200 votes in 60 seconds on a comment that previously had 5 votes/day. Huge anomaly.
- Voter profile: new accounts (age <7 days), no prior activity, voting only on this comment.
- Referrer: votes coming from off-site (Reddit, Twitter, 4chan) instead of organic article view.

Action:
- Mark these votes as "low confidence." They are still recorded (for audit), but the displayed score uses only confidence-weighted votes.
- Hide the comment if confidence-weighted score is positive but raw score is hugely negative (or vice versa). Surface to mods.
- Throttle voting from the implicated account cohort site-wide for 24h.

This is similar to how Reddit handles brigading: vote fuzzing where the displayed score deviates from the raw count under suspicious conditions.

**10. GDPR delete of 4000 comments over 5 years.**

User submits delete request.

- For each comment: `UPDATE comments SET body = '[deleted]', author_id = NULL, state = 'removed_self' WHERE author_id = ?`. Same as a normal soft delete.
- Tree structure preserved. Replies underneath remain.
- The `votes` rows by this user: also anonymize. `UPDATE votes SET user_id = NULL` is not ideal (PK conflict). Instead delete the vote rows. The comment scores remain unchanged (the votes already aggregated into the score; deleting the vote row does not change the score).
- The `edit_history` rows: replace `prior_body` with `[deleted]`, NULL the `edited_by`.
- The `flags` rows reported by the user: delete (their reports are part of their data).

Process:
- Scan all shards for `author_id = X`. Parallel queries.
- Soft-delete each comment.
- Invalidate caches for every affected article (could be thousands).
- Confirm completion within 30 days.

Edge case: a comment by the user that has 500 replies. The replies are not the user's data; they are other users' content. The user's comment becomes `[deleted]`, but the conversation thread underneath stays.

If the user wants the *replies* removed too, that is a different request and usually not part of GDPR (other users own that content).

### 13. Trade-offs and what a senior would mention

- **Sort order: by votes? chronological? hot? "best"?** Different sites have different defaults:
  - **HackerNews:** "best" by default. A modified Wilson confidence interval (`up - down` adjusted by the uncertainty of small sample sizes). A comment with 10 ups and 0 downs ranks higher than one with 50 ups and 30 downs. Mathematically sound but feels weird to new users ("why is this 1-vote comment above the 100-vote one?").
  - **Reddit:** "hot" by default (the log-time-decay formula). Top-level comments use "best." Both at once.
  - **Discord/Slack:** chronological. No voting. Threading is loose.
  - **Disqus:** "newest" by default with an option for "best" (Wilson).
  - The choice signals what kind of discussion you want: chronological feels like chat; "best" feels like quality-curated discussion; "hot" feels like a feed.
- **Controversial.** Some sites surface a "controversial" sort: comments with many votes on both sides. The formula: `min(ups, downs) × (ups + downs) ^ 0.5`. A comment with 100 ups and 100 downs scores very high; a comment with 200 ups and 0 downs scores zero. Useful for finding heated debates.
- **Why Postgres over Cassandra.** Tree fetches with path prefix work well on B-tree indexes. Strong consistency for votes is free. Total data size (~250GB/year) fits comfortably in a sharded Postgres. Cassandra would need application-side consistency for vote dedup.
- **Why not graph DB.** Trees are not really graphs (no cycles, no many-parents). Graph DBs (Neo4j) add operational complexity without benefit at this scale.
- **Why not event-source the comments.** Tempting (every change is an event, current state is a fold). The complexity of building tree views from event logs at read time outweighs the audit benefit. The `edit_history` table gives us the change record we need without rebuilding the whole comment from events.
- **What I would revisit at 10M+ comments/day:**
  - Dedicated counter store for scores (separate from primary DB).
  - Per-shard moderation pipelines.
  - Tiered storage: hot comments in Postgres, cold in ClickHouse + S3.
  - Dedicated search service (Elasticsearch) for comment text search.
  - Consider Cassandra for the votes table specifically (write-heavy, simple keying, no joins needed).

### 14. Common interview mistakes

1. **Hardcoding adjacency list with recursive CTE for fetch.** Works at small scale, falls over at 5000 comments per article. Mention the materialized path early.
2. **Naive UPDATE on the comment row for every vote.** Hot-row meltdown the moment a comment goes viral. Vote aggregator with Redis + batch flush is the canonical answer.
3. **Hard-delete on comments.** Breaks the tree the moment a comment with replies is deleted. Soft delete with tombstone is non-negotiable.
4. **Pre-publish moderation for everything.** Does not scale past a few comments per minute. Post-publish with fast async takedown is what every high-volume site does.
5. **No depth cap.** Pathological nesting is a real abuse vector. Cap at ~10 levels.
6. **Forgetting that "rendered tree" is the cache unit.** Caching individual comments forces tree assembly on every read; caching the whole rendered tree per `(article_id, sort)` is what makes reads fast.
7. **Ignoring edit history.** Every interview asks. Have a model: 5-minute free edit, then edits saved with "(edited)" badge.
8. **Vote dedup as an afterthought.** "We'll just check before incrementing" misses the race condition. Dedup must be atomic, either via DB unique constraint or Lua-scripted Redis path.
9. **No mention of soft-delete + tombstone.** The interviewer will ask "what happens to replies under a deleted comment." If you have no answer, you have not thought about the data model.
10. **Treating moderation as a side concern.** It is half the system in production. A junior designs the comment table; a senior designs the moderation queue, the auto-classifier, and the human workflow alongside it.

If you hit 7 of these 10, you are interviewing at staff level. The three that separate seniors are: vote hot-row handling, soft-delete tombstone design, and a confidence-routed moderation pipeline (not a single human queue). Those signal that you have built or operated a comment system at scale rather than designed one in the abstract.
{% endraw %}
