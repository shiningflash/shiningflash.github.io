---
layout: practice-problem
track: system-design
problem_id: 20
title: Design a File Upload & Share Service (Dropbox-lite)
slug: 020-file-upload-share
category: Storage
difficulty: Easy
topics: [chunked upload, share links, permissions, storage tiers, virus scan]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/020-file-upload-share"
solution_lang: markdown
---

{% raw %}
## The scene

You sit down for the interview. The interviewer writes one line on the whiteboard.

> *"Build a smaller version of Dropbox. Users upload files up to 5 GB. They share files with other users by invite or by link. They set permissions: view, download, or edit. Storage and bandwidth cost money, so do not waste either."*

Then they say: *"Start with a weekend project for 10 users. Walk me up to 1 million users. At each step, tell me what just broke and what you would add to fix it."*

It looks like a CRUD app sitting on top of S3. It is not. Here are the parts that get hard:

- A 4 GB upload over hotel WiFi. The connection drops at 80%. What happens?
- You share a link with one friend. A month later you revoke that one link. The other 999 links you created should still work.
- Fifty people upload the same 200 MB software installer. Do you store it 50 times?
- A file nobody has touched in two years. Do you keep paying full price to store it?

A candidate who jumps to *"POST the file to S3, write a row in Postgres"* misses about 60% of the depth. We will walk through it step by step.

A few terms before we start, so nothing trips you up:

- **S3.** Amazon's object storage. You put a file in, you get a URL back. Cheap, durable, huge.
- **Presigned URL.** A URL the server signs that lets the client upload directly to S3 without going through your server. The signature has an expiry. After it expires, the URL stops working.
- **TUS.** A standard protocol for resumable uploads. If your upload fails halfway, you continue from where it stopped instead of starting over.
- **S3 multipart upload.** S3's own way to upload a big file in chunks. You start a session, upload chunks, then call "finalize" and S3 stitches them together.
- **CDN.** Content Delivery Network. A worldwide cache that sits in front of your storage. The first download fetches from S3. The next 1000 downloads come from a cache close to the user.
- **Content hash.** A short fingerprint of a file's bytes (we use SHA-256). Two files with the same bytes have the same hash. Two different files have different hashes.

---

## Step 1: Ask the right questions

Before you draw a single box, sit for five minutes. Write down questions that would change the design if the answer was different.

A good answer is not "20 questions about every detail." It is the small handful of questions that change the design depending on the answer.

<details markdown="1">
<summary><b>Show: 8 questions that matter</b></summary>

1. **What is the biggest file size?** 5 GB was in the brief, but is that a hard cap? Anything above ~100 MB rules out a single HTTP POST. You have to use chunked upload.

2. **Sync or share-only?** Is this Dropbox-the-desktop-app (your local folder stays in sync with the cloud), or Google-Drive-the-web-page (you upload, you share)? Sync is a different problem: delta sync, conflict resolution, file watchers. Share-only is much smaller. In an interview, the answer is almost always share-only.

3. **Do we scan for viruses?** And if yes, do we block the upload until the scan finishes, or scan after the file is already saved? Sync scanning is slow. Async scanning means a file is downloadable for a couple of minutes before it might be flagged.

4. **Versioning?** When a user edits a file, do we keep the old version? How many versions? A reasonable default is "keep 10 versions or 30 days, whichever is shorter."

5. **Quotas?** Each user gets X GB? What happens when they hit the limit? Quota has a sneaky race condition we will come back to.

6. **What kinds of sharing?** Direct invite (owner enters someone's email), link share (owner makes a URL anyone can open), or both? What permissions: view, download, edit?

7. **Compliance?** GDPR delete? Customer-managed encryption keys for healthcare or finance? These change the storage layer.

8. **What is NOT in this design?** Real-time co-editing (like Google Docs)? Full-text search inside PDFs? Third-party integrations? Out of scope. They are separate products that sit on top.

A strong candidate also names what is out: real-time editing, search inside documents, integrations. Those are downstream products. Not part of the storage core.

</details>

---

## Step 2: How big is this thing?

Same problem, two scales. Do the math before you design.

**Weekend project (10,000 users):**

- 10,000 users
- 5 uploads per user per week
- ~5 MB average file
- Downloads run about 10x writes

**Dropbox-scale (100M users):**

- 100M active users
- 20 uploads per user per week
- ~8 MB average (photos, docs, some videos)
- Downloads run about 10x writes
- Files kept forever by default

Work out: uploads per second, downloads per second, storage growth per year, and how much storage goes cold (not touched in 90 days) by year two.

<details markdown="1">
<summary><b>Show: the math</b></summary>

**Weekend project (10k users):**

- Uploads: 10,000 x 5 = 50,000 per week = ~7,000/day = **~0.08/sec sustained, ~0.25/sec at peak**. Tiny.
- Downloads at 10x: **~0.8/sec sustained**.
- Storage: 50,000/week x 5 MB = ~13 TB/year.
- Egress at peak: ~100 Mbps.
- Cold tail by year 2: maybe 60-70% of files untouched.

One server. One Postgres. One S3 bucket. Done. The throughput is boring. What is interesting is the UX for a 5 GB upload and the share-link permission model.

**Dropbox-scale (100M users):**

- Uploads: 100M x 20 = 2B per week = **~3,300/sec sustained, ~10,000/sec at peak**.
- Downloads at 10x: **~33,000/sec sustained, ~100,000/sec at peak**.
- Storage growth: 286M/day x 8 MB = ~2.3 PB/day = **~840 PB/year raw**. With ~30% dedup savings: **~580 PB/year**.
- Egress at peak: 100,000 x 8 MB = 800 GB/s = **~6.4 Tbps**. You cannot serve this from one region without a CDN.
- Cold tail by year 2: ~70-80% of stored bytes untouched 90+ days.

What the math is telling you:

The system is **read-heavy by request count** but **write-heavy by bytes**. Lots of small reads. Big upload bytes.

**Storage cost is the headline expense.** 840 PB/year at $0.023/GB/month for S3 Standard is roughly $230M/year just for raw storage. Lifecycle policies (tier down to cheaper storage) and dedup (do not store duplicates) are not optional optimizations. They are survival.

> Why uploads through your server kill you. A 10 Gbps network card handles maybe 1.25 GB/s. That is around 150 concurrent 8 MB uploads per second. You run out of network capacity long before you run out of CPU. Now multiply by 10,000 concurrent uploads at peak. You would need 70 servers just to forward bytes. Presigned URLs let the client upload directly to S3. Your servers never touch the bytes. That single decision saves you an order of magnitude on the bandwidth bill.

The metadata DB is tiny next to the bytes. 100B file rows at ~500 bytes each is ~50 TB. Sharded Postgres handles it. The bytes go to S3. The database holds the index.

</details>

---

## Step 3: How do the bytes get from the client to your storage?

This is the biggest single decision in the design. Three serious options. Pick wrong here and the system melts at scale.

Spend ten minutes. Write down the pros and cons of each before peeking.

**A. Direct upload (one big POST).** Client streams the whole file in one HTTP POST to your server. Your server forwards to S3.

**B. Chunked resumable upload (TUS protocol, or S3 multipart).** Client splits the file into pieces (5 to 100 MB each). Uploads each piece in its own request. Retries failed pieces.

**C. Presigned S3 URL.** Your server gives the client a short-lived signed URL. The client uploads directly to S3. Your server never sees the bytes.

<details markdown="1">
<summary><b>Show: how each one stacks up</b></summary>

| Approach | How it works | Pros | Cons |
|----------|--------------|------|------|
| **Direct (one POST)** | Client does one big `POST /upload`. Server buffers or streams the bytes to S3. | Simple. One request. Works in any HTTP client. | Any network blip restarts the whole upload. A 4 GB file on hotel WiFi never finishes. Your server's network card is the bottleneck. Hard to show real progress. |
| **Chunked resumable (TUS, S3 multipart)** | Init session. Upload chunk 1, chunk 2, ..., chunk N. Failed chunks retry on their own. Call finalize. | Survives flaky networks. Real progress bars. Parallel chunks speed up big files. Pause and resume work. | More complex. Server tracks which chunks landed. Abandoned uploads need cleanup. |
| **Presigned S3 URL** | `POST /upload/init` returns a presigned URL. Client `PUT`s directly to S3. Client calls `POST /upload/finalize`. | Zero bandwidth through your servers. Cheapest at scale. S3 does the heavy lifting. | Client speaks S3 directly. Harder to enforce quota (you did not see the bytes). Virus scan happens after the upload. |

**The right answer is hybrid.** Pick based on file size:

- **Under 5 MB.** Single POST through your server. Simpler client. Worth the small bandwidth cost.
- **5 MB to 5 GB.** Presigned S3 multipart. Client splits into 8 MB chunks. Each chunk gets its own presigned URL. Chunks upload in parallel directly to S3. Client calls finalize.
- **Over 5 GB.** Same as above, but with bigger chunks (64 MB) and explicit server-side caps.

> Why this matters. A 1 GB upload uses about 125 chunks at 8 MB each. If chunk 87 fails because of a momentary network blip, you retry just chunk 87. You do not start over from chunk 1. The user sees a progress bar that actually progresses. That is the difference between a happy user and a 1-star review.

Why bring up TUS at all? TUS is an open protocol for resumable uploads. Useful if your storage is not S3 (some shops use MinIO, NetApp, or their own object store) and you want a standard client library. If you are on AWS, S3 multipart is more native. TUS is for the "not on S3" case.

Here is what the hybrid chunked upload looks like as a sequence:

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant S3 as S3

    C->>S: POST /uploads/init {size, hash}
    S->>S: check dedup, check quota
    S->>S3: create multipart upload
    S3-->>S: s3_upload_id
    S->>S: generate presigned URL per chunk
    S-->>C: 201 {upload_id, chunk_size, urls[]}

    par chunk 1
        C->>S3: PUT chunk 1 (presigned URL)
        S3-->>C: ETag 1
    and chunk 2
        C->>S3: PUT chunk 2 (presigned URL)
        S3-->>C: ETag 2
    and chunk 3
        C->>S3: PUT chunk 3 (presigned URL)
        S3-->>C: ETag 3
    end

    C->>S: POST /uploads/{id}/finalize {parts: ETags}
    S->>S3: complete multipart upload
    S3-->>S: final S3 key
    S->>S: insert file row, queue virus scan
    S-->>C: 200 {file_id, status: "scanning"}
```

</details>

---

## Step 4: Draw the system

You know how the bytes move. Now draw the boxes.

Try to fill in the five `[ ? ]` boxes. Each one is one of: upload service, object store (S3), metadata DB, share link resolver, virus scanner.

```
              Client (browser, mobile, desktop)
                          |
                          v
                +------------------+
                |  API Gateway     |  auth, rate limit
                +--------+---------+
                         |
        upload init,     |     download,
        finalize, list   |     share link redeem
                         |
            +------------+------------+
            |                         |
            v                         v
     +-------------+           +-------------+
     |  [ ? ]      |           |  [ ? ]      |  resolves /share/<token>
     |             |           |             |  to a file + permission
     +-----+-------+           +------+------+
           |                          |
           |   presigned URLs         |
           v                          v
     +-------------------------------------+
     |  [ ? ]                              |  bytes live here.
     |                                     |  cheap, durable, huge.
     +-------------------------------------+
            ^
            |
     +------+--------+
     |  [ ? ]        |  file_id, owner, name,
     |               |  size, hash, status
     +---------------+

     Background pipeline:
     +-----------------+
     |  [ ? ]          |  scans the file after upload
     +-----------------+
```

<details markdown="1">
<summary><b>Show: the full architecture</b></summary>

```
              Client (browser, mobile, desktop)
                          |
                          v
                +------------------+
                |  API Gateway     |  auth, rate limit, WAF
                +--------+---------+
                         |
        upload init,     |     download,
        finalize, list   |     share link redeem
                         |
            +------------+------------+
            |                         |
            v                         v
     +-----------------+        +------------------+
     | Upload Service  |        | Share Link       |
     | mints           |        | Resolver         |
     | presigned URLs, |        | token -> file +  |
     | tracks upload   |        | permission.      |
     | sessions        |        | checks expiry,   |
     |                 |        | password         |
     +-----+-----------+        +------+-----------+
           |                           |
           | presigned PUT URLs        | signed GET URLs
           v                           v (via CloudFront)
     +--------------------------------------+
     | Object Store (S3)                    |
     | layout:                              |
     |   /raw/<hash>          (deduped)     |
     |   /chunks/<upload_id>/<n> (in-flight)|
     | lifecycle:                           |
     |   90d -> S3 IA (cheaper)             |
     |   365d -> Glacier (cheapest)         |
     +--------------------------------------+
            ^
            | metadata reads + writes
            |
     +------+------------+
     | Metadata DB        |   files, file_versions,
     | (Postgres,         |   blobs (dedup),
     |  sharded by        |   shares, share_links,
     |  owner_id)         |   upload_sessions, audit
     +-------+-----------+
             |
             | events (CDC / outbox)
             v
     +-------------------+
     |  SQS / Kafka      |  topics: file.finalized,
     |                   |  file.deleted, share.created
     +---+---------+-----+
         |         |
         v         v
     +--------+ +------------------+
     | Virus  | | Lifecycle        |
     | Scan   | | Manager          |
     | Worker | | (refcounts, cold |
     | (Clam  | | tier transitions,|
     | AV)    | | abandoned uploads)|
     +--------+ +------------------+

     CDN for downloads:
     +-------------------+
     | CloudFront        |  edge cache.
     | in front of S3    |  short TTL so
     |                   |  revokes propagate.
     +-------------------+
```

What each piece does, in one line:

- **API Gateway + WAF.** First line of defense. Authentication. Rate limits (no client uploads 10,000 files per minute). Blocks obvious bad requests.
- **Upload Service.** Owns the upload session lifecycle. Mints presigned URLs. Tracks "you uploaded chunks 1, 3, 5, you still need 2, 4." Checks quota at init. Never touches bytes.
- **Share Link Resolver.** Its own service so it scales independently. The hot path for every shared file. Looks up the token, checks expiry and password, returns a permission.
- **Object Store (S3).** Source of truth for bytes. One bucket per environment. The key layout makes dedup and lifecycle easy.
- **Metadata DB (Postgres).** Source of truth for everything that is not bytes. Sharded by owner because almost every query is "show me my files."
- **Virus Scan Worker.** Decoupled from upload. Files are downloadable as soon as finalized. If the scan flags them later, status flips to quarantined and downloads return an error.
- **Lifecycle Manager.** Moves files from hot to cold storage as they age. Cleans up abandoned uploads. Garbage collects unused deduped blobs.
- **CloudFront (CDN).** What keeps egress affordable. Without it you pay full S3 egress every download. With it, the second download of a shared file comes from the edge cache at a fraction of the cost.

</details>

---

## Step 5: Share links and permissions

Sharing has two flavors and three permission scopes.

**Two flavors:**

- **Direct invite.** Owner enters someone's email. That user must have an account. The file shows up in their "shared with me" tab.
- **Share link.** Owner generates a URL. Anyone with the URL gets in. Account may or may not be required.

**Three permission scopes:**

- **View.** Preview only. No download button. (Determined users can still grab bytes. Treat as a soft control, not a security boundary.)
- **Download.** Can fetch the original file.
- **Edit.** Can upload a new version.

Now think through these:

- What does the data model look like?
- How do you expire a link?
- How do you password-protect one?
- How do you stop attackers from guessing tokens?
- What happens when someone clicks a share link?

<details markdown="1">
<summary><b>Show: how share links work end to end</b></summary>

**Token generation.**

```python
import secrets
token = base62(secrets.token_bytes(24))   # 24 bytes = 192 bits
```

192 bits is enormous. The chance of a collision (two random tokens being equal) is negligible until you have around 2^96 tokens. You will never collide. Just as important: the keyspace is too big for an attacker to guess by brute force.

> Why a random token and not a hash of `(file_id, salt)`? A hash is deterministic. If someone learns the salt, they can compute every token. A pure random token has no relationship to the file it unlocks. Leaking the algorithm leaks nothing.

**The resolution flow** for `GET /share/<token>` looks like this:

```mermaid
sequenceDiagram
    participant C as Client
    participant SLR as Share Link Resolver
    participant DB as Metadata DB
    participant CF as CloudFront

    C->>SLR: GET /share/<token>
    SLR->>DB: look up token
    DB-->>SLR: link record

    alt token not found
        SLR-->>C: 404 Not Found
    else token revoked
        SLR-->>C: 410 Gone
    else token expired
        SLR-->>C: 410 Gone
    else password required, none given
        SLR-->>C: 401 Unauthorized
    else all checks pass
        SLR->>SLR: generate signed CloudFront URL (15 min)
        SLR->>DB: increment redemptions counter
        SLR-->>C: 302 redirect to signed URL
        C->>CF: GET <signed URL>
        CF-->>C: file bytes (from cache or S3)
    end
```

**Why the 15-minute signed URL matters.** If the share link itself was the only credential, then a view-only share leaks the file the moment someone right-clicks "save target as." Force every download through a *fresh* signed URL each time. Short expiry. View-only shares mint URLs scoped to the preview renderer only, not the raw file.

**Password protection.** Hash the password with Argon2 or bcrypt when the link is created. Verify on redeem. Never put the password in the URL.

**Rate limit per token.** A single token getting 1000 redemption attempts per minute is brute-force traffic. Cap at ~10 attempts per IP per token per minute. Lock the token for 5 minutes if it trips.

**Revoking a link.** Set `revoked_at = NOW()` on that one row. The other 999 links for the same file keep working. This is why we use one row per link, not one share per file.

**The schema** behind it:

```sql
-- Direct invites (recipient is a known user).
CREATE TABLE shares (
    share_id      UUID PRIMARY KEY,
    file_id       UUID NOT NULL,
    granted_to    BIGINT NOT NULL,        -- user_id
    granted_by    BIGINT NOT NULL,
    permission    SMALLINT NOT NULL,      -- 1=view, 2=download, 3=edit
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ
);

-- Anonymous or semi-anonymous share links.
CREATE TABLE share_links (
    token              VARCHAR(32) PRIMARY KEY,  -- opaque 192-bit random
    file_id            UUID NOT NULL,
    created_by         BIGINT NOT NULL,
    permission         SMALLINT NOT NULL,
    expires_at         TIMESTAMPTZ,              -- NULL = never
    password_hash      BYTEA,                    -- NULL = no password
    require_account    BOOLEAN DEFAULT FALSE,
    max_redemptions    INT,                      -- NULL = unlimited
    redemptions        INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at         TIMESTAMPTZ
);
CREATE INDEX idx_links_file ON share_links (file_id);
```

**Folder shares.** If you share a folder, every file inside inherits the permission. At access-check time, walk the file's parent chain: "is any folder above this file shared with me?" Cache aggressively. This is read-heavy.

</details>

---

## Step 6: Storage tiers (saving money on cold files)

A file uploaded today might be downloaded 50 times this week. A file uploaded two years ago is probably never touched again. Paying full price for both wastes a lot of money.

S3 has three tiers, in increasing order of cheapness and slowness:

| Tier | Cost per GB per month | Retrieval time | Use case |
|------|------------------------|-----------------|----------|
| **S3 Standard** (hot) | $0.023 | < 100 ms | Files used recently |
| **S3 Infrequent Access** (warm) | $0.0125 | < 100 ms | Files quiet for 30-365 days |
| **S3 Glacier** (cold) | $0.0036 | 1-5 min (fast) or 3-5 hr (standard) | Files quiet over 365 days |

The Glacier tier is roughly 6x cheaper than Standard. On 580 PB of cold storage, that is the difference between $160M/year and $25M/year. Tiering is not an optimization. It is the business model.

Try to draw the tiering flowchart yourself first. When is a file in hot? When does it move to warm? When does it move to cold? What happens when a cold file gets accessed?

<details markdown="1">
<summary><b>Show: the tiering flow</b></summary>

```mermaid
flowchart TD
    A[New file uploaded] --> B[S3 Standard - hot]
    B --> C{Accessed in last 90 days?}
    C -->|Yes| B
    C -->|No| D[Move to S3 IA - warm]
    D --> E{Accessed in last 365 days?}
    E -->|Yes, stays warm| D
    E -->|No| F[Move to Glacier - cold]
    F --> G{User clicks Download?}
    G -->|No| F
    G -->|Yes| H[Restore to hot - takes 3-5 hr standard, or 1-5 min expedited]
    H --> B
```

**Two ways to implement tiering:**

- **S3 Intelligent-Tiering** (the easy way). S3 watches access patterns per object and moves files between tiers automatically. Costs $0.0025 per 1000 objects per month for the monitoring. Worth it once you have millions of objects with mixed access patterns.
- **Custom tiering** (the controlled way). Log every download. A nightly job computes "files not touched in N days" and transitions them with the S3 SDK. More work. More control. Some compliance rules require you to control where data lives.

Pick Intelligent-Tiering unless you have a compliance reason not to.

**The retrieval-latency UX problem is real.** A Glacier file takes 3-5 hours to retrieve with standard retrieval. The user clicks Download and waits forever. Options:

- **Set expectations.** Show "This file is in cold storage. Restoring takes about 5 minutes. We will email you when ready." Users hate surprise waits more than they hate honest waits.
- **Use Glacier Instant Retrieval.** Costs ~3x Glacier Flexible but reads are sub-second. Worth it for files users might re-open.
- **Pre-warm on share.** When a user shares a Glacier file, start restoring immediately so by the time the recipient clicks, the file is hot.

**Do not tier metadata.** The `files` row in Postgres stays where it is regardless of where the bytes live. The row has a `storage_tier` column so the API knows whether to expect a wait.

**Do not tier files smaller than ~128 KB.** S3 IA charges a minimum object size of 128 KB. Tiering a 10 KB file actually costs more than leaving it in Standard. Exclude small files from the lifecycle rule.

**Watch out for delete penalties.** A user deletes a file in Glacier and the object goes away, but you still pay the 90-day minimum storage charge. Build this into your cost model. Soft-delete first (status flag, file still exists), hard-delete after the regret window.

</details>

---

## Step 7: Content-addressed dedup (storing identical files once)

Fifty different users upload the same 200 MB software installer. Do you store it 50 times?

No. You hash the file content. Two files with the same bytes have the same hash. You store the bytes once and let many "file" rows point at the same blob.

A blob is the bytes themselves. A file is a user-named pointer to a blob. The `files` table has one row per user-named pointer. The `blobs` table has one row per unique byte sequence. They are joined by content hash.

```
                Blobs table              Files table
            (one per unique bytes)    (one per user pointer)

            blob A: hash=abc...   <-- file "installer-2024.exe" (Alice)
            refcount=3                <-- file "setup.exe" (Bob)
                                      <-- file "v1.0.exe" (Carol)

            blob B: hash=def...   <-- file "report.pdf" (Alice)
            refcount=1
```

When Alice deletes her copy of the installer, you decrement the blob's refcount from 3 to 2. The blob stays alive because Bob and Carol still reference it. When the refcount finally hits zero, you schedule the actual bytes for deletion (after a grace period in case someone uploads it again).

> Why this matters. Consumer file-sharing services often see ~30% storage savings from dedup. On 580 PB/year that is ~170 PB saved. At $0.023/GB/month for hot storage, dedup saves ~$50M/year. Worth getting right.

One privacy note: knowing your file's hash matches another user's tells you they have the same content. For consumer use that is fine. For high-privacy products (legal, medical), disable cross-tenant dedup. Dedup only within one account.

---

## Follow-up questions

Try answering each in 2 to 4 sentences before reading the solution.

1. **Resume the next day.** A user uploads 3 GB of a 5 GB file, then closes their laptop. The next morning they reopen the app. What happens? How does the client know which chunks already landed? How long do you keep half-finished uploads around?

2. **Quota race.** A user has 100 MB of quota left. Their phone and laptop both start uploading 80 MB files at the same instant. Both pass the quota check at init. Both upload. Now the user is 60 MB over quota. How do you prevent this?

3. **Dedup.** Three users upload the same 200 MB installer. How do you store it once? What does "delete" mean when one user deletes their copy? What about privacy (knowing my hash matches yours means we have the same file)?

4. **Token guessing.** Your tokens are 192 bits, so brute force is out. But a researcher finds your `created_at` timestamps in the response. Is this a real attack? What other side channels leak?

5. **Big delete.** A user with a 50 TB account deletes 10 TB in one click. Your metadata DB does 200,000 row updates and S3 issues 200,000 delete requests. What goes wrong? How do you smooth it out?

6. **Late-positive virus scan.** A scan flags a file as malware after 500 people have already downloaded it. What is your response? Can you tell who downloaded it? What about the share links?

7. **Edit conflict.** Two users with Edit permission upload a new version of the same file within 10 seconds. Whose version wins? Both? The first? The second? How does the loser find out?

8. **Viral file.** A YouTuber's public share link gets 1 million downloads in 24 hours for a 200 MB tutorial video. Your CDN cache hits 99% but the 1% miss rate still hammers one S3 prefix. What do you do?

9. **GDPR delete.** A user wants their data fully erased. Their account has 12,000 files, some of which are deduped with other users' files. They also created share links and were granted shares on other users' files. How do you erase them?

10. **Per-tenant billing.** You sell this to enterprises. One customer wants a monthly bill: storage GB by tier, egress GB, virus-scan calls, API requests. How do you attribute every byte and every call to the right tenant?

---

## Related problems

- **[Video Streaming (006)](../006-video-streaming/question.md).** Same shape: bytes in S3, metadata in a DB, CDN in front. Video adds adaptive bitrate transcoding. This problem adds share-link permissions. The storage and CDN layer overlaps heavily.
- **[Distributed Cache (009)](../009-distributed-cache/question.md).** Hot files need an in-memory layer (or at least CDN edge cache) for popular share links. The eviction and warming patterns there apply directly.
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md).** The "show me my files" dashboard and share-link resolution are textbook read-heavy paths.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: File Upload & Share Service

### The short version

This looks like a thin HTTP wrapper around S3. It is not. The interesting design is everything around the bytes:

- **How does a 5 GB upload survive a bad network?** Chunked upload with presigned URLs. Each chunk uploads on its own. Failed chunks retry without restarting the whole file.
- **How do you store the same file once when 50 people upload it?** Content-addressed dedup. Hash the file. Two files with the same hash share one set of bytes.
- **How do you revoke one share link without breaking 999 others?** One row per link in a `share_links` table with a `revoked_at` column. Revoke is one UPDATE.
- **How does a file nobody has touched in two years stop costing money?** S3 lifecycle policy moves it to cheaper tiers (S3 IA after 90 days, Glacier after 365 days).

The data model fits on a napkin. Seven tables: `files`, `file_versions`, `blobs`, `shares`, `share_links`, `upload_sessions`, `audit`. Bytes live in S3, addressed by their content hash. Metadata is sharded by owner because almost every query is "show me my stuff."

Uploads go client-to-S3 directly via presigned URLs. Your app servers never touch the bytes. That one decision saves you an order of magnitude on bandwidth cost.

The scaling story is four stages:

- **Stage 1 (10 users):** one VM, local disk, Postgres.
- **Stage 2 (1k users):** bytes go to S3 via presigned URL.
- **Stage 3 (100k users):** chunked uploads, async virus scan, share link service, CDN, lifecycle to cold tier.
- **Stage 4 (1M users):** regional buckets, sharded metadata, multi-region.

At every stage, build only what just broke.

---

### 1. Clarifying questions, recap

The two most important questions:

- **What is the biggest file size?** Anything above ~100 MB forces chunked or presigned uploads.
- **Sync or share-only?** Sync (Dropbox desktop) is a different problem with delta sync, conflict resolution, and file watchers. Share-only (Google Drive web) is what this design solves.

Everything else (versioning, virus scan, GDPR, quotas) follows from those two answers.

---

### 2. Capacity, in plain numbers

| Scale | Uploads/sec | Downloads/sec | Storage/year | Egress peak |
|-------|-------------|----------------|---------------|--------------|
| 10k users (weekend) | ~0.08 sustained, ~0.25 peak | ~0.8 | ~13 TB | ~100 Mbps |
| 100M users (Dropbox-scale) | ~3,300 sustained, ~10k peak | ~33k sustained, ~100k peak | ~580 PB (after 30% dedup) | ~6.4 Tbps |

Two numbers matter more than throughput:

- **The system is read-heavy by request count, but write-heavy by bytes.** Uploads dominate ingress. CDN absorbs most of the download traffic.
- **Storage cost is the headline expense.** At PB scale, $0.023/GB/month for hot S3 turns into hundreds of millions per year. Lifecycle to cheaper tiers and dedup are survival, not optimization.

The metadata DB is small compared to the object store. 100B file rows at ~500 bytes is ~50 TB. Sharded Postgres handles it easily.

> Why presigned URLs and not upload through your server? Uploading a 5 GB file through your server means: 5 GB in to your server, then 5 GB out to S3. You doubled the bandwidth bill and burned your server's CPU on copying bytes. Presigned URL lets the client upload directly to S3 in one trip. Your server only handles a tiny "give me a URL" request.

---

### 3. The API

Five endpoints carry the whole product. Init an upload, upload chunks (to S3 directly), finalize, create a share link, redeem a share link. Everything else is reading data back.

```
POST /api/v1/uploads/init
Authorization: Bearer <token>

{
  "file_name": "vacation.mp4",
  "size": 1572864000,                 # 1.5 GB
  "mime_type": "video/mp4",
  "content_hash": "sha256:abc123...", # client computes this for dedup
  "parent_folder_id": "fld_xyz",
  "client_idempotency_key": "uuid"    # retry returns same session
}
```

Responses:

| Status | Meaning | Body |
|--------|---------|------|
| 201 Created | New upload session | `{"upload_id": "...", "chunk_size": 8388608, "presigned_urls": [{"part": 1, "url": "..."}, ...]}` |
| 200 OK | Dedup hit. File already exists. No upload needed. | `{"file_id": "...", "deduped": true}` |
| 400 | File too big or invalid | `{"error": "file_too_large", "max_bytes": 5368709120}` |
| 402 | Out of quota | `{"error": "quota_exceeded", "available_bytes": 12345}` |
| 409 | Name conflict at this path | `{"error": "name_conflict"}` |

The client then `PUT`s directly to the presigned S3 URLs. Your server is not in the path. S3 returns an ETag the client must remember.

```
POST /api/v1/uploads/{upload_id}/finalize

{
  "parts": [
    {"part": 1, "etag": "abc"},
    {"part": 2, "etag": "def"}
  ]
}
```

For share links:

```
POST /api/v1/files/{file_id}/share_links
{
  "permission": "download",          # "view" | "download" | "edit"
  "expires_at": "2026-08-01T00:00:00Z",
  "password": "optional",
  "require_account": false,
  "max_redemptions": null
}
```

Returns `{"token": "...", "url": "https://app.example.com/s/<token>"}`.

Redemption is `GET /api/v1/share/{token}` (with an optional password). Returns file metadata plus a short-lived signed download URL.

Direct download is `GET /api/v1/files/{file_id}/download`, which returns a 307 redirect to a signed CloudFront URL valid for 15 minutes.

**Three small but load-bearing choices:**

- **Idempotency on upload init is required.** Mobile clients retry on timeout. Without the key, retries create new sessions and you get half-uploaded orphans everywhere.
- **The dedup hint at init is what makes "I am re-uploading my photo library" instant.** Client computes SHA-256. Server checks if a blob with this hash already exists. If yes, return the existing file_id and skip the upload. The bytes never cross the network.
- **Finalize takes ETags because S3 multipart finalize needs them.** S3 stitches the chunks together based on the part list with ETags. The client tracks these. Your server forwards them.

---

### 4. The data model

Seven tables. The two most interesting:

```sql
-- Files (the user-facing entity).
CREATE TABLE files (
    file_id          UUID PRIMARY KEY,
    owner_id         BIGINT NOT NULL,
    parent_folder_id UUID,
    name             TEXT NOT NULL,
    size_bytes       BIGINT NOT NULL,
    content_hash     BYTEA NOT NULL,           -- SHA-256 of bytes
    current_version  INT NOT NULL DEFAULT 1,
    status           SMALLINT NOT NULL,        -- 1=uploading, 2=ready, 3=quarantined, 4=deleted
    storage_tier     SMALLINT NOT NULL,        -- 1=hot, 2=warm, 3=cold
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_files_owner  ON files (owner_id, parent_folder_id);
CREATE INDEX idx_files_hash   ON files (content_hash);            -- dedup lookups

-- The dedup table. One row per unique byte sequence.
CREATE TABLE blobs (
    content_hash     BYTEA PRIMARY KEY,
    size_bytes       BIGINT NOT NULL,
    storage_key      TEXT NOT NULL,            -- S3 key /raw/<hash>
    refcount         INT NOT NULL DEFAULT 1,   -- how many files point at this blob
    first_uploaded   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_tier     SMALLINT NOT NULL DEFAULT 1
);
```

The other five (`file_versions`, `shares`, `share_links`, `upload_sessions`, `audit`) follow the same shape: an ID, a foreign reference, a few state columns, timestamps. `share_links` was shown in question.md Step 5.

**Four choices worth defending out loud:**

**Sharded by `owner_id`.** Almost every query is "list my files in folder X." Co-locating one user's files on one shard makes those queries single-shard. The exception is share lookups (you can be granted access to files owned by anyone). For that, use a separate global index on `shares.granted_to`.

**`content_hash` is a real indexed column.** It enables dedup at insert time. SHA-256 over a few PB of data has astronomically low collision probability. Treat collisions as impossible (and as a corruption signal if one ever appears).

**The `blobs` table is separate from `files`.** A blob is the actual bytes, addressed by hash. A file is a user-named pointer to a blob. Many files can point at one blob. `refcount` tracks how many files reference each blob. When it hits zero, the blob is eligible for deletion (with a grace period for safety).

**`upload_sessions` lives in Postgres, not Redis.** Sessions can live for hours and must survive any cache eviction. Volume is low (one row per in-flight upload).

---

### 5. Core algorithms

The chunked upload state machine is small:

```python
def init_upload(user_id, file_name, size, content_hash, idempotency_key):
    # Idempotency: same key returns same session.
    existing = db.find_session_by_idempotency(user_id, idempotency_key)
    if existing:
        return existing

    # Dedup hint: skip the upload entirely if we already have these bytes.
    if content_hash:
        blob = db.find_blob(content_hash)
        if blob and blob.size_bytes == size:
            file_id = create_file_pointing_at_blob(user_id, file_name, blob)
            return {"deduped": True, "file_id": file_id}

    # Quota check (atomic; see follow-up 2).
    if not reserve_quota(user_id, size):
        raise QuotaExceeded

    # Start S3 multipart upload.
    s3_upload_id = s3.create_multipart_upload(
        bucket="user-data",
        key=f"raw/pending/{uuid4()}"
    )
    chunk_size = 8 * 1024 * 1024
    total_chunks = ceil(size / chunk_size)

    # Generate one presigned URL per chunk.
    presigned_urls = [
        s3.presign_upload_part(s3_upload_id, part_number=i+1, expires_in=3600)
        for i in range(total_chunks)
    ]

    session = db.insert_session(
        user_id=user_id, expected_size=size, expected_hash=content_hash,
        total_chunks=total_chunks, s3_upload_id=s3_upload_id,
        expires_at=now() + 24h
    )
    return {"upload_id": session.id, "chunk_size": chunk_size, "presigned_urls": presigned_urls}


def finalize_upload(upload_id, parts):
    session = db.lock_session(upload_id)
    if session.status != ACTIVE:
        raise AlreadyFinalized
    if len(parts) != session.total_chunks:
        raise MissingChunks

    # Tell S3 to stitch the chunks together.
    result = s3.complete_multipart_upload(session.s3_upload_id, parts)

    # Create blob (or increment refcount if hash already exists).
    blob = db.upsert_blob(session.expected_hash, session.expected_size, result.key)

    # Create the file row pointing at the blob.
    file_id = db.insert_file(session.user_id, session.file_name, blob)

    db.mark_session_finalized(upload_id)
    publish_event("file.finalized", file_id)   # triggers virus scan
    return file_id
```

Share link resolution is the same shape, just simpler: look up the token, check `revoked_at` (410), check `expires_at` (410), check `max_redemptions` (410), verify password if set (401), rate-limit-check, increment redemptions, sign a 15-minute CloudFront URL, return.

The `cloudfront.sign` call produces a signed URL where the signature itself encodes "you may GET this S3 key until time T." CloudFront verifies the signature at request time and returns the file from edge cache or S3.

---

### 6. The architecture, drawn out

Here is the whole picture, small enough to fit one screen.

```
                  +------------------+
   Clients -----> |   CloudFront     |  edge cache for downloads.
   (web, mobile,  |   (CDN)          |  signed URLs for permission.
    desktop)      +---------+--------+
                            |
                            v   (uncached requests)
                  +------------------+
                  |   API Gateway    |  auth, rate limit, WAF
                  |   + WAF          |
                  +---------+--------+
                            |
           +----------------+----------------+
           |                |                |
           v                v                v
   +-------------+   +-------------+  +--------------+
   | Upload      |   | File API    |  | Share Link   |
   | Service     |   | (list,      |  | Resolver     |
   | (init,      |   |  metadata,  |  | (token ->    |
   |  finalize,  |   |  delete,    |  |  file +      |
   |  sessions)  |   |  download)  |  |  perms)      |
   +-----+-------+   +------+------+  +------+-------+
         |                  |                |
         |                  v                |
         |           +------------------+    |
         |           | Permission       |<---+
         |           | Resolver         |   cached "can user X
         |           | (cached)         |   access file Y" checks
         |           +------------------+
         |
         |   presigned PUTs              +-------------------------+
         +-------------------------------+    Object Store (S3)    |
                                         |                         |
         +-------------------------------+  /raw/<hash>            |
         |   signed GETs (CloudFront)    |  /chunks/<upload_id>/<n>|
         |                               |                         |
         v                               |  Lifecycle:             |
   +--------------+                      |   90d -> IA             |
   | Metadata DB  |                      |   365d -> Glacier       |
   | (Postgres,   |                      |                         |
   |  sharded by  |                      +-------------------------+
   |  owner_id)   |
   |              |
   | files,       |
   | blobs,       |
   | shares,      |
   | share_links, |
   | versions,    |
   | audit        |
   +------+-------+
          |
          |  CDC / outbox
          v
   +------------------+
   |   SQS / Kafka    |   topics: file.finalized,
   |                  |           file.deleted,
   |                  |           share.created
   +-----+------+-----+
         |      |
         v      v
   +---------+ +-----------------+
   | Virus   | | Lifecycle       |
   | Scan    | | Manager         |
   | Worker  | | (refcount GC,   |
   | (Clam   | |  tier transitions,|
   |  AV)    | |  abandoned uploads)|
   +---------+ +-----------------+
```

**Five things to notice while reading this:**

- **The Upload Service mints presigned URLs but never touches the bytes.** That single decision is what lets one small pod handle thousands of uploads per second. The bytes go client-to-S3.
- **CloudFront sits in front of S3 for downloads.** Signed URLs respect share-link permissions. Cache TTL is short (60 seconds typical) so revocations propagate fast. Without it, a viral file melts your S3 egress bill.
- **The Permission Resolver is its own service** because it is the hottest read path. "Can user X do Y on file Z?" combines owner check, direct share check, and folder share inheritance. Cache the result for 30 seconds per `(user, file)` pair. Most lookups never touch the DB.
- **Virus scan, lifecycle GC, and audit archival are all downstream of SQS/Kafka.** They are not in the write path. If the scan worker falls behind, uploads still succeed. Downloads of very recent uploads return 425 Too Early until the scan lands.
- **The metadata DB is sharded by `owner_id`.** Cross-shard share lookups go through a separate global index. Bytes are not the problem at scale. Rows are. And rows are split by who owns them.

---

### 7. An upload, drawn end to end

The chunked upload flow looks like this:

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API Gateway
    participant US as Upload Service
    participant S3 as S3
    participant DB as Metadata DB
    participant Q as SQS/Kafka

    C->>API: POST /uploads/init
    API->>US: validate, authenticate
    US->>DB: check dedup by content_hash

    alt dedup hit
        US-->>API: 200 {deduped, file_id}
        API-->>C: 200
    else new upload
        US->>DB: reserve quota
        US->>S3: create multipart upload
        S3-->>US: s3_upload_id
        US->>US: presign N chunk URLs
        US->>DB: insert upload_session
        US-->>API: 201 + presigned URLs
        API-->>C: 201

        par chunk 1
            C->>S3: PUT chunk 1 (presigned)
            S3-->>C: ETag 1
        and chunk 2
            C->>S3: PUT chunk 2 (presigned)
            S3-->>C: ETag 2
        and chunk N
            C->>S3: PUT chunk N (presigned)
            S3-->>C: ETag N
        end

        C->>API: POST /finalize {parts: [ETags]}
        API->>US: forward
        US->>S3: complete multipart upload
        S3-->>US: final S3 key
        US->>DB: BEGIN TX
        US->>DB: upsert blob (refcount++)
        US->>DB: insert file (status=uploading)
        US->>DB: insert audit
        US->>DB: COMMIT
        US->>Q: emit file.finalized
        US-->>API: 200 + file_id
        API-->>C: 200

        Note over Q: async
        Q->>Q: virus scan worker consumes
        Q->>DB: UPDATE files SET status = ready (or quarantined)
    end
```

**The download flow** is simpler:

```mermaid
sequenceDiagram
    participant C as Client
    participant CF as CloudFront
    participant API as File API
    participant PR as Permission Resolver
    participant S3 as S3

    C->>API: GET /files/{id}/download
    API->>PR: can user view file?
    PR-->>API: yes, permission = download
    API->>API: sign CloudFront URL (15 min)
    API-->>C: 307 redirect to signed URL
    C->>CF: GET <signed URL>

    alt cache hit
        CF-->>C: file bytes (fast, from edge)
    else cache miss
        CF->>S3: fetch
        S3-->>CF: file bytes
        CF-->>C: file bytes (and cache for next time)
    end
```

**Target latencies, for a sense of scale:**

- Upload init: P99 ~200 ms (dedup lookup is the slow part when cache is cold).
- Finalize: P99 ~500 ms (S3 multipart completion takes a moment).
- Permission resolution: P99 ~50 ms (cached).
- Download cache hit: usually under 30 ms (whatever CloudFront's edge latency is).

---

### 8. Storage tiers (saving money on cold files)

A file uploaded today is hot. A file uploaded two years ago is probably cold. Paying full price for both is wasteful.

```mermaid
flowchart TD
    A[New file uploaded] --> B[S3 Standard - hot]
    B --> C{Accessed in last 90 days?}
    C -->|Yes| B
    C -->|No| D[Move to S3 IA - warm]
    D --> E{Accessed in last 365 days?}
    E -->|Yes| D
    E -->|No| F[Move to Glacier - cold]
    F --> G{User clicks Download?}
    G -->|No| F
    G -->|Yes| H[Restore: 1-5 min expedited, or 3-5 hr standard]
    H --> B
```

The three tiers and what they cost:

| Tier | Cost per GB per month | Retrieval | Retrieval cost |
|------|------------------------|-----------|-----------------|
| **S3 Standard** (hot) | $0.023 | < 100 ms | free |
| **S3 IA** (warm) | $0.0125 | < 100 ms | $0.01/GB retrieved |
| **Glacier** (cold) | $0.0036 | 1-5 min fast, 3-5 hr standard | $0.03/GB + per-request fee |

The S3 lifecycle policy looks like this:

```
Rule: tier-down-by-age
  Apply to: bucket prefix /raw/
  Transition to S3 IA: 90 days after upload
  Transition to S3 Glacier: 365 days after upload
  Expiration: never (we keep files until user deletes)
```

> Why this matters. On 580 PB of cold storage at Glacier prices ($0.0036/GB/month), you pay about $25M/year. At Standard prices ($0.023/GB/month), the same data costs about $160M/year. The lifecycle policy is the difference. It is not a small optimization. It is the business model.

**Three gotchas to mention:**

- **Glacier retrieval latency surprises users.** Standard retrieval takes 3-5 hours. The user clicks Download and waits. Either use Glacier Instant Retrieval (3x cost, sub-second reads) or set explicit expectations: "Restoring. We will email you when ready."
- **Do not tier small files.** S3 IA has a 128 KB minimum object size charge. Tiering a 10 KB file actually costs more. Exclude small files from the lifecycle rule.
- **Cold tier deletes have penalties.** A file deleted in Glacier still incurs the 90-day minimum storage charge. Build this into your trash-bin retention. Soft-delete first. Hard-delete after the regret window.

---

### 9. Scaling journey: 10 to 1M users

The point is: build only what just broke. Name the pain. Add the fix. Do not pre-build.

#### Stage 1: 10 users (weekend project)

One small VM. Files saved to local disk under `/var/data/<user_id>/<file_id>`. Postgres on the same machine. Direct POST upload, files capped at 100 MB. Direct invite sharing only. No anonymous links. No virus scan, no versioning, no quota. About $20/month. Ships in a weekend.

This is enough because you have 10 users and 50 total files ever. Bandwidth is whatever the VM gives you. Nothing is big enough to fail mid-upload.

#### Stage 2: 1,000 users

Something breaks:

- Local disk fills up. One 50 GB user takes the VM into a degraded state.
- Backups are now your problem.
- A user's 2 GB upload drops at 1.8 GB. They have to start over. They complain on Twitter.

Fixes, in order:

- **Move bytes to S3 via presigned PUT URLs.** Your app server is no longer in the byte path.
- **Add anonymous share links.** `share_links` table with 192-bit tokens.
- **Add the view/download/edit permission scopes.**
- **Add per-user quota.** `users.quota_bytes` and `users.used_bytes`.
- **Add soft delete with a 30-day trash bin.** Support stops getting "I deleted by accident" tickets.

Still no chunked upload (presigned PUT handles up to S3's 5 GB single-PUT limit). No virus scan yet (acceptable for trusted early users). No CDN. One DB. Cost ~$100-300/month.

#### Stage 3: 100,000 users

Several things break at once:

- A power user uploads a 4 GB video on hotel WiFi. Fails at 80%. The whole upload restarts. They uninstall the app.
- A malware-laden PDF gets shared and downloaded. You get a security report.
- Storage cost is $3-5k/month and growing 30% per quarter. Most stored bytes are untouched after 30 days.
- `share_links` has 5M rows.
- S3 egress costs $2k/month because every share-link download streams full-cost from S3.

Fixes, in order:

- **Chunked upload via S3 multipart.** Init returns a list of presigned PUT URLs (one per chunk). Client uploads chunks in parallel and retries only failed chunks. Finalize completes the multipart. A flaky 4 GB upload now survives.
- **Virus scan pipeline.** SQS topic `file.finalized` triggers a Lambda invoking ClamAV. Result updates `files.status`. Files are downloadable in the 1-3 minute gap; when the scan flags them, status flips to quarantined and downloads return 451. Document the gap explicitly.
- **Split the Share Link Resolver into its own pod set.** Its own read replica and a small in-process LRU for the hottest tokens.
- **S3 lifecycle policy.** 90 days to IA, 365 to Glacier. Saves ~70% on cold-tier cost.
- **CloudFront in front of S3.** Signed URLs from share links route through it with a 60-second TTL so revocations propagate. Egress drops by an order of magnitude.
- **Two Postgres read replicas.** Dashboards read from replicas. Engine writes go to primary.
- **Atomic quota enforcement** with a reservation pattern (see follow-up 2).
- **Tier the audit log.** Hot 90 days in Postgres. Archive to S3 Parquet after.

Still single-region. The DB does not need sharding yet (100M rows at ~500 bytes is 50 GB, fits one big Postgres). Server-side encryption with S3-managed keys, no client-side yet. Cost ~$10-20k/month.

#### Stage 4: 1 million users (global)

New pains:

- EU users complain about upload latency from Berlin to us-east-1.
- A regulated healthcare customer demands data residency.
- A viral share link gets 1M downloads in 24 hours. CloudFront catches 99% but the 1% concentrates on one S3 prefix and triggers throttling.
- Metadata DB primary at 60% CPU at peak.
- A quota race lets three accounts overflow by 200 GB each.
- A 4-hour S3 outage takes everything dark.

Fixes:

- **Regional S3 buckets per region.** Files land in the user's home region. Lazy cross-region replication only on cross-region share access.
- **Shard metadata DB by `owner_id`.** Multi-region. Each region is primary for its own users. Global directory maps `file_id` to home region.
- **Share links are global.** The token's first few characters encode the home region of the file so any region routes correctly.
- **CloudFront with multiple origins per region.** Viral files get hash-prefix-sharded S3 keys so one prefix is never a bottleneck.
- **Per-user quota in Redis** with `INCRBY` reservations and periodic reconciliation against the DB. Resolves the overflow race.
- **Per-tenant KMS keys** for enterprise customers (customer-controlled kill switch).
- **Metadata replicas in two regions** for cross-region failover.

Even at 1M users you peak at ~10 uploads/sec and ~100 downloads/sec (most absorbed by CDN). The system is large in bytes and organizational complexity, not in QPS. The architecture is the same shape as Stage 3, multiplied across regions with isolation boundaries. Cost ~$200-500k/month, dominated by S3 storage and egress.

---

### 10. Reliability

**Interrupted upload resume.** Upload sessions live 24 hours in `upload_sessions`. Client calls `GET /uploads/{upload_id}` to ask "which chunks have you got?" Server queries S3 `ListParts` and returns the part numbers already uploaded. Client re-uploads only the missing parts. After 24 hours, the session expires and the abandoned S3 multipart is aborted by the Lifecycle Manager (S3 charges for in-flight parts until aborted).

**Orphan chunks.** Lifecycle Manager runs every 6 hours. For each session with `status=active AND expires_at < now()`, call `s3.abort_multipart_upload(s3_upload_id)` and mark the session abandoned. Safety net: a global S3 lifecycle rule aborts any multipart older than 7 days.

**Virus scan failures.** Three flavors:

- Scan worker dies mid-scan. SQS visibility timeout expires. Another worker picks up the message. Scan result is the same. Idempotent.
- Third-party scan API is down. Worker retries with backoff. If down over an hour, escalate to a human queue. Files remain `status=uploading`. Downloads return 425 Too Early.
- Scan finds a virus after the file has been downloaded. Flip `status=quarantined`. Set `revoked_at` on all share links pointing at the file. Audit log captures everything. Notify any authenticated downloaders.

**Metadata DB primary failure.** Standard Postgres failover. Promote a replica. Reads continue from other replicas during the 30-60 second promotion. In-flight upload sessions see a few errors and retry.

**S3 outage.** The hardest one. If the region's S3 is down, presigned PUTs return 5xx, signed GETs return 5xx, CloudFront serves whatever it has cached. Metadata operations still work. Honest answer: wait for S3 to recover. Multi-region replication helps for reads but is expensive and only justified for high-availability tiers.

---

### 11. Observability

| Metric | Why it matters |
|--------|----------------|
| `upload.init.rate` | Sudden drop signals auth or API issues. |
| `upload.success_rate` (finalize/init) | Headline UX SLO. If 60% of inits never finalize, something is broken. |
| `upload.duration` by file size bucket | Tells you "uploads are slow" from "uploads of 1 GB+ files are slow." |
| `download.cache_hit_rate` (CDN) | Should be > 95% in steady state. |
| `share_link.resolution.p99` | Hot path latency. |
| `share_link.brute_force_alerts` | Tokens with > 50 failed redemption attempts in an hour. |
| `quota.exceeded.rate` | Spikes signal a user or integration gone rogue. |
| `virus_scan.queue_depth` | If growing, scanner cannot keep up. Downloads of recent uploads risk exposure. |
| `virus_scan.positive_rate` | Sudden spike means a malware campaign. |
| `blob.refcount.zero.count` | Eligible-for-GC blobs. Should drain. |
| `storage.by_tier.bytes` | Hot/warm/cold breakdown. Cost forecasting input. |
| `egress.bytes_per_region` | Where the money goes. |

**Page on:** upload success rate under 90% for 5 min. Virus scan queue depth over 10k. CDN origin error rate over 1%.

**Ticket on:** per-user bandwidth anomaly. Quota race detected. Storage growth more than 2-sigma above forecast.

---

### 12. Follow-up answers

**1. Resumable upload across days.**

The client persists `upload_id` locally. On reopen, it calls `GET /uploads/{upload_id}`. Server queries S3 `ListParts`, returns the list of uploaded part numbers and the original chunk size. Client uploads only the missing parts and finalizes. If `upload_id` is past the 24-hour TTL, the client gets 410 Gone and must start over. Abandoned sessions get GC'd every 6 hours by the Lifecycle Manager calling `AbortMultipartUpload` on S3.

**2. Quota race.**

Common and real. Fix with an explicit reservation column:

```sql
UPDATE users
SET reserved_bytes = reserved_bytes + ?
WHERE user_id = ?
  AND used_bytes + reserved_bytes + ? <= quota_bytes
RETURNING reserved_bytes;
```

If this returns 0 rows, the upload is rejected. Reservation is held until finalize (moves to `used_bytes`) or session expiry (released). At higher scale, run the same logic in Redis with `INCRBY` and CAS, with periodic reconciliation back to the DB.

**3. Content-addressed dedup.**

A `blobs` table keyed by SHA-256. On finalize:

```sql
INSERT INTO blobs (content_hash, size_bytes, storage_key, refcount)
VALUES (?, ?, ?, 1)
ON CONFLICT (content_hash) DO UPDATE SET refcount = blobs.refcount + 1;
```

The S3 key is `/raw/<hash>`. If the blob exists, no new S3 object is written. The `files` row points at the blob.

Delete decrements the blob's refcount atomically. When refcount hits zero, schedule the blob's S3 object for deletion after a 24-hour grace period (in case a new file is created with the same hash).

Privacy: dedup can leak existence. If you upload a file and it dedups instantly, you have confirmed someone else has the same content. For sensitive use cases (legal, medical), disable cross-tenant dedup. Dedup only within a single account.

**4. Share link enumeration.**

192 bits of entropy makes direct brute force impossible. Side channels are the real concern:

- **Timing.** Token-not-found vs token-found-but-expired should take the same time. Use constant-time comparison and unified error paths.
- **Error responses.** Return the same generic 404 for "no such token" and "expired." Do not include `expired_at` in unauthenticated responses.
- **Predictable creation timestamps.** Pure-random tokens from `secrets.token_bytes` leak nothing. The token has no relationship to creation time.
- **Rate limiting.** Per-IP limits on `/share/*` thwart high-volume probing.
- **Web logs.** Tokens appear in access logs. Treat them as secrets. Scrub from logs or hash before logging.

**5. Large delete tombstone backlog.**

A 10 TB delete triggers 200k file row updates and 200k S3 DELETE requests. Synchronously: HTTP timeout, DB lock contention, S3 throttling, user clicks Delete again, double the load.

The fix: write a single `deletion_jobs` row `(user_id, target_folder_id, requested_at)` and return 202 Accepted with a job_id. A background worker processes the job in batches of 1000:

- Soft-delete in DB (status flip + `deleted_at`).
- Decrement blob refcounts.
- Enqueue S3 deletion (S3 bulk-delete handles 1000 objects per call).

UI shows "deletion in progress." Items disappear from listings immediately (filtered by status). After 30 days (trash retention), a sweeper hard-deletes the blobs whose refcount reached zero.

**6. Late-positive virus scan.**

Incident response, in order:

- Flip `status` to quarantined.
- `UPDATE share_links SET revoked_at = NOW() WHERE file_id = ?`.
- Invalidate CloudFront for the file's signed URL prefix.
- Query the `audit` table for `event_type = 'file.downloaded' AND file_id = ?` to identify downloaders (user_ids for authenticated, IPs for anonymous share-link).
- Notify authenticated downloaders in-app and by email: "A file you downloaded was later found to contain malware. We recommend you scan your system."
- Anonymous downloaders cannot be notified directly, but the share link itself now displays a warning.
- Notify the uploader: "Your file was flagged. If this was a mistake, request a rescan."

Pre-mitigation: keep the post-finalize, pre-scan window short. Faster scanning narrows the exposure.

**7. Edit conflict.**

Two users with Edit upload new versions within 10 seconds. Default: both succeed, both create new versions. `file_versions` has rows `version=2` (first to land) and `version=3` (second). `files.current_version` points to version 3. The losing user's version still exists in history.

Surface a conflict notification: "User B also uploaded a new version at the same time. Your version is current. Theirs is at /history/version/2."

For stronger guarantees, accept an optional `If-Match: <current_version>` header on upload. Mismatch returns 412 Precondition Failed and the client surfaces a conflict UI.

**8. Viral file.**

200 MB video, 1M downloads in 24 h, 99% CDN cache hit. The 1% miss is 10k requests to origin S3 over 24 h, about 0.1 req/sec on average. Fine for S3 overall. The concern is **prefix throttling**: S3 limits requests per prefix to 5500 GET/s. If all those requests hit one prefix at one moment, you get 503s.

Mitigations:

- **Pre-warm CDN edges** when a link is created with a known-popular file (push to all CloudFront edges immediately rather than waiting for first-miss).
- **Spread the prefix.** Store blobs at `/raw/<hash[0:2]>/<hash[2:4]>/<hash>` so popular files land on different prefixes naturally.
- **CloudFront origin shield.** A regional cache between edges and S3, collapsing many edge misses into one S3 fetch.
- **Multi-CDN** for enterprise tier (CloudFront plus Fastly plus Akamai) for resilience.

**9. GDPR delete.**

Multi-step process for a user with 12,000 files.

- `UPDATE users SET deletion_requested_at = NOW(), status = 'deleting'`. User is logged out and account frozen read-only.
- Enqueue a `deletion_jobs` row for background processing.
- Walk owned files: decrement each blob's refcount, update audit, revoke all share links the user created.
- Walk received shares: set `revoked_at` where the user is `granted_to`. (The user loses access. The file itself remains for the owner.)
- Walk audit log: replace `actor_id` with a hash. Drop PII from payloads.
- Delete the user row after the grace period (often 30 days).
- Email the deletion certificate.

The tricky part: files deduped with other users. Decrementing the refcount may leave the blob alive because other users still reference it. That is correct. The user's pointer is gone, even though the bytes might persist (referenced by someone else).

If the user demands the bytes be deleted regardless: disable dedup for that user retroactively. Copy the blob to a user-private location for any remaining references, then delete the original. Expensive. Only do on explicit request.

**10. Per-tenant cost attribution.**

Every billable action gets tagged with `tenant_id`:

- **Storage:** S3 inventory runs daily, lists all objects with size and tier. Each object's key embeds `tenant_id` (`/raw/<tenant>/<hash>`). Aggregate by tenant.
- **Egress:** CloudFront real-time logs include the request URL. URLs encode tenant_id. Daily job aggregates bytes-out per tenant.
- **API requests:** API Gateway access logs include the JWT's `tenant_id` claim. Aggregate per tenant per endpoint.
- **Virus scan API costs:** Scan worker records each scan in a `scan_invocations` table with `tenant_id`.

A nightly job rolls these into a `billing_lines` table:

```
tenant_id | period | storage_hot_gb | storage_warm_gb | storage_cold_gb |
          | egress_gb | api_requests | scan_calls
```

Invoice generation reads this table. Spot-check: the sum of per-tenant attributions should match your AWS bill within ~1%. Gaps are platform overhead, S3 inventory itself, etc.

---

### 13. Trade-offs worth saying out loud

**Single big PUT vs chunked.** Single PUT is simpler for files under 100 MB and works in every HTTP client. Chunked is necessary above 5 GB (S3's single-PUT limit) and strongly recommended above 100 MB for network resilience. Right answer: hybrid. Single PUT below a threshold, chunked above.

**Client-side encryption.** Optional but important for high-security customers. Encrypt with a key the server never sees. Tradeoffs: no dedup possible (ciphertext differs even for identical plaintext), no server-side preview (cannot render an encrypted PDF), key management burden is now the customer's. Implement as opt-in for enterprise tier.

**Dedup by content hash.** Saves ~30% on storage at consumer scale, less in business contexts. Adds complexity: refcount management, GC, blob lifecycle, privacy. Worth it at scale. Skip for the first 1000 users.

**Lifecycle to cold tier.** Saves 50-70% of storage cost on the cold tail. Costs: retrieval latency surprises users, retrieval fees on access, minimum-storage-duration penalties on early delete. Tune the transition age to your actual access pattern. Default 90 days is sometimes too aggressive (some files are bursty re-accessed in week 5).

**Postgres vs DynamoDB for metadata.** Postgres gives you joins, transactions, and a familiar query layer. DynamoDB gives you infinite horizontal scale and predictable latency. For metadata under 100M files, Postgres is simpler. Above that, sharding Postgres becomes annoying and DynamoDB is worth considering. Do not switch preemptively.

**Sync vs async virus scan.** Sync blocks the upload UX (a 2 GB file's scan takes minutes) but guarantees zero exposure. Async returns immediately and accepts a 1-3 minute exposure window. Almost everyone picks async. The exposure is small, the UX win is large.

---

### 14. Common mistakes

Most weak answers fall into one of these:

**Tunneling uploads through your app server.** The single biggest scaling mistake. Bandwidth cost is per-byte. Doubling traffic doubles your NIC bill. Presigned-direct-to-S3 is non-negotiable above ~100 concurrent uploads.

**Single POST for all uploads.** Works until the first 4 GB upload fails on hotel WiFi. Chunked is mandatory above ~100 MB.

**No quota enforcement at all.** "We will add it later" turns into "one user uploaded their Steam library and ate our budget." Quota at signup is easier than quota retrofitted.

**Forgetting to GC abandoned uploads.** S3 multipart uploads that never finalized continue to cost money. A nightly sweeper catches them. An S3 lifecycle rule that aborts multiparts older than 7 days is the safety net.

**Share links that are just file IDs in the URL.** `https://app.com/file/abc123` is not a share link. It is a permanent backdoor. Use an opaque high-entropy token with explicit expiry and revocation.

**No virus scan at all.** Fine for an internal tool. Indefensible for a public product. Even basic ClamAV catches most known malware.

**Hot path doing folder traversal for permissions.** "Is this file in any folder shared with me?" walked on every download is slow. Cache or materialize the access set per user.

**Skipping the `status` field.** Without an explicit upload/ready/quarantined/deleted state machine, you end up with weird edge cases (downloads of half-finalized files, deletes of in-flight uploads). The `files.status` smallint pays for itself in week 1.

**Mixing user files and system files in one bucket without prefixing.** Lifecycle rules apply per bucket or prefix. If you mix, you cannot tier user files independently of thumbnails or temp data. Pick a prefix scheme on day one.

**No audit log.** When the security report comes in ("user X claims their file was leaked"), the lack of "who accessed this and when" turns a 1-hour investigation into a 1-week investigation. Audit is cheap to build, painful to retrofit.

If you can hit 7 of these 10 and walk through the upload-protocol trade-off and the scaling journey in the same conversation, you are interviewing well above the bar.
{% endraw %}
