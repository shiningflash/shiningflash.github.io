---
layout: practice-problem
track: system-design
problem_id: 2
title: Design a News Feed (Twitter / Instagram)
slug: 002-news-feed
category: Social & Feeds
difficulty: Hard
topics: [fan-out, timeline, hot users, ranking, caching]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/002-news-feed"
solution_lang: markdown
---

{% raw %}
## Scene

The interviewer used to work on Twitter's home timeline team. They open with:

> *Design Twitter. Specifically the home timeline: the chronological-ish list of posts from people you follow, plus some "you might like" injection. Walk me through it.*

Then they sit back. The prompt looks like "design a feed," but what they actually want to hear about is fan-out. Miss that and the rest of your 40 minutes drawing boxes doesn't add up to much.

## Step 1: clarify before you design

Take 5 minutes. What do you ask? Don't read further until you have at least six questions written down.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. Scale. "Daily active users? Average follower count? Heaviest user's follower count? Posts per day?" Twitter-like answers: 300M DAU, median 100 followers, max user 100M followers, 500M posts/day. That one number (the heaviest user) tilts the whole design.
2. Timeline semantics. "Strict chronological, or ranked? If ranked, by what signals?" Modern Twitter, Instagram, and Facebook are all ranked. The architecture for a ranked timeline is meaningfully different because there is an ML scoring layer on the read path.
3. Latency target. "What is the P99 for loading the home timeline?" Sub-200ms is the bar for a feed app to feel responsive.
4. Read/write ratio. "Roughly how many timeline loads per post?" Heavily read-skewed. 100:1 read-to-write is typical. This is what justifies precomputed timelines.
5. Freshness. "How fresh must the timeline be? Can a post take 5 seconds to appear in followers' timelines?" The usual answer is "a few seconds is fine, but a user's own post must appear instantly in their own feed."
6. Media in posts. "Are we showing images and video inline, or just text?" If media, there is a separate CDN and thumbnail pipeline. In this round we focus on the feed itself, but I'd mention it.
7. Notifications. "Is the notification system part of this design, or separate?" Separate is the right answer. The feed is the home timeline; notifications are a different stream.
8. Personalization scope. "Just people I follow, or also recommended posts from accounts I don't follow?" Adds an injection step in the read path.

If you only asked "how many users," you missed the most important question: the heaviest user's follower count. That number alone decides whether you can push or have to pull for some users.

</details>

## Step 2: capacity estimates

Inputs from the interviewer:

- 300M DAU
- Median user: 100 followers
- P99 user: 1M followers
- Top user: 100M followers
- 500M posts per day
- Each user loads timeline ~10x/day
- Timeline shows the latest 50 posts

Compute:

1. Posts per second (sustained, peak)
2. Timeline loads per second (sustained, peak)
3. Fan-out volume per second under naive push (every post writes to every follower's timeline)
4. Storage for precomputed timelines, assuming 1000 posts kept per user
5. Why naive push breaks for a celebrity user

<details>
<summary><b>Reveal: the math</b></summary>

Posts per second.
500M / 86400 ≈ 5800 posts/sec sustained. Peak 3x → **17K posts/sec**.

Timeline loads per second.
300M × 10 / 86400 ≈ 35K loads/sec sustained, peak ~100K loads/sec.

Naive fan-out volume.
On average each post fans out to 100 followers. 5800 posts/sec × 100 = **580K timeline writes/sec sustained**, ~2M peak. Doable, but distribution matters.

Storage for precomputed timelines.
300M users × 1000 posts each × 50 bytes per timeline entry (just post_id + author_id + ts) = **15TB**. Sharded, fits.

Where naive push breaks.
One tweet from Elon (100M followers) is 100M writes for a single post. At peak we'd see ~17K of these per second in the worst case, generating 1.7 trillion writes/sec. Even one celebrity post per second is 100M writes for that single event. The fan-out worker queue gets buried, replication lag explodes, the rest of the system suffers.

The insight: the heaviest user breaks naive push. The design has to treat them differently.

</details>

## Step 3: the central design choice. Push, pull, or hybrid

This is the heart of the question. Before drawing anything, decide your approach. Take 10 minutes to think through:

- Push (fan-out on write). When user A posts, copy the post_id into every follower's timeline cache.
- Pull (fan-out on read). When user B opens their timeline, query every account they follow and merge.
- Hybrid. Push for users with < N followers, pull for celebrities.

For each, ask: what is the latency to read? To write? What breaks at scale? And what about a user who follows 5000 accounts?

<details>
<summary><b>Reveal: comparison</b></summary>

| Approach | Read latency | Write cost | Falls apart when |
|----------|--------------|------------|------------------|
| Push | ~10ms (precomputed) | O(followers) per post | A celebrity posts. 100M writes per post crushes the system. |
| Pull | O(following) per read. ~500ms for active users. | O(1) per post (one write). | A heavy follower (someone following 5000 accounts) opens their app. 5000 fan-in queries. |
| Hybrid | ~10ms for normal users; slightly higher for users who follow celebrities. | Bounded fan-out (push only for authors below a threshold). | Boundary effects: how do you decide who is a celebrity? Edge cases around the threshold. |

I'd go hybrid:

- Push for normal users posting (median 100 followers). Cheap.
- Pull for celebrities posting (anyone with > 1M followers). Their posts are not pushed; instead, when a follower opens their timeline, we merge in any recent celebrity posts from accounts they follow.
- The detection threshold is dynamic, not just 1M. You may set it lower for users who tweet frequently (high fan-out × high volume = same load) or higher for users who rarely post.

The exact threshold is tunable. Measure system load and adjust.

</details>

## Step 4: sketch the high-level architecture

Fill in the four `[ ? ]` placeholders. Hint: the timeline service is what serves reads; you need somewhere to store the precomputed timelines; you need a worker pool to do the push fan-out; you need a way to merge in celebrity posts.

```
       Client (mobile, web)
              │
              ▼
       ┌─────────────┐
       │   API GW    │
       └──┬───────┬──┘
          │       │
   read   │       │  write (post)
          │       │
          ▼       ▼
   ┌──────────┐ ┌──────────┐
   │   [ ? ]  │ │   Post   │  (stores posts in canonical store)
   │ (read)   │ │  Service │
   └────┬─────┘ └────┬─────┘
        │            │
        │            ▼
        │       ┌────────────────┐
        │       │   [ ? ]        │  (gets the post and dispatches fan-out)
        │       └────────┬───────┘
        │                │
        ▼                ▼
   ┌──────────┐   ┌──────────┐
   │   [ ? ]  │◄──┤   [ ? ]   │  (workers that write into per-follower timeline lists)
   └──────────┘   └──────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
       Client (mobile, web)
              │
              ▼
       ┌─────────────┐
       │   API GW    │
       └──┬───────┬──┘
          │       │
   read   │       │  write (post)
          │       │
          ▼       ▼
   ┌──────────┐ ┌──────────┐
   │ Timeline │ │   Post   │  Canonical post store.
   │ Service  │ │  Service │  Cassandra or Postgres sharded by post_id.
   │ (reads)  │ └────┬─────┘  Source of truth for post content.
   └────┬─────┘      │
        │            ▼
        │      ┌───────────────┐
        │      │  Fan-out      │  Reads new post from Post Service,
        │      │  Dispatcher   │  decides push vs pull per follower group,
        │      │  (Kafka cons.)│  emits per-follower tasks.
        │      └─────┬─────────┘
        │            │
        │            ▼
        │      ┌──────────────────┐
        │      │  Fan-out         │  Pool of stateless workers.
        │      │  Workers (N pods)│  Each task writes one timeline entry.
        │      └─────┬────────────┘
        │            │
        ▼            ▼
   ┌────────────────────────────┐
   │   Timeline Store (Redis    │  Precomputed per-user list of recent
   │   + spillover to KV / Cass)│  post_ids. Capped at ~1000 per user.
   │   Sharded by user_id.      │  Hot data in Redis, cold in KV.
   └────────────────────────────┘

   On read, Timeline Service does:
     1. Fetch precomputed list of post_ids from Timeline Store.
     2. For each celebrity that this user follows, pull recent posts (separate path).
     3. Merge + rerank.
     4. Hydrate post_ids → full post content via Post Service.
     5. Return.
```

Component responsibilities:

- Post Service. Owns the canonical post record. Returns full content given a post_id. Sharded by post_id hash. Read-replicated.
- Fan-out Dispatcher. Consumes the `posts.created` Kafka topic. Looks up the author's follower count. Under threshold, emit N "push to timeline" tasks. Over threshold, do nothing (the pull path handles celebrities).
- Fan-out Workers. Stateless pool. Each consumes one timeline-write task and writes a post_id into the target follower's timeline list. Auto-scales with queue depth.
- Timeline Store. Per-user sorted list of post_ids. Hot users (active in the last week) in Redis; cold users in Cassandra. Tiered.
- Timeline Service. The read path. Fetches the user's precomputed list, merges in celebrity content from the pull path, hydrates and reranks, returns.

</details>

## Step 5: handling the heavy follower (a user who follows 5000 accounts)

In a push-only world, this user's timeline has 5000 sources writing to it. Fine. In hybrid (push + pull-for-celebs), the same user might follow 50 celebrities. Every timeline load does 50 parallel reads. Is that OK? How do you make it OK?

<details>
<summary><b>Reveal: heavy-follower handling</b></summary>

50 parallel reads per timeline load is OK if:

1. Each read is fast (under 20ms): query a per-author "recent posts" list, which is itself cached.
2. The reads run in parallel, not sequentially: orchestrate them in the Timeline Service.
3. The merged result is cached: if user X loads their timeline at T1 and T1+30 seconds, the second load reuses most of T1's result.

The pattern: each celebrity has a "recent 50 posts" list cached in Redis. Pulling from 50 such lists is 50 hits to the same Redis cluster, served from memory, under 20ms total in parallel. That is much cheaper than push, which would have written 100M entries for that celebrity's last post (including writes for users who will never see that timeline today).

The key insight: pull is expensive per active user but bounded; push is cheap per active user but unbounded for celebrities. Hybrid takes the best of both.

</details>

## Step 6: ranking (timeline is not strict chronological)

Modern timelines are not chronological. Posts are ranked by an ML model: predicted engagement, recency decay, diversity penalties. Where does ranking live in your architecture? Should the precomputed timeline already be ranked, or is ranking on the read path?

<details>
<summary><b>Reveal: ranking placement</b></summary>

Ranking lives on the read path, not in the precompute.

Why:
- The model changes often (the ML team ships new versions weekly). If you ranked at write time, you'd have to recompute every user's stored timeline whenever the model changed.
- Ranking inputs are user-state dependent: how recently the viewer interacted with this author, what the viewer is doing right now (which page came before this load), and so on. You can't capture that at write time.
- Ranking runs on a candidate set of ~200 posts to pick 50. Doing that at read time, after the candidate set is assembled, is bounded and cheap.

Pipeline:
1. Candidate generation: take the top 200 most recent post_ids from the user's timeline list (push path) plus recent celebrity posts (pull path).
2. Feature lookup: fetch features (author engagement signals, viewer history) for the candidates. Heavily cached.
3. Score: send the 200 candidates through the ML scoring service. ~50ms.
4. Pick top 50, apply diversity rules ("no more than 2 posts from the same author in a row"), return.

The score model is a separate service. The Timeline Service doesn't know how it works; it just sends candidates and gets scores back. That separation matters, because the ranking team owns the model lifecycle.

</details>

## Step 7: read the full solution

You have the core: fan-out, hybrid celebrity handling, ranking placement. The solution covers database choices, multi-region replication, the user "block" feature (which complicates fan-out), and the day-2 problems you only discover after launch.

## Follow-up questions

Try answering each in 3 to 4 sentences before reading the solution.

1. A user blocks another user. How do you make sure the blocked user's old posts no longer appear in the blocker's timeline? Delete from the precomputed timeline, or filter at read time?
2. A user unfollows someone. Do you remove that author's posts from their existing timeline immediately, or let them age out naturally?
3. A user deletes a post. It might be sitting in millions of precomputed timelines. How do you handle that, given that scrubbing 100M timeline lists is expensive?
4. A new user signs up and follows 50 accounts immediately. Their timeline is empty until those accounts post. How do you bootstrap it?
5. Cold users. A user who has not opened the app for 30 days has stale timeline data. Do you keep precomputing for them?
6. Backfill for new follow. User A follows user B. Does A's timeline retroactively get B's last few posts?
7. Real-time updates (a new post appears while you're scrolling). Push the new post over WebSocket, or just refresh on pull-to-refresh? Trade-offs.
8. Pagination beyond the first 50. How do you paginate? Cursor on what? What if posts have been deleted since the cursor was issued?
9. You see in observability that one fan-out worker is processing 100x the load of others. Diagnose.
10. Your CEO wants to add "see posts from people you don't follow but might like" injection at position 5, 15, 25 of every feed. Where does this go in the pipeline? What is the latency cost?

## Related problems

- [Chat System (003)](../003-chat-system/question.md). The same delivery and fan-out problem applies to chat (DMs are 1-to-1 fan-out instead of 1-to-many, but the patterns rhyme).
- [Notification System (010)](../010-notification-system/question.md). The notification pipeline shares the fan-out worker pool pattern and the celebrity problem.
- [Distributed Cache (009)](../009-distributed-cache/question.md). The timeline store leans hard on Redis; you should know its limits.
- [Typeahead (005)](../005-typeahead-autocomplete/question.md). Both this problem and search have the "ranked candidate generation" two-stage architecture.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a News Feed (Twitter / Instagram)

### TL;DR

The news feed problem is fundamentally about fan-out. Naive "write everywhere" (push) breaks the moment one user has more than ~100k followers. Naive "read everywhere" (pull) breaks the moment one user follows more than a few hundred accounts. The right answer is hybrid: push for most users, pull for celebrities, with the threshold tuned by measured system load.

The architecture has two parallel paths feeding one read path. The push path writes post_ids into precomputed per-follower timeline lists in Redis. The pull path serves celebrities by maintaining "recent posts" lists per author that followers query at read time. The Timeline Service merges both, ranks the candidates through an ML scoring service, and returns 50 posts.

The interesting engineering is in the asymmetries: detecting a "celebrity" dynamically, keeping timelines fresh without scrubbing 100M rows when a post is deleted, keeping ranking flexible without precomputing scores, and handling the dozen edge cases (blocks, unfollows, new sign-ups) that each have their own subtle behavior.

### 1. Clarifying questions

Covered in question.md. The single most important question is the heaviest user's follower count. That number alone decides whether naive push works or you have to go hybrid.

### 2. Capacity estimates

From the question:

- 5800 posts/sec sustained, 17K peak.
- 35K timeline loads/sec sustained, 100K peak.
- 580K timeline writes/sec under naive push (already painful, before celebrities).
- 15TB for precomputed timelines.

The decisive observation: one celebrity post = 100M writes. Even one per second is too much for fan-out workers. Naive push is impossible.

### 3. API design

Read timeline:

```
GET /api/v1/timeline/home?cursor=<opaque>&limit=50
Authorization: Bearer <token>

Response (200):
{
  "posts": [
    { "id": "1234567890", "author": {...}, "content": "...", "created_at": "...", "likes": 42, "media": [...] },
    ...
  ],
  "next_cursor": "<opaque>"
}
```

The cursor is opaque. Internally it encodes (last_seen_post_id, last_seen_score, timestamp). Opaque so we can change the pagination scheme without breaking clients.

Create post:

```
POST /api/v1/posts
{
  "content": "Hello",
  "media_ids": ["mid1", "mid2"]    # uploaded separately via media service
}

Response (201):
{ "post_id": "1234567890", "created_at": "..." }
```

The 201 comes back as soon as the post is durably stored. Fan-out happens asynchronously. The user sees their own post in their own feed immediately (the client optimistically prepends it); other users see it within a few seconds.

### 4. Data model

Posts table (sharded by post_id):

```sql
CREATE TABLE posts (
    post_id          BIGINT PRIMARY KEY,        -- Snowflake-style: ts + shard + seq
    author_id        BIGINT NOT NULL,
    content          TEXT NOT NULL,
    media_ids        JSONB,
    reply_to_post    BIGINT,
    repost_of_post   BIGINT,
    created_at       TIMESTAMPTZ NOT NULL,
    deleted_at       TIMESTAMPTZ,                -- soft delete
    visibility       SMALLINT NOT NULL DEFAULT 1 -- 1=public, 2=followers, 3=private
);
CREATE INDEX idx_author_created ON posts (author_id, created_at DESC) WHERE deleted_at IS NULL;
```

Follows table (sharded by follower_id):

```sql
CREATE TABLE follows (
    follower_id      BIGINT NOT NULL,
    followee_id      BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_followee ON follows (followee_id);   -- reverse for fan-out
```

Why the duplicated indexes. Reading "who do I follow?" is by follower_id (PK). Reading "who follows X?" for fan-out is by followee_id (secondary). The secondary index is colocated in the same shard, so reading it is fast inside the shard but a scatter-gather across shards if you want all of X's followers.

For celebrities, the scatter-gather is unbounded (100M followers split across all shards). The fix: keep a separate denormalized `followers_by_followee` table sharded by followee_id. Reading a celebrity's followers becomes single-shard.

Timeline store (Redis, sharded by user_id):

```
Key:   timeline:{user_id}
Value: sorted set of (post_id, score)   # score = posted_at, for sort
Trim:  keep only top 1000 entries per user
```

For cold users (no activity in 30 days), the Redis entry is evicted; the timeline gets rebuilt on next access. The trade-off is fine: cold users are >50% of the user base and we can't keep 300M timelines hot.

### 5. The core decision: hybrid fan-out

#### Pure push

When user A posts: enqueue N tasks (one per follower). Each worker writes the post_id into one follower's timeline list.

```python
def on_post(post):
    followers = follow_index.get_followers(post.author_id)  # may be huge
    for follower_id in followers:
        timeline_writer.enqueue(follower_id, post.id)
```

This works for small follower counts. For 1M followers, this is 1M task messages on the queue and 1M timeline writes. At 5800 posts/sec, this is fine for normal users. But:

- One celebrity post = 100M tasks. At 17K posts/sec peak, even just 1% of posts being from celebrities is 170 celebrity posts/sec × 100M = 17B writes/sec. Impossible.

#### Pure pull

When user B opens timeline: read recent posts from every account they follow, merge, rank.

```python
def get_timeline(user_id):
    followees = follow_index.get_followees(user_id)
    candidates = []
    for f in followees:
        candidates.extend(post_index.recent_posts(f, limit=20))
    return rank(candidates)[:50]
```

Read latency is O(followees). For someone following 5000 accounts, this is 5000 fan-in reads. Even at 5ms each, sequential is 25 seconds. Parallel: 5000 concurrent requests against the post index per timeline load. Multiply by 35K timeline loads/sec, you get millions of fan-in requests per second.

Doesn't work either.

#### Hybrid: push for the long tail, pull for celebrities

```python
CELEBRITY_THRESHOLD = 1_000_000   # tunable

def on_post(post):
    follower_count = follow_index.follower_count(post.author_id)
    if follower_count <= CELEBRITY_THRESHOLD:
        # Push path
        for follower_id in follow_index.get_followers(post.author_id):
            timeline_writer.enqueue(follower_id, post.id)
    # else: celebrity. Do nothing. The pull path picks them up.

def get_timeline(user_id):
    # Push side: precomputed list
    pushed_ids = timeline_store.get_recent(user_id, limit=200)

    # Pull side: celebrity authors this user follows
    celeb_authors = follow_index.get_celebrities_followed(user_id)  # cached
    pulled_ids = []
    for author in celeb_authors:
        pulled_ids.extend(author_timeline.recent(author, limit=20))

    # Merge and rank
    candidates = pushed_ids + pulled_ids
    return rank_and_pick(candidates, 50)
```

The two paths feed one merge step. Most users have only a handful of celebrity follows, so the pull side is cheap. Most posts are from non-celebrities, so the push side is bounded.

The dynamic threshold: instead of a hard 1M, measure system load. If fan-out queue depth grows, raise the threshold (more authors treated as celebs). If pull-side latency grows, lower it. The threshold is per-author, set by a background job that looks at follower_count and post_rate.

### 6. Architecture (detailed)

```
                                Client (mobile, web)
                                       │
                                       ▼
                                ┌──────────────┐
                                │  API Gateway │  Auth, rate limit, request shaping
                                └──┬───────────┘
                          read     │      write (post)
                                   │
                  ┌────────────────┴────────────────┐
                  │                                 │
                  ▼                                 ▼
          ┌───────────────┐                ┌────────────────┐
          │   Timeline    │                │     Post       │
          │   Service     │                │    Service     │
          │  (stateless)  │                │  (stateless)   │
          └──┬────────┬───┘                └────┬───────────┘
             │        │                          │
             │        │ pull celebs              │ append-only writes
             │        ▼                          ▼
             │  ┌──────────────┐          ┌──────────────────┐
             │  │ Per-author   │          │  Posts DB         │
             │  │ recent-posts │          │  (Cassandra /     │
             │  │ cache (Redis)│◄─────────┤   Postgres        │
             │  │              │  CDC     │   sharded by      │
             │  └──────────────┘          │   post_id)        │
             │                            └────┬─────────────┘
             │                                 │
             │                                 │ CDC / outbox
             │                                 ▼
             │                          ┌──────────────────┐
             │                          │  posts.created   │  Kafka topic
             │                          │  topic           │
             │                          └────┬─────────────┘
             │                               │
             │                               ▼
             │                          ┌──────────────────┐
             │                          │ Fan-out          │  Consumes posts.created.
             │                          │ Dispatcher       │  Looks up author's
             │                          │ (Kafka consumer) │  follower count.
             │                          └────┬─────────────┘  Celebrity? skip.
             │                               │                Else: emit per-follower
             │                               ▼                tasks.
             │                          ┌──────────────────┐
             │                          │ timeline.write   │  Kafka topic
             │                          │ topic            │
             │                          │ (one msg/follower)│
             │                          └────┬─────────────┘
             │                               │
             ▼                               ▼
   ┌─────────────────┐               ┌──────────────────┐
   │  Timeline Store │◄──────────────│  Fan-out Workers │  Stateless pool.
   │  (Redis sharded │   writes      │  (Kafka consumer)│  Each task: write
   │   by user_id)   │               └──────────────────┘  one post_id into
   │  Sorted sets    │                                     one user's timeline
   └────────┬────────┘                                     sorted set.
            │
            │ trim to top 1000
            │ spill to KV for cold users
            ▼
   ┌─────────────────┐
   │  Cold-timeline  │   Cassandra. Holds older entries
   │  KV store       │   for users not in the active hot set.
   └─────────────────┘

   Ranking (called by Timeline Service):
   ┌─────────────────┐
   │  Ranking Service│   Stateless. Calls Feature Store +
   │                 │   ML model. Returns scores for
   │                 │   candidate post_ids.
   └─────────────────┘
```

Why each component:

- Separate Post Service and Timeline Service. Different scaling characteristics. Posts are append-only; timelines are read-heavy with hot-spots.
- Cassandra (or Postgres-sharded) for posts. Posts are write-once, mostly read by ID, occasionally listed by author. Cassandra wins on write throughput; Postgres-sharded gives stronger consistency. Either works.
- Redis sorted sets for hot timelines. Sorted by score (created_at). O(log N) insert. Trim with ZREMRANGEBYRANK to keep top 1000.
- Cassandra for cold timelines. When a user goes inactive for 7 days, we move their Redis entry to Cassandra. When they come back, the read populates Redis again. Saves Redis memory.
- Kafka as the spine. posts.created → fan-out decisions → timeline.write tasks. Decouples write rate from fan-out worker capacity. If workers fall behind, queue depth grows but no data is lost; we backfill.

### 7. Read and write paths

Write path (POST /posts)

1. Client → API GW → Post Service.
2. Post Service validates content and runs a moderation pre-flight (NSFW image checks are async, but obvious abuse like banned keywords is sync).
3. Insert into Posts DB. Use a Snowflake-style post_id so it's globally unique without coordination and sortable by time.
4. Once the insert is durable in the primary shard, reply 201 to the client (~80ms).
5. CDC stream from Posts DB writes the post event to the `posts.created` Kafka topic.
6. Fan-out Dispatcher consumes `posts.created`. Looks up the author's follower count from a cached count (refreshed every 5 min from the follows table).
7. If author is non-celebrity:
   - Stream the author's follower list from `followers_by_followee` (cursored).
   - For each follower, emit a small message to the `timeline.write` topic: `{follower_id, post_id, score=created_at}`.
   - Emit in batches of 10k followers per Kafka message to amortize overhead.
8. If author is celebrity:
   - Write post_id to the author's "recent posts" cache (the pull-path target).
   - Do not emit fan-out tasks.
9. Fan-out Workers consume `timeline.write`. For each task, ZADD into the follower's Redis timeline sorted set, then ZREMRANGEBYRANK to keep the top 1000.

End-to-end latency from post submit to follower's timeline (non-celeb): 1-5 seconds at steady state. Spikes if fan-out queue depth grows.

Read path (GET /timeline/home)

1. Client → API GW → Timeline Service.
2. Timeline Service fetches:
   a. `push_ids`: top 200 post_ids from the user's Redis sorted set. ~5ms.
   b. `celeb_authors`: list of celebrity accounts this user follows. Cached separately, ~2ms.
   c. For each celeb author, fetch their last 20 post_ids from the per-author cache. Parallel. ~10ms for 50 celebs.
3. Merge candidates: ~500 post_ids total (200 push + 300 pull from 50 celebs).
4. Hydrate features for ranking. Batch fetch from Feature Store. ~20ms.
5. Send candidates + features to Ranking Service. Get scores back. ~30ms.
6. Apply diversity rules (no two consecutive posts from the same author; mix of types).
7. Pick top 50.
8. Hydrate full content: batch fetch from Post Service. ~20ms.
9. Return 50 posts.

Total: ~90ms P50, ~200ms P99. Hydration dominates.

### 8. Scaling

#### a. Timeline cache

- Sharded by user_id, hash partitioned across ~64 Redis shards.
- Hot users in Redis. Cold users spilled to Cassandra.
- Hot/cold determined by last activity within 7 days. Background job rotates.
- Total hot users: estimate 30M (10% of DAU). 30M × 1000 entries × 20 bytes = 600GB. Across 64 shards = 10GB per shard. Fits.

#### b. Posts DB

- Sharded by post_id hash. Snowflake IDs are sortable, but we shard by hash to avoid hot writes on recent IDs.
- 500M posts/day × 365 × 5 years = ~1T posts. At ~500 bytes each = ~500TB. 64 shards × 8TB each. Fits.
- Read replicas in each region. P99 replication lag: 1 second.

#### c. Follows graph

- Sharded by follower_id for the forward lookup.
- Separately sharded by followee_id (denormalized) for fan-out.
- Bidirectional consistency is eventually consistent: a follow is written to the forward table first, then async to the reverse. There's a 1-second window where you follow X but X doesn't yet have you in their follower list. That's OK because fan-out tolerates an out-of-date follower list; the next post catches you up.

#### d. Fan-out workers

- Auto-scale on Kafka consumer lag.
- Workers do ZADD + ZREMRANGEBYRANK in one pipeline. ~1-2ms per task.
- One worker pod handles ~5K timeline writes/sec. We need ~580K/sec sustained → ~120 pods. Peak ~400 pods.

#### e. Hot-key on the read path

Some celebrities are followed by everyone (the "Elon problem" inverted: many users following one celeb means many reads of their recent-posts cache). Same hot-key mitigations as URL shortener apply:

- Read replicas of the celeb cache key.
- In-process LRU on Timeline Service.
- Stale-while-revalidate on celeb caches (60-second TTL with background refresh).

### 9. Reliability

- Posts DB shard failure. Posts for that shard are unavailable. Fan-out for posts in that shard is paused (the Kafka consumer for that shard stops). When the shard recovers, the consumer resumes from offset. No data loss.
- Timeline cache shard failure. Reads for users in that shard fall through to Cassandra (cold path), slower but correct. Active users see degraded performance until the shard recovers.
- Fan-out worker failure. No effect; another worker picks up the task. Idempotent: ZADD with the same (member, score) twice is a no-op.
- Ranking service failure. Fall back to chronological ordering of the candidate set. Quality drops, but the feed still works. Most users won't notice.
- Regional failure. Global LB routes traffic to other regions. The home region's stale write data takes 1-2 minutes to fully replicate. Affected users see a slightly stale feed for that window.

### 10. Observability

| Metric | Why |
|--------|-----|
| `timeline.read.p99` by region | Headline SLO |
| `timeline.candidate_count.p50` | If <100, ranking quality drops |
| `fanout.queue_depth` | Leading indicator of stale timelines |
| `fanout.write_lag_p99` (time from post → timeline write) | Should be under 5s |
| `fanout.celebrity_threshold` | Auto-tuned; alert if extreme |
| `ranking.latency_p99` | Should be under 50ms |
| `cache.hit_rate` (timeline + post + feature stores) | Cascade of cache misses = bad day |
| `post.creation_rate` | Sudden drop indicates auth problems |
| `block.events_per_sec` and resulting cache invalidations | Spikes during attacks |

Alerts:
- Page on: timeline P99 > 500ms for 5min; fan-out lag > 30s; ranking failure rate > 1%.
- Ticket on: celebrity threshold change events (we want to know when the load profile shifts).

### 11. Follow-up answers

1. User blocks another user.

Two options:
- Scrub the precomputed timeline. Find all entries from the blocked user in the blocker's timeline sorted set, remove them. Cheap for individual blocks (O(1000) lookup in one sorted set), but does nothing for celebrity posts (which are on the pull path).
- Filter at read time. Keep a `blocked_users:{user_id}` set in Redis. On every timeline read, filter candidates against this set. Slightly more expensive per read, but uniformly correct across push and pull paths.

I'd filter at read time. The set lookup is O(1) per candidate; for 500 candidates that's 0.5ms. It also kills the bug class where a block partially-but-not-fully clears history.

For posts the blocker wrote *replying to* the blocked user (visibility chains): apply the filter to any reply_to_post resolution too. Subtle but important.

2. User unfollows someone.

The user's precomputed timeline already contains the unfollowed user's posts. Two options:
- Lazy: let those entries age out as new posts push them down (within ~1 day for active users).
- Eager: scan the timeline and remove entries from that author.

Eager scrub is annoying in Redis sorted sets (you have to read all 1000 entries, find ones from that author, ZREM them). Costs ~10ms per unfollow.

Most products go lazy for unfollow. It's not user-visible (the unfollowed person's posts age off quickly anyway). The same logic applies to mute.

3. Post deletion when the post is in 100M timelines.

You can't scrub 100M timeline entries. Instead:

- Mark post as `deleted_at` in Posts DB.
- On the read path: when hydrating post_ids → content, skip entries where `deleted_at IS NOT NULL`. The deletion filters out invisibly.
- Sorted sets eventually shed deleted entries through the natural trim-to-1000.

This is one of the reasons we hydrate post_ids → content at read time rather than storing content in the timeline cache. Lazy filtering at hydration time is free.

4. New user signs up and follows 50 accounts.

Their timeline is empty. Generate it once:

- For each of the 50 followees, fetch their recent 20 posts. Parallel.
- Merge, take top 200, write to the new user's Redis timeline sorted set.

This takes ~100ms. Run it during signup completion as part of the welcome flow. From the user's perspective the timeline "appears" by the time they finish onboarding.

For users who follow celebrities at signup: those go through the pull path on first timeline load (no special handling needed; celebs are never in the precomputed list).

5. Cold users.

A user inactive for 30 days. Do we keep precomputing for them?

No. After 7 days of inactivity:
- Stop fan-out writes to that user's Redis sorted set. The dispatcher checks "is this user warm?" and skips cold ones.
- Move the user's Redis sorted set to Cassandra as backup.
- When they return: detect on login, schedule a "rebuild timeline" task that reads from their followees and reconstructs the sorted set.

This saves a lot of Redis memory and fan-out work. About half of follows are to or from cold users at any moment.

6. Backfill for new follow.

User A follows user B. Should A's timeline retroactively include B's last few posts?

Twitter says yes (you see ~3 recent posts from a newly-followed account immediately). It feels right; without it the new follow feels broken.

Implementation: on follow, fetch B's last ~10 posts and ZADD them to A's timeline (with appropriate scores). Done in the follow request's response path; takes ~10ms.

Edge case: B is a celebrity. They are not in A's precomputed timeline by design. The first timeline read pulls B's recent posts through the celebrity pull path, so no special handling needed.

7. Real-time updates (new post while scrolling).

Two approaches:
- Pull-to-refresh. Simple. User pulls down, client fetches `timeline/home?since=<last_seen_score>`.
- WebSocket push. Server pushes new post_ids to active clients. More work, but feels modern.

For most apps, pull-to-refresh is the right answer. WebSockets are mostly used for real-time notification badges ("3 new posts!"), not for the feed itself. The notification badge is a much smaller channel.

8. Pagination beyond first 50.

Cursor on (score, post_id). Score = post creation timestamp. Tie-breaking by post_id (deterministic) for posts at exactly the same ms.

`GET /timeline?cursor=<score>:<post_id>&limit=50` returns posts strictly below that cursor.

If the post at the cursor has since been deleted: fine; the cursor is a position, not a reference. The deletion just means one fewer result in the page.

The deeper problem: pagination beyond ~500 posts deep is rare and we don't promise stable order. If the user scrolls 1000 posts deep, ranking may have shifted in ways the cursor can't represent. Accept this; nobody scrolls that deep.

9. One fan-out worker processing 100x normal load.

Diagnosis:
1. Check if it's a partition/key issue. Each worker consumes from a Kafka partition. If one partition has hot-key data (one author with disproportionate follower count being in that partition), it gets uneven load. Re-partitioning by `(post_id, follower_id_hash)` rather than just post_id distributes celebs across partitions.
2. Check for a duplicate worker. Two pods consuming the same partition due to a Kafka consumer group bug? Look for duplicate writes in the timeline store.
3. Check the task content. Is one celebrity below the threshold but with a high follower count (just under 1M)? Their fan-out fills one worker.
4. Adjust the celebrity threshold. If a user with 800k followers is in the push path and overwhelming a partition, lower the threshold to put them in pull.

The senior answer goes through all four. The mid-level answer only mentions consumer group rebalancing.

10. "Posts you might like" injection.

CEO request: inject recommendations at positions 5, 15, 25 of every feed.

Where: in the Timeline Service, after ranking but before returning. Two new steps:

1. Candidate generation. A separate `RecommendedPostsService` returns ~20 candidates per request, based on user interests (computed offline) and recent trending posts.
2. Injection. Take the top 50 ranked organic posts, weave in 3 recommendations at fixed positions, return.

Latency cost: one extra ~30ms call to RecommendedPostsService per timeline read. To hide it, parallelize with the existing fetch (don't make it sequential).

Quality risk: recommendations are usually lower quality than followed accounts. You need to measure whether dwell time or engagement drops on injected positions. A/B test before rolling out.

This is also where ad experiments live: position 5/15/25 are perfect "slots" for sponsored content. Productizing this is half the value of the architecture.

### 12. Trade-offs worth saying out loud

- Why not store ranked timelines. Ranking lives on the read path. Reranking precomputed timelines on every model change would be a massive batch job; on read it's candidate-set scoring of 200 items instead.
- Why hybrid and not adaptive per-request. Could we decide push vs pull per timeline read instead of per author? Yes, but the cache locality benefit is small and the system complexity is large. Static-per-author (with dynamic threshold) is simpler.
- Why a separate Posts table and a separate Timelines. Could we just keep posts in the timeline cache? No: posts are 500 bytes (with content); timeline entries are 20 bytes (just post_id). Storing posts in 100M timelines bloats memory by 25x.
- What I would revisit at 10x scale.
  - Federated timeline store: per-region timeline shards with cross-region replication only for celebrities followed across regions.
  - Streaming ranking: continuously update each user's "candidate set" as new posts arrive rather than building it on every read.
  - Move ranking onto edge servers for sub-100ms global P99.

### 13. Common interview mistakes

- "Just push to every follower." Doesn't survive five seconds of celebrity math.
- "Just pull at read time." Doesn't survive a user who follows 5000 people.
- No mention of ranking. Modern feeds are not chronological. If you describe a chronological feed, the interviewer assumes you don't know what feeds look like in 2025.
- Storing post content in timelines. Bloats by 25x. Store post_ids and hydrate.
- Ignoring deletes. What happens when a post in 100M timelines is deleted? "Lazy filter at hydration" is the answer.
- No mention of blocks/mutes. These are real product features that the architecture has to accommodate.
- Sequential reads in fan-in. If you describe pull as "loop over followees and fetch their posts," you'll get 30-second latency. Parallel matters.

If you can hit 8 of these, you're interviewing at staff level. Most candidates miss the hot-key, ranking placement, and post-deletion questions.
{% endraw %}
