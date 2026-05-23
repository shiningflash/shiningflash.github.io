---
layout: practice-problem
track: system-design
problem_id: 13
title: Design a Todo List with Sharing and Collaboration
slug: 013-todo-list-sharing
category: Collaboration
difficulty: Easy
topics: [real-time, websockets, sharing, permissions, eventual consistency]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/013-todo-list-sharing"
solution_lang: markdown
---

{% raw %}
## Scene

You sit down. The interviewer leans back and says:

> *"Everyone has used Todoist or Trello. I want you to build a todo list app. Users create lists, add items, check them off. The interesting part: any list can be shared with friends. When Alice adds an item, Bob, who is also on that list, should see it on his phone within a second or two. Build that."*

They wait.

On the surface it looks like CRUD over items in a list. That answer dies fast. Three problems are hiding inside the question: how do you push changes to other devices in near real-time without melting your servers, what happens when Alice and Bob edit the same item title at the same instant, and what does the permission model look like once a list can be re-shared.

Most candidates jump straight to "I will use WebSockets." That is the right tool but the wrong place to start. The right place is to ask what kind of collaboration the interviewer actually wants. A list that updates every 10 seconds is a totally different system from one where Alice's keystrokes show up on Bob's screen as she types.

## Step 1: clarify before you design

Take 5 minutes. Do not draw anything yet. Ask at least 8 questions. The answers move the design from "polling every minute" all the way to "WebSocket fan-out with CRDTs," and you need to know which direction you are being pushed.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. How real-time is "real-time"? Is a 1-second lag acceptable, or are we aiming for sub-100ms like Google Docs character-by-character? This single answer drives 60% of the design. 1 to 5 seconds means polling or long-poll works. Sub-second means WebSocket. Sub-100ms with multiple editors lands you in CRDT or operational transform territory.
2. What can be shared, and at what granularity? Individual lists, whole workspaces, single items? Can an invitee re-share? Per-list sharing is the common answer. Re-sharing changes the permission model from a flat grant into a transitive graph.
3. Roles and permissions. Viewer, editor, admin? Per list or global? Can a viewer see who else is on the list? Two roles cover 90% of cases; add admin if you want a designated owner who can revoke.
4. Scale. How many users? How many lists per user? How many items per list? 10k users with 50 lists each and 100 items per list is a totally different sizing exercise than 10M users with the same shape. Both are reasonable.
5. Offline support. Can a user add or check off items with no network? What happens on reconnect? Offline-first is a major design choice. It pushes you toward operation logs and conflict resolution rather than naive last-write-wins.
6. Notifications. When Alice adds an item to Bob's shared list, does Bob get a push notification? In-app only? Email digest? Notifications usually live in a separate service consuming events, but you need to know whether they are in scope.
7. Item structure. Plain text checkboxes, or due dates, assignees, attachments, sub-tasks? Affects the data model. Start simple (title + done flag) and ask whether richer fields are needed.
8. Deletion semantics. When Alice deletes an item, does it vanish from Bob's view? Soft delete with undo? Trash bin? Soft delete with tombstones is the right answer for any collaborative system; explain why.
9. Mobile vs web. Both? Native app or PWA? Native gives you durable background sync; web limits you. Affects how you design offline sync.
10. Invite flow. Email invite, share link, or direct in-app share by username? Invite-link is simplest, direct grants are safest, both are commonly supported.

A strong candidate also names what is out of scope. Rich-text editing inside items, file attachments, calendar integration, AI features. Those would multiply complexity if attempted in 45 minutes.

</details>

## Step 2: capacity estimates

The interviewer gives you the small-scale numbers first:

- 10k daily active users
- Average 20 lists per user, but most lists are personal (only ~3 shared lists per user)
- Average shared list has 4 collaborators
- Each user adds or checks ~30 items per day
- Each user opens the app ~15 times per day

Compute on paper before revealing:

1. Writes per second (item add, check off, edit, delete)
2. Reads per second (open the app, refresh a list)
3. Concurrent WebSocket connections (assume each active user holds one)
4. Total storage after 2 years
5. Fan-out: when Alice writes to a 5-person list, how many delivery events fire?

Then redo the same math for 1M daily actives.

<details>
<summary><b>Reveal: the math at both scales</b></summary>

**10k DAU (small scale):**

- Writes: 10k × 30 = 300k operations/day = ~3.5 writes/sec sustained, ~10/sec peak. Trivial.
- Reads: 10k × 15 list opens × ~3 lists per session ≈ 450k reads/day = ~5 reads/sec sustained, ~15/sec peak. Also trivial.
- Concurrent WS connections: if 20% of DAU are active at peak hour, that is 2k open sockets. A single small box (4GB RAM) handles that comfortably.
- Storage: 10k users × 20 lists × 100 items × ~200 bytes/item = 40MB. Plus op-log retention at ~3 ops/sec × 86400 × 365 × 2 × ~300 bytes = ~60GB over 2 years. Easy on one disk.
- Fan-out: each write to a 5-person list fires 4 delivery events (the writer already knows). At 10 writes/sec peak that is 40 deliveries/sec. Nothing.

You could literally build this with one Postgres, one app server, and polling every 5 seconds. The only reason we will not is that we want a design that grows.

**1M DAU (large scale):**

- Writes: 1M × 30 = 30M/day = ~350 writes/sec sustained, ~1k/sec peak. Still small for any modern database.
- Reads: 1M × 15 × 3 ≈ 45M/day = ~520 reads/sec sustained, ~1.5k/sec peak.
- Concurrent WS: 20% active at peak = 200k open sockets. Now you need multiple WS servers; one box does not hold 200k sockets without careful tuning. A typical Node or Go server handles ~50k per box, so 4 to 8 boxes minimum.
- Storage: 1M users × 20 lists × 100 items × ~200 bytes = 4GB for current state. Op log at ~350 ops/sec × 86400 × 365 × 2 × ~300 bytes = ~6.5TB over 2 years if you keep every op forever. You will not. Compact old ops; keep the last 30 days for replay.
- Fan-out: ~1k writes/sec peak × 4 collaborators average = ~4k delivery events/sec. Still small, but now distributed across WS servers, so you need pub/sub between them.

The math tells you something important. Throughput is small even at 1M DAU. The hard part is not the write rate. The hard parts are connection count (200k open sockets needs multiple servers and a way to route a write to the right server), fan-out (one write must reach all active collaborators), and the offline sync queue for users who reconnect after hours away. Storage of the live state is tiny. The op log, if kept forever, dominates storage. Compaction matters. Reads vastly outnumber writes by raw count once you include dashboard rendering. Cache the "list summary" view aggressively.

</details>

## Step 3: real-time updates, three options

Alice adds an item. Bob needs to see it. You have three serious options to push the update to Bob's phone:

1. Long-poll. Bob's client opens an HTTP request that the server holds open until a change happens or a timeout fires.
2. WebSocket. Bob's client opens a persistent bidirectional connection; the server pushes whenever it has something.
3. Server-Sent Events (SSE). Like WebSocket but one-way (server to client), runs over normal HTTP.

Before peeking at the comparison, write down the pros and cons of each. Think about connection cost per user, complexity, mobile background behavior, what happens when 100 things change at once, and what happens behind a corporate proxy that blocks WebSocket.

<details>
<summary><b>Reveal: comparison and recommendation</b></summary>

| Aspect | Long-poll | WebSocket | SSE |
|--------|-----------|-----------|-----|
| Protocol | HTTP request + response (repeated) | Single persistent TCP connection upgraded from HTTP | Single persistent HTTP response, chunked |
| Direction | Client to server only (response carries push data) | Bidirectional | Server to client only |
| Latency to deliver an update | Up to the next reconnect (sub-100ms after a response, more on a fresh connect) | Sub-100ms; immediate push | Sub-100ms; immediate push |
| Connection cost | High (constant reconnects, each is a full HTTP handshake) | Low (one connection, kept open) | Low (one connection, kept open) |
| Server memory per user | Low when not connected, high during the long poll | ~10 to 50 KB per open socket | ~10 to 50 KB per open response |
| Proxy / firewall friendliness | Excellent (just HTTP) | Often blocked or rewritten; needs WSS over 443 with origin headers | Excellent (looks like a slow HTTP response) |
| Mobile background | Naturally pauses when the app suspends; client polls again on wake | Connection dies when app backgrounds; reconnect on foreground | Same as WebSocket, dies on background |
| Complexity | Lowest (just HTTP retries) | Highest (frame handling, ping/pong, reconnect, auth on upgrade) | Medium (HTTP, but need to handle resumption and event IDs) |
| Sending client to server | Use a separate POST | Same socket | Use a separate POST |
| Multiplexing many lists per user | Trivial; each poll returns a delta | Easy; route messages over the same socket with a list_id field | Easy; same as WebSocket |

**Recommendation: WebSocket with long-poll as fallback.**

WebSocket is the primary path. Lowest latency, lowest server cost per connection at scale, native browser support. Long-poll is the fallback. Some corporate networks and old mobile networks break WebSocket. The client tries WSS first; on failure (handshake fails, no message within 30 seconds), it falls back to long-poll on a separate endpoint. Same delivery semantics, just slower.

SSE is also reasonable and some teams pick it for its simplicity. The reason most pick WebSocket is the bidirectional channel: you can send presence updates ("Alice is typing") and acks on the same socket. SSE forces a separate POST for every client-to-server message.

WebSocket is not free. An open socket costs memory on the server (10 to 50 KB for buffers, plus app-level state). You pay TCP and TLS keepalive overhead. The client must send a ping every 30 seconds or so to detect dead connections behind NATs. Mobile clients drop the socket constantly (screen off, app backgrounded, weak signal), so you need fast reconnect with a "give me changes since X" delta sync. A single WS server in 2026 handles 50k to 100k connections. Beyond that, you shard across multiple WS servers and need pub/sub to fan a single write out to all of them.

At small scale (Stage 1 in the scaling section), you can skip WebSocket entirely and just poll every 5 to 10 seconds. The user sees changes within 10 seconds, which is fine for a todo list. WebSocket is worth building when you have enough active users that polling becomes a measurable cost.

</details>

## Step 4: sketch the high-level architecture

Here is an intentionally incomplete diagram. Fill in the five `[ ? ]` placeholders.

```
                Client (web, iOS, Android)
                        │
                        ▼
                ┌──────────────┐
                │   [ ? ]      │  (auth, rate limit, sticky routing for WS)
                └──────┬───────┘
                       │
        write          │           subscribe (WS)
                       │
            ┌──────────┼──────────┐
            │                     │
            ▼                     ▼
      ┌──────────┐         ┌──────────────┐
      │  [ ? ]   │         │   [ ? ]      │  (holds open sockets, routes
      │ (CRUD,   │         │   (push      │   messages to subscribers
      │  perms,  │         │    server)   │   on this server)
      │  writes  │         └──────┬───────┘
      │  ops)    │                │
      └────┬─────┘                │
           │                      │
           ▼                      │
      ┌──────────┐                │
      │   [ ? ]  │ ───────────────┘  (source of truth: lists, items,
      │          │                    op log, share grants)
      └────┬─────┘
           │
           ▼
      ┌──────────┐
      │   [ ? ]  │  (fans a write out to every WS server
      │          │   that has a subscriber for that list)
      └──────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
                Client (web, iOS, Android)
                        │
                        ▼
                ┌──────────────────┐
                │   API Gateway    │  (auth, rate limit, sticky routing for WS
                │   + Load         │   so a user's reconnects land on the same
                │   Balancer       │   server when possible)
                └──────┬───────────┘
                       │
        write          │           subscribe (WS)
                       │
            ┌──────────┼──────────┐
            │                     │
            ▼                     ▼
      ┌─────────────┐       ┌──────────────────┐
      │  API        │       │  WebSocket       │
      │  Service    │       │  Service         │
      │  (REST):    │       │  (holds 50k      │
      │   CRUD on   │       │   sockets per    │
      │   lists,    │       │   pod; routes    │
      │   items,    │       │   messages to    │
      │   share,    │       │   the right      │
      │   perms;    │       │   subscriber)    │
      │   appends   │       └────────┬─────────┘
      │   to op log)│                │
      └────┬────────┘                │
           │                         │
           ▼                         │
      ┌──────────────────────┐       │
      │  Postgres            │       │
      │  Tables:             │       │
      │   - users            │       │
      │   - lists            │       │
      │   - list_items       │       │
      │   - share_grants     │       │
      │   - change_log       │ ◄─────┘  (WS service reads from change_log
      │     (op log)         │           for replay on reconnect)
      └────────┬─────────────┘
               │
               │  every write also publishes
               ▼
      ┌──────────────────────┐
      │  Redis Pub/Sub       │  (channel per list_id;
      │  (fan-out bus)       │   WS servers subscribe
      │                      │   to channels for the
      │                      │   lists their users
      │                      │   are watching)
      └──────────────────────┘
```

What each piece does:

The API Gateway plus Load Balancer is the first hop. It terminates TLS, runs auth (JWT or session cookie), enforces rate limits. For WebSocket upgrade requests it picks a WS pod and prefers sticky routing (same client back to the same pod across reconnects) to keep cache warm.

The API Service handles all writes: create list, add item, toggle done, edit title, share, revoke. Every write appends to the `change_log` table within the same transaction as the state update. It also handles non-WS reads (initial page load).

The WebSocket Service holds open sockets. When a client connects, it authenticates, then subscribes the connection to the Redis pub/sub channels for each list the user has access to. When a message arrives on a subscribed channel, it forwards to the connection. It also serves the "changes since seq X" replay endpoint over the socket.

Postgres is the source of truth. It stores the current state of every list and item, plus an append-only change_log. The change_log is the spine of the system. It powers reconnect-and-catch-up, undo, and audit.

Redis Pub/Sub is the fan-out bus. Every write publishes a message to a channel named after the list_id. Every WS server holding at least one connection subscribed to that list receives the message and forwards to local sockets. That is what scales fan-out across many WS pods.

Why two services (API and WS) instead of one? They scale differently. API is request/response, low memory, scales with QPS. WS is connection-heavy, high memory per pod, scales with concurrent users. Keeping them separate lets each scale independently and lets you deploy WS server updates without disrupting REST traffic.

</details>

## Step 5: conflict resolution

Alice and Bob both have the same shared list open. At 2:31:05 PM:

- Alice edits the title of item #42 from "Buy milk" to "Buy oat milk."
- At the same millisecond, Bob edits the title of item #42 from "Buy milk" to "Buy almond milk."

Both writes hit your servers within 50ms of each other. What does the system do? Whose title wins? Does Bob see Alice's title flash on his screen and then change back? What if Alice was offline and queued the change locally, then synced an hour later?

Three serious options:

1. Last-write-wins (LWW) by wall-clock timestamp or by an op sequence number.
2. Operational transform (OT) like Google Docs uses for character-level merges.
3. CRDT (conflict-free replicated data type) that mathematically guarantees convergence regardless of order.

<details>
<summary><b>Reveal: which to pick and why</b></summary>

For a todo list with item-level edits (not character-level co-editing inside one field), LWW with a logical clock is the right answer. Here is why and how.

Why not OT. Operational transform shines when two users are typing in the same text field at the same time and you want both keystrokes preserved. That is overkill for "edit item title." If Alice and Bob edit at the same time, one of their edits has to lose; the user-visible behavior is "whichever was second wins." That is fine for a todo list. OT adds large amounts of complexity (transformation functions per op type, central server arbitration in most designs) that you do not need.

Why not CRDT yet. CRDTs are great for offline-first collaborative apps where two users may be disconnected for hours and you want their edits to merge without a server. They have real costs: bigger payload per op (because the CRDT metadata travels with the data), trickier debugging, and a steeper learning curve for the team. For a todo list at small to medium scale, LWW is simpler and the user experience is acceptable. CRDT becomes a strong choice once offline-first is a first-class requirement (see the scaling section, stage 4).

Why LWW with a logical clock, not wall-clock. Wall-clock timestamps are unreliable across devices. Alice's phone might be 30 seconds ahead of Bob's. A correct LWW scheme uses a logical clock so that "newer" wins by a definition that does not depend on clock skew.

Two practical options:

Per-list sequence number. Every op on a list gets a server-assigned monotonically increasing `seq`. The server is the single source of truth for ordering on that list. When Alice and Bob both submit edits, the server stamps each with the next seq. Higher seq wins. Simple, correct, requires the server to be the arbiter.

Hybrid logical clock (HLC). Combines wall-clock and a counter so concurrent ops can be totally ordered without a central server. Useful for true offline-first systems where the client writes ops while disconnected and assigns ordering metadata that survives sync.

The resolution flow for Alice and Bob's clash:

1. Alice submits her edit. Server stamps it `seq=512`, persists to `list_items` and appends to `change_log`. Server publishes `{list_id=L, seq=512, op="edit", item=42, title="Buy oat milk"}` to the Redis channel for list L.
2. Bob's edit arrives 50ms later. Server stamps it `seq=513`, persists, appends, publishes.
3. Both ops fan out via Redis to all WS pods. Alice's WS pod sees seq=512 (her own, already applied locally; she may see a brief flash of "your change is confirmed") and seq=513 (apply: title becomes "Buy almond milk").
4. Bob's WS pod sees seq=512 (apply: his screen briefly shows Alice's "oat milk" if his client hadn't optimistically applied his own change yet) and seq=513 (his own, confirmed).
5. Final state across all clients: title is "Buy almond milk" (the seq=513 winner).

The brief flash is the cost of LWW. Bob saw his own edit applied optimistically, then briefly saw Alice's edit, then his own edit came back as the winner. In practice it happens fast enough (under 200ms) that users do not notice for a todo list. For a document editor that flash would be unacceptable, which is why Google Docs uses OT.

Offline edits queue at the client. If Alice is offline and edits item #42, her client stores the op locally with a tentative client-side ID and a timestamp. When she reconnects, the client replays the op against the server. The server assigns the next seq (which may be much higher than when Alice did the edit). If Bob edited the same item while Alice was offline, Bob's edit was seq=513 and Alice's late-arriving edit is seq=900. Alice's edit wins (higher seq, even though it was authored earlier in wall time). This is the well-known "LWW does not respect intent during long offline periods" caveat. Acceptable for a todo list; not acceptable for document editing.

Special cases:

Delete + edit race. Alice deletes item #42 at seq=512. Bob edits item #42 at seq=513. The delete is recorded as a tombstone with seq=512. Bob's edit at seq=513 is applied to the tombstoned item; on next render, item #42 is hidden because tombstone wins for visibility. Bob's edit lives in the change_log forever; if Alice un-deletes (undo), the edit is still there. Simpler alternative: edits on tombstoned items are rejected with 410 Gone, forcing Bob's client to refresh.

Two adds with the same client-generated ID. Should never happen if client IDs are UUIDv7. Server enforces uniqueness on `(list_id, client_op_id)` to catch retries.

</details>

## Step 6: permissions model

Alice owns a list. She shares it with Bob (editor) and Carol (viewer). Bob then wants to share the list with Dave. Does Bob have that authority? If yes, what role does Dave get? What if Alice later revokes Bob? Does Dave lose access too?

Sketch your share_grant data model and your authorization check pseudocode.

<details>
<summary><b>Reveal: permissions model</b></summary>

Three roles:

| Role | Read items | Write items | Share list | Manage members | Delete list |
|------|------------|-------------|------------|----------------|-------------|
| viewer | yes | no | no | no | no |
| editor | yes | yes | optional (configurable per list) | no | no |
| admin | yes | yes | yes | yes | yes |

The list creator is implicitly admin. Each list has at most one admin in the simple model; advanced models allow multiple admins.

Direct grants, not transitive by default.

```sql
CREATE TABLE share_grants (
    grant_id      UUID PRIMARY KEY,
    list_id       UUID NOT NULL REFERENCES lists(list_id),
    grantee_id    UUID NOT NULL REFERENCES users(user_id),
    role          TEXT NOT NULL,             -- 'viewer' | 'editor' | 'admin'
    granted_by    UUID NOT NULL REFERENCES users(user_id),
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ,                -- soft delete
    UNIQUE (list_id, grantee_id) WHERE revoked_at IS NULL
);
CREATE INDEX idx_share_grantee ON share_grants (grantee_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_share_list ON share_grants (list_id) WHERE revoked_at IS NULL;
```

A user can access a list if they have a non-revoked grant. The `UNIQUE WHERE revoked_at IS NULL` partial index prevents duplicate active grants for the same user on the same list.

Authorization check:

```python
def can(user_id, list_id, action):
    grant = db.query_one("""
        SELECT role FROM share_grants
        WHERE list_id = %s AND grantee_id = %s AND revoked_at IS NULL
    """, list_id, user_id)
    if not grant:
        return False
    role = grant.role
    if action == "read":
        return role in ("viewer", "editor", "admin")
    if action == "write":
        return role in ("editor", "admin")
    if action == "share":
        return role == "admin" or (role == "editor" and list_allows_editor_share(list_id))
    if action == "manage_members":
        return role == "admin"
    if action == "delete_list":
        return role == "admin"
    return False
```

Cache the grant lookup per (user_id, list_id) for 60 seconds. A user touches the same lists repeatedly; the hit rate is very high. Invalidate on grant change.

Transitive sharing: Bob shares with Dave. If Bob is an editor and the list owner has set `allow_editor_share = true`, Bob can invite Dave. Bob can grant Dave any role less than or equal to his own (so Bob the editor cannot create an admin Dave). The new grant on `share_grants` has `granted_by = bob`.

Revocation cascade: Alice revokes Bob. The simple model: revoking Bob does not revoke Dave. Dave still has a direct grant on the list with `granted_by = bob`. The owner (Alice) is the only one who can revoke Dave directly. Bob being kicked out does not mean Dave loses access; Dave was given access as an individual, not as Bob's delegate.

The complicated model is cascading revocation. If `granted_by` chains form a tree, revoking Bob also revokes everyone Bob added, recursively. Much harder to reason about and it surprises users. Slack famously avoids it; Notion offers it as an option per workspace.

Recommendation: non-cascading by default. Show Alice a list of "users added by Bob" when she revokes him and ask whether to also revoke them. Explicit, not implicit.

Share by link. Two kinds:

Invite link. A signed token in the URL. Anyone with the link can join the list (gets a `share_grants` row inserted for their user_id when they accept). Owner can disable the link to revoke future invites without affecting current members.

Public view link. Anyone with the link can view (read-only) without signing in. This is its own row in a separate `public_links` table: `list_id, public_token, role='viewer'`. Different access path; the auth check skips the `share_grants` lookup if a valid public token is presented.

</details>

## Step 7: offline editing and the sync protocol

A mobile client is the dominant use case. The user opens the app on the subway, adds five items, marks two as done, and edits the title of another. There is no network. Twenty minutes later they surface and the phone reconnects. What does the protocol between client and server look like?

Sketch the sync flow. Think about: how does the client identify ops it created offline so the server does not duplicate them on retry, what does the request body look like for a batch sync, what does the server return, and what does the client do when the server says "you tried to edit item I but it was deleted by Alice while you were offline"?

<details>
<summary><b>Reveal: the offline sync protocol</b></summary>

Client-side state while offline.

The client keeps two stores. First, a local mirror of every list the user has access to (or has opened recently): items, titles, done flags, the last `seq` seen for each list. Second, a pending-ops queue: a list of ops the user performed locally that have not yet been confirmed by the server. Each op has a `client_op_id` (UUIDv7 generated at op creation time), a `list_id`, an op type, and a payload.

While offline, the client applies its own ops to the local mirror optimistically. The user sees the result of their edits immediately, with a small visual indicator ("Saving..." or a cloud-with-dash icon) that ops are pending.

On reconnect:

1. The client tries to open a WebSocket. If it succeeds, subscribe with `since_seq` per list. The server replays missed ops from change_log.
2. The client then flushes its pending-ops queue. For each pending op, send a regular write request (`POST`, `PATCH`, `DELETE`) with the same `client_op_id` it generated offline.
3. The server's idempotency check (unique index on `(list_id, client_op_id)`) makes retries safe. If the op was somehow already applied (maybe a previous flush partially succeeded), the server returns the original result.

Batch flush. If the queue is large (e.g., 50 ops), the client may use a batch endpoint:

```
POST /api/v1/lists/{list_id}/ops/batch
[
  {"client_op_id": "...", "op": "add_item", "payload": {...}},
  {"client_op_id": "...", "op": "edit_item", "payload": {...}},
  ...
]
```

The server processes them in order, stamping each with a fresh seq. The response is an array of `{client_op_id, seq, status}` so the client can mark each as confirmed.

Conflicts during sync. Three notable cases:

1. Edit on a tombstoned item. Server returns `410 Gone` for that specific op. Client surfaces it to the user: "You edited 'Buy milk' but it was deleted by Alice. Restore?"
2. Add to a list the user no longer has access to. Server returns `403 Forbidden`. Client surfaces: "Your edits to 'Family chores' were not saved; Alice removed you from this list."
3. The user's local seq is older than the server's compaction window. WS subscribe responds with `too_far_behind=true`. The client refetches the full list state, then reapplies pending ops. If any pending op's target item no longer exists, fall through to case 1.

Why `client_op_id` is non-negotiable. Without it, the server cannot tell a duplicate retry from a new op. The mobile flush might partially succeed (network drop mid-batch), and on retry the previously-applied ops would be re-applied, creating duplicate items. The unique index on `(list_id, client_op_id)` is the only thing that makes the system safe under retry.

Why the pending ops queue lives on disk, not just in memory. The user closes the app. The OS evicts the process. They re-open it the next day. The pending ops need to be there. Use SQLite on iOS/Android, IndexedDB on web. Survive process kills, app updates, and reboots.

</details>

## Step 8: read your way through the rest in solution.md

You have done the conceptual core. The rest is mechanics: data model details, the change_log replay protocol, fan-out via Redis, sticky routing for WS, offline sync, presence, and the scaling journey from 10 users to 1M. Read `solution.md` after you have attempted the follow-ups below.

## Follow-up questions

Try answering each in 2 to 4 sentences before reading the solution.

1. Reconnect after a long disconnect. Bob's phone has been offline for 4 hours. He reconnects and his client knows it last saw `seq=412` on list L. How does the server send Bob just the deltas since then, and how do you cap the cost of a very long catch-up?

2. Presence ("Alice is here"). Bob wants to see a little avatar showing Alice is currently viewing the list. How do you implement presence without writing to the database every second?

3. Permission revoked while user is connected. Alice revokes Bob while Bob has the list open on his phone. Bob's WS connection is still subscribed to the list channel. How fast does Bob actually lose access, and what does his client see?

4. Item ordering. Users can drag items to reorder. Two users reorder simultaneously. How do you represent ordering so the conflict resolution does not produce a mess (items in wildly different orders for different users)?

5. Notifications. When Alice adds an item to a shared list, Bob should get a push notification ("Alice added 'Buy milk' to your shared list"). Where does this happen in your architecture, and how do you avoid sending Bob 50 notifications when Alice adds 50 items in 10 seconds?

6. Search. Bob wants to search across all his lists for "milk." How do you support this without scanning every item in every list?

7. Undo. Bob accidentally deletes an item. He hits Cmd-Z. How does this work, and what happens if other collaborators have already seen the deletion?

8. Sticky routing fails. Your load balancer cannot guarantee sticky routing (cloud LB just round-robins). Bob's reconnect lands on a different WS pod than before. What goes wrong, and how do you fix it?

9. A list with 50k subscribers (rare but possible). Some celebrity creates a "Daily affirmations" list and 50k people subscribe to view. Every edit fans out to 50k clients. What breaks, and what do you do?

10. Privacy: Bob is on a shared list and he can see Alice's email/name. Is that a privacy issue? How do you let users hide their identity on shared lists, and what does the client show instead?

## Related problems

- [Approval Management Service (011)](../011-approval-management/question.md) also uses an append-only event log as the spine. Compare the `change_log` here with the `audit_log` there. Same idea, different consumers.
- [Comment System (015)](../015-comment-system/question.md). Comments on shared items use the same real-time fan-out and permissions checks. The thread structure and notification batching there are directly applicable.
- [Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md). The "render Bob's dashboard" path is a heavy read; the caching and denormalization patterns from that problem apply directly to the list summary view.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Todo List with Sharing and Collaboration

### TL;DR

Strip away the collaboration and this is a small CRUD app. Add the collaboration and two things get interesting: pushing changes to other people's devices in near real-time, and reconciling conflicting edits when those devices come back online after being disconnected. Everything else flows from solving those two.

The data model is small. A `users` table, a `lists` table, a `list_items` table, a `share_grants` table for permissions, and an append-only `change_log` keyed by `(list_id, seq)`. The change_log is the spine. It powers real-time push, reconnect-and-catch-up, undo, and offline sync. If you skip it, every one of those features becomes its own hack.

Real-time delivery is WebSocket with long-poll fallback. Each WS pod holds many open sockets. Writes go to the REST API, which persists to Postgres and publishes on a Redis pub/sub channel named after the list_id. Every WS pod with a subscriber for that list receives the message and forwards to local sockets.

Conflict resolution is last-write-wins by server-assigned per-list sequence number, with tombstones for deletes so they propagate cleanly. CRDTs only earn their keep at a later stage, when offline-first becomes a first-class requirement.

The scaling story is four stages: one Postgres with 10-second polling, add WebSocket, add Redis pub/sub and shard WS pods, then shard the DB by list_id and regionalize. None of it is hard if you build in order. All of it is hard if you build out of order.

### 1. Clarifying questions, recap

Covered in `question.md`. The two questions that swing the design hardest: "how real-time is real-time" (drives whether you build WebSocket on day one or just poll) and "can a shared list be re-shared" (changes the permission model from a flat grant table to a tree with `granted_by` chains).

The third most important is offline support. If yes, the client needs a local op queue and the server has to accept ops with client-side IDs and out-of-order timestamps. If no, every write requires a connection and the design simplifies a lot.

### 2. Capacity, with the math

At 10k DAU you have around 3.5 writes/sec sustained, 10/sec at peak. Reads run about 5/sec sustained, 15/sec at peak. With 20% active at peak hour, that is 2k open sockets. The current state of all lists fits in 40MB. The op log over 2 years is around 60GB if you keep every op. A single small box runs the whole thing.

At 1M DAU you have around 350 writes/sec sustained, 1k/sec peak. Reads around 520/sec sustained, 1.5k/sec peak. Concurrent WS connections hit 200k, which does not fit on one machine (a typical Node or Go server handles ~50k per box, so 4 to 8 boxes minimum). Current state is 4GB; raw op log is 6.5TB over 2 years if uncompacted. Fan-out is around 4k delivery events/sec at peak, now split across multiple WS pods.

Two numbers matter more than the throughput:

- 200k concurrent WS connections at peak. The hard scaling problem is connection count, not write rate.
- 4k delivery events/sec across multiple WS pods means you need pub/sub between them; an in-process channel does not span hosts.

Even at 1M DAU, write throughput is tiny by modern DB standards. Postgres handles 1k writes/sec on one box. The op log dominates storage if you keep every op forever, so compact aggressively (last 30 days, plus a snapshot). Dashboard reads dominate everything by raw count once you include rendering. Cache the per-list summary.

### 3. API

The list and item CRUD looks like what you would expect:

```
POST   /api/v1/lists                       create a list
GET    /api/v1/lists                       list all lists I have access to
GET    /api/v1/lists/{list_id}             get a list with its items
PATCH  /api/v1/lists/{list_id}             rename, change settings
DELETE /api/v1/lists/{list_id}             delete a list (admin only)

POST   /api/v1/lists/{list_id}/items                 add an item
PATCH  /api/v1/lists/{list_id}/items/{item_id}       edit title, toggle done, set due date
DELETE /api/v1/lists/{list_id}/items/{item_id}       soft delete (tombstone)
```

Every write carries a `client_op_id` header (UUIDv7 from the client) for idempotency. If the same `client_op_id` shows up twice within 24 hours, the server returns the original result instead of applying the op twice. This is what saves you from mobile retries creating duplicate items.

Sharing:

```
POST   /api/v1/lists/{list_id}/shares
{
  "grantee": {"type": "user_id", "value": "..."} | {"type": "email", "value": "..."},
  "role": "viewer" | "editor" | "admin"
}

GET    /api/v1/lists/{list_id}/shares             list current grants
DELETE /api/v1/lists/{list_id}/shares/{grant_id}  revoke

POST   /api/v1/lists/{list_id}/invite-link        create / rotate invite link
POST   /api/v1/invite/{token}/accept              accept an invite link
```

Get changes since:

```
GET /api/v1/lists/{list_id}/changes?since_seq=412
```

Returns the ordered list of ops with `seq > 412` for that list, up to a cap (e.g., 500 ops). Used by the client on reconnect to catch up. If the gap is larger than the cap, the response says "too far behind, refetch full state" and the client does `GET /api/v1/lists/{list_id}` to resync.

WebSocket protocol. After upgrade, the client sends:

```json
{ "type": "subscribe", "list_ids": ["..."], "since_seq": { "list_id_1": 412, "list_id_2": 0 } }
```

The server sends back, per list:

```json
{ "type": "op", "list_id": "...", "seq": 413, "op": "add_item", "payload": {...} }
{ "type": "op", "list_id": "...", "seq": 414, "op": "edit_item", "payload": {...} }
```

Ping/pong every 30 seconds. Client sends `{"type": "ping"}`, server responds `{"type": "pong"}`. Connection killed after 60 seconds without traffic.

Response codes worth knowing: 404 not 403 on missing lists, so existence does not leak. 409 if someone reuses an idempotency key with a different payload. 410 on writes to a tombstoned item, forcing the client to refresh.

| Status | Meaning |
|--------|---------|
| 200 OK | Op accepted and applied |
| 201 Created | New resource created |
| 401 Unauthorized | Bad or missing auth token |
| 403 Forbidden | User does not have the role required for this action |
| 404 Not Found | List or item does not exist (or user has no read access) |
| 409 Conflict | Idempotency key reused with a different payload |
| 410 Gone | Item was tombstoned; client must refresh |
| 429 Too Many Requests | Rate limited |

### 4. Data model

Five tables. The interesting one is `change_log`.

```sql
CREATE TABLE users (
    user_id       UUID PRIMARY KEY,
    email         CITEXT UNIQUE NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lists (
    list_id        UUID PRIMARY KEY,
    owner_id       UUID NOT NULL REFERENCES users(user_id),
    title          TEXT NOT NULL,
    settings       JSONB NOT NULL DEFAULT '{}',     -- {"allow_editor_share": true, ...}
    next_seq       BIGINT NOT NULL DEFAULT 1,        -- next change_log seq for this list
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_lists_owner ON lists (owner_id) WHERE deleted_at IS NULL;

CREATE TABLE list_items (
    item_id        UUID PRIMARY KEY,
    list_id        UUID NOT NULL REFERENCES lists(list_id),
    title          TEXT NOT NULL,
    done           BOOLEAN NOT NULL DEFAULT FALSE,
    due_date       DATE,
    order_key      TEXT NOT NULL,                    -- fractional index for stable ordering
    created_by     UUID NOT NULL REFERENCES users(user_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seq       BIGINT NOT NULL,                  -- seq of the last op that touched this item
    deleted_at     TIMESTAMPTZ                       -- tombstone
);
CREATE INDEX idx_items_list ON list_items (list_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_list_seq ON list_items (list_id, last_seq);

CREATE TABLE share_grants (
    grant_id      UUID PRIMARY KEY,
    list_id       UUID NOT NULL REFERENCES lists(list_id),
    grantee_id    UUID NOT NULL REFERENCES users(user_id),
    role          TEXT NOT NULL,                     -- 'viewer' | 'editor' | 'admin'
    granted_by    UUID NOT NULL REFERENCES users(user_id),
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_grants_active
    ON share_grants (list_id, grantee_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_grants_grantee ON share_grants (grantee_id) WHERE revoked_at IS NULL;

CREATE TABLE change_log (
    list_id        UUID NOT NULL,
    seq            BIGINT NOT NULL,                  -- per-list monotonic
    op             TEXT NOT NULL,                    -- 'add_item' | 'edit_item' | 'delete_item' | 'reorder' | 'rename_list' | 'share' | 'revoke'
    actor_id       UUID NOT NULL,
    payload        JSONB NOT NULL,                   -- op-specific
    client_op_id   UUID,                             -- for idempotency
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (list_id, seq)
);
CREATE INDEX idx_change_log_actor ON change_log (actor_id, occurred_at DESC);
CREATE UNIQUE INDEX idx_change_log_idem
    ON change_log (list_id, client_op_id) WHERE client_op_id IS NOT NULL;
```

A few choices worth defending out loud.

`next_seq` lives on the lists row. When the server records an op, it bumps `lists.next_seq` and uses the prior value as the op's seq. The bump and the change_log insert happen in the same transaction so seqs are gap-free.

`order_key` is TEXT, not INTEGER. Fractional ordering: between items with keys "a" and "c", insert "b". Between "a" and "b", insert "am". Lets you reorder without renumbering. Look up "fractional indexing" or LexoRank.

`last_seq` on `list_items` lets a partial-sync client know which op last touched this item without joining to change_log.

`deleted_at` is the tombstone. Never DELETE rows. Setting `deleted_at` removes the row from the partial index (`WHERE deleted_at IS NULL`) but keeps the row for replay.

The partial unique index on `(list_id, client_op_id)` catches retries from the same client. If the network blipped and the client retried, the server applies the op only once.

Postgres, not Cassandra or DynamoDB. This system needs transactions: appending to change_log and updating the item row must be atomic. Per-list seq generation needs strong ordering. Postgres gives both for free. Cassandra would force you to invent your own seq generator and accept eventual consistency between change_log and items.

### 5. Architecture

Here is the whole thing. Drawn small enough to fit one screen.

```
                Client (web, iOS, Android)
                        │
                        ▼
                ┌──────────────────┐
                │   API Gateway    │   auth, rate limit, sticky routing
                │   + Load         │   for WS upgrades (best effort)
                │   Balancer       │
                └──────┬───────────┘
                       │
        write          │           subscribe (WS)
                       │
            ┌──────────┼──────────┐
            │                     │
            ▼                     ▼
      ┌─────────────┐       ┌──────────────────┐
      │  API        │       │  WebSocket       │
      │  Service    │       │  Service         │
      │  (REST):    │       │  (50k sockets    │
      │   CRUD,     │       │   per pod;       │
      │   perms,    │       │   routes msgs    │
      │   appends   │       │   to local       │
      │   to op log)│       │   subscribers)   │
      └─────┬───────┘       └────────┬─────────┘
            │                        │
            │                        │ replay on reconnect
            ▼                        ▼
      ┌──────────────────────────────────────┐
      │  Postgres                            │
      │   users                              │
      │   lists       (next_seq lives here)  │
      │   list_items  (current state)        │
      │   share_grants                       │
      │   change_log  (append-only op log)   │
      └──────────────────┬───────────────────┘
                         │
                  every write also publishes
                         ▼
      ┌──────────────────────────────────────┐
      │  Redis Pub/Sub                       │
      │   list:{list_id}   (per-list fan-out)│
      │   perm:{user_id}   (access revoke)   │
      │   presence:{list_id}                 │
      └──────────────────┬───────────────────┘
                         │
                         │  CDC / outbox
                         ▼
      ┌──────────────────────────────────────┐
      │  Notification Service                │
      │   batches per recipient,             │
      │   sends push / email digest          │
      └──────────────────────────────────────┘
```

A few things to notice while reading this.

API and WS are separate services. They scale differently. API is request/response, low memory, scales with QPS. WS is connection-heavy and scales with concurrent users. Splitting them lets you roll WS deploys without disrupting REST traffic.

Postgres is the source of truth. Redis is just the delivery channel. If a Redis message is lost, no harm done: clients dedupe by seq, gap detection triggers a catch-up REST call, and the change_log in Postgres is the recovery path.

The Notification Service is downstream of the change_log. It consumes via CDC (Debezium) or an outbox pattern. Notifications are not in the write path of the API; if notifications are down, writes still succeed and the push pile up.

| Component | Stateful? | Scaling story |
|-----------|-----------|---------------|
| API Gateway / LB | No | Horizontal. Sticky routing for WS by user_id hash, best-effort. |
| API Service (REST) | No | Horizontal pods; scales with QPS. |
| WebSocket Service | Yes (in-memory connections) | Horizontal; each pod holds 50k sockets. Pub/sub fans messages across pods. |
| Postgres | Yes (source of truth) | Primary plus read replicas; shard by list_id at very large scale. |
| Redis Pub/Sub | Yes (ephemeral) | One Redis for small scale; cluster mode for large; partition channels by hash(list_id). |
| Notification Service | No (consumes events) | Separate; consumes change_log via outbox or CDC. |

### 6. Core algorithms

#### 6.1 The change feed

Every write that mutates list state follows the same skeleton:

```python
def apply_op(list_id, actor_id, op_type, payload, client_op_id):
    with db.transaction():
        # 1. Idempotency check
        if client_op_id:
            existing = db.query_one("""
                SELECT seq FROM change_log
                WHERE list_id = %s AND client_op_id = %s
            """, list_id, client_op_id)
            if existing:
                return existing  # already applied; return original result

        # 2. Permission check (cached per (user, list))
        if not can(actor_id, list_id, action_for(op_type)):
            raise Forbidden()

        # 3. Get next seq for this list (SELECT FOR UPDATE on lists row)
        lst = db.query_one("""
            SELECT next_seq FROM lists WHERE list_id = %s FOR UPDATE
        """, list_id)
        seq = lst.next_seq
        db.execute("UPDATE lists SET next_seq = %s WHERE list_id = %s", seq + 1, list_id)

        # 4. Apply the op to list_items (or lists, or share_grants)
        apply_op_to_state(op_type, list_id, payload, seq)

        # 5. Append to change_log
        db.insert("change_log",
                  list_id=list_id, seq=seq, op=op_type, actor_id=actor_id,
                  payload=payload, client_op_id=client_op_id)

    # 6. After commit, publish to Redis
    redis.publish(f"list:{list_id}",
                  json.dumps({"seq": seq, "op": op_type, "payload": payload}))

    return {"seq": seq}
```

A few things are doing real work here.

The seq is assigned by the server, in a transaction, with a row-level lock on the `lists` row. This serializes ops on the same list. Ops on different lists are independent and parallelize.

The idempotency check is inside the transaction so concurrent retries with the same `client_op_id` collapse cleanly.

The Redis publish happens after commit. If you published inside the transaction and then rolled back, subscribers would see ops that never persisted. After commit you may get duplicate delivery if the publish retries, but that is fine because clients dedupe by seq.

Subscribers re-read state from Postgres if they need to. The Redis message carries the op so they usually do not, but the change_log is the source of truth.

#### 6.2 Real-time delivery

When a client opens the app it fetches the initial state over REST, opens a WebSocket, sends `subscribe` with per-list `since_seq`, and the server checks if anything happened between the REST read and the subscribe (it usually has not). From there, every new op on those lists is pushed.

Here is what a write looks like end to end, as a sequence:

```
  Client A      API Service    Postgres       Redis P/S     WS Pod 1    WS Pod 2   Client B   Client C
    │              │              │              │             │            │          │          │
    │ PATCH item   │              │              │             │            │          │          │
    ├─────────────►│              │              │             │            │          │          │
    │              │ BEGIN TX     │              │             │            │          │          │
    │              ├─────────────►│              │             │            │          │          │
    │              │ check idem   │              │             │            │          │          │
    │              │ check perm   │              │             │            │          │          │
    │              │ SELECT       │              │             │            │          │          │
    │              │  next_seq    │              │             │            │          │          │
    │              │  FOR UPDATE  │              │             │            │          │          │
    │              │ UPDATE       │              │             │            │          │          │
    │              │  next_seq    │              │             │            │          │          │
    │              │ UPDATE       │              │             │            │          │          │
    │              │  list_items  │              │             │            │          │          │
    │              │ INSERT       │              │             │            │          │          │
    │              │  change_log  │              │             │            │          │          │
    │              │ COMMIT       │              │             │            │          │          │
    │              │◄─────────────┤              │             │            │          │          │
    │              │                             │             │            │          │          │
    │              │ PUBLISH list:L              │             │            │          │          │
    │              ├────────────────────────────►│             │            │          │          │
    │ 200 OK {seq} │                             │             │            │          │          │
    │◄─────────────┤                             │             │            │          │          │
    │              │                             │             │            │          │          │
    │              │                             │ deliver to subscribers   │          │          │
    │              │                             ├────────────►│            │          │          │
    │              │                             ├────────────────────────► │          │          │
    │              │                             │             │            │          │          │
    │              │                             │             │ forward to local socks│          │
    │              │                             │             ├───────────────────────►          │
    │              │                             │             │            │          │          │
    │              │                             │             │            │ forward to local    │
    │              │                             │             │            ├──────────────────────►
    │              │                             │             │            │          │          │
    │ (already has │                             │             │            │          │ apply op │
    │  optimistic) │                             │             │            │          │ render   │
```

A few details worth pointing out:

The originating client gets the `200 OK` before the message hits Redis. It does not wait for fan-out. Its optimistic update is already on screen; the response just confirms the seq.

Every WS pod with a local subscriber for `list:L` receives the Redis message. Pods with no subscriber for that list ignore it. The pod that holds the originating socket sends an `ack` instead of the full op (the originator already knows).

Clients dedupe by seq. Every op has a unique `(list_id, seq)`. The client tracks the highest seq it has applied per list; ops with seq <= highest are ignored. This handles both duplicate delivery and out-of-order delivery across a reconnect.

End-to-end (Alice presses Enter, Bob's screen updates) is roughly 150 to 300ms in the same region.

#### 6.3 Conflict resolution

Last-write-wins by per-list seq.

```python
def apply_remote_op(local_state, op):
    if op.op == "edit_item":
        item = local_state.items.get(op.item_id)
        if item is None:
            return  # item was deleted locally; ignore (or refetch)
        if item.last_seq >= op.seq:
            return  # we have a newer op already; ignore
        item.title = op.payload.title
        item.last_seq = op.seq
    elif op.op == "delete_item":
        item = local_state.items.get(op.item_id)
        if item is None:
            return
        if item.last_seq >= op.seq:
            return
        item.deleted = True
        item.last_seq = op.seq
    elif op.op == "add_item":
        if op.item_id in local_state.items:
            return  # duplicate
        local_state.items[op.item_id] = Item(
            title=op.payload.title,
            order_key=op.payload.order_key,
            last_seq=op.seq
        )
    # ...
```

The full story for "Alice edits, Bob edits the same item":

1. Alice's client optimistically updates locally to "Buy oat milk."
2. Alice's request reaches server. Server assigns seq=512, persists, publishes.
3. Bob's client receives the op (seq=512), sees `item.last_seq` (from when the item was created at seq=400), updates locally to "Buy oat milk."
4. Bob, who was concurrently editing, submits his change "Buy almond milk."
5. Bob's client optimistically updates locally to "Buy almond milk."
6. Bob's request reaches server. Server assigns seq=513, persists, publishes.
7. Alice's client receives seq=513, sees `item.last_seq=512`, updates to "Buy almond milk."
8. Bob's client receives seq=513 (its own); `last_seq` is now 513; idempotent.

Final state across all clients: "Buy almond milk", last_seq=513. Bob's screen never flashed because his optimistic update was already the winner. Alice did see a flash: "Buy oat milk" then "Buy almond milk." For a todo list this is acceptable. For document editing it would not be.

Tombstones for deletes. When Alice deletes item I at seq=600, the row stays in the DB with `deleted_at = now()` and `last_seq=600`. The op is added to change_log. The op fans out. Clients with the item locally set their local copy to deleted.

If Bob, who was offline, edits the deleted item at his local time and syncs later, the server stamps his edit as seq=900. The server applies the edit: title is updated, but `deleted_at` is not touched. Bob's edit lives in change_log forever; on the next render the item is still hidden because `deleted_at IS NOT NULL`. If Alice undoes the delete (sets `deleted_at = NULL`), Bob's edit becomes visible.

Compacting the change_log. Keep the last 30 days of ops per list (configurable). Older ops are summarized into a "snapshot" record. Clients catching up from a `since_seq` older than 30 days are told "too far behind, fetch full state." This caps storage; the snapshot is just the current state of `list_items` at that point.

### 7. Read and write paths

Write path (add an item):

1. Client to API Gateway. Auth. Rate limit check (default: 100 writes/min per user).
2. API Service. Permission check (cached). Compute `item_id` (UUIDv7 from client) and `order_key` (from `before_id`/`after_id` hints).
3. Transaction: `SELECT next_seq FROM lists WHERE list_id = ? FOR UPDATE`. Bump seq. INSERT into `list_items`. INSERT into `change_log`.
4. Commit.
5. `redis.publish("list:{list_id}", op)`.
6. Return 201 with `{item_id, seq}`.

P99 target: 100ms. The bottleneck is the `FOR UPDATE` lock on the lists row, which serializes writes per list. At 10 writes/sec on the same list (rare), that is fine; at 1000 writes/sec on the same list (very rare for a todo list), you would need to revisit.

Read path (open a list):

1. Client to API Gateway. Auth.
2. API Service: permission check. Cache lookup for the list summary (Redis hash: `list:{list_id}:summary` to `{title, item_count, last_seq}`).
3. Cache miss: `SELECT * FROM lists WHERE list_id = ?`, `SELECT * FROM list_items WHERE list_id = ? AND deleted_at IS NULL ORDER BY order_key`. Populate cache with 5-min TTL.
4. Return JSON: list metadata, items, latest seq.
5. Client opens WS, subscribes with `since_seq = <latest seq from step 4>`. Server checks change_log; usually 0 ops to deliver (the read just happened).

P99 target: 50ms warm, 200ms cold.

Read path (dashboard, list of all my lists):

1. Client to API Gateway. Auth.
2. API Service: query share_grants for this user, join lists.
3. Cache lookup for each list's summary; batch the misses.
4. Return JSON array.

Cache: per-user dashboard cache with 30-second TTL, invalidated when any of the user's lists changes.

### 8. Scaling journey: 10 to 1M users

This is the section that demonstrates judgment. At each stage, name what just broke and what fixes it. Resist the urge to build stage-3 features at stage-1 scale.

**Stage 1: 10 to 100 users.** One Postgres (db.t3.small, 2GB RAM). One application server (~512MB RAM). No WebSocket. Client polls `GET /api/v1/lists/{list_id}?since_seq=X` every 10 seconds when the list is open. No Redis. Permission cache lives in app process memory. About $50/month total. You ship in a week.

This is enough because 100 users × 30 ops/day is 0.04 ops/sec. Postgres yawns. Polling at peak 20 users active, each every 10 sec, is 2 reads/sec. Latency: changes appear within 10 seconds; users do not complain because they are not in active back-and-forth editing. Building anything more is over-engineering.

**Stage 2: 1k to 10k users.** Something breaks: power users in actively-edited lists notice the 10-second polling lag. Polling cost is now 200 active users at one poll every 10 sec = 20 polls/sec. Mobile users keep the app open and burn battery.

What you add: a WebSocket service (separate process or separate port). On client connect, authenticate, then load the user's lists and subscribe the connection. Because there is still only one WS server process, the API service publishes to a local channel (a Go channel, a Node EventEmitter, a Python asyncio.Queue) that the WS service listens to. Long-poll fallback endpoint for clients that cannot use WebSocket. Per-user permission cache in Redis (added now because the app server is starting to need shared state), 60-second TTL on `(user, list) → role`. One read replica; reads of "list of my lists" and "list contents on initial load" go there.

What you do not yet build: multi-WS-pod (one pod handles 10k × 30% = 3k sockets easily), Redis pub/sub, DB sharding. About $150/month.

**Stage 3: 100k users.** Several things break at once. 30k concurrent WS connections at peak: one server cannot hold this comfortably (memory pressure, file descriptor limits, GC pauses). A popular list with 50 active editors: every write fans out to 50 sockets, split across multiple WS pods, and your in-process channel does not cross pods. The "list of my lists" dashboard query for power users (200+ lists) takes 800ms because every list does a row lookup. Permission revocation: when Alice revokes Bob, his WS keeps receiving updates for up to 60 seconds (cache TTL).

Fixes: 4 to 8 WS pods at 50k sockets each, with the LB routing by user_id hash. Redis pub/sub for fan-out, replacing the in-process channel. Every API write publishes to `list:{list_id}`; every WS pod subscribes to channels for lists its connections are watching. Dashboard denormalization: a `user_list_summaries` Redis hash per user, updated by a worker that consumes change_log events; dashboard load becomes one Redis HGETALL. Dedicated `perm:{user_id}` channel for revocation: API publishes, WS pods drop the affected subscriptions and send an `access_revoked` message. Multiple read replicas with 1-sec P99 lag SLO. Nightly change_log compaction archiving ops older than 30 days to S3 Parquet. Notification service consuming via CDC or outbox, batching per recipient over a 60-sec window.

About $2-4k/month.

**Stage 4: 1M users.** 200k concurrent WS at peak. Even with sharded pods, one Redis pub/sub instance is now publishing 1k+ messages/sec to thousands of subscribers and its CPU is getting hot. Single Postgres primary writing 1000 ops/sec is fine but you are nervous about write availability. Users in Europe complain about 200ms latency to US-east. Power users with the app open across 3 devices want their offline edits to merge cleanly when they reconnect after a 12-hour flight; LWW is starting to show its limits ("I made 30 changes on the plane and 5 of them got overwritten by my husband on the ground"). A celebrity todo list ("Daily affirmations") has 50k viewers subscribed; every edit fans out to 50k clients.

What you add: shard Postgres by list_id hash (16 shards to start). Each shard has its own primary and replicas. A separate `user_list_membership` table sharded by user_id denormalizes share_grants for fast dashboard lookup. Regional WS clusters: each region has its own WS pods and its own Redis pub/sub; writes on a list in us-east are published to us-east's Redis and forwarded to other regions via a cross-region replication bridge. Partition Redis pub/sub by `hash(list_id)`: run Redis in cluster mode. CRDT for offline-first item titles (Yjs or YATA), only for the title field; the rest of the system stays LWW. Hot-list edge tier: popular lists routed to specialized broadcast pods optimized for fan-out. Outbox pattern for cross-region: every write to change_log also writes to an `outbox` table; a worker forwards and deletes on success.

About $20-50k/month depending on region count.

The architecture has not fundamentally changed since stage 3. You added regions, sharding, and CRDT for the offline-heavy users, but the core data model is the same one you wrote at stage 1.

What you would do at 10M DAU: by then your todo list app is in the top 50 globally. Work shifts from "scale the system" to "operate the system." A dedicated team per shard. Adopt a managed real-time delivery product (Ably, Pusher, AWS IoT) unless cost analysis favors in-house. CRDT as the default model for item-level state. Active-active multi-region DB (Spanner, CockroachDB). Dedicated abuse and spam pipeline.

The point of the journey: each stage's complexity is driven by a real bottleneck, not anticipated load. Build WebSocket at stage 2 because polling burns battery; do not build it at stage 1 just because "real-time is cool."

### 9. Reliability

Postgres primary fails. Promote a replica. Writes are unavailable for 30 to 60 seconds. During the outage, the API service returns 503 with `Retry-After: 30`. The WS service keeps connections open and serves cached read state; clients see "saving..." banners.

Redis pub/sub node fails. Subscribers reconnect to the new node. During the gap (5 to 10 seconds), no messages are delivered. On reconnect, clients use the WS catch-up protocol: send `since_seq` from their last known state and the server replays missed ops from change_log. No ops are lost; Postgres is the source of truth, Redis is just the delivery channel.

WS pod crashes. All connections on that pod die. Clients reconnect with exponential backoff; the LB routes them to a healthy pod. On reconnect, the catch-up flow delivers any missed ops. Worst case for a user: a 5-second visible disconnect.

Network partition splits a region. If the affected region's Postgres replicas cannot reach the primary, reads continue from local replicas (slightly stale). Writes fail. Cross-region delivery to that region pauses; on recovery, the outbox worker drains the backlog.

Bad release of the WS service drops connections. Use connection draining: on shutdown, the WS pod sends a "reconnect" message to each socket and waits 10 seconds. Clients reconnect to a sibling pod. Rolling deploys with 10-second drain windows cause no user-visible disruption.

A buggy client sends 10k ops/sec. Rate limiter per user per minute (default 100). Sustained abuse triggers a per-user circuit breaker that returns 429 for 5 minutes. Server-side log indicates which user; an alert fires.

Pub/sub message loss. Redis pub/sub is fire-and-forget. If a subscriber misses a message, it is gone. Clients dedupe by seq, and any gap detection (seq jumps from 412 to 415) triggers a catch-up REST call. The change_log is the recovery path.

### 10. Observability

| Metric | Why it matters |
|--------|----------------|
| `ops.applied.rate` | Steady-state write throughput. Sudden spike = abuse or buggy client. |
| `ws.connections.current` | Per-pod count. Pods nearing 50k need a scale-out. |
| `ws.message.fanout.p99` | From op committed to last subscriber receiving. SLO: <500ms regionally. |
| `ws.disconnect.rate` | Spike: a deploy went bad, or a network event, or NAT timeouts. |
| `pubsub.subscriber.count` per channel | Tail: which lists have many subscribers. Hot-list detection. |
| `lock.wait.p99` on `lists.next_seq` | If high, a list is being concurrently written by many users. |
| `dashboard.cache.hit_rate` | Should be >90%. Drops mean the cache or invalidation is broken. |
| `change_log.catchup.bytes` p99 | If clients are downloading >10k of catch-up, they were offline a long time. |
| `perm.revocation.propagation` p99 | From revoke API call to all WS pods removing access. SLO: <2 sec. |
| `db.replication_lag` p99 | If >2 sec, reads see stale state. |

Page on: WS message fanout p99 > 2 sec for 5 min, write error rate > 2%, pub/sub subscriber pile-up on any channel. File a ticket on: dashboard cache hit rate < 70%, perm revocation latency > 5 sec, one list with > 5k subscribers (unusual for a todo list).

### 11. Gotchas the senior interviewer is listening for

These are what separate a thoughtful design from a generic CRUD answer.

Offline edits sync conflicts. Alice edits 30 items on a plane. She lands and reconnects. Her client replays 30 ops. Each gets a new seq. If Bob edited 5 of those items while Alice was offline, Bob's edits had seqs lower than Alice's late-arriving seqs, and Alice's wins by LWW. This is the user-visible "my husband's edits got overwritten" complaint. Mitigations: CRDT for the title field on high-conflict items, conflict resolution UI ("5 items were edited by Bob while you were offline. Your version: X. Bob's: Y. Pick one."), and a hidden "version history" view recoverable from change_log.

Deleted items returning from the dead. Alice deletes item I. Bob, offline, edited the title. Bob syncs, his edit is applied. The item stays hidden because `deleted_at IS NOT NULL`. Good. But if Alice un-deletes, Bob's edited title appears. Usually fine, but if some race in setting `deleted_at` causes resurrection, it confuses users. Fix: explicitly version the deletion state. A delete op has its own seq. An un-delete op has its own seq. Visible state is determined by walking ops in seq order; latest wins.

Permission revocation while user is connected. Bob has the list open. Alice revokes Bob. Bob keeps seeing updates for up to 60 sec (perm cache TTL). Fix: dedicated `perm:{user_id}` Redis channel. On revoke, API publishes; every WS pod subscribes. The pod holding Bob's connection immediately closes his subscription to the list's channel and sends `{"type": "access_revoked"}`. Bob's client closes the list view. If Bob has the list cached locally on his device, he can still see the data offline. Once data has been delivered to a device, it cannot be recalled. Worth saying out loud in the interview.

Item ordering with concurrent reorders. Two users drag the same item to different positions. If you store order as integer indexes (`item.position = 5`), every reorder renumbers all subsequent items, and concurrent reorders race horribly. Fix: fractional indexing (LexoRank). Each item has an `order_key` like "a3", "aB", "b1". To insert between "a3" and "aB", pick a key lexicographically between them ("a7"). Concurrent reorders produce different keys; the order may not be exactly what either user intended, but it is deterministic and stable.

Seq number gaps after rollback. A transaction starts, gets seq=512 from `next_seq`, then fails before commit. The transaction rolls back; `next_seq` is back to 512. If the transaction was reading uncommitted state from another in-flight transaction, you might get gap or duplicate seqs. Fix: `SELECT next_seq FROM lists WHERE list_id = ? FOR UPDATE`. The row lock serializes seq generation per list. Postgres default isolation (READ COMMITTED) with row locking is sufficient. SERIALIZABLE is overkill and slower.

WS connection storms after a deploy. You deploy a new WS pod version. All connections drop, all clients reconnect within 30 seconds, overwhelming the remaining pods. Fix: rolling deploys with connection draining. Drain one pod at a time: send each socket a "reconnect please" message, wait 10 sec, kill the pod. Clients reconnect smoothly. Total deploy time is longer but no thundering herd.

Idempotency without client cooperation. If the client does not send `client_op_id`, the server cannot dedupe retries. A flaky network where the client retries on timeout creates duplicate items. Fix: require `client_op_id` on writes. Reject requests without it (after a deprecation window). Modern mobile SDKs handle this transparently.

List of lists query, avoiding N+1. `SELECT * FROM share_grants WHERE grantee_id = ?` returns 50 grants. Then 50 `SELECT * FROM lists WHERE list_id IN (...)`. Easy mistake: 50 separate `SELECT` calls if you naively loop. Use a single `IN` query or a join.

The "shared with me" privacy leak. Bob is on Alice's list and can see other members' names and emails by default. Some users want to be private. Add a "show as anonymous" toggle that displays "Anonymous editor" instead of email.

### 12. Follow-up answers

**1. Reconnect after a long disconnect.** Bob's client knows `since_seq = 412` for list L. On reconnect:

```
GET /api/v1/lists/L/changes?since_seq=412
→ {"ops": [{"seq": 413, ...}, ...], "has_more": false}
```

If `412` is older than the compaction window (e.g., older than 30 days), the change_log entries are gone:

```
→ {"too_far_behind": true, "current_seq": 9001}
```

The client responds by doing `GET /api/v1/lists/L` to refetch full state and subscribes from `since_seq = 9001`. Cap on a single response: 500 ops. If there are more, the response has `has_more: true` and the client paginates with `since_seq = last_seq_received`. This prevents a single user with 100k missed ops from blocking the WS server.

**2. Presence.** Avoid writing to the database for presence. Presence is ephemeral state. Each WS pod maintains in-memory `presence[list_id] = set(user_ids currently subscribed)`. When a connection subscribes to a list, add user_id to the set on that pod and publish `{"type": "presence_join", "list_id": L, "user_id": U}` to a `presence:{list_id}` Redis channel. When a connection unsubscribes or dies, publish `presence_leave`.

Every WS pod subscribed to `presence:{list_id}` maintains a merged set in memory. Clients receive `presence_update` events. Stale entries are pruned by a heartbeat: each pod re-emits its local presence every 30 sec; entries not heard from in 90 sec are dropped. Database: not touched. If all WS pods crash simultaneously, presence resets correctly when clients reconnect.

**3. Permission revoked while connected.** (Covered above.) Sequence: Alice calls `DELETE /api/v1/lists/L/shares/{bob_grant_id}`. API updates `share_grants.revoked_at = NOW()` and invalidates perm cache for `(bob, L)`. API publishes to `perm:{bob_user_id}` Redis channel: `{"revoked_lists": [L]}`. Every WS pod subscribed to that channel checks if it has any of Bob's connections. The one that does unsubscribes Bob's connection from `list:{L}` and sends `{"type": "access_revoked", "list_id": L}` over the WS. Bob's client redirects to dashboard with a banner. End-to-end latency: <2 seconds, dominated by Redis publish/subscribe propagation. If Bob's device has the list cached locally, the client should clear local state on `access_revoked`. Client-side defense only; the server cannot enforce it.

**4. Item ordering.** Fractional indexing (LexoRank). Initial items: keys "n", "v" (spread the namespace). To insert between "n" and "v": pick "r". To insert between "n" and "r": pick "o". After many inserts in the same gap, keys grow longer ("noooo7"). After very many, rebalance: a background job renumbers a list's items with evenly-spread keys.

Concurrent reorders: Alice moves item X between A and B; Bob moves item X between C and D simultaneously. Each generates an op with a different `order_key`. The seq number determines who wins: the later seq's `order_key` is what sticks. Item X ends up in one of the two positions, not split across both. Acceptable for a todo list. Edge case: two ops generate the same key (very rare). Server uses `(order_key, item_id)` as the sort tuple to break ties.

**5. Notifications.** A separate Notification Service consumes change_log events via CDC (Debezium to Kafka) or an outbox pattern (an `outbox` table written in the same transaction as change_log). The notification service receives events, looks up subscribers of the list (from `share_grants`), and for each subscriber other than the actor adds to a per-recipient bucket keyed by `(recipient, list_id)`. Buckets flush on a timer: 60 seconds after the first event in the bucket, send a digest notification.

Digest text: "Alice added 3 items and checked off 1 in 'Grocery list'."

Why batched: a user editing actively triggers many ops in a short window. Without batching, the recipient gets 30 push notifications in 5 minutes.

User preferences per user per list. Defaults: in-app and push for direct lists, daily digest for high-traffic lists. Stored in a `notification_prefs` table; the notification service reads on every send (cached for 5 min).

**6. Search.** For small scale (<1M items per user): `SELECT * FROM list_items WHERE list_id IN (lists_user_can_access) AND title ILIKE '%milk%' AND deleted_at IS NULL LIMIT 50`. With a trigram index (`CREATE INDEX... USING gin (title gin_trgm_ops)`), this is fast enough.

For large scale: pipe items into Elasticsearch. Index per user (or per tenant). The search query hits ES with permission scoping (`list_id IN [...]`). ES returns matches; the API service rehydrates from Postgres.

Permission scoping is the hard part: a user's accessible lists change in real-time. Option 1: pre-compute the user's accessible `list_ids` and pass them as a filter to ES. Works for users with <1000 accessible lists. Option 2: ES stores `(item, [accessible_user_ids])`; queries filter by user_id. Heavy storage, simple query.

**7. Undo.** Bob deletes item I. Op recorded at seq=600. Bob hits Cmd-Z within 5 seconds. The client sends a `revert` op referencing the original:

```
POST /api/v1/lists/{list_id}/ops/revert
{"target_seq": 600, "client_op_id": "..."}
```

Server checks: the target op exists, the requester is the original actor (cannot undo someone else's op), the target op is recent (within 30 seconds). If all true, generate a compensating op (seq=601, op=`undelete_item`, payload references item I).

If other clients already saw the delete and updated locally, they receive the undelete op (seq=601) and locally restore the item. Brief flash; acceptable. If the time window passed (>30 sec): no undo available; Bob has to recreate the item manually.

**8. Sticky routing fails.** Without sticky routing, Bob's reconnect lands on a different WS pod. The new pod does not know which lists Bob was subscribed to. Fix: Bob's client re-sends the `subscribe` message on reconnect with the full list of `list_ids` and per-list `since_seq`. The new pod authenticates, subscribes to the relevant Redis channels, and replays catch-up ops. No state needs to transfer between pods. Sticky routing is an optimization (warm cache, lower setup cost), not a correctness requirement. The system works correctly without it; performance is slightly worse on reconnect (one extra round trip for re-subscribe).

**9. A list with 50k subscribers.** 50k subscribers means every edit fans out to 50k WS sockets. Across N WS pods (say 8), each pod has ~6k subscribers and sends 6k messages per write.

What breaks first: outbound bandwidth on the WS pod. A 500-byte message × 6k subscribers = 3MB per write per pod. At 1 write/sec on the popular list, that is 3MB/sec per pod, manageable. At 10 writes/sec, 30MB/sec per pod, getting tight.

Mitigations: compact payloads (op deltas, not full item objects, 100 bytes per op instead of 500). Coalesce: if two writes happen within 100ms, send a single combined op. Dedicated "broadcast" pod tier: the popular list's subscribers are routed to specialized pods optimized for fan-out (higher network bandwidth, tuned kernel). Edge delivery: for read-mostly popular lists, deliver via CDN-style push rather than per-user unicast.

For a todo list this scenario is rare; you might cap subscribers per list (max 100) and route popular content to a separate broadcast product.

**10. Privacy: hiding identity.** Add a per-list `display_preferences` field per share_grant: `{"display_as": "anonymous" | "display_name" | "email"}`. The dashboard and member list respect this. When Alice opens the list, she sees "Anonymous editor" for users who chose to be anonymous; her own choice does not apply to her own view of herself.

For audit purposes: the server's change_log always stores the real `actor_id`. The client API filters the visible name based on display preferences. A determined attacker with API access still sees the real actor; a normal collaborator does not. For stricter privacy, the server can refuse to return actor_id and only return display name, but this breaks features like "Alice's most-edited list."

The deeper question is whether email visibility is a problem. Most products show the email of collaborators (Google Docs, Notion). Some (Figma, Slack) show only display names. Pick a default and let users opt-in to more visibility if needed.

### 13. Trade-offs worth saying out loud

**LWW vs OT vs CRDT.** LWW: simple, works for item-level edits, has the offline-conflict problem. OT: optimal for character-level co-editing; complex implementation; overkill for todo lists. CRDT: handles offline-first cleanly; metadata overhead per op; harder to debug. For a todo list: LWW until offline editing becomes a major feature request, then CRDT for the title field (and only the title field). The rest stays LWW.

**WebSocket vs polling at small scale.** At 100 users, polling every 10 seconds is cheaper to build and operate than WebSocket. The latency is worse but acceptable. Build WebSocket when polling cost (battery, server) outweighs the build cost. Most teams build WebSocket too early.

**Postgres vs DynamoDB vs Cassandra.** Postgres wins until you cannot fit the data on one box (~1TB-ish). Then shard by list_id, still on Postgres. DynamoDB is attractive at scale (managed, scales horizontally) but the data model fits Postgres naturally: relational join between lists and share_grants, transactional seq generation, partial indexes for soft delete. DynamoDB forces you to denormalize all of these.

**Redis pub/sub vs Kafka for fan-out.** Redis pub/sub: fast, simple, fire-and-forget. Best for transient delivery where loss is acceptable (because the source of truth is in Postgres and clients catch up on reconnect). Kafka: durable, replayable, slower than Redis. Best when you need a guaranteed-delivery log (notifications, analytics). In our design: Redis pub/sub for live WS fan-out, Kafka (via outbox or CDC) for notifications and analytics. Two systems, each picked for its strengths.

**Per-list seq vs global seq.** Per-list seq: simpler, no global coordinator, ops on different lists parallelize. Loses cross-list ordering. Global seq: requires a global counter, becomes the bottleneck under high write load, gives total ordering across all lists. For a todo list, per-list seq is the right answer. Cross-list ordering is rarely needed.

**What I would revisit at 10x scale.** Move WS to a managed product (Ably, Pusher) or a Yjs-based collaborative editing infrastructure. Adopt CRDT as the default for item-level state. Multi-region active-active DB. Dedicated abuse / safety pipeline.

### 14. Common interview mistakes

1. Diving into "use WebSocket and a database." No clarifying questions, no math, no permission model. Loses you immediately.

2. Treating real-time as binary. "We need real-time so WebSocket." No. Define what real-time means. 10-second polling is real-time for a todo list at small scale.

3. No change log. A junior design has `list_items` with `updated_at`. A senior design has an append-only log of ops. The log powers real-time delivery, reconnect, undo, audit, and conflict resolution. Without it, every one of those features is a separate hack.

4. Hard delete instead of tombstone. Hard delete means a deleted item that an offline client tries to edit later returns 404 silently. Tombstone (`deleted_at`) makes the deletion an event that propagates and can be undone.

5. Ignoring offline. Most candidates assume the client is always connected. The interviewer almost always asks "what if Alice was offline." Have an answer.

6. Permission check on the client only. "The client knows the user is a viewer so it greys out the edit button." Server must enforce. Always. The client is hostile.

7. No idempotency on writes. Mobile networks retry. Without `client_op_id`, retries create duplicate items. Famous mobile-app failure mode.

8. Designing fan-out as "broadcast to all clients." Without pub/sub, every WS pod has to know about every write. Pub/sub channels per list_id is the standard pattern; mention it explicitly.

9. Putting the conflict resolution decision in the database. "We will use Postgres advisory locks to serialize edits." That works for one list but does not scale and does not handle offline edits. The right answer is op-based: the op order (by seq) is the truth.

10. Treating presence as a database problem. Writing "user X is online" to Postgres every 30 seconds for 200k users melts the DB. Presence is ephemeral and belongs in memory or Redis, not durable storage.

If you can hit 7 of these 10, you are interviewing well. The change_log plus tombstones plus idempotency trio is what separates a thoughtful design from a generic CRUD answer.
{% endraw %}
