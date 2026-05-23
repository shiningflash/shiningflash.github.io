---
layout: practice-problem
track: system-design
problem_id: 10
title: Design a Notification System
slug: 010-notification-system
category: Messaging
difficulty: Medium
topics: [fan-out, retry, deduplication, multi-channel, queue]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/010-notification-system"
solution_lang: markdown
---

{% raw %}
## Scene

The interviewer has spent the last fifteen minutes grilling you on a feed design. They drop that thread and write a new prompt on the whiteboard:

> *Design the notification system for our product. Push, email, SMS. One event in, the right notifications out.*

They lean back. The question looks easy. Read from a queue, call APNs, done. It is not. Notifications are where two ugly problems meet: fan-out (one event becomes many notifications) and external delivery (each channel has its own SLA, failure modes, and rate limits). Get the fan-out wrong and you spam users at 3am. Get the retries wrong and you either drop notifications silently or send the same SMS seven times. Both are user-visible.

The interviewer is watching whether you ask about channels, user preferences, and dedup before you start drawing.

## Step 1: clarify before you design

Take 5 minutes. Write down at least six questions. Do not draw anything yet.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. Which channels. "Push (iOS and Android), email, SMS, in-app? Web push?" Each channel is a different external provider with its own SLA, rate limits, and failure modes. The architecture has to accommodate channel adapters as plug-ins, not bake one in.
2. What triggers a notification. "Are these user-generated events (someone liked your post), system events (your invoice is ready), or marketing campaigns? All three?" Marketing campaigns have a completely different shape (one operator action triggers 10M notifications in a few minutes) versus transactional (one event triggers one or a few notifications).
3. User preferences. "Can users opt out per channel and per event type? Quiet hours? Locale?" Preferences are the single biggest source of "why did I get this" complaints. They must be honored before fan-out, not after.
4. Latency targets. "What is the SLA per channel? Push delivered in under a minute? Email under five? SMS under one?" Each channel has different user expectations. SMS for 2FA is on a strict deadline; a weekly digest email can wait an hour.
5. Aggregation rules. "If a user gets 100 likes on a post in an hour, is that 100 notifications or one?" Almost certainly one ("John and 99 others liked your post"). Aggregation lives in the design as a first-class step, not a hack.
6. Volume and fan-out shape. "How many notifications per day? Largest single event in terms of fan-out?" The shape matters more than the total. 10B/day with even distribution is very different from 10B/day with 90% of it triggered by ten viral events per week.
7. Idempotency. "If the same event arrives twice (because the upstream producer retried), do we send the notification twice or once?" Once. The system needs a dedup key.
8. Compliance. "GDPR, TCPA for SMS, CAN-SPAM for email? Unsubscribe links mandatory?" Each channel has regulatory requirements that change the API and the data model.

If you only asked "how many notifications per day" you missed the question that decides the entire architecture: user preferences. Preferences turn this from a simple queue into a real fan-out system.

</details>

## Step 2: capacity estimates

Inputs from the interviewer:

- 1B users
- 10B notifications delivered per day across all channels
- Channel mix: 60% push, 30% in-app, 7% email, 3% SMS
- Single event fan-out: ranges from 0 (preferences blocked all channels) to 1M (a marketer's broadcast)
- Per-channel SLAs: push <1min P99, in-app <5s P99, email <5min P99, SMS <1min P99
- Worst-case event burst: a marketing campaign fires 10M notifications in 5 minutes

Compute (do this on paper before revealing):

1. Notifications per second sustained and peak
2. Per-channel send rate sustained
3. Storage for delivery records with 30-day retention
4. Burst rate for the marketing campaign and what that means for queue sizing
5. Fan-out worker pool size assuming each worker handles 500 channel-API-calls/sec

<details>
<summary><b>Reveal: the math</b></summary>

Notifications per second. 10B / 86400 is roughly 116K/sec sustained. Peak (3x): about 350K/sec. Total across channels.

Per-channel sustained:

- Push: 60% x 116K = ~70K/sec
- In-app: 30% x 116K = ~35K/sec
- Email: 7% x 116K = ~8K/sec
- SMS: 3% x 116K = ~3.5K/sec

These all sit comfortably under what APNs, FCM, SendGrid, and Twilio quote as their commercial throughput ceilings, but only if you stay within their per-account rate limits. SMS in particular has carrier-level caps (typically 100 messages/sec per long code, hundreds per short code). You will hold many sender identities, not one.

Storage for delivery records. One row per delivery: `{notification_id (16B), user_id (8B), channel (1B), event_id (16B), template_id (8B), status (1B), sent_at (8B), provider_msg_id (32B), retries (1B), ~30B overhead}` is about 120 bytes. 10B x 120B = 1.2TB/day. 30 days is ~36TB. Sharded by notification_id hash, that fits across 32 to 64 shards.

Marketing campaign burst. 10M notifications in 5 minutes is 33K/sec sustained for those 5 minutes. On top of the steady-state 116K/sec, that is a 30% spike. The queue must absorb at least 10M messages within 5 minutes without backpressuring the producer. Kafka handles this trivially as long as partitions are sized right.

Fan-out worker pool. At 500 calls/sec per worker, 116K/sec sustained needs about 230 workers. Peak around 700. Auto-scale on consumer lag.

The total throughput is not the hard part. The hard parts are:

- Fan-out per event ranges from 0 to 1M, and the system has to scale across that range without operators tuning anything.
- External providers (APNs, FCM, SendGrid, Twilio) are slow and lossy compared to in-house services. You retry without duplicating.
- Preferences and quiet hours have to be evaluated cheaply and consistently for every single notification.

</details>

## Step 3: pipeline architecture

Notifications follow a producer-to-consumer pipeline with several stages between the triggering event and the delivered message. Sketch the pipeline. Four stages: ingest the event, expand to per-recipient notifications, route per channel, deliver via external provider.

<details>
<summary><b>Reveal: full pipeline</b></summary>

```
   Producer Service (the thing that fires the event)
   e.g. PostService, BillingService, MarketingTool
                 │
                 │   1. POST /events  { event_id, type, payload, recipients[] }
                 ▼
   ┌─────────────────────────────────────┐
   │  Notification Ingest API            │  Auth, validation, idempotency
   │  (stateless)                        │  on event_id
   └────────────┬────────────────────────┘
                │
                │   2. Append to events.created Kafka topic
                ▼
   ┌─────────────────────────────────────┐
   │  Fan-out Service                    │  For each recipient:
   │  (Kafka consumer)                   │   - load user preferences
   │                                     │   - load template
   │                                     │   - decide channels (per opt-in)
   │                                     │   - check quiet hours
   │                                     │   - check aggregation window
   │                                     │  Emit per-channel tasks.
   └────────────┬────────────────────────┘
                │
                │   3. Append to per-channel topics:
                │      notifications.push, .email, .sms, .in_app
                ▼
   ┌─────────────────────────────────────┐
   │  Channel Workers                    │  One pool per channel.
   │  (push / email / sms / in-app)      │  Render template, call provider.
   └────────────┬────────────────────────┘
                │
                │   4. Provider call (APNs, FCM, SendGrid, Twilio, ...)
                ▼
              User device / inbox / phone
```

Why each stage:

- Ingest API is the front door. It validates and dedups on `event_id`. Same `event_id` twice and the second one is dropped before it costs anything downstream.
- Kafka in the middle decouples producers from consumers. Producers post and get a fast 202. Consumers run at their own pace. If a downstream provider goes down, messages queue up and drain when it returns.
- Fan-out Service is where the event-to-notifications expansion happens. One event may produce 0 (user opted out), 1 (single channel), or many (multi-channel per recipient x many recipients). All preference and aggregation logic lives here.
- Per-channel topics. Each channel has different throughput, different rate limits, different retry semantics. Separating them means a SendGrid outage does not back up push delivery.
- Channel workers are stateless. Render the localized template, call the provider, record the outcome.

</details>

## Step 4: incomplete diagram

Fill in the six `[ ? ]` boxes. Hint: think about who owns user preferences, who renders the message body, where the dedup state lives, and what the external providers look like.

```
   Producer Services ──► ┌────────────────┐
                         │   Ingest API   │
                         └───────┬────────┘
                                 │
                                 ▼
                         ┌────────────────┐
                         │  events Kafka  │
                         └───────┬────────┘
                                 │
                                 ▼
                         ┌────────────────┐         ┌──────────────────┐
                         │   Fan-out      │◄────────│   [ ? ]          │  (per-user opt-in,
                         │   Service      │         │                  │   quiet hours, locale)
                         └──┬─────────────┘         └──────────────────┘
                            │
                            │             ┌──────────────────┐
                            │◄────────────│   [ ? ]          │  (subject, body,
                            │             │                  │   localized, versioned)
                            │             └──────────────────┘
                            │
                            │             ┌──────────────────┐
                            │◄────────────│   [ ? ]          │  (event_id+recipient+
                            │             │                  │   channel → already sent?)
                            │             └──────────────────┘
                            │
                            ▼
                ┌────────────────────────────┐
                │  per-channel Kafka topics  │
                │ push / email / sms / inapp │
                └─────┬────┬────┬────┬───────┘
                      │    │    │    │
                      ▼    ▼    ▼    ▼
                ┌───┐ ┌───┐ ┌───┐ ┌───┐
                │[?]│ │[?]│ │[?]│ │[?]│  (each calls its external provider)
                └─┬─┘ └─┬─┘ └─┬─┘ └─┬─┘
                  │     │     │     │
                  ▼     ▼     ▼     ▼
                APNs/  Send  Twilio/ WebSocket
                FCM    Grid   SNS    push to
                              SMS    open app
```

<details>
<summary><b>Reveal: complete diagram</b></summary>

```
   Producer Services ──► ┌────────────────┐
                         │   Ingest API   │  Auth, idempotency on event_id
                         └───────┬────────┘
                                 │
                                 ▼
                         ┌────────────────┐
                         │  events Kafka  │  topic: events.created
                         └───────┬────────┘  partitioned by recipient_id hash
                                 │
                                 ▼
                         ┌────────────────┐         ┌─────────────────────┐
                         │   Fan-out      │◄────────│  Preferences Service │
                         │   Service      │         │  (per-channel opt-in,│
                         └──┬─────────────┘         │   per-event opt-out, │
                            │                       │   quiet hours, tz,   │
                            │                       │   locale)            │
                            │                       └─────────────────────┘
                            │
                            │             ┌─────────────────────┐
                            │◄────────────│  Template Service   │
                            │             │  (localized subject │
                            │             │   + body, versioned │
                            │             │   per channel,      │
                            │             │   A/B variants)     │
                            │             └─────────────────────┘
                            │
                            │             ┌─────────────────────┐
                            │◄────────────│  Dedup Store        │
                            │             │  (Redis with TTL,   │
                            │             │   key = event_id +  │
                            │             │   recipient +       │
                            │             │   channel)          │
                            │             └─────────────────────┘
                            │
                            ▼
                ┌────────────────────────────┐
                │  per-channel Kafka topics  │
                │ push / email / sms / inapp │
                └─────┬────┬────┬────┬───────┘
                      │    │    │    │
                      ▼    ▼    ▼    ▼
                ┌────┐┌────┐┌────┐┌────┐
                │Push││Mail││ SMS││InApp│
                │ Wkr││ Wkr││ Wkr││ Wkr │
                └─┬──┘└─┬──┘└─┬──┘└─┬──┘
                  │     │     │     │
                  ▼     ▼     ▼     ▼
                APNs/  Send  Twilio/ WebSocket
                FCM    Grid   SNS    push to
                              SMS    open app
                  │     │     │     │
                  ▼     ▼     ▼     ▼
              Device Inbox  Phone  In-app
                                   feed
```

What each new piece does:

- Preferences Service. Cheap, hot, read-mostly. Fan-out hits it once per recipient. Cached aggressively because preferences change rarely.
- Template Service. Stores message templates with variables (`Hi {{name}}, you have {{count}} new likes`), versioning, and localization. The renderer is a small library called inside the channel workers; the Template Service just serves template metadata and bodies.
- Dedup Store. Redis with TTL. Key is `event_id + recipient + channel`. If present, the notification was already sent (or is in flight) and we skip. TTL is long enough to cover all retry windows (24 hours works).
- Per-channel workers. Each pool sized independently. Push workers call APNs and FCM in batches; email workers call SendGrid; SMS workers call Twilio with per-number rate limiting; in-app workers write to a WebSocket gateway or store-and-poll.

</details>

## Step 5: retry, dedup, and deadletter

External providers fail. APNs returns 429 when you push too fast. SendGrid returns 5xx during their incidents. Twilio rejects messages to invalid numbers permanently. The design has to distinguish "transient failure, try again" from "permanent failure, give up and clean up" without sending the same notification twice.

Take 10 minutes to design:

1. The retry policy per channel (how many retries, with what backoff)
2. The idempotency key (so retries do not duplicate)
3. What goes to the deadletter queue and who looks at it
4. How invalid push tokens get cleaned up

<details>
<summary><b>Reveal: retry strategy</b></summary>

Retry classification. Every provider response falls into one of three buckets:

| Bucket | What it means | Action |
|--------|---------------|--------|
| Transient | 429, 5xx, timeout, network reset | Retry with exponential backoff |
| Permanent invalid recipient | APNs `Unregistered`, FCM `NotRegistered`, Twilio invalid number, email hard bounce | Do not retry. Mark recipient address as invalid. Trigger cleanup. |
| Permanent rejection | Template rejected, content flagged, blacklisted sender | Do not retry. Send to deadletter for human review. |

Per-channel retry policy:

| Channel | Max retries | Backoff | Max retry window |
|---------|-------------|---------|------------------|
| Push (APNs/FCM) | 5 | exp(2,4,8,16,32 sec) + jitter | 60 sec (push must be fresh) |
| In-app | 3 | exp(1,2,4 sec) | 7 sec |
| Email | 8 | exp(30s,1m,5m,15m,1h,4h,12h,24h) | 24 hours |
| SMS | 3 | exp(5s,30s,2m) + jitter | 5 min |

Push retries have a tight window because a 2-hour-old "your driver has arrived" push is useless. Email retries are generous because email is store-and-forward by nature and provider outages can last hours.

Idempotency key:

```
dedup_key = sha256(event_id + recipient_user_id + channel)
```

Stored in Redis with a 24-hour TTL. Two checks:

1. Before send. Channel worker checks `EXISTS dedup_key`. If present, skip (retry of an already-delivered message).
2. After send. Channel worker `SET dedup_key 1 EX 86400`.

Race condition: two workers process the same message simultaneously because Kafka rebalanced and replayed. Both see the key missing, both send. Fix: `SET dedup_key 1 NX EX 86400` (set only if not exists) returns whether the worker is the winner. The loser skips the provider call. That narrows the race to the inflight provider call itself; the tiny duplicate risk during rebalances is acceptable for most categories.

For mission-critical channels (SMS for 2FA), use a stronger check: write to a Postgres row with `INSERT... ON CONFLICT DO NOTHING RETURNING` and only proceed if you got the insert. Adds latency. Guarantees no duplicates.

Deadletter queue. Messages that exhaust retries go to `notifications.deadletter.{channel}`. A small dashboard surfaces them grouped by error reason. Permanent invalid recipients are auto-cleaned (push token deregistered, email marked bounced). The rest land in front of a human, usually within an hour.

Push token cleanup. APNs and FCM both return "this token is dead" responses. The channel worker reads this and:

- Writes a row to a `push_token_invalidations` topic.
- A small consumer marks the token as `revoked` in the user-devices table.
- Future notifications skip that token. If the user has no other devices, the push channel returns "no recipient" for that user, which Fan-out treats like an opt-out.

</details>

## Step 6: rate limiting, aggregation, and quiet hours

Notifications are the easiest way to make users uninstall your app. Three guardrails, each operating at a different scope.

Take 10 minutes:

1. Per-user cap. A user should not receive more than N notifications per hour across all channels (let alone per channel).
2. Aggregation. 100 likes on one post should be one notification ("John and 99 others"), not 100.
3. Quiet hours. A user in Tokyo at 2am should not receive a marketing push, even if the system is in California at 10am.

How do you implement each? Where in the pipeline do these live?

<details>
<summary><b>Reveal: guardrails</b></summary>

Per-user cap. Lives in the Fan-out Service, after channel selection, before emitting per-channel tasks.

Mechanism: a Redis sliding-window counter per `(user_id, channel)`. `INCR notifications:hourly:{user_id}:{channel}` with a 1-hour TTL. If the counter exceeds the cap (say 20/hour for push, 5/hour for SMS), drop the notification or defer it to a daily digest.

The cap is per-channel because the costs differ. SMS at $0.01 each is much costlier than push at near zero, so the SMS cap is much tighter.

Transactional notifications (your code, your invoice, your driver arrived) bypass the cap. They are tagged with `category=transactional` and the cap check skips them. Only `marketing` and `social` categories count toward the cap.

Aggregation. Also Fan-out, on a separate path for aggregatable events.

Events that can be batched (likes, follows, comments on the same post) carry an `aggregation_key` like `post:{post_id}:likes`. The Fan-out Service does:

1. On event arrival, check Redis for an existing aggregation window: `EXISTS agg:{aggregation_key}`.
2. If no window: start a window with `SETEX agg:{aggregation_key} 3600 1` (1-hour window) and emit a "delayed" notification scheduled for window end.
3. If window exists: `INCR agg:{aggregation_key}`. Do not emit a new notification.
4. When the window expires, a scheduled job (or a delayed Kafka message) reads the count and dispatches one notification with the aggregated content.

The notification body is templated: `"{{first_actor.name}} and {{count - 1}} others liked your post"`. Fan-out materializes the actor list at window-close time.

There is a subtle ordering problem. The window starts on the first event, so a user who gets 1 like at T=0 and 99 likes at T=3599 gets one notification at T=3600 (good). A user who gets 99 likes at T=0 and 1 like at T=3601 gets two notifications (the first 99, then the lonely 1). Tunable; some products use rolling windows, some use fixed.

Quiet hours. Fan-out again, before emitting any task to a channel topic.

Each user's preferences include their timezone and a do-not-disturb window (e.g., 22:00 to 07:00 local). Fan-out converts "now" to the user's local time and checks the window.

If now is inside the quiet window:

- Transactional. Still send. Quiet hours do not apply.
- Marketing. Drop. Marketing during quiet hours is dropped, not delayed. Users hate getting a morning rush of overnight notifications.
- Social (likes, follows, comments). Defer. Hold in a "deferred" topic with a delayed delivery time set to the end of quiet hours. When the user wakes up, they get a digest.

The deferred topic is a Kafka topic with delayed delivery support (or a separate scheduling service that releases messages at the right time). At end of quiet hours, messages flow into the per-channel topics as normal.

Timezone is critical. A marketing campaign that fires at "Tuesday 10am" must fire at 10am in every recipient's local time, not at 10am UTC. Fan-out shards work by recipient timezone for campaigns.

</details>

## Follow-up questions

Try answering each in 3 to 4 sentences before reading the solution.

1. A producer service retries an event due to a network blip and sends `event_id=42` twice within 100ms. Walk through how the system avoids sending duplicate notifications. What if the second retry comes 25 hours later, after the dedup TTL expires?

2. A marketing campaign is meant to send to 10M users but the operator accidentally targets 100M. How do you stop it mid-flight? What state has to be torn down?

3. APNs is down for 30 minutes. What happens to push notifications during the outage? What happens when it comes back? Do users see a flood at recovery?

4. A user updates their notification preferences to opt out of marketing, but a marketing campaign was already queued. Are messages already in the queue still sent, or honored against the latest preferences?

5. A user has 5 devices. They post something that triggers a notification to themselves (e.g., "your scheduled post just went live"). How many push notifications? On which devices? What if one device is signed out?

6. You discover that one notification template has a bug: it sends "{{name}}" literally instead of the user's name. How do you roll back? What about the messages already sent?

7. The notifications database is showing one shard much hotter than others. Diagnose.

8. A user complains they got an SMS at 4am. Trace the path: who is responsible? How do you reproduce?

9. Web push (browser-based push notifications) needs to be added as a new channel. What changes in the architecture? What stays the same?

10. Compliance asks: prove that user 12345 received exactly the notifications we claim, and not others. What is your audit trail? How long do you keep it?

## Related problems

- [News Feed (002)](../002-news-feed/question.md). The fan-out worker pattern is the same. The celebrity problem (one author with millions of followers) maps onto the marketing campaign problem here (one event targeting millions of recipients).
- [Rate Limiter (004)](../004-rate-limiter/question.md). The per-user notification cap is exactly a rate limiter scoped to a user. The sliding-window counter and token-bucket variants apply directly.
- [Chat System (003)](../003-chat-system/question.md). Push notification delivery to mobile devices is the same problem as chat message delivery. APNs and FCM are the same tools, and the device-token lifecycle is shared.
- [Distributed Cache (009)](../009-distributed-cache/question.md). Preferences and dedup state both live in Redis with TTL. Hot-key and eviction behavior matters here too.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Notification System

### TL;DR

Notifications are a fan-out pipeline. One event becomes zero, one, or many delivered messages depending on preferences, channels, and aggregation rules. The architecture is a Kafka-backed pipeline with four stages: ingest, fan-out, per-channel routing, and provider delivery. Each stage scales on its own bottleneck, and each external provider (APNs, FCM, SendGrid, Twilio) sits behind its own worker pool with channel-specific retry semantics.

The interesting engineering is at the edges. Idempotency keys (`event_id + recipient + channel`) prevent duplicate sends across retries and consumer rebalances. Aggregation windows turn 100 likes into one "John and 99 others" notification. Quiet hours plus per-user caps stop the system from waking people up or training them to disable notifications. Push token cleanup feeds back into a device registry so invalid tokens are pruned within minutes.

What breaks candidates: a single worker pool for all channels (one bad provider drags down the rest), preferences as a sync RPC on the hot path (cannot scale to 100K/sec), and retries without dedup keys producing duplicate sends.

### 1. Clarifying questions and why each matters

Covered in `question.md`. Ranked by impact on the architecture:

1. User preferences. This is the question that changes the architecture. Without preferences, fan-out is "for each recipient, send." With preferences, it is "for each recipient, decide channels, decide if now is OK, decide if this is the 21st notification this hour."
2. Channels. Determines how many provider adapters you build and how independent they need to be.
3. Fan-out shape. A 10B/day system with even distribution is easier than one with viral spikes. The marketing-campaign worst case sets the queue sizing.
4. Idempotency. A "no" here means you handle producer retries gracefully, which means dedup keys.

If you walked in asking only about throughput, you wrote the right architecture for the wrong problem.

### 2. Capacity estimates (full working)

From `question.md`:

- 10B notifications/day across 1B users gives ~116K/sec sustained, ~350K/sec peak.
- Per channel: push 70K/sec, in-app 35K/sec, email 8K/sec, SMS 3.5K/sec.
- Worst-case burst: 10M-recipient campaign in 5 minutes adds 33K/sec for the duration.
- Storage for delivery records at ~120B each, 30-day retention: ~36TB. Sharded by notification_id.
- Worker pool sizing at 500 calls/sec/worker: ~230 workers sustained, ~700 peak.

Total throughput is not the limit. The limits come from external providers' per-account quotas: SendGrid sub-account throughput, Twilio per-number rate, APNs HTTP/2 stream caps per certificate. You operate at scale by holding many provider credentials and load-balancing across them.

### 3. API design

#### Producer API (event ingestion)

```
POST /api/v1/events
Content-Type: application/json
Authorization: Bearer <producer-service-token>
Idempotency-Key: <event_id>

{
  "event_id": "evt_8f3a91...",
  "event_type": "post.liked",
  "category": "social",                  // transactional | social | marketing
  "actor": { "user_id": 123 },
  "recipients": [
    { "user_id": 456, "context": { "post_id": 789 } }
  ],
  "aggregation_key": "post:789:likes",  // optional
  "template_id": "tpl_like_v3",
  "template_vars": { "actor_name": "Alice", "post_title": "..." },
  "ttl_seconds": 3600                   // drop if not delivered in this window
}
```

Responses:

| Status | Meaning | Body |
|--------|---------|------|
| 202 Accepted | Event queued | `{ "event_id": "...", "queued_at": "..." }` |
| 200 OK | Same event_id already accepted (idempotent replay) | same shape as 202 |
| 400 Bad Request | Invalid payload, unknown template, etc. | `{ "error": "invalid_template" }` |
| 401 Unauthorized | Bad producer token | |
| 413 Payload Too Large | Recipient list too long for one request (>10k) | `{ "error": "use_bulk_endpoint" }` |
| 429 Too Many Requests | Producer rate limit | `{ "error": "rate_limited", "retry_after": 30 }` |

A few load-bearing choices:

- `Idempotency-Key` is required. It is what makes producer retries safe. The Ingest API uses it to dedup before the message ever hits Kafka.
- `recipients` is a list. For one-to-one notifications it has one entry; for fan-out events it can have up to 10k. Above that, use a bulk endpoint that takes a recipient query (e.g., "all users in segment X") and expands on the server.
- `category` is the single most important field for downstream policy. It controls whether quiet hours apply, whether per-user caps apply, and how aggressively the system retries.
- `ttl_seconds` is a hard deadline. Push notifications with a 1-hour TTL that miss the window are dropped, not delivered late. This is what prevents the "flood at recovery" problem when a provider comes back from an outage.

#### Bulk campaign API

```
POST /api/v1/campaigns
{
  "campaign_id": "cmp_winter_sale_2026",
  "segment_query": { "country": "US", "engagement_tier": "active" },
  "template_id": "tpl_winter_v2",
  "channels": ["push", "email"],
  "send_window": {
    "start_local_time": "10:00",
    "end_local_time": "20:00",
    "timezone_strategy": "per_user_local"
  },
  "rate_limit": { "per_second": 5000 }
}
```

Returns 202 with a `campaign_id`. The Campaign Service expands the segment query into a recipient stream and feeds it into the Fan-out path at the configured rate.

#### Preferences API (user-facing)

```
GET /api/v1/users/me/notification-preferences
PUT /api/v1/users/me/notification-preferences
{
  "channels": {
    "push": { "enabled": true },
    "email": { "enabled": true },
    "sms": { "enabled": false },
    "in_app": { "enabled": true }
  },
  "categories": {
    "marketing": { "enabled": false },
    "social": { "enabled": true, "channels": ["push", "in_app"] },
    "transactional": { "enabled": true }    // always true, cannot disable
  },
  "quiet_hours": {
    "enabled": true,
    "start": "22:00",
    "end": "07:00",
    "timezone": "America/Los_Angeles"
  }
}
```

Writes go to the Preferences Service primary; reads are served from a regional cache with eventual consistency. The cache is invalidated on every preference write via pub/sub.

### 4. Data model

#### Notifications (delivery log)

```sql
CREATE TABLE notifications (
    notification_id     UUID PRIMARY KEY,
    event_id            UUID NOT NULL,
    recipient_user_id   BIGINT NOT NULL,
    channel             SMALLINT NOT NULL,        -- 1=push, 2=email, 3=sms, 4=inapp
    template_id         VARCHAR(64) NOT NULL,
    template_version    INT NOT NULL,
    status              SMALLINT NOT NULL,        -- 1=queued, 2=sent, 3=failed, 4=dropped
    category            SMALLINT NOT NULL,        -- 1=transactional, 2=social, 3=marketing
    provider            VARCHAR(32),              -- 'apns', 'fcm', 'sendgrid', 'twilio'
    provider_msg_id     VARCHAR(128),             -- their message ID for tracing
    retry_count         SMALLINT NOT NULL DEFAULT 0,
    queued_at           TIMESTAMPTZ NOT NULL,
    sent_at             TIMESTAMPTZ,
    error_code          VARCHAR(64),
    error_message       TEXT
);

CREATE INDEX idx_event_recipient_channel
    ON notifications (event_id, recipient_user_id, channel);
CREATE INDEX idx_recipient_recent
    ON notifications (recipient_user_id, queued_at DESC);
CREATE INDEX idx_status_queued
    ON notifications (status, queued_at) WHERE status IN (1, 3);
```

Sharded by `notification_id` hash. The `idx_event_recipient_channel` index is what makes "did we already send this?" lookups O(log N) on the row store. The Redis dedup store is the fast path; this index is the durable backup.

#### Preferences

```sql
CREATE TABLE user_preferences (
    user_id              BIGINT PRIMARY KEY,
    channels             JSONB NOT NULL,         -- {"push": true, "email": true, ...}
    categories           JSONB NOT NULL,         -- per-category settings
    quiet_hours_start    TIME,
    quiet_hours_end      TIME,
    timezone             VARCHAR(64),            -- IANA tz name
    locale               VARCHAR(16),            -- en_US, ja_JP
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version              INT NOT NULL DEFAULT 1  -- optimistic concurrency
);
```

Sharded by `user_id`. Cached in Redis as JSON, keyed by user_id, with a 5-minute TTL and pub/sub invalidation on write. Cache hit rate runs north of 99% because preferences change rarely.

#### Templates

```sql
CREATE TABLE templates (
    template_id          VARCHAR(64) NOT NULL,
    version              INT NOT NULL,
    channel              SMALLINT NOT NULL,
    locale               VARCHAR(16) NOT NULL,
    subject              TEXT,                   -- email only
    body                 TEXT NOT NULL,          -- mustache-style
    variables            JSONB NOT NULL,         -- expected variable schema
    ab_variant           VARCHAR(16),            -- 'A', 'B', null=no test
    created_at           TIMESTAMPTZ NOT NULL,
    created_by           BIGINT NOT NULL,
    deprecated_at        TIMESTAMPTZ,
    PRIMARY KEY (template_id, version, channel, locale, ab_variant)
);
```

Templates are versioned and immutable per version. To "edit" a template you publish version N+1. The Fan-out Service resolves `template_id` at fan-out time to whichever version is current, so you can roll forward by flipping the current-version pointer. Roll back is the same operation in reverse.

Localization: resolution order is `(template_id, version, channel, user.locale)` with fallback to `en_US`. A/B variants: Fan-out hashes `user_id mod 100` to pick variant.

#### Dedup store (Redis)

```
KEY:    dedup:{event_id}:{recipient_user_id}:{channel}
VALUE:  notification_id (so you can find the original)
TTL:    24 hours
```

#### Device tokens

```sql
CREATE TABLE user_devices (
    device_id            UUID PRIMARY KEY,
    user_id              BIGINT NOT NULL,
    platform             SMALLINT NOT NULL,      -- 1=ios, 2=android, 3=web
    push_token           VARCHAR(512) NOT NULL,
    status               SMALLINT NOT NULL,      -- 1=active, 2=revoked, 3=invalid
    last_seen_at         TIMESTAMPTZ NOT NULL,
    app_version          VARCHAR(32)
);
CREATE INDEX idx_user_active ON user_devices (user_id) WHERE status = 1;
```

Sharded by `user_id`. The Fan-out Service hits this to expand "send to user 456" into "send to device tokens T1, T2, T3 for user 456".

### 5. Core algorithm: event to delivered notification

Here is the path of one event from producer to delivered push on a user's phone.

```
T+0ms     Producer calls POST /events with event_id=evt_X, recipient=user_456.
T+5ms     Ingest API validates schema, checks idempotency on event_id via Redis.
          Not seen before. Inserts event_id into idempotency cache (TTL 24h).
          Appends to events.created Kafka topic, partition = hash(recipient_user_id).
          Returns 202.

T+10ms    Fan-out Service consumer reads the message.
T+11ms    Loads user_456's preferences from Redis (cache hit, ~1ms).
T+12ms    Loads template tpl_like_v3 metadata from Redis (cache hit).
T+13ms    Evaluates:
          - category=social, preferences.categories.social.enabled=true. OK.
          - quiet_hours: user is in PST, now is 14:00 PST. Not in quiet window.
          - per-user-cap: notifications.hourly.user_456.push counter = 3. Cap is 20. OK.
          - aggregation: aggregation_key=post:789:likes. Check agg:post:789:likes.
            Window does not exist. Start window: SETEX 3600 1.
            Schedule a delayed "agg-close" message for T+3600s.
          - dedup: not relevant yet (only one event so far).
          
          Decision: emit to push and in-app channels (per user_456's channel prefs).
T+15ms    Look up user_456's active devices: [device_A (ios), device_B (android)].
T+16ms    Emit two messages to notifications.push topic:
          - {notification_id: n1, device: device_A, token: t1, ...}
          - {notification_id: n2, device: device_B, token: t2, ...}
          Emit one message to notifications.in_app.

T+18ms    INSERT 3 rows into notifications table with status=queued.

T+25ms    Push worker (one of the 230 in the pool) pulls n1.
T+26ms    Check dedup_key in Redis: not present. SETNX dedup_key with value=n1.
T+27ms    Render template body with template_vars. ~1ms.
T+28ms    Call APNs HTTP/2 stream: POST /3/device/{token}.
T+150ms   APNs returns 200. Worker updates notifications row: status=sent,
          provider_msg_id=apns_xyz, sent_at=now.
T+155ms   Worker fires a "delivered" event to Kafka (for analytics).

T+150ms   Push worker for n2 similarly completes.

T+30ms    In-app worker writes to the WebSocket gateway. If user is online, message
          appears in their feed within 100ms. If offline, stored in inbox; appears on
          next app open.
```

Total elapsed from event submission to delivered push: ~150ms P50, dominated by the APNs round-trip.

What changes for the aggregated case: at T+3600s the agg-close message fires. Fan-out reads the count from `agg:post:789:likes` (say 47), reads the actor list materialized during the window, and emits a single notification with template `tpl_like_aggregated_v1` and `template_vars={actor_name: "Alice", others_count: 46}`. The path from there is the same as a regular notification.

### 6. Architecture (detailed)

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  Producer Services                                                 │
   │  PostService, BillingService, MarketingTool, OnboardingService, ...│
   └────────────────────────────────┬───────────────────────────────────┘
                                    │
                                    ▼  POST /events
                          ┌──────────────────────┐
                          │   Ingest API         │  Stateless, N pods.
                          │   (REST + gRPC)      │  Auth, schema validation,
                          │                      │  idempotency on event_id.
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │   events.created     │  Kafka topic.
                          │   topic              │  Partitioned by recipient_user_id.
                          │   ~64 partitions     │  7-day retention.
                          └──────────┬───────────┘
                                     │
                                     ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  Fan-out Service (consumer pool)                                    │
   │                                                                     │
   │  For each event message:                                            │
   │   1. Load preferences (Redis cache).                                │
   │   2. Load template metadata.                                        │
   │   3. Evaluate category, quiet hours, per-user cap.                  │
   │   4. Aggregation window check.                                      │
   │   5. Expand recipient to devices (push) and contact (email/sms).    │
   │   6. Dedup_key set (SETNX) per (event_id, recipient, channel).      │
   │   7. INSERT notification rows (status=queued).                      │
   │   8. Emit per-channel tasks.                                        │
   └────┬───────────────┬───────────────┬───────────────┬────────────────┘
        │               │               │               │
        ▼               ▼               ▼               ▼
   ┌────────┐      ┌────────┐      ┌────────┐      ┌──────────┐
   │ push   │      │ email  │      │  sms   │      │ in_app   │  Per-channel
   │ topic  │      │ topic  │      │ topic  │      │ topic    │  Kafka topics.
   └───┬────┘      └───┬────┘      └───┬────┘      └────┬─────┘
       │               │               │                │
       ▼               ▼               ▼                ▼
   ┌────────┐      ┌────────┐      ┌────────┐      ┌──────────┐
   │ Push   │      │ Email  │      │  SMS   │      │ In-App   │  Per-channel
   │ Wkrs   │      │ Wkrs   │      │  Wkrs  │      │  Wkrs    │  worker pools.
   │ ~150   │      │ ~50    │      │  ~30   │      │  ~80     │  Each stateless.
   └───┬────┘      └───┬────┘      └───┬────┘      └────┬─────┘
       │               │               │                │
       │               │               │                ▼
       │               │               │         ┌──────────────┐
       │               │               │         │  WebSocket   │  Persistent
       │               │               │         │  Gateway     │  connections to
       │               │               │         │              │  online clients.
       │               │               │         └──────────────┘
       │               │               │
       │               │               ▼
       │               │         ┌──────────────┐
       │               │         │  Twilio /    │
       │               │         │  SNS SMS     │
       │               │         └──────────────┘
       │               │
       │               ▼
       │         ┌──────────────┐
       │         │  SendGrid /  │
       │         │  SES         │
       │         └──────────────┘
       │
       ▼
   ┌──────────────────────┐
   │  APNs (iOS) +        │
   │  FCM (Android, web)  │
   └──────────────────────┘

   Supporting services:

   ┌──────────────────────┐    ┌──────────────────────┐
   │  Preferences Service │    │  Template Service    │
   │  Postgres + Redis    │    │  Postgres + S3 +     │
   │                      │    │  Redis               │
   └──────────────────────┘    └──────────────────────┘

   ┌──────────────────────┐    ┌──────────────────────┐
   │  Device Registry     │    │  Dedup Store         │
   │  Postgres sharded    │    │  Redis cluster       │
   │  by user_id          │    │  with 24h TTL        │
   └──────────────────────┘    └──────────────────────┘

   ┌──────────────────────┐    ┌──────────────────────┐
   │  Notifications DB    │    │  Deadletter Topics   │
   │  Postgres sharded    │    │  notifications.dlq.* │
   │  by notification_id  │    │  Manual review       │
   └──────────────────────┘    └──────────────────────┘

   ┌──────────────────────┐
   │  Campaign Scheduler  │  For bulk/marketing.
   │  (segments → events) │  Reads segment queries,
   │                      │  paces emission into the
   │                      │  events topic.
   └──────────────────────┘
```

A few things worth pointing at while reading this:

The Ingest API sits in front of Kafka so the producer is never slowed by downstream. A producer call returns 202 in under 10ms regardless of fan-out load.

Kafka is partitioned by `recipient_user_id`, meaning all events for one user land on one partition. Useful for per-user ordering and for the per-user cap counter (a single consumer maintains the counter for users in its partition, no cross-pod contention).

Fan-out and channel workers are split because they have different bottlenecks. Fan-out is CPU-light, IO-heavy (preferences, template, dedup lookups). Channel workers are IO-heavy and provider-blocked. Separating them lets each scale on its own constraint.

Per-channel topics matter for blast-radius. If SendGrid is down, the email topic backs up; push and SMS keep flowing. One channel's outage cannot become an everything outage.

Redis carries the hot reads. Preferences, dedup, aggregation counters, per-user caps. All small, all hot, all need <2ms reads. Postgres is the source of truth and the rebuild path.

The Campaign Scheduler is separate because marketing campaigns need pacing. You do not fire 10M push notifications in 10 seconds. The scheduler reads a segment query, expands it into events, and feeds them into the ingest API at a controlled rate.

### 7. Channel adapters

Each channel is wrapped in an adapter that hides the provider's specifics. The Fan-out Service does not know that "push to iOS" means "APNs HTTP/2 with a JWT." It just emits to the `push` topic. The push worker is the only thing that talks to APNs and FCM.

#### Push (APNs and FCM)

```python
class PushAdapter:
    def send(self, task):
        if task.platform == 'ios':
            return self._send_apns(task)
        elif task.platform in ('android', 'web'):
            return self._send_fcm(task)
    
    def _send_apns(self, task):
        # APNs uses HTTP/2 with a long-lived connection per certificate.
        # One connection multiplexes many requests.
        response = self.apns_conn.post(
            path=f"/3/device/{task.token}",
            headers={
                'apns-topic': self.bundle_id,
                'apns-push-type': 'alert',
                'apns-priority': '10' if task.urgent else '5',
                'apns-expiration': str(task.deadline_epoch),
            },
            json={
                'aps': {
                    'alert': {'title': task.title, 'body': task.body},
                    'badge': task.badge,
                    'sound': task.sound,
                }
            }
        )
        return self._classify_apns_response(response)
    
    def _classify_apns_response(self, response):
        if response.status == 200:
            return Result.SUCCESS
        if response.status == 410:
            return Result.TOKEN_INVALID  # device unregistered
        if response.status == 429:
            return Result.TRANSIENT  # back off
        if response.status >= 500:
            return Result.TRANSIENT
        return Result.PERMANENT
```

Three details worth knowing:

APNs is sensitive to connection setup overhead. One worker holds many concurrent streams on one HTTP/2 connection. Tear-and-rebuild on errors is expensive, so the adapter is careful about when to recycle.

The `apns-expiration` header is how we avoid the "flood at recovery" problem. If the message is older than the TTL, APNs drops it server-side rather than delivering a stale push.

Token invalidation feeds back through the system. A 410 from APNs means the token is dead. The worker writes to `push_token_invalidations`; a small consumer marks the row in `user_devices` as `status=invalid`. Future notifications skip that token.

FCM is similar but uses HTTP/1.1 or HTTP/2 with OAuth bearer tokens and a different invalid-token signal (`NotRegistered`). Same pattern.

#### Email (SendGrid / SES)

```python
class EmailAdapter:
    def send(self, task):
        # SendGrid v3 API. Batches up to 1000 personalizations per request.
        response = self.sendgrid.post('/v3/mail/send', json={
            'from': {'email': task.from_email, 'name': task.from_name},
            'personalizations': [{
                'to': [{'email': task.to_email}],
                'subject': task.subject,
                'dynamic_template_data': task.template_vars,
            }],
            'template_id': task.provider_template_id,
            'tracking_settings': {
                'click_tracking': {'enable': True},
                'open_tracking': {'enable': True},
            },
            'headers': {'X-Notification-ID': task.notification_id},
            'asm': {'group_id': task.unsubscribe_group_id},
        })
        return self._classify_sendgrid_response(response)
```

There is a choice between provider templates (SendGrid stores them) and in-house templates (you render and send full HTML). For simple emails the provider templates save bandwidth and give you a drag-drop editor. For complex emails it is easier to render in-house.

Unsubscribe group ID is SendGrid's compliance feature and is required for marketing emails. Each category (newsletter, promotional, etc.) gets its own group; users can unsubscribe per group instead of from all email.

Hard bounces flow back via webhook. SendGrid notifies us when an email hard-bounces; a small consumer reads these and marks the email address as `status=invalid` in the user profile. Fan-out then skips invalid addresses.

#### SMS (Twilio / SNS)

```python
class SMSAdapter:
    def send(self, task):
        # Twilio Messaging Services API. Routes through a sender pool
        # (long codes + short codes + toll-free) with per-carrier optimization.
        response = self.twilio.post('/Messages.json', data={
            'MessagingServiceSid': self.messaging_service_sid,
            'To': task.to_phone,
            'Body': task.body,
            'StatusCallback': self.callback_url,
        })
        return self._classify_twilio_response(response)
```

A few SMS-specific things:

Always use Messaging Services, not single From numbers. Twilio routes across a pool of sender numbers, respecting per-number throughput. Without this you would manually shard recipients across numbers.

Twilio responds 201 when it accepts the message, but actual carrier delivery takes seconds to minutes. They post status updates via webhook (`queued` to `sent` to `delivered` or `failed`). A small webhook consumer updates the notifications row.

Twilio error 21211 means invalid number. Mark the phone in the user profile, never retry.

US carriers throttle aggressively. Going over the limit causes `Filtering` errors. The Messaging Service handles much of this; for high-volume senders you also need 10DLC registration with the carriers.

#### In-app

```python
class InAppAdapter:
    def send(self, task):
        # Two-part: persist to inbox, push to live WebSocket if connected.
        self.inbox_store.insert(InboxItem(
            user_id=task.user_id,
            notification_id=task.notification_id,
            payload=task.payload,
            created_at=now(),
        ))
        # WebSocket fan-out (fire-and-forget; failure to push is OK because
        # the next app open reads from inbox_store).
        self.ws_gateway.try_push(task.user_id, task.payload)
        return Result.SUCCESS
```

In-app is the simplest channel because there is no external provider with its own SLA. The inbox is your own database; the WebSocket gateway is your own service. The only failure mode is the gateway being down, and we tolerate that because the inbox is the source of truth.

### 8. Scaling

#### a. Kafka partitions

- `events.created`: 64 partitions, partitioned by `recipient_user_id`. Why by recipient: it co-locates all events for one user on one consumer, which makes the per-user cap counter easy (no cross-partition contention).
- Per-channel topics: 32 partitions each, partitioned by `notification_id` (random). Why random: we do not need ordering at this stage, and random partitioning gives the best load distribution across workers.

#### b. Worker pools

- Push: ~150 workers sustained. Each holds APNs and FCM connections. Auto-scale on consumer lag.
- Email: ~50 workers. Batch sends (up to 1000 per SendGrid request) so per-worker throughput is high.
- SMS: ~30 workers. Throughput is limited by Twilio's per-Messaging-Service limits, not worker CPU. Adding workers does not help once you hit the provider cap.
- In-app: ~80 workers. CPU-bound on serialization; the WebSocket gateway is a separate scaling concern.

Scaling triggers: consumer lag > 30 seconds for push, > 5 minutes for email. The auto-scaler reacts to these by spinning new pods.

#### c. Hot recipient (campaign-style fan-out)

A campaign targeting 10M users emits 10M events. Each event has one recipient. They land on partitions by `recipient_user_id`, so they distribute well. Fan-out workers process them in parallel; no single consumer is overloaded.

The problem is downstream: 10M push-token lookups in a 5-minute window stress the device registry. Fix: the campaign expander batches lookups (`SELECT * FROM user_devices WHERE user_id = ANY(...)` with 1000 IDs at a time) and prewarms a cache.

The other problem is provider rate limits. 10M emails in 5 minutes is 33K emails/sec. SendGrid throttles a single sub-account at that rate. Fix: hold multiple SendGrid sub-accounts and round-robin across them. Or use the Campaign Scheduler's `rate_limit` config to pace the campaign within the provider's quota.

#### d. Hot recipient (popular user case)

If user 456 follows 1000 high-volume accounts, they could receive thousands of notifications/hour. The per-user cap stops the spam, but the cap counter itself becomes a hot Redis key: every event for that user does `INCR notifications:hourly:user_456:push`. At hundreds of writes/sec on one key, Redis handles it, but it is worth knowing the limit.

Mitigation if it ever becomes a problem: shard the counter across N sub-counters and sum at read time. For 99% of users (who get fewer than 100 notifications/hour) the single counter is fine.

#### e. Database growth

Notifications table grows by 1.2TB/day. With 30-day retention that is 36TB across 64 shards, around 600GB per shard. Manageable, but partition by month or week within each shard so you can drop old data with `DROP PARTITION` instead of `DELETE` (which would bloat the table).

For long-term audit (some compliance regimes require 7 years), archive to S3 as compressed Parquet after 30 days. The audit-query path reads from S3 via Athena, not from the live database.

### 9. Reliability

#### Retries (already covered in question.md Step 5)

Short version: transient failures retry with exponential backoff; permanent failures go to deadletter or auto-cleanup. Idempotency keys prevent duplicate sends across retries and consumer rebalances.

#### Provider outage

APNs goes down. The push channel topic backs up. Push workers retry with backoff; after exhausting retries they emit to deadletter. When APNs returns, the backlog drains over the next 5 to 30 minutes.

What we do not do: dump the entire backlog at APNs the instant it returns. Two safeguards:

1. Per-notification TTL. Notifications older than their TTL are dropped, not sent. A 30-minute outage means notifications queued in the first 30 minutes are dropped if their TTL was 30 minutes.
2. Worker rate-limiting. Workers respect APNs's published throughput and our own backpressure. They do not flood on recovery.

#### Late-arriving events

A producer sits on an event for 10 minutes due to its own outage, then sends it. Do we deliver?

Two cases:

- Has TTL. Honor the TTL. If TTL is 10 minutes and the event is 10 minutes old, drop.
- No TTL. Send. Some events (your invoice for last month) genuinely should be delivered even if they are slightly stale.

Producers are expected to set TTL based on event semantics.

#### Consumer rebalance duplicates

Kafka consumer groups rebalance when a consumer dies or joins. During rebalance, a partition can briefly be processed by two consumers. Without dedup keys, this causes duplicate sends.

The dedup key in Redis (`SETNX dedup:event_id:recipient:channel`) handles this. The losing consumer sees the key already set and skips the provider call.

There is still a window. Between `SETNX success` and `provider call complete`, if the worker dies, the consumer that replays sees the key set and skips. The notifications row is in `status=queued`, but the actual provider call may or may not have happened. Real edge case.

Mitigation for mission-critical channels:

- Set dedup_key with worker_id and timestamp. On replay, check if the original worker is still alive (heartbeat in Redis with TTL). If dead, the replay can proceed.
- Or use a two-phase commit: mark the row as `status=sending` before the provider call, `status=sent` after. On replay, only retry if `status=queued` or `status=sending` and elapsed time > N seconds.

For social and marketing categories, at-most-once with a tiny duplicate risk is fine. For 2FA SMS, you want exactly-once with stronger guarantees, which costs latency. Pick per category.

#### Deadletter triage

Messages in deadletter are categorized:

- Invalid recipient (~90%). Auto-handled: token invalidated, email marked bounced, phone marked invalid. No human action.
- Template rendering failure (rare). A bug in the template caused the renderer to fail. Page the on-call.
- Provider permanent rejection (5-10%). Content flagged, sender blacklisted. Surface to product owner; may indicate abuse or compliance issue.

Deadletter messages older than 7 days are archived to S3 and dropped from the active queue.

### 10. Observability

The metrics you need from day one:

| Metric | Why |
|--------|-----|
| `notifications.queued_rate` (by channel, category) | Headline throughput |
| `notifications.delivered_rate` (by channel) | Headline delivery |
| `notifications.delivery_rate_pct` (delivered / queued) | Lower bound on health |
| `fanout.latency_p99` (event arrival → first channel emit) | Fan-out service health |
| `channel.latency_p99` (channel emit → provider response) | Per-channel provider health |
| `provider.error_rate` (by provider, error code) | Spot APNs / SendGrid / Twilio issues early |
| `dedup.hit_rate` | Should be ~0% normally; spike means producer is retrying often |
| `aggregation.windows_open` | Sanity on aggregation correctness |
| `quiet_hours.deferred_rate` | If too high, the system may be holding too much |
| `preferences.cache_hit_rate` | Should be >99% |
| `kafka.consumer_lag_p99` (per topic) | Leading indicator |
| `deadletter.rate` (by channel, reason) | Manual triage trigger |
| `token_invalidation.rate` | Sudden spike may be a token-revocation bug |
| `unsubscribe.rate` (by category) | Product signal; correlates with notification fatigue |

Alerts:

- Page on: any channel's delivery_rate_pct drops below 95% for 5 minutes; fan-out latency P99 > 30s for 5 min; deadletter rate spike > 10x baseline.
- Ticket on: unsubscribe rate spike (likely a bad campaign); token invalidation rate spike (auth bug?); preferences cache hit rate dropping (cache eviction tuning).

Per-user audit log: every notification has a row in the `notifications` table with `event_id`, decisions taken (which channels selected and why others were skipped), and provider message ID. Compliance can answer "what did user 12345 receive on 2026-03-15?" with one query.

### 11. Follow-up answers

**1. Producer retries `event_id=42` twice within 100ms. Later, after dedup TTL expires.**

Within 100ms: the Ingest API hashes `event_id` and checks Redis. The first call SETs the key with a 24-hour TTL and gets a `1`. The second call sees the key already set and returns 200 with the original `queued_at`. No downstream impact; the event is processed once.

After 25 hours: the dedup key has expired. The second call is treated as a new event and a second notification fires. This is intentional. 24 hours is long enough that a legitimate retry has already happened; after that, "retry" is more likely an operator manually re-sending or a system bug producing the same event_id twice for different intents.

If you need protection beyond 24 hours: write the event_id into a Postgres `processed_events` table at ingest time with a unique constraint. INSERT-OR-IGNORE pattern. Costs more (one DB write per event) but is durable across Redis evictions.

**2. Marketing campaign accidentally targets 100M instead of 10M.**

Detection: operator notices, or the volume alerts fire (notifications.queued_rate spike for the marketing category).

Stopping it: the Campaign Scheduler exposes `POST /campaigns/{id}/pause`. This writes a `paused=true` flag to the campaign state. The scheduler stops emitting new events for that campaign within 1-2 seconds.

But events already in `events.created` Kafka are not stopped. To kill those:

- Fan-out Service checks a "campaign blocklist" Redis set on every event. If the event's `campaign_id` is in the blocklist, drop the event without fan-out.
- Operator adds the campaign_id to the blocklist via an admin endpoint. Takes effect within seconds.

Per-channel topics still have queued messages from the bad campaign. Same trick: channel workers check the blocklist before calling the provider. Drop if blocked.

Cleanup state: campaign_id stays in blocklist for 24 hours, then expires. Notifications already sent are in the notifications table for audit; nothing to roll back.

The deeper lesson: a circuit breaker per campaign is a cheap insurance policy. Build it on day one.

**3. APNs is down for 30 minutes.**

During: push channel topic backs up. Push workers retry; after max retries, messages go to deadletter. We do not actively drain APNs; backoff naturally throttles our retries.

Recovery: APNs returns. Workers resume. A backlog of (say) 500K messages drains over the next ~5 minutes at our throughput.

Flood prevention: per-message TTL drops anything older than its expiration. A "your driver has arrived" push with a 5-minute TTL is dropped if it sat in the queue for 30 minutes. Marketing pushes typically have 1-hour TTLs and may also be dropped.

What users see: they get the notifications that are still valid, and they miss the ones that are not. No flood; we deliberately drop stale ones.

**4. User opts out of marketing while a campaign is in flight.**

Fan-out evaluates preferences at the moment it processes the event, not at the moment the event was created. The Preferences cache has a 5-minute TTL with pub/sub invalidation on write.

So: user opts out at T=0. Pub/sub invalidates the cache. Fan-out refetches on next event. Within ~1 second of the opt-out, the new preference is honored.

Events already past the Fan-out stage (sitting on per-channel topics) do not re-check preferences. Those are sent. Window of inconsistency: about 10 seconds typically.

For strict compliance (legally must not send marketing after opt-out), re-check preferences in the channel worker too. Adds about 1ms per send. Worth it for marketing; not necessary for transactional.

**5. User has 5 devices; notification triggered for themselves.**

Fan-out expands "send to user_456" to all active devices for that user: device_A (ios, active), device_B (android, active), device_C (ios, signed out, status=revoked, skip), device_D (web push, active), device_E (ios, old token, status=invalid, skip).

Result: 3 push notifications, one per active device. Signed-out and invalid-token devices are filtered at expansion time.

The user gets 3 push notifications. Correct: they have 3 active devices they might be looking at. Whether to also dedup within a user (one push per user, picking the most recently active device) is a product decision; most products send to all active devices and let the user mute on devices they do not want.

In-app: one entry in the inbox, regardless of devices. Inbox is per-user, not per-device.

**6. Template has a bug; rendering literal `{{name}}` instead of user's name.**

Detection: support tickets, or an automated template QA check that catches unrendered variables.

Roll back: templates are versioned and immutable. Flip the "current version" pointer for `tpl_X` from v3 to v2. Fan-out picks up the new pointer on next template metadata read (cache TTL is short for the pointer, longer for the body).

Messages already sent: they are sent. You cannot un-send a push or email. For very severe issues (PII leaked in the body, say), send a follow-up notification apologizing. Mostly you accept the damage and move on.

Prevention: every template change goes through:

- Lint: check that template_vars provided match the variables referenced in the body.
- Preview: render a sample with test data and have a human review.
- Canary: send to 0.1% of recipients first; if error rate spikes (rendering failures, unsubscribes), pause.
- Full rollout.

A senior candidate mentions all four.

**7. One shard hotter than others.**

Diagnosis steps:

1. Check the shard key. `notifications` is sharded by `notification_id` hash, which is random. An imbalanced shard suggests something other than shard key. Maybe one shard has more long-running queries pending.
2. Check the query pattern. If a query like `SELECT FROM notifications WHERE recipient_user_id = ?` runs and recipient_user_id is not the shard key, the query scatter-gathers across all shards. One slow shard means the whole query is slow, and the slow shard looks "hot" from outside.
3. Check partition skew within the shard. Notifications grow over time; if you partition by month within shard, the latest month is hottest. Expected and fine.
4. Check noisy neighbor. Shared infrastructure? The shard may be hot because another tenant is hogging the host.
5. Resolve. If shard key is bad (e.g., accidentally sharded by `user_id` instead of `notification_id`), rebalance via consistent hashing. If it is query pattern, add a secondary index or a denormalized table. If it is noisy neighbor, move the shard.

Most often it is a query-pattern issue. A senior candidate asks for the slow-query log before reaching for re-sharding.

**8. User got an SMS at 4am.**

Trace path:

1. Find the notification row in DB: `SELECT FROM notifications WHERE recipient_user_id = ? AND sent_at BETWEEN ? AND ? AND channel = 3`. Returns `notification_id`, `event_id`, `template_id`, `category`, `sent_at`.
2. From `event_id`, find the originating event. Who emitted it? What category?
3. Check user's preferences: are quiet hours set? What timezone?
4. Check the Fan-out Service log for this event: did it evaluate quiet hours? What did it decide?

Likely causes:

- Transactional category. Quiet hours do not apply to transactional. If the SMS was a 2FA code, by design.
- Timezone wrong. User's timezone is UTC in our records but they are actually in PST. We sent at "10am UTC" which is 3am PST. Fix: refresh user timezone on app open.
- Bug in quiet hours evaluation. Off-by-one or DST issue. Reproduce by replaying the same event with the same user state.

The audit log (which Fan-out decisions were made for this notification) is what makes diagnosis possible. Without it, you cannot answer this question.

**9. Add web push as a new channel.**

What changes:

- New channel adapter for Web Push protocol (uses VAPID keys, talks to FCM for Chrome, Mozilla autopush for Firefox, etc.). New entry in the `channel` enum.
- New template variant per template (web push bodies are short, no rich content).
- Subscription endpoint: browser subscribes to push and gets a subscription object (endpoint URL + keys). We store this in `user_devices` with `platform=3 (web)`.
- Preferences UI adds the web push toggle.

What stays the same:

- Ingest API: no change. Producers emit events; Fan-out decides whether to add web push as a channel based on the user having an active web subscription.
- Kafka topology: add `notifications.web_push` topic, but the pattern is identical.
- Templates, dedup, preferences, retries, deadletter: all reused.

Adding a channel is a 2-3 week project once. The architecture pays back this design choice every time.

**10. Audit trail for compliance.**

Every notification has a row in `notifications` with:

- `notification_id`, `event_id`, `recipient_user_id`, `channel`, `template_id`, `template_version`, `category`.
- `status` (queued / sent / failed / dropped).
- `queued_at`, `sent_at`.
- `provider`, `provider_msg_id` (the provider's own ID, traceable on their dashboard).
- `error_code`, `error_message` if it failed.

For "prove user 12345 received exactly these notifications":

```sql
SELECT * FROM notifications
WHERE recipient_user_id = 12345
  AND sent_at BETWEEN ? AND ?
  AND status = 2  -- sent
ORDER BY sent_at;
```

That is the source-of-truth answer. To prove the negative ("user did not receive notification X"), the absence of a row is sufficient because every emitted notification is logged at queue time, before any provider call.

Retention: 30 days hot in Postgres, archived to S3 as Parquet for 7 years. Compliance queries hit Postgres for recent data and Athena for archived.

For deeper audit (which Fan-out decisions were made, e.g., "we considered SMS but skipped because user opted out"), structured logs from Fan-out are shipped to a log warehouse. Cheaper than putting every decision into Postgres; sufficient for the rare compliance audit.

### 12. Trade-offs worth saying out loud

Build vs buy channel adapters. You could use a single service like OneSignal or Braze to handle all channels. Pro: less code, faster to launch. Con: you pay per notification, you cannot tune behavior per channel, and you have less observability into provider issues. For a product sending billions, build. For a product sending millions, buy.

Aggregation aggressiveness. Aggregate too much and users miss real-time events. Aggregate too little and they get spammed. The right answer is product-specific and depends on user segmentation. Some products tier: power users see real-time, casual users get hourly digests.

Where to put preferences evaluation. Earlier (in Fan-out) is cheaper but less responsive to preference changes. Later (in channel worker) is more responsive but more expensive. I would pick Fan-out for the steady state and accept the ~10-second window where stale preferences may still send.

Strict vs eventual dedup. SETNX in Redis is fast but has a tiny window where two workers can both win. Two-phase commit with Postgres is durable but adds 5-10ms. SETNX for social and marketing, two-phase for transactional and 2FA.

Per-user cap vs per-recipient cap. A user can have many recipients (multiple devices, multiple emails). Do we cap per user (one limit across all their addresses) or per recipient (each device its own limit)? Per user. Otherwise a user with 5 devices effectively gets 5x the cap.

What I would revisit at 10x scale:

- Move the Fan-out Service to a streaming framework (Flink or Kafka Streams) instead of bare Kafka consumers. Lets you express aggregation windows declaratively and get state management for free.
- Federate the dedup store regionally. At 100K/sec writes, one global Redis becomes the bottleneck. Shard by recipient_user_id with strong consistency within shard, eventually consistent across shards.
- Build a "shadow send" mode where new channels or new templates can be evaluated against real traffic without actually delivering. The shadow path writes to a log instead of calling the provider. Lets you validate behavior before rolling out.

### 13. Common interview mistakes

One worker pool for all channels. "We have a worker that handles push, email, and SMS." Wrong. One bad channel drags down the others. Separate pools, separate Kafka topics.

No idempotency key on producer calls. "Producers just call our API." Then a producer retry sends two notifications. Bad.

Synchronous preference lookup from a database. "We look up preferences for each event from Postgres." At 100K/sec, that is 100K Postgres reads/sec, which melts the database. Redis cache with pub/sub invalidation.

No mention of aggregation. A user with 100 likes on a post gets 100 notifications. Real product complaint within a day of launch.

No quiet hours, no per-user cap. Both are required for any product that has more than a handful of users.

Treating push token revocation as a manual cleanup. APNs and FCM tell you when a token is dead. Build the feedback loop on day one.

No deadletter strategy. "Failed messages just retry forever." Either you flood the provider or messages pile up forever. Deadletter + categorization + auto-cleanup is required.

Ignoring channel-specific SLAs. Treating push and email with the same retry policy means you either over-retry push (delivers a "your driver arrived" 2 hours late) or under-retry email (drops messages that could have been delivered after the provider's 1-hour outage).

Forgetting that marketing is different. Transactional and marketing have different latency, different scale, different compliance. A single uniform pipeline blurs them and creates problems.

No mention of compliance. GDPR for EU, TCPA for SMS in US, CAN-SPAM for email. Each has hard rules (unsubscribe links mandatory in marketing email, opt-in proof for SMS). The architecture must accommodate them, not bolt them on later.

If you hit 8 of these 10, you are interviewing well. Most candidates miss aggregation, quiet hours, and push token cleanup.
{% endraw %}
