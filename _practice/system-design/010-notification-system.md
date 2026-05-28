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
## The scene

You sit down. The interviewer leans forward.

> *"Every time Alice likes your photo, you get a push. Every time your invoice is ready, you get an email. Every time your Uber driver is three minutes away, you get an SMS."*
>
> *"One event comes in. The right notifications go out. Design the system that does this at a billion users."*

It sounds like "read from a queue, call Apple's push service, done." It is not.

The trap is the word **one**. One event is not one notification. One event can become zero notifications (the user turned everything off), one notification (a single SMS), or ten million notifications (a marketing blast). The system has to handle all three shapes without operators tuning it by hand.

Two problems collide here. **Fan-out:** one input event produces many output messages, like one "Black Friday sale" event going to ten million recipients. And **external delivery:** your code does not deliver the push. Apple does. Or Google. Or SendGrid. Or Twilio. Each has its own failures, its own rate limits, its own error codes.

Get fan-out wrong and you wake users up at 3am. Get retries wrong and you either drop notifications silently or send the same SMS seven times.

We will build this from a tiny startup up to a billion-user product, adding one layer at a time.

---

## Step 1: Picture one notification

Before any boxes, picture what one notification actually is. One event. One recipient. One channel.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Received: event arrives
    Received --> Filtered: check user prefs
    Filtered --> Queued: emit to channel
    Filtered --> Dropped: user opted out
    Queued --> Delivered: provider accepts
    Queued --> Retrying: transient failure
    Retrying --> Delivered: retry succeeds
    Retrying --> Failed: retries exhausted
    Delivered --> [*]
    Dropped --> [*]
    Failed --> [*]
```

That is the whole product. Everything we add later (fan-out, aggregation, quiet hours, rate limits) is a complication on top of this single path.

> **Take this with you.** A notification system is a pipeline. The hard part is not moving the message. The hard part is deciding whether to move it at all, and what to do when the provider fails.

---

## Step 2: Ask the right questions

In a real interview, sit quietly for two minutes. Write down the questions whose answers change the whole design. Not every edge case. Five good questions.

<details markdown="1">
<summary><b>Show: 5 questions that change the design</b></summary>

1. **Which channels?** Push (iOS and Android), email, SMS, in-app? *Each channel is a different external service with different error codes and rate limits. The design has to treat channels as plug-ins, not bake one in.*

2. **What kinds of events trigger notifications?** User activity (Alice liked your post), system events (your invoice is ready), or marketing campaigns? *Marketing is a totally different shape. One operator click can target 10 million users. Transactional goes to one user at a time. They need separate paths.*

3. **Can users turn things off?** Per channel? Per event type? Quiet hours? *Preferences are the number-one source of "why did I get this?" complaints. They must be checked before fan-out, not after.*

4. **What is the freshness deadline per channel?** Push in under a minute? Email in under five minutes? *A two-hour-old "your driver arrived" push is junk. A weekly digest email can wait an hour. Different deadlines change the retry policy completely.*

5. **What if the same event arrives twice?** A producer service retried because of a network blip. Do we send the notification twice? *This decides whether we need idempotency keys throughout the pipeline.*

The meta question: *"Is notifications a separate service or part of the product service?"* The right answer is separate. Product services emit events. A notification service consumes them.

</details>

---

## Step 3: How big is this thing?

Same product, two very different scales.

| Company | Users | Notifications/day | Per second (sustained) | Peak burst |
|---------|-------|-------------------|------------------------|------------|
| Startup | 100k | ~1 million | ~12 | ~50 |
| Billion-user product | 1 billion | ~10 billion | ~116,000 | ~350,000 |

<details markdown="1">
<summary><b>Show: how the numbers come out</b></summary>

**Startup: 100k users.**

Assume 10 notifications per user per day on average. That is 1 million per day, or about 12 per second. Even with a 4x peak, a single server handles this easily.

**Billion-user product: 10 billion per day.**

10 billion / 86,400 seconds = ~116,000 per second sustained. Peak is roughly 3x that, ~350,000/sec.

Per-channel split:

| Channel | Share | Sustained QPS |
|---------|-------|---------------|
| Push    | 60%   | ~70,000/sec |
| In-app  | 30%   | ~35,000/sec |
| Email   | 7%    | ~8,000/sec  |
| SMS     | 3%    | ~3,500/sec  |

**Marketing campaign burst.**

One campaign targeting 10 million users sent in 5 minutes: 10M / 300 seconds = ~33,000/sec for those 5 minutes. A 30% spike on top of the baseline.

**Storage for delivery records over 30 days.**

One row per delivered notification is about 120 bytes. 10 billion × 120 bytes = 1.2 TB per day. Over 30 days: 36 TB. Spread across 64 database shards, that is ~600 GB per shard.

**The number that matters.** Throughput is not the hard part. A well-partitioned Kafka cluster handles 116,000/sec easily. The hard parts are:

1. Fan-out per event ranges from 0 to 10 million. The system must handle that range without operators adjusting settings per campaign.
2. External providers are slow and lossy. You have to retry without sending duplicates.
3. Preferences must be checked cheaply for every single notification in the hot path.

</details>

---

## Step 4: The smallest thing that works

Forget a billion users. We are a startup. One event type: "someone liked your post." One channel: push. One external provider: APNs.

Three boxes. Nothing else.

```mermaid
flowchart LR
    PS([Post Service]):::user --> API[/"Ingest API"/]:::app
    API --> K{{"Kafka"}}:::queue
    K --> W["Push Worker"]:::app
    W --> APNs:::ext

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    classDef ext fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

One event, all the way to the device:

```mermaid
sequenceDiagram
    autonumber
    participant P as Post Service
    participant I as Ingest API
    participant K as Kafka
    participant W as Push Worker
    participant A as APNs
    participant D as Alice's phone

    P->>I: POST /events (event_id=42, recipient=Alice)
    I->>K: append to events.created
    I-->>P: 202 Accepted
    K->>W: read event
    W->>A: POST /3/device/{token}
    A-->>W: 200 OK
    A->>D: push notification
```

<details markdown="1">
<summary><b>Show: the minimal table</b></summary>

```sql
CREATE TABLE notifications (
    notification_id   UUID PRIMARY KEY,
    event_id          UUID NOT NULL,
    recipient_user_id BIGINT NOT NULL,
    channel           TEXT NOT NULL,
    status            TEXT NOT NULL,   -- 'queued', 'sent', 'failed'
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    sent_at           TIMESTAMPTZ
);
```

One table. This is the right place to start. Everything we add from here will be a response to a real problem.

</details>

> **Take this with you.** Always start from the smallest thing that works. The interesting part of the interview is what happens **next**.

---

## Step 5: The first crack

The next morning, the product manager walks in: *"We want to send the same 'liked your post' notification via email for users who opted out of push. And we want to send a welcome email to every new signup. Oh, and a weekly digest."*

You look at your code. The word `push` is baked in everywhere. If you add email by copy-pasting the push worker, you will add SMS the same way next month, then in-app, and you will end up with four nearly-identical workers sharing no code, with different bugs in each.

The real problem: one event can now produce different notifications for different channels. You have a **fan-out** problem.

```mermaid
flowchart LR
    subgraph Before["One event, one channel"]
        E1[liked.post] --> Push1[push worker]
    end
    subgraph After["One event, multiple channels"]
        E2[liked.post] --> FO[Fan-out Service]
        FO --> Push2[push worker]
        FO --> Email[email worker]
        FO --> InApp[in-app worker]
    end
```

The Fan-out Service is where the decision lives: *for this event, for this user, on which channels?* That question touches preferences, quiet hours, and the per-user rate cap. It belongs in one place, not scattered across four workers.

<details markdown="1">
<summary><b>Show: the Fan-out Service decision logic</b></summary>

```python
def fan_out(event):
    for recipient in event.recipients:
        prefs = preferences.get(recipient.user_id)   # Redis cache hit

        for channel in ["push", "email", "sms", "in_app"]:
            if not prefs.channel_enabled(channel):
                continue
            if not prefs.category_enabled(channel, event.category):
                continue
            if is_quiet_hours(recipient.user_id, channel):
                maybe_defer(event, recipient, channel)
                continue
            if hourly_cap_exceeded(recipient.user_id, channel):
                continue

            emit_to_channel(channel, event, recipient)
```

Five checks. Each one a reason to stop. If all five pass, the notification is emitted to the per-channel queue. The channel worker then handles delivery, retries, and failure.

</details>

> **Take this with you.** Fan-out is its own service. Once you add a second channel, preferences and quiet hours live in the fan-out layer, not inside each channel worker.

---

## Step 6: Build the architecture, one layer at a time

We now have a Fan-out Service. Build the rest of the system around it, one layer at a time.

### v1: just the pipeline

```mermaid
flowchart TB
    P([Producer]):::user --> I["Ingest API"]:::app
    I --> K{{"Kafka<br/>events.created"}}:::queue
    K --> F["Fan-out Service"]:::app
    F --> W["Channel Worker"]:::app
    W --> Ext:::ext

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    classDef ext fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

Fine for a startup. One channel, one worker pool.

### v2: multiple channels, separate queues

Each channel has its own queue and its own worker pool. If SendGrid goes down, email backs up but push keeps flowing.

```mermaid
flowchart TB
    P([Producer]):::user --> I["Ingest API<br/>(dedup on event_id)"]:::app
    I --> K{{"Kafka<br/>events.created"}}:::queue
    K --> F["Fan-out Service"]:::app
    F --> KP{{"push topic"}}:::queue
    F --> KE{{"email topic"}}:::queue
    F --> KS{{"sms topic"}}:::queue
    KP --> PW["Push Worker"]:::app
    KE --> EW["Email Worker"]:::app
    KS --> SW["SMS Worker"]:::app
    PW --> APNs:::ext
    EW --> SG[SendGrid]:::ext
    SW --> Tw[Twilio]:::ext

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    classDef ext fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

### v3: preferences, templates, dedup

The fan-out check needs three things at hot-path speed: user preferences, message templates, and a dedup store. All three belong in Redis.

```mermaid
flowchart TB
    P([Producer]):::user --> GW["API Gateway"]:::edge
    GW --> I["Ingest API"]:::app
    I --> K{{"Kafka<br/>events.created"}}:::queue
    K --> F["Fan-out Service"]:::app
    F --> Prefs[("Preferences<br/>Redis cache")]:::cache
    F --> T[("Template<br/>Service")]:::db
    F --> DD[("Dedup Store<br/>Redis 24h TTL")]:::cache
    F --> KP{{"push"}}:::queue
    F --> KE{{"email"}}:::queue
    F --> KS{{"sms"}}:::queue

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

### v4: the full system

Add the delivery log, a device registry, dead-letter queues, and a separate Campaign Scheduler for marketing blasts.

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        P([Producer Services]):::user
        GW["API Gateway<br/>(auth, rate limit, idempotency)"]:::edge
    end

    subgraph Ingest["Ingest path"]
        I["Ingest API"]:::app
        K{{"Kafka<br/>events.created"}}:::queue
    end

    subgraph FanOut["Fan-out path"]
        F["Fan-out Service"]:::app
        Prefs[("Preferences<br/>Service + Redis")]:::cache
        Tmpl[("Template<br/>Service")]:::db
        DD[("Dedup Store<br/>Redis")]:::cache
        DR[("Device<br/>Registry")]:::db
    end

    subgraph Channels["Per-channel queues + workers"]
        KP{{"push"}}:::queue
        KE{{"email"}}:::queue
        KS{{"sms"}}:::queue
        KI{{"in-app"}}:::queue
        PW["Push Worker"]:::app
        EW["Email Worker"]:::app
        SW["SMS Worker"]:::app
        IW["In-app Worker"]:::app
    end

    subgraph Providers["External providers"]
        APNs:::ext
        FCM:::ext
        SG[SendGrid]:::ext
        TW[Twilio]:::ext
        WS["WebSocket<br/>Gateway"]:::app
    end

    DB[("Notifications DB<br/>Postgres, sharded")]:::db
    Camp["Campaign<br/>Scheduler"]:::app
    DLQ{{"Dead-letter<br/>topics"}}:::queue

    P --> GW --> I
    I --> K
    K --> F
    F --> Prefs
    F --> Tmpl
    F --> DD
    F --> DR
    F --> KP --> PW --> APNs
    F --> KP --> PW --> FCM
    F --> KE --> EW --> SG
    F --> KS --> SW --> TW
    F --> KI --> IW --> WS
    PW --> DB
    EW --> DB
    SW --> DB
    IW --> DB
    PW -.failed.-> DLQ
    EW -.failed.-> DLQ
    Camp --> I

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    classDef ext fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

Each box in one line:

| Box | What it does |
|-----|--------------|
| **API Gateway** | Authenticates producers, rate-limits, checks idempotency keys. |
| **Ingest API** | Schema check, dedup on `event_id`, appends to Kafka. |
| **Fan-out Service** | Checks preferences, quiet hours, per-user cap, aggregation windows. Emits per-channel tasks. |
| **Preferences Service** | Per-user opt-ins, quiet hours, timezone, locale. Backed by Postgres, cached in Redis. |
| **Template Service** | Versioned, localized message templates. Renders variables at fan-out time. |
| **Dedup Store** | Redis with 24h TTL. Key = `event_id + recipient + channel`. Stops duplicates across retries. |
| **Device Registry** | Maps user_id to active push tokens. Fan-out turns "send to user 456" into device tokens. |
| **Channel Workers** | Render the message, call the provider, record the result, handle retries. |
| **Notifications DB** | Delivery log. Every notification row: status, timestamps, provider message ID. |
| **Campaign Scheduler** | Expands a segment query into individual events and feeds them into the ingest path at a controlled rate. |
| **Dead-letter topics** | Notifications that failed all retries. Auto-cleans invalid tokens; surfaces others to human review. |

> **Take this with you.** If SendGrid goes down at 3am, push and SMS keep flowing. Each channel has its own queue. One bad provider cannot drag down the others.

---

## Step 7: One event, all the way through

Alice likes Bob's photo. Bob has push and in-app enabled. He is in Los Angeles (not in quiet hours).

```mermaid
sequenceDiagram
    autonumber
    participant P as Post Service
    participant GW as API Gateway
    participant I as Ingest API
    participant K as Kafka
    participant F as Fan-out
    participant Prefs as Prefs Cache
    participant DD as Dedup Store
    participant KP as push topic
    participant W as Push Worker
    participant A as APNs
    participant D as Bob's phone

    P->>GW: POST /events (event_id=evt_8f3a, recipient=Bob, type=post.liked)
    GW->>I: forward (auth ok)
    I->>DD: check event_id in Redis
    DD-->>I: not seen
    I->>DD: SET event_id (TTL 24h)
    I->>K: append to events.created
    I-->>GW: 202 Accepted

    K->>F: read event
    F->>Prefs: get Bob's prefs
    Prefs-->>F: push=on, in_app=on, quiet_hours: no

    rect rgb(241, 245, 249)
        Note over F,DD: fan-out checks (all in Redis, ~3ms total)
        F->>DD: dedup key for (evt_8f3a, Bob, push)?
        DD-->>F: not present, SETNX
        F->>KP: emit push task
    end

    KP->>W: read push task
    W->>W: render template
    W->>A: POST /3/device/{token}
    A-->>W: 200 OK
    W->>A: APNs delivers to device
    A->>D: notification appears
```

Three things to notice:

1. The dedup check at the Ingest API catches producer retries early, before any fan-out work happens.
2. The fan-out checks (preferences, quiet hours, dedup) all hit Redis. No Postgres in the hot path.
3. The push worker talks to APNs over a persistent HTTP/2 connection. One worker holds many open streams, not one connection per notification.

---

## Step 8: Retry, dedup, and dead-letter

External providers fail. APNs returns 429 when you push too fast. SendGrid returns 5xx during incidents. Twilio rejects messages to invalid numbers. The design must tell "try again later" from "give up forever" without sending duplicates.

```mermaid
flowchart TD
    A[Worker picks up task] --> B[Check dedup key in Redis]
    B -->|key exists| C[Skip - already sent or in flight]:::ok
    B -->|key missing| D[SETNX dedup key]
    D -->|won| E[Call provider]
    D -->|lost the race| C
    E --> F{Provider response}
    F -->|200 OK| G[Mark delivered<br/>keep key for TTL]:::ok
    F -->|429 or 5xx| H{Retries left?}
    F -->|4xx invalid token/address| I[Mark address dead<br/>feed back to registry]:::bad
    F -->|4xx permanent rejection| J[Dead-letter<br/>human review]:::bad
    H -->|yes| K[Exponential backoff + jitter]
    K --> E
    H -->|no| J

    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

<details markdown="1">
<summary><b>Show: per-channel retry policy</b></summary>

Every provider response falls into one of three buckets:

| Bucket | Signal | Action |
|--------|--------|--------|
| Transient | 429, 5xx, timeout | Retry with exponential backoff + jitter |
| Permanent invalid recipient | APNs `Unregistered`, FCM `NotRegistered`, Twilio invalid number, email hard bounce | No retry. Mark address dead. |
| Permanent rejection | Content flagged, sender blacklisted | No retry. Dead-letter for human. |

Per-channel retry windows:

| Channel | Max retries | Max window | Reason |
|---------|-------------|-----------|--------|
| Push | 5 | 60 seconds | A two-hour-old "driver arrived" push is useless |
| In-app | 3 | 7 seconds | If the app is open, it needs to appear now |
| Email | 8 | 24 hours | SendGrid outages can last hours; email is store-and-forward |
| SMS | 3 | 5 minutes | Short; SMS must be timely |

**Why jitter?** If 1,000 workers all wait exactly 8 seconds after a 429, they all hit the provider at the same instant and cause another 429. Adding a random offset (say, 8 ± 2 seconds) spreads the retries out.

**Push token cleanup.** When APNs returns a dead-token signal (HTTP 410), the push worker writes to a `push_token_invalidations` Kafka topic. A small consumer marks the token as `invalid` in the device registry. Future fan-outs skip that token.

</details>

> **Take this with you.** 4xx means "stop retrying." 5xx means "try again later." Getting these two buckets mixed up turns one bad address into a million pointless API calls.

---

## Step 9: Aggregation, quiet hours, and per-user caps

Notifications are the fastest way to make users uninstall your app. Three guardrails, each enforced in the Fan-out Service.

<details markdown="1">
<summary><b>Show: aggregation windows</b></summary>

**The problem.** Alice's post goes viral. Bob gets 100 "Alice liked your post" notifications in one hour. Each fires its own event.

**The fix.** Events that can be batched carry an `aggregation_key` like `post:789:likes`. Fan-out checks Redis:

1. No open window: `SETEX agg:post:789:likes 3600 1`. Schedule a "close" message for 60 minutes from now.
2. Window exists: `INCR agg:post:789:likes`. Emit nothing.
3. At window close: read the count and the actor list. Emit one notification: *"Alice and 99 others liked your post."*

The template renders differently based on count: one actor, two named actors, or "N and M others."

One subtle edge case: the window starts on the first event. If Bob gets one like at T=0 and 99 likes at T=3,599, he gets one aggregated notification at T=3,600. If the 99 likes arrive after the window closes, he gets two: the first batch, then a new window starting. This is expected behavior for tumbling windows. Rolling windows (where the window extends on each new event) are an option but are harder to implement correctly.

</details>

<details markdown="1">
<summary><b>Show: quiet hours and per-user caps</b></summary>

**Quiet hours.** Each user's preferences include their timezone and a do-not-disturb window (like 22:00 to 07:00 local time). Fan-out converts the current UTC time to the user's local time and checks the window.

If we are inside the quiet window:

- **Transactional** (2FA, invoice, security alert): send immediately. Quiet hours do not apply.
- **Marketing**: drop. A "lunch deal: $5 off until 3pm" notification delivered at 8am the next day is stale and annoying.
- **Social** (likes, comments, follows): defer to a delayed topic. The user gets a digest when quiet hours end.

**Per-user cap.** A Redis sliding-window counter per `(user_id, channel)`:

```
INCR notifications:hourly:user_456:push
EXPIRE notifications:hourly:user_456:push 3600
```

If the counter exceeds the cap (say 20/hour for push, 5/hour for SMS), drop or defer the notification.

Why per-channel and not just per-user? Because SMS costs about $0.01 each and push costs near zero. The caps should reflect cost and intrusiveness, not just count.

Transactional notifications bypass the cap entirely. They are tagged `category=transactional` and the check skips them.

</details>

> **Take this with you.** Aggregation, quiet hours, and per-user caps all belong in the Fan-out Service, not scattered across individual channel workers. The Fan-out layer is the one place that sees every notification for every user before it goes anywhere.

---

## Follow-up questions

Try answering each in 2 or 3 sentences before opening the solution.

1. A producer service retries `event_id=42` because of a network blip, sending it twice within 100ms. Walk through how the system avoids sending duplicate notifications. What if the second retry comes 25 hours later, after the dedup TTL expires?

2. A marketing campaign is supposed to target 10 million users but the operator accidentally targets 100 million. How do you stop it mid-flight? What state has to be torn down?

3. APNs is down for 30 minutes. What happens to push notifications during the outage? What happens when it comes back? Do users see a flood at recovery?

4. A user updates their notification preferences to opt out of marketing. A marketing campaign was already queued and is mid-fan-out. Which notifications still go out?

5. A user has 5 devices. They do something that triggers a notification to themselves (like "your scheduled post just went live"). How many push notifications? On which devices? What if one device is signed out?

6. You discover a template bug: it sends literal `{{name}}` instead of the user's name. How do you roll back? What about messages already sent?

7. The notifications database shows one shard much hotter than the others. Diagnose.

8. A user complains they got an SMS at 4am. Trace the path. Who is responsible? How do you reproduce it?

9. Web push (browser-based notifications) needs to be added as a new channel. What changes in the architecture? What stays the same?

10. Compliance asks: prove that user 12345 received exactly the notifications we claim, and no others. What is your audit trail? How long do you keep it?

---

## Related problems

- **[News Feed (002)](../002-news-feed/question.md).** The fan-out worker pattern is the same. The celebrity problem (one author with millions of followers) maps onto the marketing campaign problem here (one event targeting millions of recipients).
- **[Rate Limiter (004)](../004-rate-limiter/question.md).** The per-user notification cap is exactly a rate limiter scoped to a user. The sliding-window counter and token-bucket variants apply directly.
- **[Chat System (003)](../003-chat-system/question.md).** Push notification delivery to mobile devices is the same problem as chat message delivery. APNs and FCM are the same tools, and the device-token lifecycle is shared.
- **[Distributed Cache (009)](../009-distributed-cache/question.md).** Preferences and dedup state both live in Redis with TTL. Hot-key and eviction behavior matters here too.
- **[Approval Management (011)](../011-approval-management/question.md).** Every approval event fires off notifications. The fan-out, retry, and quiet-hours machinery here consumes the approval engine's events.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Notification System

### The short version

A notification system is a pipeline. One event comes in. The right messages go out. Four stages: ingest the event, decide what to send (fan-out), route per channel, deliver through an external provider.

The pipeline runs on Kafka. Each stage is its own service so each can scale on its own bottleneck. Push, email, SMS, and in-app each get their own queue and their own worker pool. If SendGrid goes down, push keeps flowing.

The interesting work is at the edges. **Idempotency keys** (`event_id + recipient + channel`) stop duplicate sends across retries and Kafka rebalances. **Aggregation windows** turn 100 likes into one "Alice and 99 others" notification. **Quiet hours** and **per-user caps** stop the system from waking people up at 3am. **Push token cleanup** feeds back into the device registry so dead tokens get pruned within minutes.

What trips candidates: one worker pool for all channels (one bad provider drags everyone else down), preferences as a synchronous Postgres call on the hot path (cannot scale to 100,000/sec), and retries without dedup keys producing duplicate sends.

---

### 1. The two questions that matter most

**User preferences.** Without preferences, fan-out is "for each recipient, send." With preferences, it becomes "for each recipient, decide channels, check quiet hours, check the hourly cap, check if we already sent this." Different system.

**Fan-out shape.** Are events always 1-to-1 (transactional), or can one event target millions (marketing campaigns)? A 10 billion/day system with even spread is easier than one with viral spikes. The marketing worst case decides queue sizing and whether you need a separate Campaign Scheduler.

---

### 2. The math, in plain numbers

| Scale | Notifications/day | Per second (sustained) | Peak | Storage (30 days) |
|-------|-------------------|------------------------|------|-------------------|
| Startup (100k users) | ~1 million | ~12 | ~50 | 3.6 GB |
| Mid-size (10M users) | ~100 million | ~1,200 | ~5,000 | 360 GB |
| Billion-user product | ~10 billion | ~116,000 | ~350,000 | 36 TB |

Per-channel split at the billion-user scale:

| Channel | Share | Sustained QPS |
|---------|-------|---------------|
| Push    | 60%   | ~70,000/sec |
| In-app  | 30%   | ~35,000/sec |
| Email   | 7%    | ~8,000/sec  |
| SMS     | 3%    | ~3,500/sec  |

Worst burst: a 10-million-recipient marketing campaign sent in 5 minutes adds ~33,000/sec for the duration. A 30% spike on top of the 116,000 baseline.

Worker pool sizing: at 500 provider calls per second per worker, the sustained 116,000/sec needs ~230 workers; peak needs ~700. Auto-scale based on Kafka consumer lag.

The real ceiling is not your code. It is the **per-account quotas** at the providers. APNs throttles per HTTP/2 connection per certificate. Twilio throttles per sender number. SendGrid throttles per sub-account. At scale, you hold many provider credentials and load-balance across them.

---

### 3. The API

Two endpoints carry the whole product. Submit an event and read/write preferences. Everything else is reading data back.

```
POST /api/v1/events
Idempotency-Key: <event_id>

{
  "event_id": "evt_8f3a91...",
  "event_type": "post.liked",
  "category": "social",
  "actor": { "user_id": 123 },
  "recipients": [
    { "user_id": 456, "context": { "post_id": 789 } }
  ],
  "aggregation_key": "post:789:likes",
  "template_id": "tpl_like_v3",
  "template_vars": { "actor_name": "Alice", "post_title": "..." },
  "ttl_seconds": 3600
}
```

| Status | Meaning |
|--------|---------|
| **202** | Event queued |
| **200** | Same event_id already accepted (idempotent replay) |
| **400** | Invalid payload, unknown template |
| **413** | Recipient list too long (> 10k); use bulk endpoint |
| **429** | Producer rate limit hit |

Load-bearing choices:

- **`Idempotency-Key` is required.** Producer retries on timeout. Without it, mobile apps and microservices replay the same event and users get duplicate notifications.
- **`category` controls policy.** It decides whether quiet hours apply, whether per-user caps apply, and how aggressively the system retries. `transactional` bypasses caps and quiet hours. `marketing` does not.
- **`ttl_seconds` is a hard deadline.** A push with a 1-hour TTL that sits in a backed-up queue for 90 minutes gets dropped, not delivered stale. This is what prevents the "flood at recovery" problem.

For marketing campaigns targeting millions, a separate bulk endpoint takes a segment query and paces delivery:

```
POST /api/v1/campaigns
{
  "campaign_id": "cmp_winter_2026",
  "segment_query": { "country": "US", "tier": "active" },
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

The Campaign Scheduler expands the segment into a recipient stream and feeds it into the ingest path at the configured rate. Without this, one careless campaign floods Kafka and backpressures everything else.

Preferences API:

```
PUT /api/v1/users/me/notification-preferences
{
  "channels": {
    "push":  { "enabled": true },
    "sms":   { "enabled": false }
  },
  "categories": {
    "marketing":     { "enabled": false },
    "transactional": { "enabled": true }
  },
  "quiet_hours": {
    "enabled": true,
    "start": "22:00",
    "end": "07:00",
    "timezone": "America/Los_Angeles"
  }
}
```

Writes go to the Preferences Service primary. Reads come from a regional Redis cache invalidated via pub/sub on every write.

---

### 4. The data model

Five tables. Each one does one job.

```mermaid
erDiagram
    user_preferences ||--o{ notifications : "guides fan-out"
    templates ||--o{ notifications : "versioned"
    user_devices ||--o{ notifications : "token lookup"
    notifications }o--|| events : "created from"

    user_preferences {
        bigint user_id
        jsonb channels
        jsonb categories
        time quiet_hours_start
        time quiet_hours_end
        text timezone
    }
    notifications {
        uuid notification_id
        uuid event_id
        bigint recipient_user_id
        smallint channel
        smallint status
        text provider
        text provider_msg_id
        timestamptz sent_at
    }
    templates {
        text template_id
        int version
        smallint channel
        text locale
        text body
    }
    user_devices {
        uuid device_id
        bigint user_id
        smallint platform
        text push_token
        smallint status
    }
```

<details markdown="1">
<summary><b>Show: the full SQL</b></summary>

```sql
CREATE TABLE notifications (
    notification_id     UUID PRIMARY KEY,
    event_id            UUID NOT NULL,
    recipient_user_id   BIGINT NOT NULL,
    channel             SMALLINT NOT NULL,       -- 1=push, 2=email, 3=sms, 4=inapp
    template_id         VARCHAR(64) NOT NULL,
    template_version    INT NOT NULL,
    status              SMALLINT NOT NULL,       -- 1=queued, 2=sent, 3=failed, 4=dropped
    category            SMALLINT NOT NULL,       -- 1=transactional, 2=social, 3=marketing
    provider            VARCHAR(32),
    provider_msg_id     VARCHAR(128),
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

CREATE TABLE user_preferences (
    user_id              BIGINT PRIMARY KEY,
    channels             JSONB NOT NULL,
    categories           JSONB NOT NULL,
    quiet_hours_start    TIME,
    quiet_hours_end      TIME,
    timezone             VARCHAR(64),
    locale               VARCHAR(16),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version              INT NOT NULL DEFAULT 1
);

CREATE TABLE templates (
    template_id     VARCHAR(64) NOT NULL,
    version         INT NOT NULL,
    channel         SMALLINT NOT NULL,
    locale          VARCHAR(16) NOT NULL,
    subject         TEXT,
    body            TEXT NOT NULL,
    variables       JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    deprecated_at   TIMESTAMPTZ,
    PRIMARY KEY (template_id, version, channel, locale)
);

CREATE TABLE user_devices (
    device_id       UUID PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    platform        SMALLINT NOT NULL,    -- 1=ios, 2=android, 3=web
    push_token      VARCHAR(512) NOT NULL,
    status          SMALLINT NOT NULL,    -- 1=active, 2=revoked, 3=invalid
    last_seen_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_user_active ON user_devices (user_id) WHERE status = 1;
```

**Dedup store (Redis, not SQL):**

```
KEY:   dedup:{event_id}:{recipient_user_id}:{channel}
VALUE: notification_id
TTL:   24 hours
```

</details>

Three small choices doing real work:

**`notifications` is sharded by `notification_id` hash.** Writes spread evenly. The `idx_event_recipient_channel` index makes "did we already send this?" lookups fast within the shard. The Redis dedup store is the fast path. This index is the durable backup.

**`templates` are immutable per version.** To "edit" a template, publish version N+1. Roll back by flipping the current-version pointer back. Old messages already sent are stuck (you cannot un-send a push), but new sends pick up the fix within minutes.

**`user_devices` filtered by `status = 1`.** Fan-out turns "send to user 456" into active device tokens. Revoked and invalid tokens never touch the provider.

---

### 5. The engine: event to delivered push

The path of one event, with timing:

```
T+0ms    Post Service calls POST /events with event_id=evt_X, recipient=user_456.
T+5ms    Ingest API checks payload. Checks event_id in Redis: not seen.
         SETs event_id (TTL 24h). Appends to events.created Kafka topic.
         Returns 202.

T+10ms   Fan-out consumer reads the message.
T+11ms   Loads user_456's preferences from Redis (cache hit, ~1ms).
T+12ms   Loads template metadata from Redis (cache hit).
T+13ms   Checks in order:
          - category=social, prefs.social.enabled=true. OK.
          - quiet_hours: user is in PST, now is 14:00. Not in window.
          - per-user cap: counter=3, cap=20. OK.
          - aggregation: agg:post:789:likes does not exist.
            Start window: SETEX 3600 1. Schedule close message.
          - dedup: SETNX dedup:evt_X:user_456:push. Won.
         Decision: emit to push and in-app (per user's prefs).

T+15ms   Expand user_456 to active devices: device_A (ios), device_B (android).
T+16ms   Emit two push tasks. Emit one in-app task.
T+18ms   INSERT 3 rows into notifications (status=queued).

T+25ms   Push worker pulls task for device_A.
T+26ms   Check dedup key: already set by fan-out. Proceed.
T+27ms   Render template body. ~1ms.
T+28ms   Call APNs HTTP/2: POST /3/device/{token_A}.
T+150ms  APNs returns 200. Worker updates: status=sent, provider_msg_id=apns_xyz.

T+3600s  Aggregation window closes. Fan-out reads count: 47 likes.
         Emits one notification: "Alice and 46 others liked your post."
```

P50 end-to-end for a single push: ~150ms. The biggest chunk is the APNs round trip.

---

### 6. The architecture

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        P([Producer Services]):::user
        GW["API Gateway<br/>(auth · rate limit · idempotency)"]:::edge
    end

    subgraph Ingest["Ingest path"]
        I["Ingest API<br/>(dedup on event_id)"]:::app
        K{{"Kafka<br/>events.created · 64 partitions"}}:::queue
    end

    subgraph FanOut["Fan-out"]
        F["Fan-out Service<br/>(stateless pods)"]:::app
        Prefs[("Preferences<br/>Redis + Postgres")]:::cache
        Tmpl[("Template<br/>Service")]:::db
        DD[("Dedup Store<br/>Redis 24h TTL")]:::cache
        DR[("Device Registry<br/>Postgres by user_id")]:::db
    end

    subgraph Channels["Per-channel queues"]
        KP{{"push"}}:::queue
        KE{{"email"}}:::queue
        KS{{"sms"}}:::queue
        KI{{"in-app"}}:::queue
    end

    subgraph Workers["Channel workers"]
        PW["Push Workers (~150)"]:::app
        EW["Email Workers (~50)"]:::app
        SW["SMS Workers (~30)"]:::app
        IW["In-app Workers (~80)"]:::app
    end

    subgraph Providers["External providers"]
        APNs["APNs (iOS)"]:::ext
        FCM["FCM (Android/web)"]:::ext
        SG["SendGrid / SES"]:::ext
        TW["Twilio / SNS"]:::ext
        WS["WebSocket Gateway"]:::app
    end

    DB[("Notifications DB<br/>Postgres · sharded")]:::db
    DLQ{{"Dead-letter topics<br/>dlq.push / dlq.email / ..."}}:::queue
    Camp["Campaign Scheduler"]:::app

    P --> GW --> I
    I --> K
    K --> F
    F --> Prefs
    F --> Tmpl
    F --> DD
    F --> DR
    F --> KP --> PW
    F --> KE --> EW
    F --> KS --> SW
    F --> KI --> IW
    PW --> APNs
    PW --> FCM
    EW --> SG
    SW --> TW
    IW --> WS
    PW --> DB
    EW --> DB
    SW --> DB
    IW --> DB
    PW -.failed.-> DLQ
    EW -.failed.-> DLQ
    SW -.failed.-> DLQ
    Camp --> I

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
    classDef ext fill:#e9d5ff,stroke:#7e22ce,color:#581c87
```

Five things to notice:

- The Ingest API sits in front of Kafka so producers never wait on fan-out. A producer call returns 202 in under 10ms regardless of downstream load.
- Kafka is partitioned by `recipient_user_id` on `events.created`. All events for one user land on one partition. The per-user cap counter lives on the consumer that owns the partition. No cross-pod fighting.
- Fan-out and channel workers are split because they have different bottlenecks. Fan-out is IO-bound on Redis lookups. Channel workers are blocked by the provider's latency. Splitting them lets each scale independently.
- Per-channel topics contain blast radius. If SendGrid is down, the email topic backs up. Push and SMS keep flowing.
- The Campaign Scheduler is separate because marketing campaigns need pacing. Firing 10 million notifications in 10 seconds would overwhelm the provider quotas. The scheduler reads a segment query, expands it, and feeds the ingest API at a configured rate.

---

### 7. A request, end to end

```mermaid
sequenceDiagram
    autonumber
    participant P as Post Service
    participant GW as API Gateway
    participant I as Ingest API
    participant K as Kafka
    participant F as Fan-out
    participant DD as Dedup (Redis)
    participant KP as push topic
    participant W as Push Worker
    participant A as APNs

    P->>GW: POST /events (event_id=evt_8f3a)
    GW->>I: forward (auth ok)
    I->>DD: SETNX event_id (dedup check)
    DD-->>I: ok, first time seen
    I->>K: append to events.created
    I-->>GW: 202 Accepted
    GW-->>P: 202 Accepted

    K->>F: read event (partition by recipient_id)

    rect rgb(241, 245, 249)
        Note over F,DD: fan-out checks, all Redis, ~3ms
        F->>F: load prefs, check category, quiet hours, cap
        F->>DD: SETNX dedup:evt_8f3a:user_456:push
        DD-->>F: set ok
    end

    F->>KP: emit push task
    KP->>W: read task
    W->>W: render template
    W->>A: POST /3/device/{token} (HTTP/2)
    A-->>W: 200 OK
    W->>W: UPDATE notifications (status=sent)
```

---

### 8. The scaling journey: 10 users to 1 billion

```mermaid
flowchart LR
    S1["Stage 1<br/>10k users<br/>1 app + 1 Postgres<br/>~$50/mo"]:::s1
    S2["Stage 2<br/>~1M users<br/>+ Kafka<br/>+ Preferences svc<br/>~$500/mo"]:::s2
    S3["Stage 3<br/>10M-100M users<br/>+ Redis for hot reads<br/>+ per-channel workers<br/>+ Campaign Scheduler<br/>~$3-8k/mo"]:::s3
    S4["Stage 4<br/>1B users<br/>+ multi-region<br/>+ Flink for aggregation<br/>+ sharded dedup store"]:::s4

    S1 --> S2 --> S3 --> S4

    classDef s1 fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef s2 fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s3 fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef s4 fill:#fce7f3,stroke:#be185d,color:#831843
```

#### Stage 1: 10,000 users

One Postgres, one app instance. Preferences stored in Postgres. Push only (APNs + FCM). Notifications delivered inline via HTTP call to APNs. No queue, no retry logic beyond a single try-catch.

Enough because you see a few hundred notifications per hour. Building more is over-engineering.

#### Stage 2: 1 million users

Something breaks: the inline APNs call slows down the API because APNs latency is 50-200ms. Producer services start timing out.

Add Kafka to decouple the ingest path from delivery. Add a Preferences Service backed by Postgres (still synchronous, but now a separate service). Add a push worker pool. Add basic retry logic. ~$500/month.

Still no Redis, no separate channel workers, no dedup beyond a simple Postgres check. One million users and a few thousand notifications per minute is still manageable with direct Postgres reads.

#### Stage 3: 10 million to 100 million users

Several things break at once:

- Preferences Postgres is hit on every fan-out event. At 10,000/sec, that is 10,000 Postgres reads per second. The database falls over.
- One marketing campaign targeting 5 million users overwhelms the single channel worker pool. Email delivery queues up behind push.
- No dedup: a Kafka consumer rebalance causes a worker to re-process 500 messages. Users get duplicate push notifications.

Fixes, in order:

- Redis cache for preferences with pub/sub invalidation on write. Cache hit rate goes to 99%.
- Separate Kafka topics and worker pools per channel. Email and push can now fail independently.
- Redis dedup store with SETNX. Consumer rebalance duplicates handled.
- Campaign Scheduler to pace large campaigns.
- Aggregation windows in fan-out to batch social notifications.
- Quiet hours and per-user caps enforced at fan-out.

Cost jumps to $3-8k/month.

#### Stage 4: 1 billion users

New problems:

- EU operations open. GDPR requires EU user data to stay in EU.
- The Redis dedup store at 100k writes/sec on one cluster becomes a bottleneck.
- Aggregation windows are stateful. Fan-out workers need distributed state for aggregation counters.
- Marketing campaigns targeting 100 million users overwhelm even the Campaign Scheduler.

Multi-region: each region has its own Kafka, workers, Postgres, and Redis. The user's home region (from HRIS/auth) decides where events are processed. Cross-region delivery (a US user sending a notification to an EU user) routed via authenticated cross-region API.

Dedup store sharded by `recipient_user_id` with strong consistency within shard. The dedup guarantee is per-shard; acceptable because cross-shard duplicates are rare.

Replace bare Kafka consumers in fan-out with Flink or Kafka Streams for window aggregation. Lets you express aggregation declaratively and get state management for free.

The core data model has not changed since Stage 1. You added regions, sharding, and a streaming framework on top.

---

### 9. The variants

| Variant | What changes |
|---------|--------------|
| **In-app only (no external providers)** | No retry, no token cleanup, no provider quotas. Fan-out writes directly to an inbox table. WebSocket gateway for online users. |
| **2FA / security SMS** | Exactly-once guarantee required. Use two-phase commit (Postgres `INSERT ON CONFLICT`) instead of Redis SETNX. Accept the ~5ms extra latency. |
| **Weekly digest** | Fan-out defers all social notifications to a "digest" bucket. A cron job at Sunday midnight aggregates per user and emits one email. |
| **WhatsApp / LINE** | Same channel adapter pattern. Each new channel is ~2 weeks of work to wire in. Nothing else changes. |

---

### 10. Reliability

**Provider outage.** APNs goes down for 30 minutes. Push topic backs up. Push workers retry with backoff. After max retries, messages go to dead-letter. When APNs returns, the backlog drains. Two safeguards stop a flood: per-notification TTL drops stale messages, and workers respect APNs's published throughput limit on recovery.

**Consumer rebalance.** Kafka consumer groups rebalance when a pod dies or joins. A partition briefly gets processed by two consumers. The Redis SETNX dedup key serializes them: the loser sees the key set and skips the provider call. For 2FA SMS, the stronger Postgres two-phase commit is used instead.

**Late-arriving events.** A producer held an event for 10 minutes due to its own outage, then sent it. If `ttl_seconds` was 5 minutes, drop it. If no TTL was set, deliver it. Some events (an invoice notification) should be delivered even slightly late. Producers are expected to set TTL based on the event's meaning.

**Preferences write race.** A user rapidly toggles marketing opt-out on and off. The pub/sub invalidation fires multiple times. The preferences cache reads the latest value from Postgres on each invalidation. The last write wins. This is intentional and correct.

---

### 11. Observability

| Metric | Why it matters |
|--------|----------------|
| `notifications.queued_rate` (by channel, category) | Headline throughput |
| `notifications.delivery_rate_pct` (delivered / queued) | Drops below 95% = page |
| `fanout.latency_p99` | Fan-out service health |
| `channel.latency_p99` (per provider) | Spot APNs/SendGrid slowdowns early |
| `provider.error_rate` (by code) | Distinguish transient from permanent failures |
| `dedup.hit_rate` | Should be near 0% in steady state; spike means producers are retrying |
| `aggregation.windows_open` | Sanity check |
| `quiet_hours.deferred_rate` | If too high, the system may be holding too much |
| `preferences.cache_hit_rate` | Should be > 99% |
| `kafka.consumer_lag_p99` (per topic) | Leading indicator of backup |
| `deadletter.rate` (by channel, reason) | Triggers manual triage |
| `token_invalidation.rate` | Sudden spike may be an auth bug |
| `unsubscribe.rate` (by category) | Product signal for notification fatigue |

Page on: any channel's `delivery_rate_pct` below 95% for 5 minutes. Fan-out `latency_p99` above 30 seconds for 5 minutes. Dead-letter rate spike more than 10x baseline.

Ticket on: unsubscribe rate spike (likely a bad campaign). Token invalidation spike (auth bug?). Preferences cache hit rate dropping (eviction tuning needed).

---

### 12. Follow-up answers

**1. Producer retries `event_id=42` twice within 100ms. Later, after TTL expires.**

Within 100ms: the Ingest API checks Redis for the event_id. The first call SETs the key (24h TTL) and proceeds. The second call sees the key set and returns 200 immediately. Nothing reaches Kafka twice.

After 25 hours: the dedup key has expired. The second call is treated as a new event and a second notification fires. This is intentional. Twenty-four hours is long enough that a legitimate retry has already landed. After that, the same event_id is more likely an operator manually resending or a bug producing the same ID for a different intent. For strict deduplication beyond 24 hours, write the event_id to a Postgres `processed_events` table with a unique constraint at ingest time.

**2. Marketing campaign accidentally targets 100M instead of 10M.**

Detection: the volume alert fires when `notifications.queued_rate` for the marketing category spikes beyond the expected band.

Stop at the Campaign Scheduler: `POST /campaigns/{id}/pause`. The scheduler stops emitting events within 1-2 seconds.

Events already on `events.created` Kafka are not stopped by pausing the scheduler. Fix: the fan-out Service checks a "campaign blocklist" Redis set on every event. If the campaign_id is in the blocklist, drop the event without fan-out. The operator adds the campaign_id via an admin endpoint, effective within seconds.

Per-channel topics may already have tasks from the bad campaign. Channel workers also check the blocklist before calling the provider.

Cleanup: the blocklist entry expires after 24 hours. Notifications already sent are in the notifications table for audit. Nothing to roll back on the delivery side.

**3. APNs is down for 30 minutes.**

During: push topic backs up. Workers retry with exponential backoff. After max retries (5 attempts, ~60-second window), messages go to dead-letter.

Recovery: APNs returns. Workers resume. A backlog of ~500k messages drains over the next ~5 minutes.

Flood prevention: per-message TTL drops anything past its expiration. A "your driver arrived" push with a 5-minute TTL is dropped if it sat in the queue for 30 minutes. Workers also respect APNs's throughput limits on resumption and do not dump the full backlog at once.

**4. User opts out of marketing while a campaign is in flight.**

Fan-out checks preferences at the moment it processes the event, not when the event was created. The preferences cache has a 5-minute TTL with pub/sub invalidation on write. Opt-out at T=0 invalidates the cache. Fan-out refetches on next event, typically within 1 second.

Events already past the fan-out stage and sitting on per-channel topics are not re-checked. Those are sent. Window of inconsistency: about 10 seconds.

For strict legal compliance (must not send marketing after opt-out), also re-check preferences in the channel worker before calling the provider. Adds ~1ms per send. Worth it for marketing.

**5. User has 5 devices; notification to themselves.**

Fan-out expands "send to user_456" against the device registry filtered by `status = 1` (active). Results: device_A (ios, active), device_B (android, active), device_C (ios, status=revoked, skip), device_D (web push, active), device_E (ios, status=invalid, skip).

Result: 3 push notifications, one per active device. The signed-out and invalid-token devices are filtered at expansion time, before any provider call.

The user gets 3 pushes. Whether to further deduplicate to the most recently active device is a product decision. Most products send to all active devices.

For in-app: one row in the inbox, regardless of devices. Inbox is per-user, not per-device.

**6. Template bug: renders `{{name}}` literally.**

Detection: support tickets, or an automated lint pass that catches unrendered variables in a sample render.

Roll back: templates are versioned and immutable. Flip the "current version" pointer for `tpl_X` from v3 to v2. Fan-out picks up the new pointer when the template metadata cache expires (TTL is short for the pointer, longer for the body).

Messages already sent cannot be recalled. For severe issues (PII leaked), send a follow-up notification with an apology. Mostly, accept the damage and fix forward.

Prevention: every template change goes through lint (check template_vars match variables referenced), a preview render with sample data, a canary to 0.1% of recipients, then full rollout.

**7. One database shard hotter than others.**

Diagnosis:

1. Check the shard key. `notifications` is sharded by `notification_id` hash. An imbalance on a hash-sharded table usually means either the hash function is bad or queries are not using the shard key and are scatter-gathering.
2. Check slow-query logs. A query like `SELECT FROM notifications WHERE recipient_user_id = ?` scatter-gathers all shards when `recipient_user_id` is not the shard key. One slow shard delays every such query, and it looks "hot" from outside.
3. Check partition age within the shard. If partitioned by week, the current week's partition takes all writes. Expected and fine.
4. Check noisy neighbor. Another tenant on the same physical host can steal I/O.

Most often it is a query-pattern issue. A secondary index on `recipient_user_id` on each shard handles the common case without re-sharding.

**8. User got an SMS at 4am.**

Trace:

1. `SELECT FROM notifications WHERE recipient_user_id = ? AND channel = 3 AND sent_at BETWEEN '03:30' AND '04:30'`. Returns `notification_id`, `event_id`, `template_id`, `category`.
2. From `event_id`: find the originating event. Who emitted it? What `category`?
3. Check the user's preferences: are quiet hours set? What timezone is stored?
4. Check fan-out logs for this event: did it run the quiet-hours check? What did it decide?

Likely causes: (a) the category was `transactional`, so quiet hours were skipped by design; (b) the user's timezone is wrong in the preferences table (stored as UTC but they live in PST); (c) a DST edge case in the quiet-hours evaluation. Reproduce by replaying the same event with the same user state against the fan-out logic.

The structured fan-out log is what makes diagnosis possible. Without it, you cannot answer this question.

**9. Add web push as a new channel.**

What changes:

- New channel adapter for the Web Push protocol (uses VAPID keys, talks to FCM for Chrome, Mozilla autopush for Firefox).
- New entry in the `channel` enum.
- New template variant per template (web push bodies are short).
- Subscription endpoint: browser subscribes and gets a `{endpoint URL, keys}` object stored in `user_devices` with `platform=3`.
- Preferences UI adds the web push toggle.

What stays the same: Ingest API, Kafka topology, dedup store, preferences service, retry and dead-letter logic, templates service. Fan-out now checks for an active web subscription and, if present, emits to a new `notifications.web_push` topic.

Adding a channel is a 2-3 week project. The architecture pays back this decision every time.

**10. Audit trail for compliance.**

Every notification has a row in `notifications` with: `notification_id`, `event_id`, `recipient_user_id`, `channel`, `template_id`, `template_version`, `category`, `status`, `queued_at`, `sent_at`, `provider`, `provider_msg_id`, `error_code`.

For "prove user 12345 received exactly these notifications":

```sql
SELECT *
  FROM notifications
 WHERE recipient_user_id = 12345
   AND sent_at BETWEEN ? AND ?
   AND status = 2
 ORDER BY sent_at;
```

The absence of a row proves the negative: every emitted notification is logged at queue time (status=queued), before any provider call. If status never became `sent`, the row is still there.

Retention: 30 days hot in Postgres, archived to S3 as Parquet for 7 years. Compliance queries hit Postgres for recent data and Athena for archived.

For deeper audit (why a notification was suppressed: quiet hours? cap? opt-out?), structured fan-out logs ship to a log warehouse. Cheaper than putting every suppression decision in Postgres. Sufficient for the rare compliance audit.

---

### 13. Trade-offs worth saying out loud

**Build vs. buy channel adapters.** You could use OneSignal or Braze to handle all channels. Faster to launch. But you pay per notification at scale, you cannot tune behavior per channel, and you have less visibility into provider failures. For a product sending billions, build. For millions, buy.

**Where to evaluate preferences.** Earlier (in fan-out) is cheaper but slightly stale if the user changes preferences mid-campaign. Later (in channel worker) is more responsive but costs an extra Redis read per send. Fan-out is the right default; re-check in the channel worker only for strict compliance cases.

**Strict vs. eventual dedup.** Redis SETNX is fast but has a window where two workers can both win. Two-phase commit with Postgres is durable but adds 5-10ms. SETNX for social and marketing. Two-phase for 2FA SMS. Pick per category.

**Aggregation window shape.** Tumbling windows (fixed duration, no overlap) are simple but can produce two notifications if events straddle a boundary. Rolling windows extend on each event and never close until quiet, but they delay delivery. Most products use tumbling with a 1-hour default and accept the edge case.

**What you would revisit at 10x scale.** Move fan-out to a streaming framework (Flink or Kafka Streams) for declarative window aggregation and built-in state management. Federate the dedup store regionally. Build a "shadow send" mode where new channels or templates can be tested against real traffic without actually calling the provider.

---

### 14. Common mistakes

**One worker pool for all channels.** "We have a worker that handles push, email, and SMS." Wrong. One bad channel drags down the others. Separate pools, separate topics.

**No idempotency key on producer calls.** A producer retry sends two notifications. Bad.

**Synchronous Postgres preference lookup in the hot path.** At 100k/sec, 100k Postgres reads per second melts the database. Cache in Redis with pub/sub invalidation.

**No aggregation.** A user with 100 likes on a post gets 100 notifications. Real product complaint within a day of launch.

**No quiet hours or per-user cap.** Both required for any product with more than a few hundred users.

**Treating push token revocation as manual cleanup.** APNs and FCM tell you when a token is dead. Build the feedback loop on day one.

**No dead-letter strategy.** "Failed messages just retry forever." Either you flood the provider or messages pile up indefinitely.

**Same retry policy across all channels.** Push with a 24-hour retry window delivers a "your driver arrived" push two hours late. Email with a 60-second retry window drops messages that could have delivered after a 1-hour SendGrid outage.

**Forgetting marketing is different from transactional.** Marketing needs pacing, a Campaign Scheduler, separate quiet-hours behavior, and compliance handling (CAN-SPAM, GDPR). A single uniform pipeline blurs them.

**No mention of compliance.** GDPR for EU, TCPA for SMS in the US, CAN-SPAM for email. The architecture must accommodate these, not bolt them on later.

If you hit 8 of these 10 in an interview, you are doing well. The three that separate strong from average answers: separate per-channel queues, dedup keys on the producer path, and preferences as a cached read.
{% endraw %}
