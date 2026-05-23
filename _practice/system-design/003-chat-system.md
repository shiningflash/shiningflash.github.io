---
layout: practice-problem
track: system-design
problem_id: 3
title: Design a Chat System (WhatsApp / Slack)
slug: 003-chat-system
category: Real-Time Communication
difficulty: Hard
topics: [websockets, message delivery, presence, ordering, end-to-end]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/003-chat-system"
solution_lang: markdown
---

{% raw %}
## Scene

Third loop. The interviewer did time at WhatsApp and then Slack. They open with one line:

> *Design a chat system. Both 1-to-1 and group. Real-time. Mobile clients are the primary surface. Go.*

They are not asking for email. "Real-time" is doing a lot of work in that sentence. If I start by listing REST endpoints, I have already missed what makes this problem hard. If I draw a single WebSocket box and call it done, I have missed the other thing that makes it hard.

Two things make chat genuinely difficult: persistent connections at scale, and per-conversation ordering across mobile clients that drop offline constantly. Everything else is a variation of patterns I have seen before.

## Step 1: clarify before you design

Take 5 minutes. Do not draw anything. What would I ask the interviewer? Aim for at least six questions that would change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. Scale. "Daily active users? Connections held open at peak? Messages per day?" A WhatsApp-style answer: 1B DAU, 500M concurrent connections at peak, 100B messages per day. The concurrent-connection number is the single biggest design driver. 500M open TCP sockets is not a back-of-the-envelope detail; it dictates how many edge servers I need and how I load balance them.
2. 1-to-1 vs group, and group size. "Are groups capped? At what?" WhatsApp caps groups at 1024. Slack channels go to tens of thousands. Discord servers go higher. The group-size answer changes whether per-message fan-out fits in a single transaction or needs a worker pool.
3. Ordering guarantees. "Strict FIFO per sender? Total order in a conversation? Causal order?" Most chat products promise FIFO per sender and a consistent view per conversation, not strict total order. That difference removes the need for distributed consensus on every message.
4. Delivery receipts. "Do we show sent / delivered / read? For groups too?" Receipts triple the message volume in groups (every recipient sends a delivered, then a read). If groups are 1000 strong, one message produces 1000 delivered events. That is bigger than the message traffic itself.
5. Presence. "Online/offline indicator? Typing indicators? Last-seen?" Presence is a different beast: high update rate, low durability requirements, fan-out to a separate audience (your contacts, not your message threads).
6. History and retention. "Server-side history? How far back? Searchable?" WhatsApp historically kept little server-side; Slack keeps everything indexed forever. This decision changes the storage tier entirely.
7. Encryption. "End-to-end? Server-side? Key handling on multi-device?" E2E (WhatsApp, Signal) means the server cannot read messages, which constrains search, moderation, and notification content. I mention it but do not deep-dive here.
8. Push notifications when offline. "If a recipient is not connected, how do they find out?" Apple/Google push services have their own delivery semantics and rate limits. They are part of the design.

Asking only "how many users" misses the questions that actually shape the architecture. Concurrent connections, group size, and delivery receipts together determine 80% of the system.

</details>

## Step 2: capacity estimates

Inputs from the interviewer:

- 1B DAU
- 500M concurrent WebSocket connections at peak
- 100B messages per day total
- 50% of messages are in groups; average group size 50; max group size 1000
- Each message generates a "delivered" event from each online recipient and a "read" event from each who opens it (assume 80% read rate)
- Average message size 200 bytes
- History retention: 1 year, searchable

Compute (on paper, then reveal):

1. Messages per second sustained and peak
2. Including delivery and read receipts, total events per second through the system
3. Edge server count if one server holds 100K connections
4. Storage for one year of messages
5. Outbound bandwidth at peak (for delivery to recipients)

<details>
<summary><b>Reveal: the math</b></summary>

Messages per second. 100B / 86400 ≈ 1.16M messages/sec sustained. Peak 3x → ~3.5M messages/sec.

With receipts:

- 50% of messages are 1-to-1: 1 delivered + 0.8 read = 1.8 receipts per message.
- 50% are in groups of avg size 50, so 49 recipients per message. Assume ~80% are online: ~39 delivered + ~31 read = 70 receipts per group message.
- Weighted average: 0.5 × 1.8 + 0.5 × 70 ≈ 36 receipts per message.
- Total events: 1.16M × (1 + 36) ≈ 43M events/sec sustained, ~130M peak.

Receipts dominate the load, not messages. That is the first non-obvious insight.

Edge servers. 500M connections / 100K per server = 5000 edge servers at peak. In practice over-provision to 7000-8000 to absorb traffic shifts. Each holds one open TCP socket per connected client; kernel and memory tuning matter.

Storage. 100B msgs/day × 365 = 36.5T messages/year. At 200 bytes (content) + ~150 bytes (metadata, sender, conversation_id, timestamp, message_id, indexing overhead) = 350 bytes/msg → ~12 PB/year. Sharded across hundreds of nodes. Compressed and tiered: hot (last 30 days) on SSD, warm (30 days to 1 year) on cheaper disks, cold (older) archived to object storage.

Outbound bandwidth. 3.5M peak messages × 36 fanout × ~300 bytes (content + envelope) ≈ 38 GB/sec outbound at peak. Spread across edge servers, that is ~5 MB/sec per server. Trivially within line rate of a single NIC.

Key insight: the receipts are the real workload. Fan-out for one group message of 1000 members is 1000 deliveries + 800 read receipts = 1800 events for one original event. A naive design that treats every receipt as a real message gets you 36 PB/year, not 12.

</details>

## Step 3: connection layer: WebSocket, long-poll, or short-poll?

Mobile clients need to receive messages without polling. Three serious options. Take 8 minutes to write pros and cons of each.

<details>
<summary><b>Reveal: comparison and recommendation</b></summary>

| Approach | How it works | Pros | Cons |
|----------|-------------|------|------|
| Short-poll | Client GETs `/messages?since=T` every N seconds | Trivial. Stateless servers. Works through any proxy. | High latency (N seconds). Massive request overhead: 500M users polling every 5s = 100M req/sec for mostly empty polls. |
| Long-poll | Client GETs `/messages?since=T`. Server holds the request until a message arrives or 30s timeout. | Lower latency. Works over plain HTTPS. | Still one request per message round-trip. Servers hold connections open anyway, so you get all the WebSocket cost without the benefit. |
| WebSocket | One persistent bidirectional TCP socket per client | Lowest latency. Bidirectional (server pushes, client acks on the same socket). No per-message HTTP overhead. | Persistent connection state. Load balancers and proxies must support upgrade. Mobile networks drop sockets; reconnect logic is nontrivial. Edge server count grows with connection count, not request rate. |

WebSocket as the primary transport, with HTTPS polling as a fallback for clients on networks that block WebSocket upgrades (some corporate proxies still do).

Why WebSocket wins:

- 500M concurrent users at one HTTPS request every 5 seconds is 100M req/sec of mostly empty responses. Far more costly than holding 500M idle TCP sockets (each idle socket on Linux is a few KB of kernel memory).
- The server-to-client direction is the whole product. Push notifications via APNs / FCM are part of the stack too, but only for offline users; the online experience runs over WebSocket.
- Bidirectional matters for delivery receipts. When the client receives a message and shows it, the same socket sends the "delivered" ack back without opening a new connection.

For mobile: WebSocket over TLS, keepalive ping every 30 seconds, documented reconnect-with-resume protocol. The reconnect part comes up again in the solution.

</details>

## Step 4: sketch the high-level architecture

Fill in the five `[ ? ]` placeholders. Hint: the gateway holding WebSocket connections is one piece; messages get persisted somewhere; group fan-out is its own subsystem; offline users need a different delivery path; and you need to know which gateway holds which user's connection.

```
   Mobile / Web client
          │
          │ WebSocket (TLS)
          ▼
   ┌─────────────────┐
   │   [ ? ]         │  Holds 100K WebSocket connections per node.
   │  (stateful)     │  Routes inbound messages, pushes outbound.
   └────┬─────────┬──┘
        │         │
   send │         │ recv (via pub/sub from other gateways)
        ▼         ▲
   ┌─────────────────┐
   │   Message       │  Validates, assigns IDs, persists.
   │   Service       │
   └────┬────────────┘
        │
        ▼
   ┌─────────────┐         ┌──────────────────────┐
   │  [ ? ]      │────────►│   [ ? ]              │
   │  (durable   │ change  │  (decides who needs  │
   │   storage)  │ stream  │   to receive this)   │
   └─────────────┘         └──────┬───────────────┘
                                  │
                  ┌───────────────┼────────────────┐
                  │               │                │
                  ▼               ▼                ▼
            ┌──────────┐    ┌──────────┐    ┌──────────┐
            │   [ ? ]  │    │   [ ? ]  │    │  APNs /  │
            │ (knows   │    │ (online  │    │   FCM    │
            │  which   │    │  gateway │    │ (offline │
            │ gateway  │    │  fanout) │    │   users) │
            │ each     │    │          │    │          │
            │ user is  │    │          │    │          │
            │ on)      │    │          │    │          │
            └──────────┘    └──────────┘    └──────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
   Mobile / Web client
          │
          │ WebSocket (TLS)
          ▼
   ┌─────────────────────────┐
   │  Connection Gateway     │   Stateful. Holds ~100K WS connections.
   │  (a.k.a. edge / chat    │   Sticky routing: a user's socket
   │   server)               │   is pinned to one gateway instance.
   └────┬──────────────┬─────┘
        │              │
   send │              │ recv (from other gateways via pub/sub)
        ▼              ▲
   ┌─────────────────────────┐
   │  Message Service        │   Stateless. Validates, assigns
   │  (REST + RPC)           │   message_id (Snowflake), persists,
   └────┬────────────────────┘   acks back to sender.
        │
        ▼
   ┌─────────────────┐      ┌─────────────────────────┐
   │  Message Store  │─────►│  Fan-out Dispatcher      │
   │  (Cassandra,    │ CDC  │  Reads new messages from │
   │   sharded by    │      │  CDC. Resolves who needs │
   │   conversation_ │      │  to receive (members of  │
   │   id)           │      │  conversation).          │
   └─────────────────┘      └──────┬───────────────────┘
                                   │
              ┌────────────────────┼──────────────────────┐
              │                    │                      │
              ▼                    ▼                      ▼
        ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
        │  Presence /  │     │  Delivery    │     │  Push        │
        │  Session     │     │  Workers     │     │  Service     │
        │  Registry    │     │              │     │              │
        │              │     │  For each    │     │  For users   │
        │  Maps        │     │  online      │     │  offline:    │
        │  user_id →   │     │  recipient:  │     │  send via    │
        │  gateway_id  │     │  publish to  │     │  APNs / FCM. │
        │              │     │  gateway's   │     │              │
        │  (Redis,     │     │  pub/sub     │     │              │
        │   replicated)│     │  channel.    │     │              │
        └──────────────┘     └──────────────┘     └──────────────┘
```

Component responsibilities:

- Connection Gateway holds the TCP/TLS socket. Stateful in the sense that it knows which user_id is connected on which socket. Auto-scales horizontally; sticky DNS or LB-level steering keeps a user pinned to one gateway across reconnects so receipts and inbound messages route consistently.
- Message Service validates the message (length, conversation membership, blocked-user check), assigns a globally unique `message_id` (Snowflake, sortable by time), persists, and acks. The ack returns to the sender via the gateway over the same WebSocket.
- Message Store is Cassandra or a similar wide-column store, sharded by `conversation_id`. All messages for one conversation live on the same shard; reading recent history is a single range query.
- Fan-out Dispatcher consumes the CDC stream from the Message Store. Looks up conversation membership. For each member, checks the Presence Registry: online or offline? Emits delivery tasks to either Delivery Workers or Push Service.
- Presence / Session Registry is a lightweight Redis cluster mapping `user_id → gateway_id, connection_id`. Updated on connect/disconnect. Also stores derived presence state (online/offline/idle).
- Delivery Workers consume the fan-out task, look up the right gateway in the Presence Registry, and publish the message to that gateway's pub/sub channel. The gateway sees it and writes it to the WebSocket.
- Push Service talks to APNs (iOS) and FCM (Android, web). Batches and rate-limits to comply with provider quotas. Stores a per-device push token registry.

</details>

## Step 5: ordering guarantees

A user sends three messages quickly: "hi", "are you there", "ok bye". On the recipient's screen they must appear in that order even if the transport reorders or retries. The same conversation can have two senders typing at once; what order do those interleave in?

Take 10 minutes. Sketch the ordering guarantees I want, and how the message_id design supports them.

<details>
<summary><b>Reveal: ordering model and how to enforce it</b></summary>

The guarantee chat products actually provide:

1. FIFO per sender within a conversation. Messages from sender A appear in A's send order. This is the only guarantee users actually notice.
2. Consistent total order per conversation, but the cross-sender interleaving is server-decided. If A and B send at nearly the same time, every recipient sees the same A/B interleaving (the server picks one). No client tries to enforce a particular cross-sender order.
3. No total order across conversations. Messages in conversation X and Y are independent.

Implementation:

- Snowflake-style `message_id`. 64-bit: 41 bits timestamp (ms since epoch) + 10 bits shard/datacenter + 12 bits sequence. Globally unique without coordination, sortable by time within ~1ms resolution.
- Within a conversation, message_id is the canonical order. Recipients sort by message_id when rendering.
- FIFO per sender, enforced by the Message Service. Each sender's connection has a monotonic client-side sequence counter. The Message Service rejects out-of-order arrivals from the same sender (returns an error, client retries). Catches the rare case where the same sender's two messages arrive via different paths (e.g., reconnect with retry of an in-flight message).
- Interleaving: when A and B both send to the same conversation, the Message Service assigns message_ids in the order requests reach it. Two messages within 1ms get distinct sequence values inside the same millisecond. Every recipient sorts by message_id and gets the same interleaving.

What I do *not* need:

- Distributed consensus on the order. Each message goes through one Message Service instance; that instance picks the order. Different conversations can be on different instances.
- Vector clocks. Overkill for the guarantee chat users actually care about.

The common mistake here: candidates try to design Lamport timestamps or vector clocks. The interviewer will let you, then ask "what does the user see if those guarantees are violated?" and the answer is "nothing, because they are looking at 50 messages on a phone screen and will not notice a 1ms reordering." Match the engineering to the user-visible problem.

</details>

## Step 6: delivery semantics and receipts

For each message I must support: sent (the server stored it), delivered (the recipient's device received it), read (the recipient opened the conversation). For 1-to-1 these are three states. For groups they are per-recipient state.

Sketch the storage and the event flow for receipts.

<details>
<summary><b>Reveal: receipt model</b></summary>

Storage shape. For 1-to-1 chats, a single row per message captures sender, recipient, and the timestamps for each state (sent_at, delivered_at, read_at). For group chats, store per-(message_id, member_id) state in a separate table; per-member columns on the message row would be unbounded.

```
Group receipts (per message x per member):
  PK: (message_id, member_id)
  Columns: state (sent/delivered/read), state_changed_at
```

This table is enormous (one row per group member per message). It is the highest write-volume table in the whole system. Mitigations:

- Batch receipts. A client does not send a `delivered` event for each individual message. It batches every 1-2 seconds: "messages M1..M20 are all delivered as of timestamp T." One event from the client, one row update per (message, member) on the server, network and gateway work amortized.
- TTL the receipts table. After 90 days, receipts on old messages do not matter. Cassandra TTL handles this for free.
- Skip storing 'delivered' for group chats above a threshold. WhatsApp groups above 256 members only show sent and read; delivered is dropped. Substantial volume saved.

Event flow for a 1-to-1 message:

1. A sends "hi". Message Service persists, returns ack to A. A's UI shows a single check (sent).
2. Delivery Worker pushes to B's gateway. B's client receives the message, writes "delivered" event back over the WebSocket. Message Service updates the row. A's gateway sees the change via pub/sub and pushes the receipt to A. A's UI shows double check (delivered).
3. B opens the conversation. B's client emits "read M1..Mn" batch. Same flow. A sees double-check-blue.

Event flow for a group message of 50 members:

1. A sends to group G. Message persisted with `message_id`.
2. Fan-out Dispatcher resolves 49 other members. 40 are online. Delivery Workers route to 40 gateways.
3. As each recipient's client acks delivery (batched per client), the receipts table accumulates 40 rows for (message_id, *).
4. A's client wants to show "delivered to 40/49." It subscribes to a derived counter `(message_id, delivered_count, read_count)` rather than the raw row set. Counter is updated as receipts arrive, cached in Redis, pushed to A.

The derived counter is the right abstraction. A does not want a list of 49 names with checkmarks; A wants two numbers. Computing counts on read by scanning 49 rows is fine at message scale, but at group-of-1000 scale you maintain the counter incrementally.

</details>

## Step 7: read the full solution

That covers the heart of the design: connections, ordering, delivery, receipts. The solution covers presence in detail, the message store schema and shard strategy, how reconnect-with-resume actually works on the wire, push notifications and their rate limits, and the dozen failure modes you only think about after an outage.

## Follow-up questions

Try answering each in 3 to 4 sentences before reading the solution.

1. A user goes offline mid-conversation, comes back 30 minutes later. What is the protocol for catching up on missed messages? How does the client know what it missed without re-downloading everything?
2. A group has 1000 members. One is a bot that sends a message every 5 seconds. What strain does this put on the system, and how do I protect against it?
3. Presence updates. If every user has 200 contacts and updates presence every time they open the app, what is the fan-out? Is presence stored anywhere durable?
4. Typing indicators. How are these delivered? Are they persisted? What is the failure mode if a typing event is sent but the user closes the app before sending the message?
5. Multi-device sync. A user has a phone and a laptop both logged in. How do I make a message read on the phone disappear from the unread badge on the laptop, and vice versa?
6. End-to-end encryption. If messages are E2E-encrypted, the server cannot see content. How does that affect search, push notification previews, and group fan-out?
7. A gateway holding 100K WebSocket connections crashes. What happens to those clients? How do they recover? How fast is reconnection at scale?
8. A new device is added to an existing account. Zero local history. How do I bootstrap it efficiently for a user with 10 years of chat history and 500 conversations?
9. Anti-abuse: a user is mass-DMing strangers (spam). How do I detect and rate-limit without blocking legitimate high-volume users (e.g., a business account)?
10. At 3am, message delivery lag spikes to 30 seconds for one region but the message store metrics look fine. Where do I look?

## Related problems

- [News Feed (002)](../002-news-feed/question.md), same fan-out fundamentals; group chat is fan-out-on-write with a small audience.
- [Notification System (010)](../010-notification-system/question.md), the push-notification path here is the same machinery; offline delivery is its own subsystem.
- [Distributed Cache (009)](../009-distributed-cache/question.md), the presence registry and receipt counters lean on Redis; understanding its limits is required.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Chat System (WhatsApp / Slack)

### TL;DR

Chat is two distinct problems glued together: a persistent-connection layer that holds hundreds of millions of WebSockets at once, and a per-conversation ordered log that stores and fans out messages. The connection layer is dominated by socket count, kernel tuning, and reconnect protocols. The message layer is dominated by write volume from delivery receipts, which outnumber actual messages by 30x or more in groups.

The shape: stateful gateways at the edge holding WebSockets, a stateless Message Service that owns ordering and persistence, Cassandra (sharded by conversation_id) as the durable log, a fan-out dispatcher that consumes a change stream and routes delivery to the right gateways via pub/sub, and a separate push pipeline (APNs/FCM) for offline users. A Redis-based Presence/Session Registry maps user to gateway so deliveries route correctly.

The interesting engineering hides in the small details. Snowflake IDs for FIFO-per-sender without consensus. Batched receipts to keep groups affordable. Reconnect-with-resume to make mobile drops invisible. Derived counters for "delivered to N/M" instead of scanning per-member rows. And a clear story for what happens when a 100K-connection gateway dies (clients reconnect in a thundering herd you have to shape).

### 1. Clarifying questions

Covered in question.md. The single most important number is peak concurrent connections, not message rate. 500M open WebSockets dictates the edge fleet size; everything else flexes around it. Second most important is max group size, because it controls per-message fan-out work.

### 2. Capacity estimates

From the question:

- 1.16M messages/sec sustained, 3.5M peak.
- ~43M events/sec sustained, ~130M peak once receipts are included. Receipts dominate.
- ~5000 edge servers at 100K connections each, in practice 7000-8000 with headroom.
- ~12 PB of message storage per year at 350 bytes per message.
- ~38 GB/sec outbound at peak, spread across the edge fleet.

The decisive observation: a group message of 1000 members produces 1 store write, 999 deliveries, ~800 read receipts. 1800 events for one user action. Designing the receipt path well matters more than designing the message path.

### 3. API design

Chat is mostly bidirectional WebSocket events with a small REST surface for things that do not need to be real-time.

WebSocket upgrade:

```
GET /chat/v1/ws
Upgrade: websocket
Connection: Upgrade
Authorization: Bearer <token>
Sec-WebSocket-Protocol: chat.v1
```

After upgrade the connection speaks a length-prefixed framed protocol with JSON or protobuf payloads. Protobuf in production; JSON shown here for readability.

Client-to-server frames:

```
// Send a message
{
  "type": "send",
  "client_msg_id": "uuid-v4",        // for dedup and ack matching
  "conversation_id": "conv_abc",
  "body": "hi",
  "media_ids": []                    // optional, uploaded over HTTPS separately
}

// Delivery receipt (batched)
{
  "type": "delivered",
  "conversation_id": "conv_abc",
  "up_to_message_id": "msg_1234567"  // I've received everything up to and including this
}

// Read receipt (batched)
{
  "type": "read",
  "conversation_id": "conv_abc",
  "up_to_message_id": "msg_1234567"
}

// Typing indicator
{
  "type": "typing",
  "conversation_id": "conv_abc",
  "is_typing": true
}

// Resume after reconnect
{
  "type": "resume",
  "last_seen_message_id": {           // per conversation
    "conv_abc": "msg_1234560",
    "conv_xyz": "msg_999999"
  }
}
```

Server-to-client frames:

```
// Ack of a sent message
{
  "type": "ack",
  "client_msg_id": "uuid-v4",
  "message_id": "msg_1234568",       // server-assigned
  "server_ts": 1716000000123
}

// New message delivered to this client
{
  "type": "message",
  "message_id": "msg_1234568",
  "conversation_id": "conv_abc",
  "sender_id": "user_a",
  "body": "hi",
  "server_ts": 1716000000123
}

// Receipt update
{
  "type": "receipt",
  "conversation_id": "conv_abc",
  "message_id": "msg_1234568",
  "state": "delivered",              // or "read"
  "member_id": "user_b",
  "ts": 1716000000800
}

// Presence update
{
  "type": "presence",
  "user_id": "user_b",
  "state": "online"                  // online | idle | offline
}

// History since resume
{
  "type": "history",
  "conversation_id": "conv_abc",
  "messages": [...]                  // messages since the last_seen_message_id
}
```

REST endpoints (for non-real-time):

```
POST /api/v1/conversations            // create a conversation (1-to-1 or group)
GET  /api/v1/conversations            // list conversations for the user
GET  /api/v1/conversations/:id/messages?before=<message_id>&limit=50
POST /api/v1/media                    // upload media; returns media_id used in send frame
POST /api/v1/devices                  // register a device + push token
GET  /api/v1/contacts/presence        // bulk presence lookup
```

Send/receive is exclusively WebSocket. The REST endpoints exist for fetching history (paginated), uploading media before referencing it in a message, and account/device management.

Idempotency: every `send` frame carries a `client_msg_id` (UUID). The Message Service deduplicates by (sender_id, client_msg_id). If the client retries after a reconnect, the second send returns the same server message_id rather than a duplicate. Critical for mobile where the socket dies mid-send.

### 4. Data model

Messages table (Cassandra, partition key = conversation_id, clustering = message_id desc):

```
CREATE TABLE messages (
    conversation_id    TEXT,
    message_id         BIGINT,        -- Snowflake-style
    sender_id          BIGINT,
    body               TEXT,
    body_type          SMALLINT,      -- 1=text, 2=image_ref, 3=system, etc.
    media_refs         LIST<TEXT>,
    reply_to           BIGINT,
    created_at         TIMESTAMP,
    deleted_at         TIMESTAMP,
    edited_at          TIMESTAMP,
    PRIMARY KEY ((conversation_id), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

Choices worth defending:

- Partition by `conversation_id`. A conversation's messages live on one shard. Reading recent history is a single range query. Hot conversations land on hot shards, but they cap out (a single conversation rarely exceeds a few thousand messages/sec).
- Clustering descending. The common read is "give me the last 50 messages." Descending order matches the read.
- `message_id` is the sort key, not `created_at`. message_id is Snowflake (time-prefixed) so it gives global uniqueness and time ordering with a deterministic tiebreaker.
- Soft delete (`deleted_at`). A deleted message becomes a server-side tombstone. The client renders a "message deleted" placeholder. Preserves the ordering of surrounding messages.

Conversations table (Postgres, normal relational):

```sql
CREATE TABLE conversations (
    conversation_id   BIGSERIAL PRIMARY KEY,
    type              SMALLINT NOT NULL,    -- 1=direct, 2=group, 3=broadcast
    name              TEXT,                 -- nullable for direct
    created_by        BIGINT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_id   BIGINT,
    last_message_ts   TIMESTAMPTZ           -- denormalized for chat list ordering
);

CREATE TABLE conversation_members (
    conversation_id   BIGINT NOT NULL,
    user_id           BIGINT NOT NULL,
    role              SMALLINT NOT NULL DEFAULT 1,  -- 1=member, 2=admin, 3=owner
    joined_at         TIMESTAMPTZ NOT NULL,
    last_read_msg_id  BIGINT,               -- for unread counts
    muted_until       TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_member_user ON conversation_members (user_id);
```

The `last_read_msg_id` column drives the unread badge. The unread count for user U in conversation C is `count(messages where message_id > U.last_read_msg_id in C)`. I do not store this count directly; I compute it from the column. For hot conversations I cache it.

Group receipts table (Cassandra, separate from messages):

```
CREATE TABLE group_receipts (
    conversation_id   TEXT,
    message_id        BIGINT,
    member_id         BIGINT,
    state             SMALLINT,           -- 1=delivered, 2=read
    state_ts          TIMESTAMP,
    PRIMARY KEY ((conversation_id, message_id), member_id)
) WITH default_time_to_live = 7776000;     -- 90 days
```

90-day TTL because nobody looks at receipts that old. For 1-to-1 chats, receipts live on the `messages` row itself (delivered_at, read_at columns) since there is a single recipient.

Derived counter (Redis):

```
Key:   receipts:{conversation_id}:{message_id}
Value: hash { delivered: N, read: M }
TTL:   90 days
```

Maintained incrementally by the Delivery / Receipt Worker. Avoids scanning the `group_receipts` table to answer "how many delivered?"

Presence / Session Registry (Redis):

```
Key:   session:{user_id}
Value: hash {
  device_id_1: { gateway: "gw-42", connection: "c-123", connected_at: T }
  device_id_2: { gateway: "gw-17", connection: "c-456", connected_at: T }
}
TTL:   none (entries removed on disconnect; periodic cleanup for stale)

Key:   presence:{user_id}
Value: "online" | "idle" | "offline"
TTL:   none (set/cleared on connect/disconnect with last activity)
```

### 5. Core algorithm: delivery and ordering

#### Ordering

Messages within a conversation are sorted by `message_id`. The message_id is a Snowflake: 41 bits timestamp (ms since custom epoch) + 10 bits machine_id + 12 bits sequence within ms. The Message Service is the only place that mints message_ids; each instance has a stable machine_id and a per-ms sequence counter. Two messages assigned in the same ms get distinct sequences. Two messages from different instances get different machine_ids in the lower bits, so they never collide.

For FIFO per sender, each client maintains a monotonically increasing `client_seq` per conversation. The Message Service tracks the last seen client_seq for (sender, conversation) in a small in-memory cache (sharded by conversation_id, evicted after 10 minutes idle). If an incoming send has a client_seq at or below the last seen, the service rejects with `out_of_order` and the client retries after refreshing state. Catches duplicate sends on reconnect and out-of-order arrivals.

What I do *not* do: distributed consensus, vector clocks, Lamport timestamps. The user-visible guarantee is "in this conversation, every viewer sees the same sequence." That holds because every viewer sorts by message_id.

#### Delivery: the end-to-end path

```
Sender's client → Sender's gateway → Message Service → Cassandra
                                                          │
                                                       CDC ▼
                                              Fan-out Dispatcher
                                                          │
                                              ┌───────────┼───────────┐
                                              │           │           │
                                       (online users)  (online)   (offline)
                                              │           │           │
                                              ▼           ▼           ▼
                                         Recipient    Recipient   Push
                                         gateway #1   gateway #2  pipeline
                                              │           │           │
                                              ▼           ▼           ▼
                                         Recipient    Recipient   APNs/FCM
                                         client #1    client #2    device
```

Step by step:

1. Sender's client writes `send` frame with `client_msg_id`. Gateway forwards to Message Service over RPC.
2. Message Service:
 a. Authenticates (token from connect time, cached).
 b. Checks conversation membership (cached, refreshed on member changes via invalidation event).
 c. Mints `message_id` (Snowflake).
 d. Dedupes against (sender_id, client_msg_id) in a small Redis set with TTL.
 e. Persists to Cassandra. Cassandra returns ack once the write reaches QUORUM.
 f. Sends `ack` back to sender via the gateway. Sender's UI shows "sent."
3. Cassandra emits a CDC event for the new row. Fan-out Dispatcher consumes the CDC stream.
4. Dispatcher loads conversation membership (cached). For each member except the sender:
 a. Query Presence Registry: is this user online? If yes, which gateway?
 b. If online: emit a `deliver` task to a Delivery Worker. Task payload is small: `(member_id, gateway_id, message_id, conversation_id)`. Worker publishes to that gateway's pub/sub channel.
 c. If offline: emit a `push` task to the Push Service.
5. Each gateway subscribes to its own pub/sub channel. On receiving a `deliver` event, it looks up the local socket for the user and writes the `message` frame. Multiple devices on the same gateway get a write each.
6. Recipient client receives the frame, processes, acks back: "delivered up to message_id X" (batched every 1-2 seconds, not per-message). The receipt flows back through Message Service, updates `group_receipts`, increments the Redis counter, and the sender's gateway picks up the counter change and pushes a `receipt` frame to the original sender.

End-to-end latency target: 1-to-1 message both online, P99 under 500ms (sender hits send to recipient sees the message). Step 2e (Cassandra QUORUM write) dominates at ~50-100ms. Fan-out, pub/sub, and gateway push add ~50ms each. Network RTT for both sides adds ~150-200ms on mobile.

#### Why pub/sub between Fan-out Dispatcher and Gateway

The Dispatcher does not know directly which gateway a user is on. It learns via the Presence Registry, which can be slightly stale. The Gateway is the source of truth for "is this connection still alive." Publishing to a per-gateway channel and letting the gateway decide whether to push handles two race conditions cleanly:

- User reconnected to a different gateway. The old gateway gets the publish but has no live socket; it drops the event. The new gateway receives nothing, but the user's `resume` frame catches them up (see "reconnect with resume" in section 9).
- User disconnected entirely. The publish lands on the old gateway with no socket; it drops the event. The Push Service was already notified in parallel by the Dispatcher for offline users. For users that disconnect *between* the presence check and the publish, the Push Service backfills via a "missed delivery" sweep (see reliability).

### 6. High-level architecture (detailed)

```
                              Mobile / Web client
                                    │
                                    │ WebSocket / TLS, keepalive 30s
                                    │ HTTPS for REST + media upload
                                    ▼
                            ┌────────────────────┐
                            │  Global Anycast    │  Routes to nearest region
                            │  Load Balancer     │  TLS terminates at LB or edge
                            └────────┬───────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            │                        │                        │
            ▼                        ▼                        ▼
       ┌─────────┐              ┌─────────┐              ┌─────────┐
       │ Region  │              │ Region  │              │ Region  │
       │ us-east │              │ eu-west │              │ ap-south│
       └────┬────┘              └────┬────┘              └────┬────┘
            │                        │                        │
            ▼                        ▼                        ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                  Connection Gateway Fleet                    │
   │   ~2500 nodes per region × 100K WS each.                     │
   │   Sticky routing via consistent hashing on user_id.          │
   │   Subscribes to per-gateway channel in pub/sub.              │
   └────┬───────────────────────────────────────────┬────────────┘
        │ inbound (send, receipt, typing)            │ outbound (push to socket)
        ▼                                            ▲
   ┌─────────────────────┐                  ┌────────────────────┐
   │  Message Service    │                  │  Pub/Sub Bus       │
   │  (stateless, RPC)   │                  │  (Redis Cluster or │
   │  Validates, mints   │                  │   NATS / Kafka     │
   │  message_id,        │                  │   for in-region    │
   │  persists.          │                  │   per-gateway      │
   │                     │                  │   channels)        │
   └────┬────────────────┘                  └────────▲───────────┘
        │                                            │
        ▼                                            │
   ┌─────────────────────┐                           │
   │  Message Store      │                           │
   │  (Cassandra,        │                           │
   │   sharded by        │                           │
   │   conversation_id,  │                           │
   │   RF=3 per region,  │                           │
   │   QUORUM writes)    │                           │
   └────┬────────────────┘                           │
        │ CDC                                        │
        ▼                                            │
   ┌─────────────────────┐                           │
   │ Fan-out Dispatcher  │                           │
   │ (Kafka consumer)    │                           │
   │ Resolves members,   │                           │
   │ presence-checks,    │                           │
   │ emits tasks.        │                           │
   └────┬──────────────┬─┘                           │
        │              │                             │
        ▼              ▼                             │
   ┌──────────┐  ┌──────────────┐                   │
   │ Delivery │  │  Push        │                   │
   │ Workers  │  │  Service     │                   │
   │          │  │              │                   │
   │ Publish  │──┘  Talks to    │                   │
   │ to gw    │     APNs/FCM,   │                   │
   │ channel  │     batches,    │                   │
   └──────────┘     rate-limits.│                   │
        │           └──────────┘                    │
        └────────────────────────────────────────────┘

   Side services (not shown above for clarity):

   ┌─────────────────────┐    ┌─────────────────────┐
   │  Presence /         │    │  Conversation /     │
   │  Session Registry   │    │  Membership Service │
   │  (Redis Cluster)    │    │  (Postgres)         │
   │  user → gateway     │    │  conversations,     │
   │  user → presence    │    │  members, settings  │
   └─────────────────────┘    └─────────────────────┘

   ┌─────────────────────┐    ┌─────────────────────┐
   │  Media Service      │    │  Search Service     │
   │  Object storage,    │    │  Elasticsearch      │
   │  CDN, thumbnailing  │    │  (Slack only; not   │
   │                     │    │  for E2E products)  │
   └─────────────────────┘    └─────────────────────┘
```

Why each piece is here:

- Anycast LB routes a client to the nearest region. Inside a region, sticky hashing on user_id pins to a specific gateway. The DNS / LB layer does not understand WebSockets, but it does understand long-lived TCP and consistent hashing.
- Connection Gateway is stateful. 100K sockets per node. Cheap on memory (a few KB per socket, batched epoll/io_uring on Linux). Crashes are routine; clients reconnect within seconds.
- Pub/Sub Bus. Each gateway subscribes to its own channel `gw:{gateway_id}`. The bus is fast (Redis pub/sub) and not durable. Lost messages here are recovered by `resume` after a client reconnect, or by the Push pipeline if the user is offline.
- Message Service is stateless. Owns ordering and persistence. Horizontal scale.
- Cassandra. Wide-column wins for append-heavy ordered logs. Partitioning by conversation_id keeps history reads on one node. Replication factor 3 within region; cross-region is async with a few-second lag.
- CDC + Fan-out Dispatcher decouples ingest rate from fan-out work. Backpressure builds in Kafka if delivery workers fall behind; nothing is lost.
- Delivery Workers are stateless. Auto-scale on Kafka consumer lag.
- Push Service owns the APNs/FCM relationship. Maintains per-device push tokens. Rate-limits to avoid carrier and platform throttling.
- Presence Registry is Redis Cluster. Read-mostly, with bursts on connect/disconnect. The session map (user to gateway) is small per user; the whole registry fits in memory comfortably even at 500M concurrent.

### 7. Write and read paths in detail

#### Write path: client sends a message

P99 budget: 500ms end-to-end client-to-client. Per hop:

| Step | Budget | Notes |
|------|--------|-------|
| Client → Gateway (WebSocket frame) | 50-150ms RTT | Mobile network dominated |
| Gateway → Message Service RPC | 5ms | Intra-DC |
| Message Service: validate, mint id | 1ms | In-memory |
| Message Service: dedup check (Redis) | 2ms | One round trip |
| Cassandra write (QUORUM, RF=3) | 50-100ms | Real cost |
| Ack back to sender | one Gateway → client write | |
| CDC → Fan-out (async, off critical path) | <5s for in-region delivery | |
| Fan-out → Delivery → Gateway → Recipient | ~50ms intra-region + RTT to recipient | |

The Cassandra write is the dominant cost. Some products optimize this by writing to a local commit log first (Kafka or a per-DC durable queue), acking the sender on log durability, and writing to Cassandra in the background. This shaves ~50ms from sender perceived latency at the cost of an extra durability layer. We do not include this in the base design; it is mentioned in "what I would revisit."

#### Read path A: client opens an existing conversation

1. REST `GET /api/v1/conversations/:id/messages?limit=50`.
2. Service reads from Cassandra: `SELECT * FROM messages WHERE conversation_id = ? ORDER BY message_id DESC LIMIT 50`.
3. Returns 50 messages plus `next_cursor` (oldest message_id seen).
4. Subsequent pages: `?before=<message_id>&limit=50` does `WHERE conversation_id = ? AND message_id < ? ORDER BY message_id DESC LIMIT 50`.

This path does not touch WebSocket. It is paginated history fetch.

#### Read path B: client receives a new message (the real-time path)

This is the push from the server side; the client does not request it. Covered in section 5.

#### Read path C: client reconnects after a drop

1. Client connects WebSocket; sends `resume` frame with per-conversation `last_seen_message_id`.
2. Gateway routes resume to Message Service.
3. For each conversation in the resume frame, Message Service queries Cassandra for messages with `message_id > last_seen_message_id` in that conversation, capped at some window (e.g., 1000 messages or 7 days, whichever comes first).
4. Returns the catch-up batch as `history` frames over the WebSocket.
5. If the gap is too large (more than 1000 messages or older than 7 days), the server responds with `resume_failed: too_old`, and the client falls back to a full REST history pull for that conversation.

This is the protocol that makes mobile-network drops invisible. Most reconnects find 0-2 missed messages and resume in under 100ms.

### 8. Scaling

#### a. Connection layer

500M concurrent connections. Linux can handle ~1M open sockets per machine with proper sysctl (`fs.file-max`, `net.ipv4.tcp_mem`, `net.core.somaxconn`, etc.), but at 1M you have no headroom and any blip pushes you over. **100K per node is the practical sweet spot** for chat. That gives:

- ~5000 nodes worldwide at peak, ~7000-8000 with regional spare.
- Roughly $0.05 per 100 connections per month at cloud prices (varies a lot).
- Easy bounce: losing 1 gateway disconnects 100K users, which is 0.02% of users. They reconnect to another node within seconds.

Each gateway runs a small loop:

```
for each socket:
  read frame (epoll-driven)
  enqueue to local handler pool

for each event on subscribed pub/sub channels:
  lookup local connection for user_id
  write frame to socket
```

Memory: each socket is ~6 KB kernel + ~4 KB user-space buffers + ~1 KB Go/Rust connection state = ~11 KB. 100K × 11 KB = ~1.1 GB. Fits on any reasonable machine. CPU is dominated by TLS terminate; modern hardware does this trivially with kTLS or off-CPU crypto.

#### b. Message Service

Stateless. Scale on CPU. Each instance handles ~5-10K message writes/sec (limited by Cassandra QUORUM round-trip). For 3.5M peak we need ~500 instances. Run 750 for headroom.

#### c. Cassandra sharding

Partition by conversation_id. Hash to one of N partitions; Cassandra handles the placement. 100B messages/day × 365 days = 36T messages/year, at ~350 bytes = 12 PB raw, ×3 RF = 36 PB. On 4 TB nodes that is ~9000 nodes for raw capacity, plus headroom and compaction overhead → ~12000 nodes. In practice you tier:

- **Hot (last 30 days):** SSD, kept densely available. Most reads land here.
- **Warm (30-365 days):** HDD or cheaper SSD, fewer replicas (RF=2). Slower reads but accessed rarely.
- **Cold (>1 year):** Move to object storage (S3 with a Parquet layout). Search service indexes this separately.

The tier transition is a background job: when a conversation's recent activity is old enough, the older partitions are exported to cold storage and the Cassandra rows are deleted. Reading old history hits an Athena-like layer over object storage, which is slow but rare.

#### d. Fan-out work

The Fan-out Dispatcher reads CDC and emits one delivery task per online recipient plus one push task per offline recipient. At peak 3.5M messages/sec × ~36 recipients per message = ~130M tasks/sec.

Per-task work is tiny (lookup, publish, log). One worker handles ~5K tasks/sec. We need ~26000 worker pods at peak. Scaled on Kafka consumer lag. Auto-scaler set to keep lag under 2 seconds.

#### e. Hot conversations

A "town hall" channel with 50K members and 100 messages/min. Per message, fan-out is 50K events. Mitigations:

- **Per-conversation rate limit on writes.** A channel can post at most N msgs/sec. Server returns 429 if exceeded.
- **Membership read cache** with longer TTL (60s) so the Fan-out Dispatcher does not re-query Postgres on every message.
- **Skip per-member receipts for very large channels.** Past 1000 members, store only counters, not per-(message, member) rows. Past 10000, drop "delivered" entirely; show only "sent" and a read-count.
- **Sticky fan-out partitioning.** A hot conversation is partitioned across multiple Fan-out Dispatcher Kafka partitions. Otherwise one partition's consumer becomes the bottleneck.

#### f. Multi-region

Each region holds:

- Its own Connection Gateway fleet.
- Its own Message Service, Cassandra ring, and Fan-out pipeline.

Cassandra cross-region replication is async (within the same logical keyspace if you use multi-DC NetworkTopologyStrategy). A user in eu-west writes to eu-west's primary; a recipient in us-east reads from us-east's replica. Cross-region replication lag is ~1-3 seconds typically.

For a conversation with members in multiple regions, the **home region** for that conversation is decided by the conversation's creator (or load-balanced). All writes go to the home region; reads in other regions read locally from replicas. This avoids the multi-master conflict resolution problem at the cost of slightly higher write latency for non-home members.

If you want every member to write locally (true multi-master), you need either CRDTs on the message log (complex, with weird semantics on edits) or a globally-consistent store like Spanner (expensive). Most chat products accept the single-home-region trade-off.

### 9. Reliability

#### Gateway crash

A gateway with 100K connections crashes. What happens:

1. All 100K clients see their TCP socket close.
2. Each client backs off (jittered exponential, starting at 1-2 seconds) and reconnects.
3. The new connection lands on a different gateway (LB hashes user_id and the crashed node is no longer in the consistent-hash ring).
4. Client sends `resume` with per-conversation `last_seen_message_id`.
5. Message Service queries Cassandra for missed messages per conversation, returns history frames.
6. Within ~5-15 seconds, all 100K clients are back online and caught up.

Key design choice: **the gateway holds no durable state**. Everything that matters is in Cassandra, Postgres, or Redis. A gateway crash never loses data; it only causes a reconnect storm.

Reconnect-storm shaping is real. 100K clients reconnecting in the same second hammer the LB and the new gateways. Mitigation:

- **Client-side jitter.** Built into the client SDK. Reconnect delay is `random(0, 5s) + exponential_backoff`.
- **LB connection-rate limiting.** Cap new connections per gateway per second so a flood does not knock over a healthy node.
- **Stand-by gateway capacity.** Maintain ~30% spare gateway capacity so a major region can absorb a fleet-wide failure of another region.

#### Cassandra shard failure

A Cassandra node hosting some conversation partitions goes down. With RF=3, two replicas remain. Reads continue at QUORUM (need 2 of 3, still works). Writes continue at QUORUM. Replication factor 3 across racks/zones means a whole zone can disappear without data loss.

If two nodes fail simultaneously and they happen to be replicas for the same partition: that partition becomes unavailable for QUORUM writes. Reads at QUORUM also fail. We have to choose between LOCAL_ONE reads (potential stale data) or surfacing the error. For chat, briefly degrading to "history fetch unavailable" for that 0.01% of conversations is acceptable; messages still flow in real-time because the Cassandra write retries with backoff and eventually succeeds when the third replica recovers.

#### Pub/Sub bus failure

Redis pub/sub is not durable. If the bus drops a message during delivery, that recipient never sees it via the real-time path. Recovery:

- **Resume protocol.** When a client opens its conversation list and notices a new top message_id (via the chat-list refresh or via push), it queries history for any conversation with `last_message_id > last_seen_message_id`. Catches up missed real-time pushes.
- **Push notification as backup.** For mobile clients with the app backgrounded, the Push Service path is independent of the gateway/pub-sub path. Even if pub/sub drops, push delivers.
- **Periodic reconciliation.** Some products run a "missed delivery sweep" job: every 30 seconds it scans the last 30s of messages in active conversations and re-publishes for any (conversation, member) combo where the member's last delivered receipt is older than the message. This is expensive; only run it for high-priority workspaces (Slack does this for paid plans).

#### Message Service crash mid-write

The Message Service has acked the client but Cassandra's write timed out. Two cases:

- **Cassandra eventually committed the write.** The next read finds the message. No loss.
- **Cassandra rejected.** The client's `client_msg_id` dedupe entry in Redis already exists. On retry, dedupe matches and we return the stored message_id. But the stored message_id was minted but never persisted. We need to handle this: store the (client_msg_id → message_id) entry in Redis *after* successful Cassandra write, not before. On failure, the client retries with the same client_msg_id, we mint a new message_id, and we write durably.

The simpler approach: do not mint message_id until after Cassandra commits. But Cassandra requires the message_id at write time (it is the clustering key). Resolution: use `client_msg_id` as the dedupe key during a short window (60s), but the *authoritative* dedupe is a Cassandra read inside the partition for that client_msg_id (we maintain a secondary index on `(sender_id, client_msg_id)` per partition, scoped to the most recent ~100 messages). Slightly heavier on the write path but correct under all failure modes.

#### Push provider failure (APNs/FCM outage)

Push is offline. Messages still flow to online users via the real-time path. Offline users do not get notified until the provider recovers or they open the app (at which point the resume protocol catches them up). We do not buffer pushes during the outage; pushes are best-effort by design.

### 10. Observability

| Metric | Why |
|--------|-----|
| `gateway.connections.current` per region | Capacity and routing health |
| `gateway.connection_churn_per_sec` | High churn = mobile network issues, bad client builds |
| `gateway.message_in.rate` / `message_out.rate` | Top-line traffic |
| `message_service.write_latency_p99` | Cassandra QUORUM dominates this |
| `cassandra.replication_lag_p99` cross-region | Should be <3s |
| `fanout.kafka.consumer_lag` | Leading indicator of delayed delivery |
| `fanout.dispatch_latency_p99` (CDC to publish) | Should be <1s |
| `delivery.gateway_publish_drop_rate` | If pub/sub drops, this rises |
| `receipts.write_rate` | Should be ~20-40x message rate |
| `push.apns.error_rate` / `push.fcm.error_rate` | Provider health |
| `push.token_invalid_rate` | Users uninstalling; need cleanup |
| `presence.online_count` | Should match `gateway.connections.current` within 1% |
| `resume.message_count_p99` | High means clients are missing pushes |
| `resume.fallback_rate` (resume too old → full history fetch) | Bad if rising |

Alerts:

- Page on: gateway availability <99.9% any region, message P99 >1s for 5 min, Kafka consumer lag >30s.
- Ticket on: push provider error rate >5%, resume fallback rate >10%, receipt write rate diverging from message rate (suggests batch logic is broken).

### 11. Follow-up answers

**1. User offline, comes back 30 minutes later.**

Resume protocol. On reconnect, client sends `resume` with per-conversation `last_seen_message_id` (stored locally). Server queries each conversation for messages with `message_id > last_seen_message_id`, capped at 1000 messages and 7 days. Returns as `history` frames. For larger gaps, client falls back to REST `GET /conversations/:id/messages` paginated history.

Crucially, the server never assumes the client has anything. The client's local DB is the source of truth for "what does this client know." Server returns from Cassandra; client deduplicates by message_id and inserts new rows locally. This makes the protocol stateless on the server side: no per-user "delivery queue" to maintain. (Some designs do maintain such a queue; we avoid it because at 500M users it is a huge state to keep current.)

**2. A bot sends a message every 5 seconds to a 1000-member group.**

That is 1 msg / 5s × ~1000 members × (1 delivered + 0.8 read) = ~360 receipt events/sec from one bot's activity. Not enough alone, but if 10K bots do this we have 3.6M extra receipts/sec.

Protections:

- **Per-sender rate limit per conversation.** A reasonable limit: 60 messages/min in any single conversation, 600/min total. Bots that need more must declare themselves as bots and use a separate API with explicit quota.
- **Receipt suppression for bot-tagged senders.** Messages from accounts flagged as bots do not generate "read" receipts (it makes no sense for a bot to care that you read its system message). This cuts the bot-driven receipt load in half.
- **Throttled fan-out for bot conversations.** Bot-heavy conversations (channels dominated by automation) get their own Kafka partition with rate-limited consumption.
- **Anomaly detection.** A bot account exceeding normal patterns triggers verification (CAPTCHA, account review).

**3. Presence updates.**

User has 200 contacts. Opens the app, transitions from offline to online. Naive: publish presence change to all 200 contacts. At 1B users with periodic flips, presence becomes the highest-event-rate subsystem.

Real designs:

- **Presence is best-effort and not durable.** Stored in Redis, no write to disk. Lost on Redis failure; recomputed on reconnect.
- **Subscriber model.** A user "subscribes to presence" for the contacts they currently care about (visible in the active screen). When the user navigates away, the subscription is dropped. So a user with 200 contacts is only subscribed to ~20 at any moment (the ones visible).
- **Coarse granularity.** "Online" for 5 minutes after last activity; "idle" between 5 and 15; "offline" after 15. Avoids flickering.
- **Pub/Sub channel per user.** Each user has a `presence:{user_id}` channel. Subscribers receive transitions. Producers (Connection Gateway on connect/disconnect, the user's last-activity heartbeat) publish to it.
- **No "last seen" exposure unless the user opts in.** WhatsApp's last-seen privacy setting suppresses publishing entirely.

At 500M concurrent users with ~20 active presence subscriptions each = 10B subscription edges, but each only fires on transitions (typically a few per hour per user). Total presence events: 10B / 3600s × 0.1 (sparsity) ≈ ~300K events/sec. Manageable.

**4. Typing indicators.**

Typing is sent over WebSocket as `{ "type": "typing", "conversation_id": "...", "is_typing": true }`. Sent on first keypress. Client also emits `is_typing: false` after 5 seconds of no keypress, or when the message is sent (the message itself implies typing stopped).

Storage: none. Typing events never touch durable storage. They flow gateway → fan-out (small path) → recipient gateways → recipient sockets. If the user closes the app before sending: nothing to clean up; typing state auto-expires on the recipient side after 5 seconds without a refresh.

Trade-off: typing fan-out for a 1000-member group is 999 sockets every few seconds while someone types. Skip typing for groups above some threshold (Slack does not show typing in large channels). Typing is a 1-to-1 / small-group feature.

**5. Multi-device sync.**

Same user_id has two active sessions (phone and laptop). Both connect to the gateway fleet, possibly different gateways. The Session Registry stores per-device entries:

```
session:user_42 = {
  "phone_abc": { gateway: "gw-7", connection: "c-101" },
  "laptop_xyz": { gateway: "gw-22", connection: "c-203" }
}
```

When a message is delivered, Fan-out Dispatcher emits one task per session, not per user. Each device gets its own copy.

Read state sync: when the phone marks message M1 as read, that "read" event flows through the normal receipt path: phone → gateway → Message Service → updates `last_read_msg_id` in `conversation_members`. The laptop also subscribes to its own conversation state updates and receives a `state_change` frame indicating the unread badge should drop. This is the same mechanism that drives the unread badge cross-device.

For more aggressive sync (e.g., "I dismissed a notification on the phone, drop the toast on the laptop"), use a per-user "device events" channel that all the user's connected devices subscribe to.

**6. End-to-end encryption.**

Messages are encrypted client-side with per-conversation keys (Signal Protocol-style: Double Ratchet for 1-to-1, Sender Keys or MLS for groups). The server stores ciphertext blobs; it cannot read content.

Effects on the design:

- **Search.** Cannot be server-side. Slack does not E2E because it needs server-side search. WhatsApp does E2E and search is client-side: each client indexes its own decrypted history locally. Slow on a new device, but it works.
- **Push notification previews.** The server sends a generic notification "New message from X" because it cannot decrypt content for the preview. Some products send the encrypted blob in the push payload and decrypt on-device to construct the preview; this requires the device to be unlocked at notification time.
- **Group fan-out.** Same path as plaintext. Encryption affects only the body; the metadata (sender_id, conversation_id, message_id, timestamps) is plaintext and used for routing.
- **Multi-device.** Each device has its own key pair. A new device must be authorized by an existing device (QR code pairing in WhatsApp, key exchange in Signal). Sender Keys must be re-shared when membership changes; MLS handles this with a "commit" message per change.
- **Moderation.** Server cannot scan content. Trust falls on client-side reporting + sender reputation + metadata heuristics. Real-world systems use perceptual hashes of media (computed client-side) for known-bad content like CSAM.

We are not deep-diving E2E in this problem; the architecture above is compatible with adding E2E by changing only the message body field.

**7. Gateway crash with 100K connections.**

Covered in section 9. Summary: clients reconnect with jittered backoff over 5-15 seconds, are re-routed via consistent hashing, send `resume`, and catch up on missed messages. No data loss because no durable state lives in the gateway.

The non-obvious scaling concern: at peak, the gateway fleet is sized to absorb a 10-15% capacity loss from a single fleet failure. If you size at exactly 5000 nodes for 500M connections, losing one node spills 100K reconnects in seconds onto the other 4999 nodes, which is fine, but losing a whole zone (say 30% of the fleet) means 150M clients reconnecting at once. The remaining nodes might be at 80% utilization and cannot absorb 30% extra. So you over-provision by ~30%, or use auto-scaling tied to connection count, or both.

**8. New device, full history bootstrap.**

User logs in on a new phone. They have 500 conversations and 10 years of history (millions of messages). Naive: download everything. Bad.

Pragmatic approach:

- **Lazy load.** Show conversation list with last message preview (one row per conversation). The conversation list is small: 500 rows × ~500 bytes = 250 KB.
- **On opening a conversation, fetch the last 50 messages.** That is one Cassandra range read; instant.
- **Backfill older history in the background only if the user scrolls or searches.** Pagination by message_id; each page is one range read.
- **For E2E, the client must request key material from another active device** to decrypt history. Some products (WhatsApp) skip this and just don't show pre-pairing history on the new device. Others (Signal) sync a recent window.

The chat list query is the only one that has to be fast on a fresh login. We optimize it with a denormalized `last_message` and `last_message_ts` on the `conversations` row, plus a `last_read_msg_id` on `conversation_members` for unread counts. One query gets everything.

**9. Anti-abuse: spam detection.**

Signals to track per sender:

- **Outbound rate to non-contacts.** Sending 100 DMs to people who have never messaged you back is suspicious.
- **Account age vs message volume.** A 1-hour-old account sending 500 messages is a bot.
- **Block / report rate.** If 5% of your recipients block you within 24 hours, you are spam.
- **Similar message body.** Sending identical or near-identical content to many recipients (locality-sensitive hashing of message bodies).
- **Network-level signals.** New device, unusual IP, mismatched timezone.

Response, in escalating severity:

1. **Soft rate limit.** Cap outbound to non-contacts at, say, 50 per hour.
2. **Friction.** Require CAPTCHA or phone verification before more messages.
3. **Shadow ban.** Messages accepted by the server but never delivered. Recipient sees nothing; sender sees "sent." Buys time to confirm abuse without alerting the spammer.
4. **Hard block.** Account suspended.

Legitimate high-volume users (business accounts, broadcasters) are whitelisted via the business API with declared quota and pay for higher limits.

The hard part is precision: false positives are bad (real users falsely flagged). Maintain an appeal flow and a clear paper trail.

**10. Delivery lag spikes to 30s in one region, message store metrics look fine.**

Where to look, in order:

1. **Fan-out Kafka consumer lag for that region.** This is the most common cause: the Dispatcher cannot keep up. Check per-partition lag, not just aggregate. A single hot partition can drive perceived lag while average is fine.
2. **Pub/Sub bus latency.** Redis pub/sub for the gateways. If Redis is slow (CPU bound, eviction churn), publishes back up. Check Redis CPU, slow log, connection count.
3. **Specific gateway saturation.** If 5% of users are landing on a hot gateway (consistent hashing imbalance after a deploy), that gateway's outbound write rate is saturated. Check per-gateway connection count and outbound rate.
4. **Cross-region replication lag.** If the dispatcher is reading CDC from Cassandra and the local replica is lagging, the dispatcher reads stale offsets. Check `nodetool netstats`, replication lag metrics.
5. **Presence Registry slowness.** Every fan-out task hits Presence Registry to look up the gateway for each member. If Redis is slow, fan-out backs up. Symptom: per-task fan-out latency rises while consumer count is steady.
6. **Membership service slowness.** If conversation membership is cached but the cache is cold or evicting, Postgres queries flood. Check membership-cache hit rate.

The senior answer mentions per-partition lag (not just aggregate) and the Presence Registry as the often-overlooked culprit. Mid-level answers stop at "check Kafka lag."

### 12. Trade-offs and what a senior would mention

- **Stateful gateways are a tax.** Every other system in our architecture is stateless and trivially scaled. Gateways are not. Deploys must be careful (rolling, with connection draining: refuse new connections, wait for old ones to migrate, then restart). The complexity is justified because the alternative (HTTP long-poll at 500M users) costs more in aggregate request volume than the gateway state costs in operational care.
- **Why no per-user inbox queue.** Some chat designs (especially in books) maintain a durable per-user inbox: messages are pushed into a queue, the user drains it on connect. We do not, because at 1B users the queue infra is gigantic and Cassandra+resume gives the same guarantees with less moving infra. The trade-off is that we re-read Cassandra on each resume, which is fine because the read is cheap (single partition) and bounded.
- **Why pub/sub is not durable.** Redis pub/sub is fire-and-forget. We accept the loss because (a) push notifications backstop the case where the recipient is offline, and (b) resume backstops the case where the recipient reconnects. A durable replacement (e.g., Kafka per gateway) would double the operational footprint of the bus for negligible gain.
- **Why single home region per conversation.** Avoids multi-master conflict resolution on the ordered log. Cross-region writes have higher latency (~150ms WAN added), but it is invisible during async pipelines and only mildly visible on send-ack for cross-region members. The complexity savings are massive.
- **What I would revisit at 10x scale.**
 - **Commit-log front of Cassandra.** Write the ordered log to a Kafka-like durable buffer first, ack the sender immediately, then write to Cassandra in the background. Shaves ~50ms from sender perceived latency. Doubles operational complexity of the storage tier.
 - **MLS for E2E group chat.** WhatsApp's Sender Keys do not scale gracefully for 1000-person groups with churning membership. MLS (Messaging Layer Security) handles this; it is the future state.
 - **Edge-local Message Service.** At extreme scale, push the Message Service to each region's edge and synchronize via a global log. Gets sub-200ms cross-region latency. Operational complexity high.
 - **Federated identity / cross-system messaging.** Compatibility with Matrix / XMPP / iMessage interop. Not a scale issue; a product issue, but it changes routing significantly.

### 13. Common interview mistakes

- **Drawing one box labeled "WebSocket server" and moving on.** The connection layer is half the problem. Talk about connection count, sticky routing, reconnect-with-resume, gateway crash recovery.
- **Forgetting receipts dominate the load.** Many candidates compute messages-per-second and stop. The receipt math is 30x larger and shapes the schema and write path.
- **Strict total order via consensus.** Designing a Paxos-per-conversation log. The user-visible guarantee is much weaker and Snowflake IDs give it for free.
- **Pull-based message reception ("client polls inbox every 5s").** Walks into the worst-of-both-worlds: connection state per client plus high-rate polling.
- **No mention of push (APNs/FCM) for offline users.** Real-time delivery only works while connected; offline users are a separate path.
- **One big database table for everything.** Postgres for messages at 100B/day melts. Cassandra (or equivalent) sharded by conversation_id is the standard answer.
- **Storing per-recipient state for every message in every group.** Mention the receipts table separately, and the optimization that drops "delivered" in large groups.
- **No discussion of multi-device.** Users have phones and laptops. The session model must support multiple active sessions per user_id.
- **Ignoring abuse / spam.** Always asked as a follow-up. Have rate limits and shadow ban in your back pocket.
- **Hand-waving reconnect.** "The client reconnects" is not an answer. The resume protocol with per-conversation last_seen_message_id is the answer.

If you hit 8 of these 10, you are interviewing at the senior level. Most candidates miss receipts dominating load, the resume protocol, and the multi-device session model.
{% endraw %}
