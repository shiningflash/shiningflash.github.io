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

This problem looks like a CRUD app sitting on top of S3. It is not. The interesting parts are: how the upload survives a flaky hotel WiFi for a 4GB video, how a share link can be revoked without invalidating every other link, how the same file uploaded by 50 people is stored once, and how a file that nobody has touched for two years stops costing you anything.

The candidate who jumps to "we POST the file to S3 and store a row in Postgres" loses 60% of the depth of the problem. We are going to walk through every layer.

## Step 1: clarify before you design

Take 6 minutes. Aim for at least 8 questions that meaningfully change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Max file size.** "5GB was mentioned. Are there hard cutoffs? What about a 50GB video?" A 5GB cap rules out single-PUT uploads and forces chunked or multipart. A 50GB cap forces presigned-direct-to-S3 because tunneling through your app servers is bandwidth suicide.
2. **Sync versus share-only.** "Is this Dropbox-the-sync-client, or Google-Drive-the-web-share? Sync means delta-sync, conflict resolution, and local file watchers. Share-only is a much smaller problem." Almost always the answer is share-only for an interview; sync is its own design.
3. **Virus scanning.** "Do we scan uploads? Synchronously block on the result, or async-quarantine after the fact?" Sync scan is slow and breaks the upload UX. Async means a file can be downloaded for a few minutes before being quarantined.
4. **Versioning.** "Does editing a file create a new version, or overwrite? How many versions kept? Forever or 30 days?" Versions multiply storage cost. A safe default is 10 versions or 30 days, whichever comes first.
5. **Bandwidth limits.** "Per-user upload and download caps? Per-account total storage quota?" Quotas are not optional once you have a free tier. The check has a sneaky race condition we will come back to.
6. **Sharing model.** "Link share (anyone with the link), direct invite (must have an account), or both? What permission scopes: view-only preview, download, edit?" Each scope has security implications and changes the download URL flow.
7. **File preview.** "Do we render PDFs and images in the browser, or just offer download?" Preview means a thumbnailing pipeline, which is a sub-service in itself.
8. **Compliance and retention.** "Are we GDPR-required to fully delete on request? Are there industries (healthcare, finance) that require encryption-at-rest with customer-managed keys?" The answer changes the storage layer.
9. **Geographic reach.** "Single region or global? If global, do we replicate files between regions or only metadata?" File replication is expensive; metadata replication is cheap.
10. **Authentication.** "Existing auth system, or do we build it? Single-sign-on?" Out of scope for most interviews, but worth confirming.

A strong candidate also names what is *out* of scope: real-time collaborative editing (Google Docs), full-text search inside documents, integrations with third-party apps. These are downstream products built on top of the storage primitive.

</details>

## Step 2: capacity estimates

The interviewer gives you two regimes.

**Small startup:**
- 10,000 users
- Average 5 file uploads per user per week, average size 5MB
- Reads (downloads + previews) 10x writes

**Dropbox-scale:**
- 100M active users
- Average 20 uploads per user per week, average size 8MB (mix of photos, docs, occasional video)
- Reads 10x writes
- Storage retention: indefinite by default

Compute, for both:

1. Uploads per second (sustained and peak)
2. Downloads per second
3. Storage growth per year (raw, before dedup)
4. Egress bandwidth at peak download
5. How much storage gets stale (untouched for 90 days) in year 2

<details>
<summary><b>Reveal: the math</b></summary>

**Small startup (10k users):**

- Uploads: 10,000 × 5 / week = 50,000/week = ~7,000/day = **~0.08 uploads/sec sustained**, ~0.25 peak. Trivial.
- Downloads: 10x = ~0.8/sec sustained, ~2.5 peak. Still trivial.
- Storage growth: 50,000/week × 5MB × 52 = ~13TB/year. Fits in one S3 bucket with no thought.
- Egress at peak: 2.5 downloads/sec × 5MB = 12.5 MB/s = ~100 Mbps. Modest.
- Stale at year 2: probably 60-70% of files (most uploads are looked at once, never again).

A single app server plus S3 plus Postgres handles all of this. The system is not interesting from a throughput angle. It is interesting because of the upload UX for a 5GB file and the share-link permission model.

**Dropbox-scale (100M users):**

- Uploads: 100M × 20 / week = 2B/week ≈ 286M/day ≈ **~3,300 uploads/sec sustained**, ~10k peak.
- Downloads: 10x = ~33,000/sec sustained, ~100k peak.
- Storage growth: 286M/day × 8MB ≈ 2.3 PB/day ≈ **~840 PB/year before dedup**. With ~30% dedup savings (people share popular images, identical PDFs, etc.) call it ~580 PB/year.
- Egress at peak: 100k × 8MB = 800 GB/s = ~6.4 Tbps. This is CDN territory; you cannot serve this from a single region without it.
- Stale at year 2: roughly 70-80% of stored bytes are untouched for 90 days. At 1.2EB stored after 2 years, ~900PB is cold. Lifecycle policy to S3 IA + Glacier saves ~70% of storage cost on that tier.

**Key insights from the math:**

- **The system is read-heavy by request count but write-heavy by bytes.** Uploads dominate ingress bandwidth; downloads (with CDN) dominate egress to end users.
- **Storage cost is the headline expense.** At 840 PB/year × ~$0.023/GB/month (S3 standard), you are paying ~$230M/year for raw storage. Lifecycle policies and dedup are not optimizations, they are survival.
- **Per-server bandwidth is the bottleneck if you tunnel uploads through app servers.** A 10Gbps NIC at 100% sustained handles ~1.25 GB/s, which is ~150 concurrent uploads of an 8MB file per second. You will run out of NICs long before you run out of CPU. Hence presigned URLs.
- **The metadata DB is small.** 100M users × 1000 files/user = 100B files × ~500 bytes/row = ~50TB. Sharded Postgres or a wide-column store handles it. The bytes are in S3; the metadata is what you actually run a database for.

</details>

## Step 3: upload protocols

The single biggest design decision is *how the bytes get from the client to your storage*. Three serious options. Take 10 minutes to write down the pros and cons of each before peeking.

- **A. Direct upload (single HTTP POST).** Client streams the whole file in one request to your API server, which forwards to S3.
- **B. Chunked resumable upload (TUS protocol, or S3 multipart).** Client splits the file into 5-100MB chunks and uploads them with retry-per-chunk semantics.
- **C. Presigned S3 URL.** Your server hands the client a short-lived signed URL; the client uploads directly to S3, skipping your app servers entirely.

<details>
<summary><b>Reveal: comparison</b></summary>

| Approach | How it works | Pros | Cons |
|----------|-------------|------|------|
| **Direct (single POST)** | `POST /upload` with multipart body. Server buffers or streams to S3. | Simple. One request, one response. Works in any HTTP client. | Whole upload restarts on any network blip. 4GB upload on hotel WiFi never finishes. Saturates your app server bandwidth. Hard to show real progress. |
| **Chunked resumable (TUS, S3 multipart)** | Initiate session → upload chunk 1 of N → ... → finalize. Each chunk is its own HTTP request. Failed chunks retry independently. | Survives flaky networks. Real progress bars. Parallel chunk upload speeds large files. Server can pause and resume. | More complex protocol. Server tracks per-session state (which chunks landed). Garbage collection of abandoned uploads. |
| **Presigned S3 URL** | `POST /upload/init` returns a presigned URL valid for ~1h. Client `PUT`s directly to S3. On success, client calls `POST /upload/finalize` so server knows. | Zero bandwidth through your servers. Cheapest at scale. S3 handles the heavy lifting. Can combine with multipart for huge files. | Client must speak S3 directly. Quota enforcement is harder (server didn't see the bytes). Virus scan is post-hoc. Signed URL leaks = anyone can upload to that key. |

**The recommendation: chunked + presigned, depending on file size.**

- Files under 5MB: single POST through the app server is fine. Simpler client.
- Files 5MB to 5GB: presigned S3 multipart upload. Client splits into 8MB chunks, gets a presigned URL per chunk (or one initiation token), uploads chunks in parallel directly to S3, calls finalize when done.
- Files over 5GB: same as above but bumped chunk size to 64MB and enforced server-side limits.

The hybrid keeps the API simple for the common case and offloads the painful case (big files) to S3 entirely.

**Why TUS at all?** TUS (`tus.io`) is an open protocol for resumable uploads. It is implemented as a Go/Node server library that the client speaks to. Useful if your storage is not S3 (some companies use MinIO, NetApp, or their own object store) and you want to give clients a standard protocol. If you are on AWS, S3 multipart is more native; TUS is for the "S3 alternative" case.

</details>

## Step 4: incomplete architecture diagram

Sketch the high-level architecture. Fill in the five `[ ? ]` boxes. Each placeholder is one of: upload service, object store, metadata DB, share link resolver, virus scanner.

```
                Client (browser, mobile, desktop sync agent)
                              │
                              ▼
                    ┌──────────────────┐
                    │   API Gateway    │  (auth, rate limit, request shaping)
                    └────────┬─────────┘
                             │
        upload init,         │       download,
        finalize, list       │       share link redeem
                             │
                ┌────────────┼────────────┐
                │                         │
                ▼                         ▼
        ┌─────────────┐            ┌─────────────┐
        │  [ ? ]      │            │  [ ? ]      │   (resolves /share/<token>
        │             │            │             │    to a file + permission)
        └─────┬───────┘            └──────┬──────┘
              │                            │
              │   presigned URLs           │
              │                            │
              ▼                            ▼
        ┌──────────────────────────────────────┐
        │  [ ? ]                               │  (the bytes live here;
        │                                      │   cheap, durable, huge)
        └──────────────────────────────────────┘
              ▲
              │
              │   reads/writes
              │
        ┌─────┴────────┐
        │  [ ? ]       │   (file_id, owner, name, size,
        │              │    hash, status, version)
        └──────────────┘

        Async pipeline:
            ┌──────────────────┐
            │  [ ? ]           │  (consumes "file finalized" events,
            │                  │   scans, marks quarantined if positive)
            └──────────────────┘
```

<details>
<summary><b>Reveal: completed architecture</b></summary>

```
                Client (browser, mobile, desktop sync agent)
                              │
                              ▼
                    ┌──────────────────┐
                    │   API Gateway    │  (auth, rate limit, request shaping,
                    │   + WAF          │   blocks obvious abuse)
                    └────────┬─────────┘
                             │
        upload init,         │       download,
        finalize, list       │       share link redeem
                             │
                ┌────────────┼────────────┐
                │                         │
                ▼                         ▼
        ┌─────────────────┐         ┌──────────────────┐
        │  Upload Service │         │  Share Link      │
        │  (mints         │         │  Resolver        │
        │   presigned     │         │  (token →        │
        │   URLs, tracks  │         │   file + perms,  │
        │   session       │         │   checks expiry, │
        │   state)        │         │   password)      │
        └─────┬───────────┘         └──────┬───────────┘
              │                            │
              │   presigned PUT URLs       │  presigned GET URLs
              │                            │  (with CloudFront signing)
              ▼                            ▼
        ┌──────────────────────────────────────┐
        │  Object Store (S3)                   │  Standard tier for hot,
        │  Bucket layout:                      │  IA after 90 days,
        │   /raw/<file_id>/<version>           │  Glacier after 365.
        │   /chunks/<upload_id>/<n>            │  Lifecycle policy auto-migrates.
        └──────────────────────────────────────┘
              ▲
              │
              │   metadata reads/writes
              │
        ┌─────┴────────────────┐
        │  Metadata DB         │   Tables: files, file_versions,
        │  (Postgres, sharded  │   shares, share_links, audit.
        │   by owner_id)       │   Sharded by owner_id; cross-shard
        │                      │   share lookups via separate index.
        └──────────────────────┘

        Async pipeline:
                                       (file finalized event)
                                  ┌─────────────────────────┐
                                  │  SQS / Kafka            │
                                  └──────────┬──────────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  Virus Scan Worker   │  ClamAV or
                                  │  (Lambda or          │  3rd-party API
                                  │   long-running pod)  │  (VirusTotal).
                                  │                      │  Marks file
                                  │                      │  status =
                                  │                      │  quarantined
                                  │                      │  if positive.
                                  └──────────────────────┘

        CDN for downloads:
            ┌──────────────────┐
            │  CloudFront      │  Signed URLs respect share link
            │  in front of S3  │  permissions. Edge cache hot files.
            └──────────────────┘
```

Why each piece is here:

- **API Gateway + WAF.** Auth, rate limit (no client uploads 10k files in a minute), block obvious malicious requests.
- **Upload Service.** Owns the upload session lifecycle. Mints presigned URLs. Tracks "upload_id → chunks uploaded → finalize." Enforces per-user quota on init.
- **Share Link Resolver.** Standalone service so it can scale independently. Hot path for any shared file. Lightweight: look up token in DB, check expiry/password, return permission grant.
- **Object Store (S3).** Source of truth for bytes. Bucket per environment, key layout that makes lifecycle and dedup easy.
- **Metadata DB.** Source of truth for everything that is not bytes. Sharded by owner because most queries are "show me my files."
- **Async virus scan pipeline.** Decoupled from upload latency. Files are downloadable as soon as finalized; if scan flags them, status flips to `quarantined` and downloads start returning 451.
- **CDN.** Without it, you pay full S3 egress + your origin bandwidth. With it, the second download of a shared file comes from edge cache at a fraction of the cost.

</details>

## Step 5: share links and permissions

Sharing has two flavors and three permission scopes. Walk through the design of each.

**Two flavors:**

1. **Direct invite.** Owner enters another user's email. That user must have an account. The invited user sees the file in their "shared with me" tab.
2. **Share link.** Owner generates a URL. Anyone who has the URL can access. No account required (or required, configurable).

**Three permission scopes:**

- **View.** Preview-only (rendered in browser, no download button).
- **Download.** Can fetch the file.
- **Edit.** Can upload a new version.

What does the data model look like? How do you expire a share link? How do you password-protect one? What stops an attacker from enumerating share tokens?

<details>
<summary><b>Reveal: share link design</b></summary>

**Two tables:**

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

-- Anonymous/semi-anonymous share links.
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

**Token generation:**

```python
token = base62(secrets.token_bytes(24))   # 24 bytes = 192 bits of entropy
```

192 bits is enormous. The birthday collision probability is negligible until you have ~2^96 tokens. Practically: you will never collide. Crucially, 192 bits also means an attacker cannot enumerate; the keyspace is too large to brute-force.

Why opaque random, not a hash of (file_id, salt)? Because hashed tokens are deterministic; if someone learns the salt they can compute all your tokens. Pure-random tokens have no relationship to the file they unlock, so leaking the algorithm leaks nothing.

**Resolution flow (`GET /share/<token>`):**

```
1. Look up token in share_links table.
2. If not found → 404.
3. If revoked_at is not null → 410 Gone.
4. If expires_at < now → 410 Gone.
5. If max_redemptions is set and redemptions >= max → 410 Gone.
6. If password_hash is set, demand password (return 401 with WWW-Authenticate);
   on submission, verify against stored hash.
7. If require_account, redirect to login; on return, log redemption against user.
8. Return: {file_id, file_name, permission, owner_name}.
9. Increment redemptions counter (atomic).
10. Issue a short-lived (15-min) download cookie or signed CloudFront URL.
```

**Why a 15-minute signed URL and not a permanent download endpoint:**

If the link itself is the only credential, then a "view-only" share leaks the file the moment someone right-clicks "save target as." Force every download through a signed URL that the share resolver mints fresh each time and that expires quickly. View-only shares mint URLs scoped to the preview renderer only, not the raw file.

**Expiring links.** The `expires_at` column drives a periodic sweeper that hard-deletes very old rows (90 days past expiry) to keep the table small. Until the sweep, expired rows return 410, which is the correct response.

**Password protection.** Bcrypt or Argon2 the password at create time. At redeem, compare. Use HTTP 401 on first request, then accept the password on a follow-up POST. Don't ever put the password in the URL.

**Rate limit per token.** A single token getting 1000 redemption attempts per minute is brute-force traffic. Limit to ~10 redemption attempts per IP per token per minute; lock the token for 5 minutes if the limit trips.

**Direct invite permissions:** simpler because the recipient is authenticated. The `shares` table is checked at file-access time: "is there a non-revoked row granting this user permission on this file?" Index on `(granted_to)` makes "show me shared-with-me" fast.

**Permission scope semantics:**

- View: download URL serves the file through a preview renderer (PDF viewer, image viewer) with `Content-Disposition: inline`. No "download original" button shown. Determined attackers can still pull bytes; treat view-only as a soft control, not a security boundary.
- Download: signed URL serves the original file with `Content-Disposition: attachment`.
- Edit: same as download, plus the API endpoint to upload a new version is permitted.

**Folder-level shares.** If you support folders, sharing a folder cascades to all files inside. Implementation: `shares.target_id` with `target_type = 'folder'` or `'file'`. At access-check time, traverse the parent chain: "is this file in a folder I have access to?" Cache the traversal aggressively because it is read-heavy.

</details>

## Step 6: storage tiers

A file uploaded today might be downloaded 50 times this week. A file uploaded two years ago is statistically never touched again. Paying S3 Standard rates for both is wasteful. Walk through the tiering strategy.

<details>
<summary><b>Reveal: lifecycle policy and tier choice</b></summary>

**Three tiers:**

| Tier | Use case | Cost / GB / month | Retrieval latency | Retrieval cost |
|------|----------|-------------------|--------------------|----------------|
| **Hot (S3 Standard)** | Files accessed in the last 30 days. New uploads. | $0.023 | <100ms | $0 |
| **Warm (S3 Infrequent Access)** | Files untouched 30-365 days. | $0.0125 | <100ms | $0.01 / GB retrieved |
| **Cold (S3 Glacier Flexible Retrieval)** | Files untouched > 365 days. | $0.0036 | 1-5 min (expedited) or 3-5 hr (standard) | $0.03 / GB retrieved + per-request fee |

**Lifecycle policy (S3 native, no code required):**

```
Rule: tier-down-by-age
  Apply to: bucket prefix /raw/
  Transition to S3 IA: 90 days after upload
  Transition to S3 Glacier: 365 days after upload
  Expiration: never (we keep files until user deletes)
```

But this is too crude. A file uploaded 91 days ago that is being actively downloaded should *not* tier down. Two options:

**Option A: Use S3 Intelligent-Tiering.** S3 monitors access patterns per object and moves them between tiers automatically. Costs $0.0025 per 1000 objects per month for monitoring. Worth it once you have millions of objects with unpredictable access.

**Option B: Custom tiering driven by your own access stats.** You log every download to a `file_access` table or stream. A daily job computes "files not accessed in N days" and explicitly transitions them via S3 SDK. More control, more code.

Pick A unless you have a specific reason to need B (compliance often requires explicit control of where data lives).

**The retrieval-latency UX problem.** A file in Glacier takes 3-5 hours to retrieve via standard retrieval. The user clicks Download and waits forever. Solutions:

- **Show the wait explicitly.** "This file is in cold storage. Restoring will take ~5 minutes. We'll email you when ready." Set the user expectation up front.
- **Use Glacier Instant Retrieval tier instead.** Costs ~3x Glacier Flexible but reads are sub-second. Worth it for files users might re-access.
- **Pre-warm on first share.** When a user shares a Glacier-tier file, kick off restoration immediately so by the time the recipient clicks, the file is hot.

**Don't tier metadata.** The `files` row stays in the hot DB regardless of where the bytes live. The row has a `storage_tier` column so the API knows whether to expect latency.

**Don't tier files smaller than ~128KB.** S3 IA and Glacier charge minimum object sizes (128KB for IA). Tiering a 10KB file actually costs more than leaving it in Standard. Exclude small files from the lifecycle rule.

**Deletion in cold tiers.** A user deletes a file that lives in Glacier. The object is deleted from Glacier with a 90-day minimum storage charge (you pay for 90 days even if you delete on day 2). Factor this into your cost model and into your "trash bin" retention. Soft-delete first (status = `deleted_pending`), hard-delete after the user is past the regret window.

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
## Solution: Design a File Upload & Share Service (Dropbox-lite)

### TL;DR

A file upload and share service is, at first glance, an HTTP wrapper around S3. The interesting design work is everything around the bytes: how a 5GB upload survives a flaky network (chunked, presigned), how the same file uploaded by 100 people is stored once (content-addressed dedup by SHA-256), how a share link can be revoked instantly without invalidating the other 999 valid links (token table with revoked_at), and how a file that nobody has touched for a year stops costing money (S3 lifecycle to IA, then Glacier).

The data model is small: `files`, `file_versions`, `shares`, `share_links`, `audit`. The bytes live in S3, addressed by content hash. The metadata DB is sharded by owner because almost every query is "show me my stuff." Uploads route directly client-to-S3 via presigned URLs so app servers never touch the bytes; that one decision saves an order of magnitude on bandwidth cost.

The scaling story is a four-stage journey. Stage 1 is a single app server with local disk plus Postgres for 10 users. Stage 2 moves bytes to S3 via presigned URL for 1000 users. Stage 3 adds chunked TUS-style uploads, async virus scan, share-link service, and lifecycle policy for 100k users. Stage 4 goes regional with CDN, multi-region metadata, and per-tenant quota isolation for 1M users. At every stage you add only what just broke.

### 1. Clarifying questions

Covered in `question.md`. The most consequential question is "max file size", because anything above ~100MB rules out single-POST uploads and forces chunked or presigned. The second most consequential is "sync or share-only", because file sync (Dropbox the desktop client) is a fundamentally different problem with delta sync, conflict resolution, and local file watchers; share-only (Google Drive web UI) is what this problem actually is.

### 2. Capacity estimates (full working)

**Small startup (10k users):**

- Uploads: ~7,000/day = 0.08/sec sustained, ~0.25/sec peak. Trivial.
- Downloads: 0.8/sec sustained. Trivial.
- Storage growth: ~13TB/year. One bucket, no thought.
- Egress at peak: ~100 Mbps. One server's NIC.

**Dropbox-scale (100M users):**

- Uploads: ~3,300/sec sustained, ~10k/sec peak.
- Downloads: ~33k/sec sustained, ~100k/sec peak.
- Storage growth: ~840 PB/year raw, ~580 PB after dedup.
- Egress at peak: ~6.4 Tbps. CDN is non-negotiable.
- Cold storage (untouched > 90 days) by year 2: ~70% of stored bytes. Lifecycle to IA + Glacier cuts ~70% off the cold tier cost.

**Key insights:**

- Read-heavy by request count, write-heavy by bytes. Uploads dominate ingress, CDN absorbs most downloads.
- Storage cost is the dominant line item. At PB scale, $0.023/GB/month for S3 Standard becomes hundreds of millions per year if you do not tier.
- App-server bandwidth dies first if you tunnel uploads. 10Gbps NIC = ~150 concurrent 8MB uploads/sec. Presigned URLs to S3 remove this ceiling entirely.
- Metadata DB is small relative to the object store. 100B file rows × 500 bytes ≈ 50TB; sharded Postgres holds this easily.

### 3. API design

**Initiate upload:**

```
POST /api/v1/uploads/init
Authorization: Bearer <token>
Content-Type: application/json

{
  "file_name": "vacation.mp4",
  "size": 1572864000,                 # 1.5 GB
  "mime_type": "video/mp4",
  "content_hash": "sha256:abc123...", # client-computed for dedup hint
  "parent_folder_id": "fld_xyz",
  "client_idempotency_key": "uuid"    # so retry doesn't create a new session
}
```

Responses:

| Status | Meaning | Body |
|--------|---------|------|
| 201 Created | New upload session | `{"upload_id": "...", "chunk_size": 8388608, "presigned_urls": [{"part": 1, "url": "..."}, ...], "expires_at": "..."}` |
| 200 OK | Dedup hit; file already exists; no upload needed | `{"file_id": "...", "deduped": true}` |
| 400 Bad Request | Invalid mime, size over limit, name invalid | `{"error": "file_too_large", "max_bytes": 5368709120}` |
| 402 Payment Required | Out of quota | `{"error": "quota_exceeded", "available_bytes": 12345}` |
| 409 Conflict | A file with this name already exists at this path | `{"error": "name_conflict"}` |

**Upload chunk:**

The client `PUT`s directly to the presigned S3 URLs. Your server is not in the path. The response from S3 is an ETag the client must remember.

**Finalize upload:**

```
POST /api/v1/uploads/{upload_id}/finalize

{
  "parts": [
    {"part": 1, "etag": "abc"},
    {"part": 2, "etag": "def"},
    ...
  ]
}
```

Responses:

| Status | Meaning |
|--------|---------|
| 200 OK | Multipart completed; file_id returned. Virus scan queued. |
| 400 Bad Request | Missing chunks or wrong ETag list |
| 410 Gone | Upload session expired (>24h since init) |

**Create share link:**

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

**Redeem share link:**

```
GET /api/v1/share/{token}
GET /api/v1/share/{token}?password=...    # if password-protected
```

Returns file metadata and a short-lived signed download URL.

**Download:**

```
GET /api/v1/files/{file_id}/download
```

Returns a 307 redirect to a signed CloudFront URL valid for 15 minutes.

**Notes:**

- Idempotency on upload init. The same `client_idempotency_key` returns the existing upload session, not a new one. Mobile clients retry on timeout; this prevents orphaned half-uploads.
- Dedup hint at init. Client computes SHA-256 and sends it. Server checks if a file with this hash already exists in this user's content-addressed pool; if so, return the existing file_id and skip the upload entirely.
- Finalize takes ETags. S3 multipart finalize needs the part list with ETags. The client tracks this; your server forwards it to S3.

### 4. Data model

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

**Choices and why:**

- **Sharded by `owner_id`.** Most queries are "list my files in folder X". Co-locating one user's files on one shard makes those queries single-shard. The exception is share lookups (you might be granted shares on files owned by anyone); we handle that with a secondary global index on `shares.granted_to`.
- **`content_hash` as a real column with an index.** Enables dedup at insert time. SHA-256 over a few PB of data has astronomically low collision probability; we treat collisions as impossible for design purposes (and as a corruption signal if they ever appear).
- **`blobs` table separate from `files`.** The blob is the actual byte payload, addressed by hash. A file is a user-named pointer to a blob. Many files can point to one blob. The `refcount` tracks how many files reference each blob; when it hits zero the blob is eligible for deletion (with a grace period for safety).
- **`upload_sessions` lives in Postgres, not Redis.** Sessions can live for hours; survives Redis evictions. Volume is low (one row per in-flight upload).
- **`audit` append-only.** Compliance for any business product. Tier hot 90 days in Postgres, cold to S3 after that.

### 5. Core algorithms

#### a. Chunked upload state machine

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

    # Quota check (atomic; see below)
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

    # Verify hash (S3 returns the ETag of the assembled object; compute SHA-256
    # by fetching or by streaming the parts. In practice: trust the client hash
    # and verify async during virus scan.)
    
    # Create blob (or increment refcount if hash already exists)
    blob = db.upsert_blob(session.expected_hash, session.expected_size, result.key)
    
    # Create the file
    file_id = db.insert_file(session.user_id, session.file_name, blob)

    db.mark_session_finalized(upload_id)
    publish_event("file.finalized", file_id)   # triggers virus scan
    return file_id
```

#### b. Share link generation and resolution

```python
def create_share_link(file_id, user_id, permission, expires_at=None, password=None):
    # Authz: caller must own or have edit on the file
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

    # Rate-limit redemptions per (token, ip) to thwart brute force
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

The `cloudfront.sign` call produces a signed URL where the signature itself encodes "you may GET this S3 key until time T". CloudFront verifies the signature at request time and returns the file from edge cache or S3.

### 6. Architecture (the full picture)

```
                   ┌──────────────────┐
   Clients ──────► │   CloudFront     │   Edge cache for downloads.
   (web, mobile,   │   (CDN)          │   Signed URLs for permission.
    desktop)       └─────────┬────────┘
                             │
                             ▼ (uncached requests)
                   ┌──────────────────┐
                   │   API Gateway    │   Auth, rate limit, WAF.
                   │   + WAF          │
                   └─────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
    ┌─────────────┐   ┌─────────────┐  ┌──────────────┐
    │  Upload     │   │  File API   │  │  Share Link  │
    │  Service    │   │  (list,     │  │  Resolver    │
    │  (init,     │   │   metadata, │  │  (token →    │
    │   finalize, │   │   delete,   │  │   file +     │
    │   sessions) │   │   download) │  │   perms)     │
    └─────┬───────┘   └──────┬──────┘  └──────┬───────┘
          │                  │                 │
          │                  ▼                 │
          │           ┌──────────────────┐     │
          │           │  Permission      │◄────┘
          │           │  Resolver        │   Cached "can user X
          │           │  (cached)        │   access file Y" lookups.
          │           └──────────────────┘
          │
          │   presigned PUTs                 ┌─────────────────────────┐
          └──────────────────────────────────┤    Object Store (S3)    │
                                             │                         │
          ┌──────────────────────────────────┤  /raw/<hash>            │
          │   signed GETs (via CloudFront)   │  /chunks/<upload_id>/<n>│
          │                                  │                         │
          ▼                                  │  Lifecycle:             │
   ┌──────────────┐                          │   30d → IA              │
   │  Metadata DB │                          │   365d → Glacier        │
   │  (Postgres,  │                          │                         │
   │   sharded    │                          └─────────────────────────┘
   │   by         │
   │   owner_id)  │
   │              │
   │ files,       │
   │ blobs,       │
   │ shares,      │
   │ share_links, │
   │ versions,    │
   │ audit        │
   └──────┬───────┘
          │
          │  CDC / outbox
          ▼
   ┌──────────────────┐
   │   SQS / Kafka    │   Topics: file.finalized,
   │                  │           file.deleted,
   │                  │           share.created
   └─────┬──────┬─────┘
         │      │
         ▼      ▼
   ┌─────────┐ ┌─────────────────┐
   │ Virus   │ │  Lifecycle      │
   │ Scan    │ │  Manager        │
   │ Worker  │ │  (refcounts,    │
   │ (Lambda │ │   tiering hints,│
   │  + Clam │ │   GC of orphan  │
   │  AV)    │ │   chunks)       │
   └─────────┘ └─────────────────┘
```

Component responsibilities:

- **CloudFront.** Caches signed download responses at the edge. TTL is short (1 minute typically) so revocations propagate quickly. Without it, a viral file melts S3 egress.
- **API Gateway + WAF.** First defense. Auth, per-user rate limits, blocks obvious abuse (script-kiddie scanning for `/share/aaaaaaaa`).
- **Upload Service.** Owns presigned URL minting and session state. Enforces quota at init. Does not touch bytes.
- **File API.** Metadata operations: list, rename, move, delete, fetch download URL.
- **Share Link Resolver.** Hot path for every shared file. Read-heavy; aggressively cached.
- **Permission Resolver.** "Can user X do Y on file Z?" Combines owner check, direct share check, folder-share inheritance. Result cached for 30 seconds per (user, file).
- **Metadata DB.** Sharded Postgres. Source of truth for everything that is not bytes.
- **Object Store.** S3 with two prefixes: `/chunks/` for in-flight multipart parts, `/raw/<hash>` for finalized content-addressed blobs.
- **Async pipeline (SQS or Kafka).** Decouples finalize latency from virus scan, lifecycle, and other side effects.
- **Virus Scan Worker.** Lambda for small files (under ~500MB), long-running container for larger ones. ClamAV or a third-party API.
- **Lifecycle Manager.** Periodic worker that GCs abandoned uploads, decrements blob refcounts on file delete, and triggers Glacier restores when a cold file is shared.

### 7. Upload path and download path

#### Upload path (chunked, presigned)

1. Client computes SHA-256 of the file (or streams in chunks if too big to hold in memory).
2. Client calls `POST /uploads/init` with file metadata + hash + idempotency key.
3. Upload Service checks quota, checks dedup (hash already exists for this user → instant return), reserves an S3 multipart upload, generates N presigned PUT URLs.
4. Client uploads chunks in parallel (default concurrency 4). Failed chunks retry with exponential backoff. Progress is tracked per chunk.
5. After all chunks land, client calls `POST /uploads/finalize` with the part-ETag list.
6. Upload Service calls S3 `CompleteMultipartUpload`. Creates `blobs` row (or increments refcount). Creates `files` row. Marks session finalized.
7. Returns `file_id` to client. File is now visible in the user's account but flagged `status = uploading` until virus scan completes.
8. Event `file.finalized` goes to SQS. Virus Scan Worker picks it up, scans, and flips `status = ready` (or `status = quarantined`).

P99 target for init: 200ms. P99 for finalize: 500ms (S3 multipart completion latency). The bytes themselves take however long the client's bandwidth allows; that is not in your SLA.

#### Download path

1. Client calls `GET /files/{file_id}/download` (or hits a share link).
2. Permission Resolver checks: is this caller the owner, a direct grantee, or holding a valid share link?
3. If permitted: API returns a 307 redirect to a signed CloudFront URL valid for 15 minutes.
4. Client follows redirect. CloudFront serves from edge cache if hot, otherwise fetches from S3.
5. If the file is in Glacier, the download fails with `INVALID_OBJECT_STATE`; API instead returns 202 Accepted with a "restore in progress" status and triggers a Glacier restore. Client polls.

P99 target for permission resolution: 50ms (cached). P99 for cold path (cache miss + DB hit): 150ms.

### 8. Scaling journey: 10 to 1M users

The whole point of this section: build only what just broke. Each stage names the new pain and the new pieces.

#### Stage 1: 10 users (weekend project)

**What you build:**

- One server (any small VM) running a Node/Go/Python app.
- Files saved to local disk under `/var/data/<user_id>/<file_id>`.
- Postgres on the same machine for metadata.
- Direct POST upload, files limited to 100MB so a single request handles it.
- Share by direct invite only (no anonymous links). Permissions: owner-only or shared, no scopes.
- No virus scan, no versioning, no quota.

**Why this is enough:**

- 10 users × 5 files = 50 files ever uploaded in the first weeks.
- Bandwidth is whatever the VM's NIC gives you, which is fine for one upload at a time.
- No need for chunking; nothing is big enough to fail mid-upload.

**What you do not build:**

- No CDN. No S3. No async pipeline. No quota.

**Total cost:** ~$20/month. Ships in a weekend.

#### Stage 2: 1,000 users (Series-A territory)

**What just broke:**

- Local disk filled up. The first 50GB user's upload took the VM into a degraded state.
- Backups are now your problem; restoring a single file from a tar.gz takes forever.
- A user uploaded a 2GB file, the connection dropped at 1.8GB, they had to start over. They complained.

**What you add:**

- **Move bytes to S3.** Replace local-disk writes with S3 PUTs via presigned URLs. App server is no longer in the byte path. Storage cost is now per-byte, not per-VM-disk. Backups are S3's problem.
- **Anonymous share links.** Add the `share_links` table. Token = 192-bit random. Resolver endpoint returns a signed S3 GET URL.
- **Permission scopes.** Add view / download / edit to both `shares` and `share_links`.
- **Per-user quota.** A `users.quota_bytes` and `users.used_bytes`. Decrement on upload finalize, increment on delete. Use a Postgres atomic update for safety.
- **Soft delete with trash bin.** Files go to `status = deleted_pending` for 30 days before hard-delete. Saves the support load when users delete things by accident.

**What you do not yet build:**

- Still no chunked upload; presigned PUT to S3 handles up to 5GB in a single request. (S3's single-PUT limit is 5GB.)
- No virus scan. Acceptable for an early product targeting trusted users; revisit at the first incident.
- No CDN. S3 egress is fine for 1k users.
- One DB, no sharding.

**Why this is enough:**

- Storage scales with S3, not with VMs.
- 1k users × 5 files/week × 5MB ≈ 25GB/week. S3 costs ~$0.60/month. Trivial.
- Quota race conditions are theoretical at this volume.

**New cost:** ~$100-300/month (app server + Postgres + S3 storage + minimal egress).

#### Stage 3: 100,000 users

**What just broke:**

- A power user trying to upload a 4GB video on hotel WiFi fails at the 80% mark. The whole upload restarts. They lose a day's work and uninstall the app.
- A user uploaded a malware-laden PDF that other users downloaded via share links. You get a security report.
- Storage cost is now $3-5k/month and growing 30% per quarter. Most stored bytes are untouched after 30 days.
- The `share_links` table has 5M rows; lookups are still fast but you notice "show me all my shares" is slow because of fan-out.
- Egress from S3 hits $2k/month because every share link download streams full-cost from S3.

**What you add:**

- **Chunked upload via S3 multipart + TUS-style protocol.** Init returns a list of presigned PUT URLs (one per chunk). Client uploads chunks in parallel, retries only failed chunks. Finalize completes the multipart. Now a flaky-network 4GB upload survives because failed chunks resume instead of restarting.
- **Virus scan pipeline.** SQS topic `file.finalized` → Lambda invokes ClamAV. Scan result updates `files.status`. Files are downloadable in the gap (1-3 minutes typical); when scan flags, status flips and downloads start returning 451. Accept the gap explicitly; document it.
- **Share Link Service split out.** Becomes its own pod set with its own read replica. Hot path for the most-trafficked URLs. Add a small in-process LRU for the top tokens.
- **Lifecycle policy.** S3 lifecycle rule moves objects to IA after 30 days, to Glacier after 365 days. Saves ~70% on storage cost for the cold tail.
- **CDN (CloudFront).** Signed URLs from share links route through CloudFront. Cache TTL is short (60s) so revocations propagate. Egress cost drops by an order of magnitude.
- **Metadata DB read replicas.** Two replicas; reads go to replicas, writes to primary.
- **Quota enforcement made atomic.** `UPDATE users SET used_bytes = used_bytes + ? WHERE user_id = ? AND used_bytes + ? <= quota_bytes` returns 0 rows if over quota. Combined with a "reservation" pattern at upload init (debited optimistically, credited back if upload fails) to handle concurrent uploads from multiple devices.
- **Audit log tiering.** Hot 90 days in Postgres, archived to S3 (Parquet) for long-term retention.

**What you do not yet build:**

- Still single-region. 100k users is fine in one region; latency to far-away users degrades but is acceptable.
- Metadata DB sharding not yet needed. ~100M file rows × 500 bytes = 50GB; fits in one big Postgres.
- No client-side encryption (still server-side with S3-managed keys).

**Why this is enough:**

- 100k users × 20 uploads/week × 8MB = ~600GB/week ingress. S3 multipart absorbs this easily.
- Downloads: 100k × ~10x = ~10/sec sustained; CDN absorbs the hot tail.
- Operations cost: ~$10-20k/month total.

#### Stage 4: 1M users (and global)

**What just broke:**

- EU users complain that uploads from Berlin to us-east-1 are slow. Latency on a 100MB upload is dominated by RTT × chunk count.
- A regulated customer (healthcare) demands data residency: their files must never leave the region.
- A viral share link gets 1M downloads in 24 hours. CloudFront cache hits 99% but the 1% miss rate concentrates on one S3 prefix and triggers throttling.
- Metadata DB primary is at 60% CPU during peak; one big Postgres is reaching its ceiling.
- A bug in your quota logic caused a thundering-herd race that let three accounts exceed their quota by 200GB each.
- Your single-region setup had a 4-hour S3 outage in us-east-1. Everything went dark.

**What you add:**

- **Regional S3 buckets.** Each region has its own bucket. Files land in the user's home region. A file is replicated across regions only if explicitly shared cross-region (lazy replication on first cross-region access).
- **Metadata DB sharded by owner_id, multi-region.** Each region holds the primary for its own users; cross-region reads (for share-link resolution) hit a global directory service that maps file_id → home_region.
- **Global share link resolver.** Share links are global; the token's first few characters encode the home region of the file. Resolver in any region can route to the correct backend. Cache aggressively at the edge.
- **CDN with multiple origins.** CloudFront origin per region. Viral files get multiple S3 prefixes (sharded by hash prefix) so one prefix is never a bottleneck.
- **Per-user storage quota cached in Redis.** Real-time quota counter in Redis with a periodic reconciliation against the DB. Atomic INCRBY for upload reservations. Resolves the race condition that let the three accounts overflow.
- **Storage tier prediction.** A daily job models per-file access patterns and pre-emptively tiers files (or keeps them hot). Files that have been opened twice this week stay hot regardless of age; one-time uploads tier down faster.
- **Per-tenant logical isolation.** Enterprise customers get their data in their own logical schema with their own KMS key. The KMS key allows the customer to "kill switch" all their data by revoking the key.
- **Cross-region failover.** Metadata replicas in two regions; if the home region fails, reads continue from replica. Writes degraded for ~5 minutes during failover.

**Why this is enough:**

Even at 1M users you peak at ~10 uploads/sec and ~100 downloads/sec (most absorbed by CDN). The system is large in *bytes* and *organizational complexity*, not in QPS. The architecture is the same shape as stage 3; it has multiplied across regions and added isolation boundaries.

**Cost:** ~$200-500k/month at this scale, dominated by storage (PB of S3) and egress.

#### What you would do at 10M+ users

- Multi-tenant becomes the primary axis: noisy-neighbor isolation, per-tenant rate limiting, per-tenant cost attribution at the request level.
- Custom object store (or at least a custom layer over S3 with stronger consistency guarantees, like a write-through cache for metadata).
- Edge upload acceleration (upload to nearest edge, async replication to home region's S3).
- Specialized hardware for inline virus scanning to remove the async gap.

### 9. Reliability

**Interrupted upload resume.**

Upload sessions live for 24 hours in `upload_sessions`. The client can call `GET /uploads/{upload_id}` to ask "which chunks have you got?" The server queries S3 `ListParts` and returns the part numbers already uploaded. The client re-uploads only missing parts. After 24 hours, the session expires; the abandoned S3 multipart upload is aborted by the Lifecycle Manager via S3 `AbortMultipartUpload` (S3 charges for in-flight parts until aborted).

**Orphan chunks.**

S3 multipart uploads that never finalized leave parts in S3 that you pay for. The Lifecycle Manager runs every 6 hours:

```
For each upload_session with status=active AND expires_at < now():
    s3.abort_multipart_upload(s3_upload_id)
    db.mark_session(status=abandoned)
```

Also, a global S3 lifecycle rule aborts any multipart upload older than 7 days as a safety net.

**Virus scan failure.**

Three failure modes:

1. **Scan worker dies mid-scan.** SQS visibility timeout expires; another worker picks up the message. Idempotent: scan result is the same.
2. **Scan API (third-party) is down.** Worker retries with backoff; if down for >1 hour, escalate to a human queue. Files remain in `status = uploading` until scanned; downloads return 425 Too Early.
3. **Scan finds a virus after the file has been downloaded.** Flip `status = quarantined`. Invalidate all share links pointing at the file (set `revoked_at`). Audit log captures the event. Notify downloaders if you have their identities (from audit). The five-minute window between finalize and scan-complete is the exposure.

**Metadata DB primary failure.**

Standard Postgres failover. Promote a replica; reads continue from other replicas during the 30-60 second promotion. Upload sessions in flight see a few errors; clients retry.

**S3 outage.**

The hardest one. If the region's S3 is down, no uploads succeed (presigned URLs return 5xx), no downloads succeed (signed URLs return 5xx). CDN serves whatever it has cached. Metadata operations still work. Honest answer: you wait for S3 to recover. Multi-region replication helps for read availability if you have a hot copy elsewhere; it is expensive and only justified for high-availability tiers.

### 10. Observability

| Metric | Why it matters |
|--------|----------------|
| `upload.init.rate` | Sudden drop signals auth or API issues. |
| `upload.success_rate` (finalize/init) | The headline UX SLO. If 60% of inits never finalize, something is broken (probably network on the client side, or a bug in chunk URLs). |
| `upload.bytes_per_user.p99` | Outlier detection: someone uploading 10x normal might be a backup tool gone wrong. |
| `upload.duration` by file size bucket | Lets you tell "uploads are slow" from "uploads of 1GB+ files are slow". |
| `download.rate` by file_id (top-N) | Identifies viral files; lets you pre-warm CDN. |
| `download.cache_hit_rate` (CDN) | Should be >95% in steady state. |
| `share_link.resolution.p99` | Hot path latency. |
| `share_link.brute_force_alerts` | Tokens with >50 failed redemption attempts in an hour. |
| `quota.exceeded.rate` | Spikes signal a user (or an integration) gone rogue. |
| `virus_scan.queue_depth` | If growing, scanner can't keep up; downloads of recent uploads risk gap exposure. |
| `virus_scan.positive_rate` | Sudden spike = malware campaign. |
| `blob.refcount.zero.count` | Eligible-for-GC blobs; should drain. |
| `storage.by_tier.bytes` | Hot/warm/cold breakdown; cost forecasting input. |
| `egress.bytes_per_region` | Where the money goes. |
| `lifecycle.transition.rate` | If transitions stall, cost forecast is wrong. |

Alerts:

- Page: upload success rate <90% for 5 min; virus scan queue depth >10k; CDN origin error rate >1%.
- Ticket: per-user bandwidth anomaly; quota race detected; storage growth >2σ above forecast.

### 11. Common gotchas

1. **File size lies in HTTP headers.** A client claims `Content-Length: 1MB` in the init call but uploads 5GB. Enforce size both at presigned URL generation (S3 respects the `Content-Length` you sign) and at finalize (compare expected_size to actual S3 object size). Reject mismatches.
2. **Quota race condition.** Two concurrent uploads from the same user both pass the quota check at init. Without atomic reservation, both succeed and the user is over quota. Fix: atomic `UPDATE users SET reserved_bytes = reserved_bytes + ? WHERE reserved_bytes + used_bytes + ? <= quota`. Returns 0 rows if overflow. On finalize or session-abort, reservation moves to used_bytes or is released.
3. **Share link enumeration.** Even with 192-bit tokens, side channels can leak: timing differences on lookup (cache hit vs miss), error message differences (404 vs 410), `created_at` in responses. Mitigate: constant-time response, generic "not found or expired" message, no metadata in unauthenticated responses.
4. **Large file delete tombstone backlog.** Deleting a 10TB folder triggers 200k row updates and 200k S3 deletes. Single-shot does it in one request that times out, holds DB locks, and overwhelms S3. Fix: enqueue a deletion job that processes in batches of 1000, with rate limiting. UI shows "deletion in progress" until done.
5. **Dedup with privacy.** Knowing your file's SHA-256 matches another user's leaks the fact that you both have the same file. For most use cases this is fine; for high-privacy products (legal docs, healthcare) you skip dedup or do it only within a single tenant.
6. **Presigned URL TTL too long.** A presigned URL valid for 24 hours that leaks (logged, copy-pasted in chat, stored in a CI variable) is a 24-hour data breach. Default to 1 hour for upload, 15 minutes for download. Re-mint on retry.
7. **Refcount race in dedup.** Two users delete the last two files referencing a blob at the same instant. Both transactions see refcount=2, both decrement to 1, blob never GC'd. Or both see refcount=1, both delete the blob, second user's data is lost. Solution: atomic `UPDATE blobs SET refcount = refcount - 1 WHERE content_hash = ? RETURNING refcount`. Only the row that returns 0 triggers actual S3 deletion, and that deletion is deferred by 24 hours in case a new file is created referencing the same hash.
8. **Folder permission inheritance is recursive.** Sharing a folder grants access to all descendants. Checking "can user X view file Y" requires walking up Y's parent chain looking for a share grant. Cache the result aggressively (per (user, file) for 30s) or denormalize by materializing the closure on share-grant changes.
9. **Glacier retrieval latency surprises users.** Standard retrieval takes 3-5 hours. A user clicks Download and waits hours. Either use Glacier Instant Retrieval (3x cost, sub-second) or set explicit user expectations ("Restoring; we'll email when ready").
10. **Versioning interacts with dedup.** A user uploads `report.pdf`, then a slightly edited `report.pdf`. Two versions, two blobs (different hashes), both stored. After 10 edits, the file has 10 blobs even though most pages are identical. For large editable files, consider block-level dedup; for documents, accept the cost.

### 12. Follow-up answers

**1. Resumable upload across days.**

The client persists `upload_id` locally. On reopen, it calls `GET /uploads/{upload_id}`. Server queries S3 `ListParts` for the multipart upload, returns the list of uploaded part numbers and the original chunk size. Client uploads only the missing parts and finalizes. If `upload_id` is past the 24-hour TTL (session expired, multipart aborted), the client gets 410 Gone and must start a new upload. Abandoned upload sessions are GC'd every 6 hours by the Lifecycle Manager calling `AbortMultipartUpload` on S3 and marking the session row abandoned.

**2. Quota enforcement race.**

The race is real and common. Fix it with an explicit reservation column:

```sql
UPDATE users
SET reserved_bytes = reserved_bytes + ?
WHERE user_id = ?
  AND used_bytes + reserved_bytes + ? <= quota_bytes
RETURNING reserved_bytes;
```

If this UPDATE returns 0 rows, the upload is rejected. Reservation is held until upload finalize (moves to `used_bytes`) or session expiry (released back). At higher scale, the same logic runs in Redis with `INCRBY` and CAS, with periodic reconciliation back to the DB.

**3. Content-addressed dedup.**

A `blobs` table keyed by SHA-256. On finalize, `INSERT INTO blobs ... ON CONFLICT (content_hash) DO UPDATE SET refcount = refcount + 1`. The S3 key is `/raw/<hash>`; if the blob exists, no new S3 object is written. The `files` row points at the blob.

Delete decrements the blob's refcount atomically. When refcount hits zero, schedule the blob's S3 object for deletion after a 24-hour grace period (in case a new file is created with the same hash).

Privacy: dedup can leak existence. If you upload a file and it dedups instantly, you've confirmed someone else has the same content. For sensitive use cases (legal, medical), disable cross-tenant dedup; dedup only within a single account.

**4. Share link enumeration.**

192 bits of entropy makes direct brute-force impossible. Side channels are the concern:

- **Timing.** Token-not-found vs token-found-but-expired should take the same time. Use constant-time comparison and unified error paths.
- **Error responses.** Return the same generic 404 for "no such token" and "expired" (or 410 for both). Do not include "expired_at" in unauthenticated responses.
- **Predictable creation timestamps.** Some token schemes encode a timestamp. Pure-random tokens (24 bytes from `secrets.token_bytes`) leak nothing.
- **Rate limiting.** Per-IP limits on `/share/*` to thwart any high-volume probing.
- **Web logs.** Tokens appear in access logs. Treat them as secrets: scrub from logs, or hash before logging.

**5. Large delete tombstone backlog.**

A 10TB delete triggers 200k file row updates and 200k S3 DELETE requests. Doing this synchronously: HTTP timeout, DB lock contention, S3 throttling, user clicks Delete again, double the load.

Fix:

- API call writes a single `deletion_jobs` row: `(user_id, target_folder_id, requested_at)`. Returns 202 Accepted with a job_id.
- A background worker processes the job in batches of 1000 files: soft-delete in DB (status flip + deleted_at), decrement blob refcounts, enqueue S3 deletion (which respects S3's bulk-delete API of 1000 objects per call).
- UI shows "deletion in progress" with a progress bar. Items disappear from listings immediately (filtered by status).
- After 30 days (trash retention), a separate sweeper hard-deletes from S3 the blobs whose refcount reached zero.

**6. Virus scan returns positive late.**

Incident response:

1. **Flip status.** `UPDATE files SET status = quarantined WHERE file_id = ?`.
2. **Revoke share links.** `UPDATE share_links SET revoked_at = NOW() WHERE file_id = ?`.
3. **Invalidate CDN.** Issue a CloudFront invalidation for the file's signed URL prefix.
4. **Identify downloaders.** Query `audit` table for `event_type = 'file.downloaded' AND file_id = ?`. Returns user_ids (for authenticated downloads) and IPs (for share-link downloads).
5. **Notify.** Authenticated downloaders get an in-app + email notification: "A file you downloaded was later found to contain malware. We recommend you scan your system." Anonymous downloaders cannot be notified; the share link itself is now revoked so the URL displays a warning.
6. **Notify the uploader.** "Your file was flagged. If this was a mistake, request rescan."

Pre-mitigation: keep the post-finalize, pre-scan window short. Faster scanning narrows the exposure.

**7. Edit conflict.**

Two users with Edit upload new versions of the same file within 10 seconds.

Default: both succeed; both create new versions. The `file_versions` table has rows `version=2` (first to land) and `version=3` (second). The `files.current_version` points to version 3.

The losing user's version still exists; they can see it in version history. The winning user's version is "current". The system surfaces a conflict notification: "User B also uploaded a new version of this file at the same time. Your version is current; theirs is at /history/version/2."

For stronger guarantees (last-writer-wins is wrong; lock-required): add an optional `If-Match: <current_version>` header on the upload. If the current version on the server doesn't match, return 412 Precondition Failed. The client either retries with the new version (after user merges) or surfaces a conflict UI.

**8. Viral share link.**

200MB video, 1M downloads in 24h, 99% CDN cache hit. The 1% miss = 10k requests to origin S3 over 24h = ~0.1 req/sec on average. That is fine for S3 overall. The concern is **prefix throttling**: S3 limits requests per prefix to 5500 GET/s. If all those requests hit one prefix at one moment, you get 503s.

Mitigations:

- **Pre-warm CDN edges.** When a link is created with a known-popular file, push the object to all CloudFront edges immediately rather than waiting for first-miss.
- **Spread the prefix.** Store the blob at `/raw/<hash[0:2]>/<hash[2:4]>/<hash>` so popular files land on different prefixes naturally.
- **CDN origin shielding.** CloudFront's origin shield acts as a regional cache between edges and S3, collapsing many edge misses into one S3 fetch.
- **Multi-CDN for tiered customers.** Enterprise customers paying for premium get content delivered from multiple CDNs (CloudFront + Fastly + Akamai) for resilience.

**9. GDPR delete.**

Multi-step process for a user with 12,000 files:

1. **Mark account for deletion.** `UPDATE users SET deletion_requested_at = NOW(), status = 'deleting'`. User is logged out, account is read-only frozen.
2. **Enqueue deletion job.** A `deletion_jobs` row triggers background processing.
3. **Walk owned files.** For each file, decrement the blob's refcount (which may or may not GC the blob); update audit; revoke all share links the user created.
4. **Walk shares received.** For each `shares` row where the user is `granted_to`, set `revoked_at` (the user no longer receives access; the file itself remains for the owner).
5. **Walk audit log.** Anonymize: replace `actor_id` with a hash, drop PII from payloads.
6. **Delete user row** after the grace period (varies by jurisdiction; often 30 days).
7. **Email confirmation.** Send the user the deletion certificate; required by many privacy regulations.

The tricky bit: files deduped with other users. Decrementing the refcount may leave the blob alive (other users still have it). That is correct; the user's *pointer* is gone, even though the bytes might persist (referenced by someone else). If the user demands the bytes be deleted regardless: disable dedup for that user retroactively (copy the blob to a user-private location for any remaining references, then delete the original). Expensive; only do on explicit request.

**10. Cost attribution per tenant.**

Every billable action gets tagged with `tenant_id`:

- **Storage:** S3 inventory report runs daily, lists all objects with size and tier. Each object's key embeds `tenant_id` (`/raw/<tenant>/<hash>`); aggregate by tenant.
- **Egress:** CloudFront real-time logs include the request URL; URLs encode tenant_id. Daily job aggregates bytes-out per tenant.
- **API requests:** API Gateway access logs include the JWT's `tenant_id` claim. Aggregate per tenant per endpoint.
- **Virus scan API costs:** Scan worker records each scan in a `scan_invocations` table with `tenant_id`.

A nightly job aggregates these into a `billing_lines` table:

```
tenant_id | period | storage_hot_gb | storage_warm_gb | storage_cold_gb | egress_gb | api_requests | scan_calls
```

Invoice generation reads this table. Spot-checking: the sum of per-tenant attributions should match your AWS bill within ~1% (gaps are platform overhead, S3 inventory itself, etc.).

### 13. Trade-offs

- **Single big PUT vs chunked.** Single PUT is simpler for files under 100MB and supported by every HTTP client. Chunked (S3 multipart, TUS) is necessary above 5GB (S3's single-PUT limit) and strongly recommended above 100MB for network resilience. The right answer is hybrid: single PUT below a threshold, chunked above.
- **Client-side encryption.** Optional but important for high-security customers. Encrypt with a key the server never sees; server stores ciphertext. Tradeoffs: no dedup possible (ciphertext is different even for identical plaintext), no server-side preview (can't render an encrypted PDF), key management burden is now the customer's. Implement as an opt-in for enterprise tier.
- **Dedup by content hash.** Saves ~30% on storage at consumer scale (people share popular files), less in business contexts (everyone uploads unique documents). Adds complexity: refcount management, GC, blob lifecycle, privacy considerations. Worth it at scale; skip for the first 1000 users.
- **Lifecycle to cold tier.** Saves 50-70% of storage cost on the cold tail. Costs: retrieval latency surprises users, retrieval fees on access, minimum-storage-duration penalties on early delete. Tune the transition age to your actual access pattern; default 90 days is usually too aggressive (some files are bursty re-accessed in week 5).
- **Postgres vs DynamoDB for metadata.** Postgres gives you joins, transactions, and a familiar query layer. DynamoDB gives you infinite horizontal scale and predictable latency. For metadata at <100M files, Postgres is simpler. Above that, sharding Postgres becomes annoying and DynamoDB is worth considering. Don't switch preemptively.
- **Synchronous vs async virus scan.** Sync blocks the upload UX (a 2GB file's scan takes minutes), but guarantees zero exposure. Async returns immediately and accepts a 1-3 minute exposure window. Almost everyone picks async; the exposure is small and the UX win is large.

### 14. Common mistakes

1. **Tunneling uploads through your app server.** The single biggest scaling mistake. Bandwidth cost is per-byte; doubling your traffic doubles your NIC bill. Presigned-direct-to-S3 (or equivalent for non-S3 storage) is non-negotiable above ~100 concurrent uploads.
2. **Single POST for all uploads.** Works until the first 4GB upload fails on hotel WiFi. Chunked is mandatory above ~100MB; lower the threshold if your users are on mobile networks.
3. **No quota enforcement at all.** "We'll add it later" turns into "one user uploaded their entire Steam library and ate our budget." Quota at signup is easier than quota retrofitted.
4. **Forgetting to GC abandoned uploads.** S3 multipart uploads that never finalized continue to cost money. A nightly sweeper catches them; an S3 lifecycle rule that aborts multiparts older than 7 days is the safety net.
5. **Share links that are just file IDs in the URL.** `https://app.com/file/abc123` is not a share link; it's a permanent backdoor. Use an opaque high-entropy token with explicit expiry and revocation.
6. **No virus scan at all.** Acceptable for an internal tool, indefensible for a public product. Even basic ClamAV catches most known malware and signals to your incident-response process that scanning exists.
7. **Hot path doing folder traversal for permissions.** "Is this file in any folder shared with me?" naive implementation walks the parent chain on every download. Cache or materialize the access set per user.
8. **Skipping the `status` field.** Without an explicit upload/ready/quarantined/deleted state machine, you end up with weird edge cases (downloads of half-finalized files, deletes of in-flight uploads). The `files.status` smallint pays for itself in week 1.
9. **Mixing user files and system files in one bucket without prefixing.** Lifecycle rules apply to a bucket or prefix; if you mix, you can't tier user files independently of thumbnails or temp data. Pick a prefix scheme on day one.
10. **No audit log.** When the security report comes in ("user X claims their file was leaked"), the lack of "who accessed this and when" turns a 1-hour investigation into a 1-week investigation. Audit is cheap to build, painful to retrofit.

If you can hit 7 of these 10 and walk through the upload-protocol trade-off and the scaling journey in the same conversation, you are interviewing well above the bar.
{% endraw %}
