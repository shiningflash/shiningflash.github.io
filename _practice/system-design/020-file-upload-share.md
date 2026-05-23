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
## Scene

The interviewer drops a one-line brief into the doc.

> *Build a Dropbox-lite. Users upload files up to 5GB each, share them with other users by direct invite or by link, and set permissions (view, download, edit). Storage and bandwidth cost money, so don't waste either.*

They lean back. "Take it from a weekend project to something that could survive a million users. I want to hear what you'd build at each stage and what you'd defer."

The trap is that this looks like a CRUD app on top of S3. It isn't. The interesting parts are how a 4GB upload survives hotel WiFi, how one share link gets revoked without breaking every other link, how the same file uploaded by fifty people sits on disk once, and how a file nobody has touched in two years stops costing you anything. A candidate who jumps to "POST the file to S3, write a row in Postgres" misses about 60% of the depth.

## Step 1: clarify before you design

Spend six minutes here. Eight or so questions that meaningfully change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

The first one I always ask is the max file size. 5GB was in the brief, but is that a hard cutoff or a soft one? Anything above a single-PUT limit forces chunked or multipart. A 50GB cap is bandwidth suicide if it tunnels through your app servers, so it forces presigned-direct-to-S3.

Second: sync or share-only. Is this Dropbox-the-sync-client, or Google-Drive-the-web-share? Sync means delta-sync, conflict resolution, and local file watchers; that's its own design problem. Share-only is much smaller. In an interview, the answer is almost always share-only.

Then virus scanning. Do we scan uploads at all, and if so do we block on the result or quarantine after the fact? Sync scanning kills the upload UX. Async means a file is downloadable for a few minutes before potentially being quarantined.

Versioning matters next. Does an edit create a new version or overwrite? How many do we keep? Versions multiply storage cost. A reasonable default is ten versions or thirty days, whichever comes first.

Bandwidth limits and quotas. Per-user upload caps, account-wide storage quotas. The check has a sneaky race we'll come back to.

Sharing model. Link share, direct invite, or both? What permission scopes: view-only preview, download, edit? Each scope has security implications and changes the download flow.

File preview. Do we render PDFs and images in the browser, or just offer download? Preview means a thumbnailing pipeline, which is a sub-service in itself.

Compliance and retention. GDPR delete? Customer-managed encryption keys for healthcare or finance? The answer changes the storage layer.

Geographic reach. One region or global? If global, do we replicate the files or only the metadata? File replication is expensive; metadata replication is cheap.

Auth is usually out of scope, but worth confirming.

A strong candidate also names what's out of scope: real-time collaborative editing, full-text search inside documents, third-party integrations. Those are downstream products built on top of the storage primitive, not part of it.

</details>

## Step 2: capacity estimates

Two regimes.

**Small startup:**
- 10,000 users
- 5 uploads per user per week, ~5MB average
- Reads about 10x writes

**Dropbox-scale:**
- 100M active users
- 20 uploads per user per week, ~8MB average (mix of photos, docs, occasional video)
- Reads 10x writes
- Indefinite retention by default

For both, work out uploads per second (sustained and peak), downloads per second, storage growth per year before dedup, egress at peak download, and how much storage goes stale (untouched 90+ days) by year two.

<details>
<summary><b>Reveal: the math</b></summary>

**Small startup, 10k users.**

Uploads come out to 10,000 times 5 per week, so 50,000 a week, around 7,000 a day, which is 0.08 per second sustained and maybe 0.25 at peak. Trivial. Downloads at 10x are still under 3 per second. Storage growth is 50,000 a week at 5MB, so roughly 13TB a year. One S3 bucket, no thought. Egress at peak is 2.5 downloads per second times 5MB, about 100 Mbps. Modest. By year two probably 60-70% of those files are stale (most things get looked at once and forgotten).

A single app server plus S3 plus Postgres handles all of this. The system isn't interesting from a throughput angle. What's interesting is the upload UX for a 5GB file and the share-link permission model.

**Dropbox-scale, 100M users.**

Uploads: 100M times 20 per week is 2B per week, about 286M per day, which is ~3,300 per second sustained and ~10k at peak. Downloads at 10x are ~33k per second sustained, ~100k peak. Storage growth is 286M per day times 8MB, so 2.3 PB per day, around 840 PB per year before dedup. With ~30% dedup savings (people share popular images, identical PDFs) call it ~580 PB per year. Egress at peak is 100k times 8MB, which is 800 GB/s or ~6.4 Tbps. That's CDN territory; you can't serve it from a single region without one. By year two, ~70-80% of stored bytes are untouched 90+ days. On 1.2EB stored, that's ~900PB cold. Lifecycle to S3 IA plus Glacier saves ~70% of the cold-tier cost.

The math tells you a few things.

The system is read-heavy by request count but write-heavy by bytes. Uploads dominate ingress; downloads (with CDN) dominate egress.

Storage cost is the headline expense. 840 PB per year at $0.023/GB/month for S3 Standard is roughly $230M a year for raw storage alone. Lifecycle policies and dedup aren't optimizations, they're survival.

Per-server bandwidth is what dies first if you tunnel uploads. A 10Gbps NIC at full pelt handles ~1.25 GB/s, which is ~150 concurrent 8MB uploads per second. You'll run out of NICs long before you run out of CPU. That's why presigned URLs to S3 are the answer.

The metadata DB is small. 100M users times 1000 files each is 100B rows at ~500 bytes, so ~50TB. Sharded Postgres or a wide-column store handles it. The bytes live in S3; the metadata is what you actually run a database for.

</details>

## Step 3: upload protocols

The biggest single design decision is how the bytes get from the client to your storage. Three serious options. Take ten minutes and write down the pros and cons of each before peeking.

- **A. Direct upload (single HTTP POST).** Client streams the whole file in one request to your API server, which forwards to S3.
- **B. Chunked resumable upload (TUS protocol, or S3 multipart).** Client splits the file into 5-100MB chunks and uploads them with retry-per-chunk semantics.
- **C. Presigned S3 URL.** Your server hands the client a short-lived signed URL; the client uploads directly to S3, skipping your app servers entirely.

<details>
<summary><b>Reveal: comparison</b></summary>

| Approach | How it works | Pros | Cons |
|----------|-------------|------|------|
| **Direct (single POST)** | `POST /upload` with multipart body. Server buffers or streams to S3. | Simple. One request, one response. Works in any HTTP client. | Whole upload restarts on any network blip. 4GB upload on hotel WiFi never finishes. Saturates your app server bandwidth. Hard to show real progress. |
| **Chunked resumable (TUS, S3 multipart)** | Initiate session, upload chunk 1 of N, then chunk 2, and so on, then finalize. Each chunk is its own HTTP request. Failed chunks retry independently. | Survives flaky networks. Real progress bars. Parallel chunks speed large files. Server can pause and resume. | More complex protocol. Server tracks per-session state (which chunks landed). Garbage collection of abandoned uploads. |
| **Presigned S3 URL** | `POST /upload/init` returns a presigned URL valid for ~1h. Client `PUT`s directly to S3. On success, client calls `POST /upload/finalize` so server knows. | Zero bandwidth through your servers. Cheapest at scale. S3 handles the heavy lifting. Combines with multipart for huge files. | Client must speak S3 directly. Quota enforcement is harder (server didn't see the bytes). Virus scan is post-hoc. Signed URL leaks mean anyone can upload to that key. |

My recommendation is hybrid: chunked plus presigned, depending on file size.

Files under 5MB: single POST through the app server is fine. Simpler client.

Files 5MB to 5GB: presigned S3 multipart. Client splits into 8MB chunks, gets a presigned URL per chunk (or one initiation token), uploads chunks in parallel directly to S3, calls finalize when done.

Files over 5GB: same approach with 64MB chunks and explicit server-side caps.

The hybrid keeps the API simple for the common case and offloads the painful case to S3 entirely.

Why TUS at all? TUS (`tus.io`) is an open protocol for resumable uploads with a Go/Node server library that the client speaks to. Useful if your storage isn't S3 (some shops use MinIO, NetApp, or their own object store) and you want a standard client protocol. If you're on AWS, S3 multipart is more native; TUS is for the "S3 alternative" case.

</details>

## Step 4: incomplete architecture diagram

Sketch the high-level architecture. Fill in the five `[ ? ]` boxes. Each is one of: upload service, object store, metadata DB, share link resolver, virus scanner.

```
                Client (browser, mobile, desktop sync agent)
                              |
                              v
                    +------------------+
                    |   API Gateway    |  (auth, rate limit, request shaping)
                    +--------+---------+
                             |
        upload init,         |       download,
        finalize, list       |       share link redeem
                             |
                +------------+------------+
                |                         |
                v                         v
        +-------------+            +-------------+
        |  [ ? ]      |            |  [ ? ]      |   (resolves /share/<token>
        |             |            |             |    to a file + permission)
        +-----+-------+            +------+------+
              |                            |
              |   presigned URLs           |
              |                            |
              v                            v
        +--------------------------------------+
        |  [ ? ]                               |  (the bytes live here;
        |                                      |   cheap, durable, huge)
        +--------------------------------------+
              ^
              |
              |   reads/writes
              |
        +-----+--------+
        |  [ ? ]       |   (file_id, owner, name, size,
        |              |    hash, status, version)
        +--------------+

        Async pipeline:
            +------------------+
            |  [ ? ]           |  (consumes "file finalized" events,
            |                  |   scans, marks quarantined if positive)
            +------------------+
```

<details>
<summary><b>Reveal: completed architecture</b></summary>

```
                Client (browser, mobile, desktop sync agent)
                              |
                              v
                    +------------------+
                    |   API Gateway    |  auth, rate limit, request shaping,
                    |   + WAF          |  blocks obvious abuse
                    +--------+---------+
                             |
        upload init,         |       download,
        finalize, list       |       share link redeem
                             |
                +------------+------------+
                |                         |
                v                         v
        +-----------------+         +------------------+
        |  Upload Service |         |  Share Link      |
        |  mints          |         |  Resolver        |
        |  presigned      |         |  token ->        |
        |  URLs, tracks   |         |  file + perms,   |
        |  session state  |         |  checks expiry,  |
        |                 |         |  password        |
        +-----+-----------+         +------+-----------+
              |                            |
              |   presigned PUT URLs       |  presigned GET URLs
              |                            |  (CloudFront-signed)
              v                            v
        +--------------------------------------+
        |  Object Store (S3)                   |  Standard for hot,
        |  Bucket layout:                      |  IA after 90 days,
        |   /raw/<file_id>/<version>           |  Glacier after 365.
        |   /chunks/<upload_id>/<n>            |  Lifecycle auto-migrates.
        +--------------------------------------+
              ^
              |
              |   metadata reads/writes
              |
        +-----+----------------+
        |  Metadata DB         |   files, file_versions,
        |  (Postgres, sharded  |   shares, share_links, audit.
        |  by owner_id)        |   Cross-shard share lookups
        |                      |   via separate index.
        +----------------------+

        Async pipeline:

                                       (file finalized event)
                                  +-------------------------+
                                  |  SQS / Kafka            |
                                  +----------+--------------+
                                             |
                                             v
                                  +----------------------+
                                  |  Virus Scan Worker   |  ClamAV or
                                  |  (Lambda or          |  3rd-party API.
                                  |  long-running pod)   |  Flips status
                                  |                      |  to quarantined
                                  |                      |  if positive.
                                  +----------------------+

        CDN for downloads:
            +------------------+
            |  CloudFront      |  Signed URLs respect share link
            |  in front of S3  |  permissions. Edge cache hot files.
            +------------------+
```

A few notes on why each piece is there.

API Gateway plus WAF is the first defense. Auth, rate limit (no client uploads 10k files in a minute), block obvious malicious requests.

Upload Service owns the upload session lifecycle. Mints presigned URLs. Tracks "upload_id, chunks uploaded, finalize." Enforces per-user quota at init. Doesn't touch bytes.

Share Link Resolver is standalone so it scales independently. Hot path for any shared file. Lightweight: look up token, check expiry and password, return permission grant.

Object Store is the source of truth for bytes. One bucket per environment, key layout that makes lifecycle and dedup easy.

Metadata DB is the source of truth for everything that isn't bytes. Sharded by owner because most queries are "show me my files."

Async virus scan pipeline is decoupled from upload latency. Files are downloadable as soon as finalized; if the scan flags them, status flips to quarantined and downloads start returning 451.

CDN is what keeps egress affordable. Without it you pay full S3 egress plus your origin bandwidth. With it, the second download of a shared file comes from edge cache at a fraction of the cost.

</details>

## Step 5: share links and permissions

Sharing has two flavors and three permission scopes.

The two flavors are direct invite (owner enters someone's email, that user must have an account, file shows up in their "shared with me" tab) and share link (owner generates a URL, anyone with the URL gets in, account may or may not be required).

The three permission scopes are view (preview-only, no download button), download (can fetch the file), and edit (can upload a new version).

What does the data model look like? How do you expire a link? How do you password-protect one? What stops an attacker from enumerating share tokens?

<details>
<summary><b>Reveal: share link design</b></summary>

Two tables.

```sql
-- Direct invites (recipient is a known user).
CREATE TABLE shares (
    share_id      UUID PRIMARY KEY,
    file_id       UUID NOT NULL,
    granted_to    BIGINT NOT NULL,    -- user_id
    granted_by    BIGINT NOT NULL,
    permission    SMALLINT NOT NULL,  -- 1=view, 2=download, 3=edit
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_shares_recipient ON shares (granted_to) WHERE revoked_at IS NULL;
CREATE INDEX idx_shares_file ON shares (file_id);

-- Anonymous or semi-anonymous share links.
CREATE TABLE share_links (
    token              VARCHAR(32) PRIMARY KEY,  -- opaque, 192-bit random
    file_id            UUID NOT NULL,
    created_by         BIGINT NOT NULL,
    permission         SMALLINT NOT NULL,
    expires_at         TIMESTAMPTZ,             -- NULL = never
    password_hash      BYTEA,                    -- NULL = no password
    require_account    BOOLEAN DEFAULT FALSE,
    max_redemptions    INT,                      -- NULL = unlimited
    redemptions        INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at         TIMESTAMPTZ
);
CREATE INDEX idx_links_file ON share_links (file_id);
```

Token generation is straightforward:

```python
token = base62(secrets.token_bytes(24))   # 24 bytes = 192 bits of entropy
```

192 bits is enormous. Birthday collision probability is negligible until you have about 2^96 tokens. You'll never collide. Crucially, that keyspace is too large to brute-force, so attackers can't enumerate.

Why opaque random instead of a hash of (file_id, salt)? Because hashed tokens are deterministic; if someone learns the salt they can compute all your tokens. Pure-random tokens have no relationship to the file they unlock, so leaking the algorithm leaks nothing.

The resolution flow for `GET /share/<token>`:

1. Look up token in `share_links`.
2. Not found, 404.
3. `revoked_at` set, 410 Gone.
4. `expires_at < now`, 410.
5. `max_redemptions` reached, 410.
6. Password required, return 401 with WWW-Authenticate; on submission, verify against the stored hash.
7. Account required, redirect to login; on return, log redemption against the user.
8. Return file_id, file_name, permission, owner_name.
9. Increment redemptions counter atomically.
10. Issue a short-lived (15-minute) download cookie or signed CloudFront URL.

The 15-minute signed URL matters. If the link itself is the only credential, then a view-only share leaks the file the moment someone right-clicks "save target as." Force every download through a signed URL that the share resolver mints fresh each time, with short expiry. View-only shares mint URLs scoped to the preview renderer only, not the raw file.

`expires_at` drives a periodic sweeper that hard-deletes very old rows (90 days past expiry) to keep the table small. Until the sweep, expired rows return 410, which is the correct response.

Password protection: bcrypt or Argon2 at create time. Verify at redeem. HTTP 401 on first request, then accept the password on a follow-up POST. Never put the password in the URL.

Rate limit per token. A single token getting 1000 redemption attempts a minute is brute-force traffic. Cap at ~10 attempts per IP per token per minute; lock the token for 5 minutes if it trips.

Direct invite permissions are simpler because the recipient is authenticated. The `shares` table is checked at file-access time: "is there a non-revoked row granting this user permission on this file?" Index on `granted_to` makes "show me shared-with-me" fast.

Permission scope semantics. View serves through a preview renderer (PDF viewer, image viewer) with `Content-Disposition: inline` and no download button shown. Determined attackers can still pull bytes; treat view-only as a soft control, not a security boundary. Download serves the original file with `Content-Disposition: attachment`. Edit is download plus the API endpoint to upload a new version.

Folder-level shares cascade to all files inside. Implementation: `shares.target_id` with `target_type = 'folder'` or `'file'`. At access-check time, traverse the parent chain: "is this file in a folder I have access to?" Cache the traversal aggressively because it's read-heavy.

</details>

## Step 6: storage tiers

A file uploaded today might be downloaded 50 times this week. A file uploaded two years ago is statistically never touched again. Paying S3 Standard rates for both is wasteful. What's the tiering strategy?

<details>
<summary><b>Reveal: lifecycle policy and tier choice</b></summary>

Three tiers.

| Tier | Use case | Cost / GB / month | Retrieval latency | Retrieval cost |
|------|----------|-------------------|--------------------|----------------|
| **Hot (S3 Standard)** | Files accessed in the last 30 days. New uploads. | $0.023 | <100ms | $0 |
| **Warm (S3 Infrequent Access)** | Files untouched 30-365 days. | $0.0125 | <100ms | $0.01 / GB retrieved |
| **Cold (S3 Glacier Flexible Retrieval)** | Files untouched > 365 days. | $0.0036 | 1-5 min (expedited) or 3-5 hr (standard) | $0.03 / GB retrieved + per-request fee |

An S3-native lifecycle policy looks like this:

```
Rule: tier-down-by-age
  Apply to: bucket prefix /raw/
  Transition to S3 IA: 90 days after upload
  Transition to S3 Glacier: 365 days after upload
  Expiration: never (we keep files until user deletes)
```

But that's crude. A file uploaded 91 days ago that's being actively downloaded shouldn't tier down. Two options to handle access patterns.

Option A is S3 Intelligent-Tiering. S3 monitors access per object and moves them between tiers automatically. Costs $0.0025 per 1000 objects per month for monitoring. Worth it once you have millions of objects with unpredictable access.

Option B is custom tiering driven by your own access stats. You log every download to a `file_access` table or stream. A daily job computes "files not accessed in N days" and explicitly transitions them via S3 SDK. More control, more code.

Pick A unless you have a specific reason to need B (compliance often requires explicit control of where data lives).

The retrieval-latency UX problem is real. A file in Glacier takes 3-5 hours to retrieve via standard retrieval. The user clicks Download and waits forever. A few ways out:

Show the wait explicitly. "This file is in cold storage. Restoring will take ~5 minutes. We'll email you when ready." Set the expectation up front.

Use Glacier Instant Retrieval instead. Costs ~3x Glacier Flexible but reads are sub-second. Worth it for files users might re-access.

Pre-warm on first share. When a user shares a Glacier-tier file, kick off restoration immediately so by the time the recipient clicks, the file is hot.

Don't tier metadata. The `files` row stays in the hot DB regardless of where the bytes live. The row has a `storage_tier` column so the API knows whether to expect latency.

Don't tier files smaller than ~128KB. S3 IA and Glacier charge minimum object sizes (128KB for IA). Tiering a 10KB file actually costs more than leaving it in Standard. Exclude small files from the lifecycle rule.

Deletion in cold tiers has its own gotcha. A user deletes a file in Glacier, the object goes away but you still pay the 90-day minimum storage charge. Factor this into your cost model and into your trash-bin retention. Soft-delete first (`status = deleted_pending`), hard-delete after the user is past the regret window.

</details>

## Follow-up questions

Try answering each in 2 to 4 sentences before reading the solution.

1. **Resumable upload across days.** A user uploads 3GB of a 5GB file, then closes their laptop. The next morning they reopen the app. What happens? How does the client know which chunks already landed? How long do you keep abandoned uploads around?

2. **Quota enforcement race.** A user has 100MB of quota left. Two clients (their phone and laptop) initiate uploads of 80MB each at the same instant. Both pass the quota check at init. Both upload. Now the user is 60MB over quota. How do you prevent this?

3. **Content-addressed dedup.** Three different users upload the same 200MB software installer. How do you store it once? What does "delete" mean when one user deletes their copy? What about privacy (knowing my hash matches yours implies we have the same file)?

4. **Share link enumeration.** Your tokens are 192 bits, so brute force is out. But a security researcher finds your `created_at` timestamps in the response and notes that links from the same minute share a creation pattern. Is this a real attack? What other side channels leak?

5. **Large file delete causing tombstone backlog.** A user with a 50TB account deletes 10TB in one click. Your metadata DB does 200k row updates and S3 issues 200k delete requests. What problems does this cause? How do you smooth it out?

6. **Virus scan returns positive after the file has been downloaded 500 times.** What is your incident response? Can you tell who downloaded it? Do you notify them? What about the share links pointing at the now-quarantined file?

7. **Edit conflict.** Two users with Edit permission upload a new version of the same file within 10 seconds of each other. Whose version wins? Both? The first? The second? How does the loser find out?

8. **A specific shared file goes viral.** A YouTuber's public share link gets 1 million download requests in 24 hours. The file is a 200MB tutorial video. Your CDN cache hits 99% but the 1% miss rate still saturates one S3 prefix. What do you do?

9. **GDPR delete.** A user requests full deletion. Their account has 12,000 files, including some that other users have copies of (via dedup). They also created share links and were granted shares on other users' files. How do you fully erase them?

10. **Cost attribution for an internal customer.** You sell this to enterprises. One enterprise customer wants a monthly invoice breakdown: storage GB by tier, egress GB, virus-scan-API calls, requests-per-million. How do you attribute every byte and every API call to a tenant?

## Related problems

- **[Video Streaming (006)](../006-video-streaming/question.md)**. Same fundamental shape: bytes in S3, metadata in a DB, CDN in front. Video adds adaptive bitrate transcoding; this problem adds share-link permissions. The storage and CDN layer overlaps heavily.
- **[Distributed Cache (009)](../009-distributed-cache/question.md)**. Hot files need an in-memory layer (or at least CDN edge cache) for popular share links. The eviction and warming patterns there apply directly.
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md)**. The "show me my files" dashboard and share-link resolution are textbook read-heavy paths. The cache tiering and read-replica strategies from that problem apply directly.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: File Upload & Share Service

### TL;DR

At first glance this is an HTTP wrapper around S3. The actual design work is everything around the bytes: how a 5GB upload survives a flaky network (chunked, presigned), how the same file uploaded by a hundred people is stored once (content-addressed dedup by SHA-256), how a single share link gets revoked instantly without invalidating the other 999 valid links (token table with `revoked_at`), and how a file nobody has touched in a year stops costing money (S3 lifecycle to IA, then Glacier).

The data model fits on a napkin. `files`, `file_versions`, `blobs`, `shares`, `share_links`, `upload_sessions`, `audit`. Bytes live in S3, addressed by content hash. Metadata is sharded by owner because almost every query is "show me my stuff." Uploads go client-to-S3 directly via presigned URLs so app servers never touch the bytes; that one decision saves an order of magnitude on bandwidth cost.

The scaling story is a four-stage journey. Stage 1 is a single app server with local disk plus Postgres for 10 users. Stage 2 moves bytes to S3 via presigned URL for 1000 users. Stage 3 adds chunked TUS-style uploads, async virus scan, a share-link service, and lifecycle policy for 100k users. Stage 4 goes regional with CDN, multi-region metadata, and per-tenant quota isolation for 1M users. At every stage, build only what just broke.

### 1. Clarifying questions, recap

The most consequential question is "max file size." Anything above about 100MB rules out single-POST and forces chunked or presigned. The second most consequential is "sync or share-only." File sync (the Dropbox desktop client) is a fundamentally different problem with delta sync, conflict resolution, and local file watchers. Share-only (Google Drive web UI) is what this problem actually is.

Everything else (versioning, virus scan, GDPR, quotas) follows from those two answers.

### 2. Capacity, with the math

At 10k users you see roughly 0.08 uploads per second sustained and 0.25 at peak. Downloads track at 0.8 per second. Storage growth is around 13TB a year. Egress at peak is maybe 100 Mbps. One server's NIC.

At 100M users it gets interesting. Uploads run ~3,300 per second sustained, ~10k at peak. Downloads ~33k sustained, ~100k peak. Storage growth is ~840 PB per year raw, ~580 PB after dedup. Egress at peak is ~6.4 Tbps. CDN is non-negotiable. By year two ~70% of stored bytes are cold; lifecycle to IA plus Glacier cuts ~70% off the cost of that tier.

Two numbers matter more than the throughput:

The system is read-heavy by request count but *write-heavy by bytes*. Uploads dominate ingress, CDN absorbs most downloads.

Storage cost is the headline expense. At PB scale, $0.023/GB/month for S3 Standard turns into hundreds of millions per year if you don't tier.

App-server bandwidth is what dies first if you tunnel uploads. A 10Gbps NIC handles maybe 150 concurrent 8MB uploads per second. Presigned URLs to S3 take that ceiling away entirely.

The metadata DB is small compared to the object store. 100B file rows at ~500 bytes is ~50TB; sharded Postgres holds this easily.

### 3. API

Five endpoints carry the whole product. Init an upload, upload chunks, finalize, create a share link, redeem it. Everything else is a read.

```
POST /api/v1/uploads/init
Authorization: Bearer <token>

{
  "file_name": "vacation.mp4",
  "size": 1572864000,                 # 1.5 GB
  "mime_type": "video/mp4",
  "content_hash": "sha256:abc123...", # client-computed for dedup hint
  "parent_folder_id": "fld_xyz",
  "client_idempotency_key": "uuid"    # retry doesn't create a new session
}
```

Responses:

| Status | Meaning | Body |
|--------|---------|------|
| 201 Created | New upload session | `{"upload_id": "...", "chunk_size": 8388608, "presigned_urls": [{"part": 1, "url": "..."}, ...], "expires_at": "..."}` |
| 200 OK | Dedup hit; file already exists; no upload needed | `{"file_id": "...", "deduped": true}` |
| 400 Bad Request | Invalid mime, oversize, name invalid | `{"error": "file_too_large", "max_bytes": 5368709120}` |
| 402 Payment Required | Out of quota | `{"error": "quota_exceeded", "available_bytes": 12345}` |
| 409 Conflict | A file with this name already exists at this path | `{"error": "name_conflict"}` |

The client then `PUT`s directly to the presigned S3 URLs. My server is not in the path. S3 returns an ETag the client must remember.

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

Redemption is `GET /api/v1/share/{token}` (with an optional password query). It returns file metadata plus a short-lived signed download URL.

Direct download is `GET /api/v1/files/{file_id}/download`, which returns a 307 redirect to a signed CloudFront URL valid for 15 minutes.

A few small but load-bearing choices:

Idempotency on upload init is required. The same `client_idempotency_key` returns the existing upload session, not a new one. Mobile clients retry on timeout; without the key, you get orphaned half-uploads.

The dedup hint at init is what makes "I'm re-uploading my photo library" instant. Client computes SHA-256 and sends it. Server checks if a blob with this hash already exists; if so, return the existing file_id and skip the upload entirely. Cheaper than the bytes ever crossing the network.

Finalize takes ETags because S3 multipart finalize needs the part list with ETags. The client tracks this; your server forwards it to S3.

### 4. Data model

Seven tables. Two large, five small.

```sql
-- Files (the user-facing entity).
CREATE TABLE files (
    file_id          UUID PRIMARY KEY,
    owner_id         BIGINT NOT NULL,
    parent_folder_id UUID,
    name             TEXT NOT NULL,
    mime_type        TEXT NOT NULL,
    size_bytes       BIGINT NOT NULL,
    content_hash     BYTEA NOT NULL,           -- SHA-256 of file contents
    current_version  INT NOT NULL DEFAULT 1,
    status           SMALLINT NOT NULL,        -- 1=uploading, 2=ready, 3=quarantined, 4=deleted
    storage_tier     SMALLINT NOT NULL,        -- 1=hot, 2=warm, 3=cold
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_files_owner ON files (owner_id, parent_folder_id);
CREATE INDEX idx_files_hash ON files (content_hash);            -- dedup lookups
CREATE INDEX idx_files_status ON files (status) WHERE status != 2;

-- File versions (history; current_version on files points at the latest).
CREATE TABLE file_versions (
    file_id          UUID NOT NULL,
    version          INT NOT NULL,
    content_hash     BYTEA NOT NULL,
    size_bytes       BIGINT NOT NULL,
    uploaded_by      BIGINT NOT NULL,
    uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_key      TEXT NOT NULL,            -- S3 key
    PRIMARY KEY (file_id, version)
);

-- Content-addressed blob registry (the dedup table).
CREATE TABLE blobs (
    content_hash     BYTEA PRIMARY KEY,
    size_bytes       BIGINT NOT NULL,
    storage_key      TEXT NOT NULL,            -- S3 key under /raw/<hash>
    refcount         INT NOT NULL DEFAULT 1,
    first_uploaded   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_tier     SMALLINT NOT NULL DEFAULT 1
);

-- Direct invites.
CREATE TABLE shares (
    share_id         UUID PRIMARY KEY,
    file_id          UUID NOT NULL,
    granted_to       BIGINT NOT NULL,
    granted_by       BIGINT NOT NULL,
    permission       SMALLINT NOT NULL,        -- 1=view, 2=download, 3=edit
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at       TIMESTAMPTZ
);
CREATE INDEX idx_shares_recipient ON shares (granted_to) WHERE revoked_at IS NULL;
CREATE INDEX idx_shares_file ON shares (file_id);

-- Share links (anonymous or semi-anonymous).
CREATE TABLE share_links (
    token            VARCHAR(32) PRIMARY KEY,
    file_id          UUID NOT NULL,
    created_by       BIGINT NOT NULL,
    permission       SMALLINT NOT NULL,
    expires_at       TIMESTAMPTZ,
    password_hash    BYTEA,
    require_account  BOOLEAN NOT NULL DEFAULT FALSE,
    max_redemptions  INT,
    redemptions      INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at       TIMESTAMPTZ
);
CREATE INDEX idx_links_file ON share_links (file_id);

-- Upload sessions (state of in-progress chunked uploads).
CREATE TABLE upload_sessions (
    upload_id        UUID PRIMARY KEY,
    user_id          BIGINT NOT NULL,
    file_name        TEXT NOT NULL,
    expected_size    BIGINT NOT NULL,
    expected_hash    BYTEA,
    chunks_uploaded  INT NOT NULL DEFAULT 0,
    total_chunks     INT NOT NULL,
    s3_upload_id     TEXT NOT NULL,            -- S3 multipart upload ID
    status           SMALLINT NOT NULL,        -- 1=active, 2=finalized, 3=abandoned
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON upload_sessions (user_id, status);
CREATE INDEX idx_sessions_expires ON upload_sessions (expires_at) WHERE status = 1;

-- Audit (append-only).
CREATE TABLE audit (
    event_id         UUID PRIMARY KEY,
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id         BIGINT,
    event_type       TEXT NOT NULL,            -- upload.initiated, file.downloaded, share.created, etc.
    file_id          UUID,
    payload          JSONB
);
CREATE INDEX idx_audit_actor ON audit (actor_id, occurred_at DESC);
CREATE INDEX idx_audit_file ON audit (file_id, occurred_at DESC);
```

A few choices worth defending out loud.

Sharded by `owner_id` because most queries are "list my files in folder X." Co-locating one user's files on one shard makes those queries single-shard. The exception is share lookups (you might be granted shares on files owned by anyone); handle that with a secondary global index on `shares.granted_to`.

`content_hash` is a real column with an index. Enables dedup at insert time. SHA-256 over a few PB of data has astronomically low collision probability; treat collisions as impossible for design purposes (and as a corruption signal if one ever appears).

The `blobs` table is separate from `files` for a reason. The blob is the actual byte payload, addressed by hash. A file is a user-named pointer to a blob. Many files can point at one blob. The `refcount` tracks how many files reference each blob; when it hits zero, the blob is eligible for deletion (with a grace period for safety).

`upload_sessions` lives in Postgres, not Redis. Sessions can live for hours and survive Redis evictions. Volume is low (one row per in-flight upload).

`audit` is append-only because every business product eventually needs compliance. Hot 90 days in Postgres, cold to S3 after that.

### 5. Core algorithms

The chunked upload state machine is small:

```python
def init_upload(user_id, file_name, size, content_hash, idempotency_key):
    # Idempotency
    existing = db.find_session_by_idempotency(user_id, idempotency_key)
    if existing:
        return existing

    # Dedup hint
    if content_hash:
        blob = db.find_blob(content_hash)
        if blob and blob.size_bytes == size:
            # Instant dedup: register a new file pointing at existing blob
            file_id = create_file_pointing_at_blob(user_id, file_name, blob)
            return {"deduped": True, "file_id": file_id}

    # Quota check (atomic; see follow-up 2)
    if not reserve_quota(user_id, size):
        raise QuotaExceeded

    # Initiate S3 multipart
    s3_upload_id = s3.create_multipart_upload(
        bucket="user-data",
        key=f"raw/pending/{uuid4()}"
    )
    chunk_size = 8 * 1024 * 1024
    total_chunks = ceil(size / chunk_size)
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

    # Complete S3 multipart
    result = s3.complete_multipart_upload(session.s3_upload_id, parts)

    # Create blob (or increment refcount if hash already exists)
    blob = db.upsert_blob(session.expected_hash, session.expected_size, result.key)

    # Create the file
    file_id = db.insert_file(session.user_id, session.file_name, blob)

    db.mark_session_finalized(upload_id)
    publish_event("file.finalized", file_id)   # triggers virus scan
    return file_id
```

Share link generation and resolution looks like this:

```python
def create_share_link(file_id, user_id, permission, expires_at=None, password=None):
    require_permission(user_id, file_id, "share")

    token = base62(secrets.token_bytes(24))      # 192-bit
    password_hash = argon2.hash(password) if password else None

    db.insert_share_link(
        token=token, file_id=file_id, created_by=user_id,
        permission=permission, expires_at=expires_at,
        password_hash=password_hash
    )
    return token

def resolve_share_link(token, supplied_password=None, viewer_user_id=None):
    link = db.find_share_link(token)
    if not link:
        return error("not_found", 404)
    if link.revoked_at:
        return error("revoked", 410)
    if link.expires_at and link.expires_at < now():
        return error("expired", 410)
    if link.max_redemptions and link.redemptions >= link.max_redemptions:
        return error("exhausted", 410)
    if link.password_hash and not argon2.verify(supplied_password, link.password_hash):
        return error("password_required", 401)
    if link.require_account and not viewer_user_id:
        return error("login_required", 302)

    if rate_limiter.too_many(token, ip):
        return error("rate_limited", 429)

    db.atomic_increment_redemptions(token)
    audit("share.redeemed", file_id=link.file_id, actor=viewer_user_id)

    download_url = cloudfront.sign(
        s3_key_for_file(link.file_id),
        expires_in=900,                          # 15 minutes
        permission=link.permission
    )
    return {
        "file": fetch_file_metadata(link.file_id),
        "permission": link.permission,
        "download_url": download_url
    }
```

The `cloudfront.sign` call produces a signed URL where the signature itself encodes "you may GET this S3 key until time T." CloudFront verifies the signature at request time and returns the file from edge cache or S3.

### 6. Architecture

Here's the whole picture. Drawn small enough to fit one screen.

```
                   +------------------+
   Clients ------> |   CloudFront     |   Edge cache for downloads.
   (web, mobile,   |   (CDN)          |   Signed URLs for permission.
    desktop)       +---------+--------+
                             |
                             v   (uncached requests)
                   +------------------+
                   |   API Gateway    |   Auth, rate limit, WAF.
                   |   + WAF          |
                   +---------+--------+
                             |
            +----------------+----------------+
            |                |                |
            v                v                v
    +-------------+   +-------------+  +--------------+
    |  Upload     |   |  File API   |  |  Share Link  |
    |  Service    |   |  (list,     |  |  Resolver    |
    |  (init,     |   |   metadata, |  |  (token ->   |
    |   finalize, |   |   delete,   |  |   file +     |
    |   sessions) |   |   download) |  |   perms)     |
    +-----+-------+   +------+------+  +------+-------+
          |                  |                 |
          |                  v                 |
          |           +------------------+     |
          |           |  Permission      |<----+
          |           |  Resolver        |   Cached "can user X
          |           |  (cached)        |   access file Y" lookups.
          |           +------------------+
          |
          |   presigned PUTs                 +-------------------------+
          +----------------------------------+    Object Store (S3)    |
                                             |                         |
          +----------------------------------+  /raw/<hash>            |
          |   signed GETs (via CloudFront)   |  /chunks/<upload_id>/<n>|
          |                                  |                         |
          v                                  |  Lifecycle:             |
   +--------------+                          |   30d -> IA             |
   |  Metadata DB |                          |   365d -> Glacier       |
   |  (Postgres,  |                          |                         |
   |   sharded    |                          +-------------------------+
   |   by         |
   |   owner_id)  |
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
   |   SQS / Kafka    |   Topics: file.finalized,
   |                  |           file.deleted,
   |                  |           share.created
   +-----+------+-----+
         |      |
         v      v
   +---------+ +-----------------+
   | Virus   | |  Lifecycle      |
   | Scan    | |  Manager        |
   | Worker  | |  (refcounts,    |
   | (Lambda | |   tiering hints,|
   |  + Clam | |   GC of orphan  |
   |  AV)    | |   chunks)       |
   +---------+ +-----------------+
```

Five things to notice while reading this.

The Upload Service mints presigned URLs but never touches the bytes. That single decision is what lets one small pod handle thousands of uploads per second. The bytes go client-to-S3.

CloudFront sits in front of S3 for downloads. Signed URLs respect share-link permissions; the cache TTL is short (60 seconds typical) so revocations propagate fast. Without it, a viral file melts S3 egress.

The Permission Resolver is a service on its own because it's the hottest read path. "Can user X do Y on file Z" combines owner check, direct share check, and folder-share inheritance. Cache the result for 30 seconds per (user, file) and most lookups never touch the DB.

Virus scan, lifecycle GC, and audit archival are all downstream of SQS or Kafka. They're not in the write path of upload finalize. If the scan worker is behind, uploads still succeed; downloads of recent uploads return 425 Too Early until the scan lands.

The metadata DB is sharded by `owner_id`. Cross-shard queries (share lookups by recipient) use a separate global index. Bytes are not the problem at scale; rows are, and rows are split by who owns them.

### 7. What an upload looks like, end to end

Here's the chunked upload flow drawn as a sequence:

```
   Client      API GW    Upload Svc       S3            DB         SQS
     |           |           |             |             |          |
     | POST /init|           |             |             |          |
     |---------->|           |             |             |          |
     |           |--validate>|             |             |          |
     |           |           | check dedup |             |          |
     |           |           |------------------------>  |          |
     |           |           |<------------------------  |          |
     |           |           |             |             |          |
     |           |           | reserve quota             |          |
     |           |           |------------------------>  |          |
     |           |           |                           |          |
     |           |           | create multipart          |          |
     |           |           |------------>|             |          |
     |           |           |<------------|             |          |
     |           |           |                           |          |
     |           |           | presign N URLs            |          |
     |           |           | insert session            |          |
     |           |           |------------------------>  |          |
     |           | 201 + URLs|             |             |          |
     |<----------|<----------|             |             |          |
     |                                                              |
     | PUT chunk 1 (directly to S3, presigned)                      |
     |--------------------------->|                                 |
     |<-- ETag 1 -----------------|                                 |
     |                                                              |
     | PUT chunk 2,3,4 in parallel                                  |
     |--------------------------->|                                 |
     |<-- ETags ------------------|                                 |
     |                                                              |
     | POST /finalize {parts:[...]}                                 |
     |---------->|           |             |             |          |
     |           |---------->|             |             |          |
     |           |           | complete multipart        |          |
     |           |           |------------>|             |          |
     |           |           |<-- key, etag|             |          |
     |           |           |                           |          |
     |           |           | BEGIN TX                  |          |
     |           |           | UPSERT blobs (refcount++) |          |
     |           |           | INSERT files (status=uploading)      |
     |           |           | INSERT audit                          |
     |           |           | COMMIT                    |          |
     |           |           |------------------------>  |          |
     |           |           |                                      |
     |           |           | emit file.finalized                  |
     |           |           |--------------------------------->    |
     |           | 200 + id  |             |             |          |
     |<----------|<----------|             |             |          |
     |                                                              |
     |                       virus scan worker consumes             |
     |                                                              |<--+
     |                       scan ClamAV                            |
     |                       UPDATE files SET status=ready          |
     |                       (or status=quarantined)                |
```

Download has its own short flow. Client hits CloudFront. Cache hit returns 302 + bytes immediately. Cache miss falls through to the File API, which checks permissions via the Permission Resolver, mints a signed CloudFront URL valid for 15 minutes, and 307s the client to it. CloudFront fetches from S3 (or origin shield) and starts caching.

Target latencies for a sense of scale: init P99 around 200ms (bottleneck is the dedup lookup when cache is cold). Finalize P99 around 500ms (S3 multipart completion latency). Permission resolution P99 around 50ms (cached). Download cache hit is whatever CloudFront's edge latency is, usually under 30ms.

### 8. Scaling journey: 10 to 1M users

The point of this section is: build only what just broke. At every stage, name the pain and the fix.

**Stage 1: 10 users (weekend project).** One small VM running Node, Go, or Python. Files saved to local disk under `/var/data/<user_id>/<file_id>`. Postgres on the same machine. Direct POST upload, files capped at 100MB. Direct invite sharing only, no anonymous links, owner-or-shared permissions only. No virus scan, no versioning, no quota. About $20 a month. Ships in a weekend.

This is enough because you have 10 users and 50 total files ever. Bandwidth is whatever the VM's NIC gives you. Nothing is big enough to fail mid-upload.

**Stage 2: 1,000 users (Series-A territory).** Something breaks. Local disk fills up. One 50GB user takes the VM into a degraded state. Backups are now your problem. A user's 2GB upload drops at 1.8GB and they have to start over. They complain on Twitter.

The fixes, in order. Move bytes to S3 via presigned PUT URLs; the app server is no longer in the byte path. Add anonymous share links with a `share_links` table and 192-bit tokens. Add the view/download/edit permission scopes. Add per-user quota (`users.quota_bytes` and `users.used_bytes`). Add soft delete with a 30-day trash bin so support stops getting "I deleted it by accident" tickets.

Still no chunked upload (presigned PUT handles up to S3's 5GB single-PUT limit). No virus scan yet, acceptable for trusted early users. No CDN. One DB, no sharding. Cost is ~$100-300 a month.

**Stage 3: 100,000 users.** Several things break at once. A power user trying to upload a 4GB video on hotel WiFi fails at 80%; the whole upload restarts; they uninstall. A malware-laden PDF gets shared and downloaded; you get a security report. Storage cost is $3-5k a month and growing 30% per quarter, with most stored bytes untouched after 30 days. `share_links` has 5M rows. S3 egress costs $2k a month because every share-link download streams full-cost from S3.

The fixes in order. Add chunked upload via S3 multipart, TUS-style protocol. Init returns a list of presigned PUT URLs (one per chunk); client uploads chunks in parallel and retries only failed chunks; finalize completes the multipart. A flaky-network 4GB upload now survives. Add the virus scan pipeline: SQS topic `file.finalized` triggers a Lambda invoking ClamAV; result updates `files.status`. Files are downloadable in the 1-3 minute gap; when the scan flags them, status flips and downloads return 451. Document the gap explicitly. Split the Share Link Resolver into its own pod set with its own read replica and a small in-process LRU for the hottest tokens. Add the S3 lifecycle policy: 30 days to IA, 365 to Glacier, saves ~70% on cold-tier cost. Put CloudFront in front of S3; signed URLs from share links route through it with a 60-second TTL so revocations propagate. Egress drops by an order of magnitude. Add two Postgres read replicas. Make quota enforcement atomic with a reservation pattern (see follow-up 2). Tier the audit log: hot 90 days in Postgres, archive to S3 Parquet after.

Still single-region. The DB doesn't need sharding yet (100M rows at ~500 bytes is 50GB, fits in one big Postgres). Server-side encryption with S3-managed keys, no client-side yet. Cost is ~$10-20k a month.

**Stage 4: 1M users (global).** New pains. EU users complain about upload latency from Berlin to us-east-1 (latency dominates RTT times chunk count). A regulated healthcare customer demands data residency. A viral share link gets 1M downloads in 24 hours; CloudFront catches 99% but the 1% concentrates on one S3 prefix and triggers throttling. Metadata DB primary at 60% CPU at peak. A quota race lets three accounts overflow by 200GB each. A 4-hour S3 outage takes everything dark.

Regional S3 buckets per region; files land in the user's home region, with lazy cross-region replication only on cross-region share access. Metadata DB sharded by `owner_id` and multi-region; each region is primary for its own users, with a global directory mapping `file_id` to home region. Share links are global; the token's first few characters encode the home region of the file so any region can route to the right backend. CloudFront with multiple origins per region; viral files get hash-prefix-sharded S3 keys so one prefix is never a bottleneck. Per-user quota cached in Redis with INCRBY for reservations and periodic reconciliation against the DB; resolves the overflow race. A daily job models per-file access patterns and pre-emptively tiers files. Enterprise tenants get a per-tenant KMS key allowing customer-controlled kill-switch. Metadata replicas in two regions for cross-region failover.

Even at 1M users you peak at ~10 uploads per second and ~100 downloads per second (most absorbed by CDN). The system is large in bytes and organizational complexity, not in QPS. The architecture is the same shape as stage 3, multiplied across regions and with isolation boundaries added. Cost ~$200-500k a month, dominated by S3 storage and egress.

What you'd do at 10M+ users: multi-tenancy becomes the primary axis (noisy-neighbor isolation, per-tenant rate limiting, per-request cost attribution). Custom layer over S3 with stronger consistency guarantees. Edge upload acceleration (upload to nearest edge, async replicate to home region). Specialized hardware for inline virus scanning to remove the async gap.

### 9. Reliability

Interrupted upload resume is built in. Upload sessions live 24 hours in `upload_sessions`. The client calls `GET /uploads/{upload_id}` to ask "which chunks have you got?" Server queries S3 `ListParts` and returns the part numbers already uploaded. Client re-uploads only the missing parts. After 24 hours, the session expires and the abandoned S3 multipart is aborted by the Lifecycle Manager (S3 charges for in-flight parts until aborted).

Orphan chunks are the Lifecycle Manager's job, running every 6 hours. For each session with `status=active AND expires_at < now()`, call `s3.abort_multipart_upload(s3_upload_id)` and mark the session abandoned. As a safety net, a global S3 lifecycle rule aborts any multipart older than 7 days.

Virus scan failures come in three flavors. A scan worker dies mid-scan, SQS visibility timeout expires, another worker picks up the message; scan result is the same, so idempotent. The third-party scan API is down: worker retries with backoff; if down for over an hour, escalate to a human queue; files remain `status=uploading` and downloads return 425 Too Early. A scan finds a virus after the file has been downloaded: flip `status=quarantined`, set `revoked_at` on all share links pointing at the file, audit log captures it, notify any downloaders with identities. The 1-3 minute window between finalize and scan completion is the exposure.

Metadata DB primary failure is standard Postgres failover. Promote a replica; reads continue from other replicas during the 30-60 second promotion. In-flight upload sessions see a few errors and retry.

S3 outage is the hardest one to design around. If the region's S3 is down, presigned PUTs return 5xx, signed GETs return 5xx, and CloudFront serves whatever it has cached. Metadata operations still work. Honest answer: wait for S3 to recover. Multi-region replication helps for read availability if you have a hot copy elsewhere; it's expensive and only justified for high-availability tiers.

### 10. Observability

| Metric | Why it matters |
|--------|----------------|
| `upload.init.rate` | Sudden drop signals auth or API issues. |
| `upload.success_rate` (finalize/init) | The headline UX SLO. If 60% of inits never finalize, something is broken. |
| `upload.bytes_per_user.p99` | Outlier detection: someone uploading 10x normal might be a backup tool gone wrong. |
| `upload.duration` by file size bucket | Lets you tell "uploads are slow" from "uploads of 1GB+ files are slow." |
| `download.rate` by file_id (top-N) | Identifies viral files; lets you pre-warm CDN. |
| `download.cache_hit_rate` (CDN) | Should be > 95% in steady state. |
| `share_link.resolution.p99` | Hot path latency. |
| `share_link.brute_force_alerts` | Tokens with > 50 failed redemption attempts in an hour. |
| `quota.exceeded.rate` | Spikes signal a user (or integration) gone rogue. |
| `virus_scan.queue_depth` | If growing, scanner can't keep up; downloads of recent uploads risk gap exposure. |
| `virus_scan.positive_rate` | Sudden spike = malware campaign. |
| `blob.refcount.zero.count` | Eligible-for-GC blobs; should drain. |
| `storage.by_tier.bytes` | Hot/warm/cold breakdown; cost forecasting input. |
| `egress.bytes_per_region` | Where the money goes. |
| `lifecycle.transition.rate` | If transitions stall, cost forecast is wrong. |

Page on: upload success rate under 90% for 5 min, virus scan queue depth over 10k, CDN origin error rate over 1%. File a ticket on: per-user bandwidth anomaly, quota race detected, storage growth more than 2σ above forecast.

### 11. Gotchas the senior interviewer is listening for

Some of these only come out when the interviewer asks "what happens if..." The senior candidate brings them up unprompted.

**File size lies in HTTP headers.** A client claims `Content-Length: 1MB` at init but uploads 5GB. Enforce size at presigned URL generation (S3 respects the `Content-Length` you sign) and at finalize (compare expected to actual). Reject mismatches.

**Quota race condition.** Two concurrent uploads from the same user both pass the check at init. Without atomic reservation, both succeed and the user is over quota. Fix: atomic `UPDATE users SET reserved_bytes = reserved_bytes + ? WHERE reserved_bytes + used_bytes + ? <= quota`. Returns 0 rows if overflow. On finalize or session-abort, reservation moves to `used_bytes` or is released.

**Share link enumeration.** Even with 192-bit tokens, side channels can leak: timing differences on lookup, error messages that distinguish "not found" from "expired," `created_at` in responses. Mitigate with constant-time response, generic "not found or expired" message, no metadata in unauthenticated responses.

**Large file delete tombstone backlog.** Deleting a 10TB folder triggers 200k row updates and 200k S3 deletes. Single-shot times out, holds DB locks, and overwhelms S3. Fix: enqueue a deletion job processing in batches of 1000 with rate limiting; UI shows "deletion in progress" until done.

**Dedup with privacy.** Knowing your file's SHA-256 matches another user's leaks the fact that you both have the same file. For most use cases this is fine; for high-privacy products (legal, healthcare) skip dedup or do it only within a single tenant.

**Presigned URL TTL too long.** A presigned URL valid for 24 hours that leaks (logs, chat, CI variables) is a 24-hour data breach. Default to 1 hour for upload, 15 minutes for download. Re-mint on retry.

**Refcount race in dedup.** Two users delete the last two files referencing a blob at the same instant. Without atomicity, both see `refcount=2`, both decrement to 1, blob never GC'd; or both see `refcount=1`, both delete, the second user's data is lost. Fix: atomic `UPDATE blobs SET refcount = refcount - 1 WHERE content_hash = ? RETURNING refcount`. Only the transaction that returns 0 triggers actual S3 deletion, and that deletion is deferred by 24 hours in case a new file is created with the same hash.

**Folder permission inheritance is recursive.** Sharing a folder grants access to all descendants. Checking "can user X view file Y" walks Y's parent chain looking for a share grant. Cache aggressively (per `(user, file)` for 30s) or denormalize by materializing the closure on share-grant changes.

**Glacier retrieval latency surprises users.** Standard retrieval takes 3-5 hours. User clicks Download and waits hours. Either use Glacier Instant Retrieval (3x cost, sub-second) or set explicit expectations ("Restoring; we'll email when ready").

**Versioning interacts with dedup.** A user uploads `report.pdf`, then a slightly edited `report.pdf`. Two versions, two blobs (different hashes), both stored. After 10 edits, the file has 10 blobs even though most pages are identical. For large editable files, consider block-level dedup; for documents, accept the cost.

### 12. Follow-up answers

**1. Resumable upload across days.** The client persists `upload_id` locally. On reopen, it calls `GET /uploads/{upload_id}`. Server queries S3 `ListParts` for the multipart upload, returns the list of uploaded part numbers and the original chunk size. Client uploads only the missing parts and finalizes. If `upload_id` is past the 24-hour TTL (session expired, multipart aborted), the client gets 410 Gone and must start a new upload. Abandoned sessions are GC'd every 6 hours by the Lifecycle Manager calling `AbortMultipartUpload` on S3 and marking the session row abandoned.

**2. Quota enforcement race.** Common and real. Fix it with an explicit reservation column:

```sql
UPDATE users
SET reserved_bytes = reserved_bytes + ?
WHERE user_id = ?
  AND used_bytes + reserved_bytes + ? <= quota_bytes
RETURNING reserved_bytes;
```

If this returns 0 rows, the upload is rejected. Reservation is held until upload finalize (moves to `used_bytes`) or session expiry (released back). At higher scale the same logic runs in Redis with `INCRBY` and CAS, with periodic reconciliation back to the DB.

**3. Content-addressed dedup.** A `blobs` table keyed by SHA-256. On finalize, `INSERT INTO blobs... ON CONFLICT (content_hash) DO UPDATE SET refcount = refcount + 1`. The S3 key is `/raw/<hash>`; if the blob exists, no new S3 object is written. The `files` row points at the blob.

Delete decrements the blob's refcount atomically. When refcount hits zero, schedule the blob's S3 object for deletion after a 24-hour grace period (in case a new file is created with the same hash).

Privacy: dedup can leak existence. If you upload a file and it dedups instantly, you've confirmed someone else has the same content. For sensitive use cases (legal, medical), disable cross-tenant dedup; dedup only within a single account.

**4. Share link enumeration.** 192 bits of entropy makes direct brute-force impossible. Side channels are the concern. Timing: token-not-found vs token-found-but-expired should take the same time. Use constant-time comparison and unified error paths. Error responses: return the same generic 404 for "no such token" and "expired" (or 410 for both); don't include `expired_at` in unauthenticated responses. Predictable creation timestamps: pure-random tokens from `secrets.token_bytes` leak nothing. Rate limiting: per-IP limits on `/share/*` thwart any high-volume probing. Web logs: tokens appear in access logs; treat them as secrets, scrub from logs or hash before logging.

**5. Large delete tombstone backlog.** A 10TB delete triggers 200k file row updates and 200k S3 DELETE requests. Synchronously: HTTP timeout, DB lock contention, S3 throttling, user clicks Delete again, double the load.

The fix is to write a single `deletion_jobs` row `(user_id, target_folder_id, requested_at)` and return 202 Accepted with a job_id. A background worker processes the job in batches of 1000: soft-delete in DB (status flip + `deleted_at`), decrement blob refcounts, enqueue S3 deletion (S3 bulk-delete handles 1000 objects per call). UI shows "deletion in progress" with a progress bar; items disappear from listings immediately (filtered by status). After 30 days (trash retention), a separate sweeper hard-deletes from S3 the blobs whose refcount reached zero.

**6. Virus scan returns positive late.** Incident response in order: flip `status` to quarantined; `UPDATE share_links SET revoked_at = NOW() WHERE file_id = ?`; invalidate CloudFront for the file's signed URL prefix; query the `audit` table for `event_type = 'file.downloaded' AND file_id = ?` to identify downloaders (user_ids for authenticated, IPs for share-link); notify authenticated downloaders in-app and by email ("A file you downloaded was later found to contain malware; we recommend you scan your system"); anonymous downloaders can't be notified directly but the share link itself now displays a warning; notify the uploader ("Your file was flagged; if this was a mistake, request rescan"). Pre-mitigation: keep the post-finalize, pre-scan window short. Faster scanning narrows the exposure.

**7. Edit conflict.** Two users with Edit upload new versions within 10 seconds. Default: both succeed; both create new versions. `file_versions` has rows `version=2` (first to land) and `version=3` (second). `files.current_version` points to version 3. The losing user's version still exists in history. The system surfaces a conflict notification: "User B also uploaded a new version of this file at the same time. Your version is current; theirs is at /history/version/2." For stronger guarantees, add an optional `If-Match: <current_version>` header on upload; mismatch returns 412 Precondition Failed and the client surfaces a conflict UI.

**8. Viral share link.** 200MB video, 1M downloads in 24h, 99% CDN cache hit. The 1% miss is 10k requests to origin S3 over 24h, about 0.1 req/sec on average; that's fine for S3 overall. The concern is *prefix throttling*: S3 limits requests per prefix to 5500 GET/s. If all those requests hit one prefix at one moment, you get 503s.

Mitigations: pre-warm CDN edges when a link is created with a known-popular file (push to all CloudFront edges immediately rather than waiting for first-miss). Spread the prefix by storing blobs at `/raw/<hash[0:2]>/<hash[2:4]>/<hash>` so popular files land on different prefixes naturally. CloudFront origin shield acts as a regional cache between edges and S3, collapsing many edge misses into one S3 fetch. For enterprise tier, multi-CDN (CloudFront plus Fastly plus Akamai) for resilience.

**9. GDPR delete.** Multi-step process for a user with 12,000 files. First, `UPDATE users SET deletion_requested_at = NOW(), status = 'deleting'`; user is logged out and account read-only frozen. Enqueue a `deletion_jobs` row to trigger background processing. Walk owned files: decrement each blob's refcount, update audit, revoke all share links the user created. Walk received shares: set `revoked_at` on each row where the user is `granted_to` (the user loses access; the file itself remains for the owner). Walk audit log: replace `actor_id` with a hash, drop PII from payloads. Delete the user row after the grace period (often 30 days). Email the deletion certificate.

The tricky bit: files deduped with other users. Decrementing the refcount may leave the blob alive because other users still reference it. That's correct; the user's *pointer* is gone, even though the bytes might persist (referenced by someone else). If the user demands the bytes be deleted regardless: disable dedup for that user retroactively (copy the blob to a user-private location for any remaining references, then delete the original). Expensive; only do on explicit request.

**10. Cost attribution per tenant.** Every billable action gets tagged with `tenant_id`. Storage: S3 inventory runs daily, lists all objects with size and tier; each object's key embeds `tenant_id` (`/raw/<tenant>/<hash>`); aggregate by tenant. Egress: CloudFront real-time logs include the request URL; URLs encode tenant_id; daily job aggregates bytes-out per tenant. API requests: API Gateway access logs include the JWT's `tenant_id` claim; aggregate per tenant per endpoint. Virus scan API costs: scan worker records each scan in a `scan_invocations` table with `tenant_id`. A nightly job rolls these into a `billing_lines` table:

```
tenant_id | period | storage_hot_gb | storage_warm_gb | storage_cold_gb | egress_gb | api_requests | scan_calls
```

Invoice generation reads this table. Spot-check: the sum of per-tenant attributions should match your AWS bill within ~1%; gaps are platform overhead, S3 inventory itself, etc.

### 13. Trade-offs worth saying out loud

**Single big PUT vs chunked.** Single PUT is simpler for files under 100MB and supported by every HTTP client. Chunked (S3 multipart, TUS) is necessary above 5GB (S3's single-PUT limit) and strongly recommended above 100MB for network resilience. The right answer is hybrid: single PUT below a threshold, chunked above.

**Client-side encryption.** Optional but important for high-security customers. Encrypt with a key the server never sees; server stores ciphertext. Tradeoffs: no dedup possible (ciphertext differs even for identical plaintext), no server-side preview (can't render an encrypted PDF), key management burden is now the customer's. Implement as an opt-in for enterprise tier.

**Dedup by content hash.** Saves ~30% on storage at consumer scale (people share popular files), less in business contexts (everyone uploads unique documents). Adds complexity: refcount management, GC, blob lifecycle, privacy considerations. Worth it at scale; skip for the first 1000 users.

**Lifecycle to cold tier.** Saves 50-70% of storage cost on the cold tail. Costs: retrieval latency surprises users, retrieval fees on access, minimum-storage-duration penalties on early delete. Tune the transition age to your actual access pattern; default 90 days is usually too aggressive (some files are bursty re-accessed in week 5).

**Postgres vs DynamoDB for metadata.** Postgres gives you joins, transactions, and a familiar query layer. DynamoDB gives you infinite horizontal scale and predictable latency. For metadata under 100M files, Postgres is simpler. Above that, sharding Postgres becomes annoying and DynamoDB is worth considering. Don't switch preemptively.

**Synchronous vs async virus scan.** Sync blocks the upload UX (a 2GB file's scan takes minutes) but guarantees zero exposure. Async returns immediately and accepts a 1-3 minute exposure window. Almost everyone picks async; the exposure is small and the UX win is large.

### 14. Common interview mistakes

Most weak answers fall into one of these.

**Tunneling uploads through your app server.** The single biggest scaling mistake. Bandwidth cost is per-byte; doubling traffic doubles your NIC bill. Presigned-direct-to-S3 (or equivalent for non-S3 storage) is non-negotiable above ~100 concurrent uploads.

**Single POST for all uploads.** Works until the first 4GB upload fails on hotel WiFi. Chunked is mandatory above ~100MB; lower the threshold if your users are on mobile networks.

**No quota enforcement at all.** "We'll add it later" turns into "one user uploaded their entire Steam library and ate our budget." Quota at signup is easier than quota retrofitted.

**Forgetting to GC abandoned uploads.** S3 multipart uploads that never finalized continue to cost money. A nightly sweeper catches them; an S3 lifecycle rule that aborts multiparts older than 7 days is the safety net.

**Share links that are just file IDs in the URL.** `https://app.com/file/abc123` is not a share link; it's a permanent backdoor. Use an opaque high-entropy token with explicit expiry and revocation.

**No virus scan at all.** Acceptable for an internal tool, indefensible for a public product. Even basic ClamAV catches most known malware and signals to your incident-response process that scanning exists.

**Hot path doing folder traversal for permissions.** "Is this file in any folder shared with me?" naive implementation walks the parent chain on every download. Cache or materialize the access set per user.

**Skipping the `status` field.** Without an explicit upload/ready/quarantined/deleted state machine, you end up with weird edge cases (downloads of half-finalized files, deletes of in-flight uploads). The `files.status` smallint pays for itself in week 1.

**Mixing user files and system files in one bucket without prefixing.** Lifecycle rules apply to a bucket or prefix; if you mix, you can't tier user files independently of thumbnails or temp data. Pick a prefix scheme on day one.

**No audit log.** When the security report comes in ("user X claims their file was leaked"), the lack of "who accessed this and when" turns a 1-hour investigation into a 1-week investigation. Audit is cheap to build, painful to retrofit.

If you can hit 7 of these 10 and walk through the upload-protocol trade-off and the scaling journey in the same conversation, you're interviewing well above the bar.
{% endraw %}
