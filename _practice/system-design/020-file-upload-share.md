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

You sit down. The interviewer pulls up a blank whiteboard.

> *"Build a smaller version of Dropbox. Users upload files up to 5 GB. They share files by invite or by link. They set permissions: view, download, or edit. Storage and bandwidth cost money, so don't waste either."*
>
> *"Start with 10 users. Walk me up to 1 million. At each step, tell me what just broke and what you'd add to fix it."*

It looks like a CRUD app sitting on top of S3. It is not. Here is where it gets hard:

- Alice uploads a 4 GB video over hotel WiFi. The connection dies at 80%. What happens?
- She shares a link with Bob. A month later she revokes that one link. The other 999 links she made should still work.
- Fifty people upload the same 200 MB software installer. Do you store it 50 times?
- A file nobody has touched in two years. Do you keep paying full price to store it?

A candidate who jumps to "POST the file to S3, write a row in Postgres" misses about 60% of the depth. We will walk through it step by step.

A few terms before we start:

- **S3.** Amazon's object storage. Put a file in, get a URL back. Cheap, durable, huge.
- **Presigned URL.** A URL your server signs that lets the client upload directly to S3, without going through your server. The signature has an expiry.
- **S3 multipart upload.** S3's native way to upload a large file in chunks. Start a session, upload chunks, call finalize, and S3 stitches them together.
- **CDN.** Content Delivery Network. A worldwide cache in front of your storage. First download fetches from S3. The next 1,000 come from a nearby edge cache.
- **Content hash.** A short fingerprint of a file's bytes (SHA-256). Two files with the same bytes have the same hash.

---

## Step 1: Picture one upload

Before any boxes, picture what one upload and one download **is**.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Uploading: Alice starts upload
    Uploading --> Scanning: finalize received
    Scanning --> Ready: scan clean
    Scanning --> Quarantined: scan flagged
    Ready --> Shared: Alice creates share link
    Shared --> Downloaded: Bob opens link
    Ready --> Deleted: Alice deletes
    Quarantined --> Deleted: admin quarantines
    Deleted --> [*]
```

That is the whole product in one picture. Everything we add later (chunked upload, dedup, cold tier, revocation) is a complication on top of this.

> **Take this with you.** A file service is a state machine around bytes. The state lives in your database. The bytes live in object storage. They are two separate things.

---

## Step 2: Ask the right questions

Sit for two minutes. Write down the five questions that would change the design if the answer were different.

<details markdown="1">
<summary><b>Show: 5 questions that change the design</b></summary>

1. **What is the biggest file size?** 5 GB was in the brief. Anything over ~100 MB rules out a single HTTP POST. You need chunked upload.

2. **Sync or share-only?** Is this Dropbox-the-desktop-app (local folder stays in sync with the cloud), or Google-Drive-the-web-page (you upload and share)? Sync adds delta sync, conflict resolution, and file watchers. Share-only is much smaller. In an interview, the answer is almost always share-only.

3. **Do we scan for viruses?** And if yes, do we block the upload until the scan finishes, or scan after the file is saved? Synchronous scanning blocks the UX for minutes on big files. Async scanning means a file is downloadable for a short window before it might be flagged.

4. **Versioning?** When a user uploads a new version of a file, do we keep the old one? How many versions? A reasonable default is "10 versions or 30 days, whichever is shorter."

5. **Quotas?** Each user gets X GB. What happens when they hit the limit? Quota has a sneaky race condition we will come back to.

A strong candidate also names what is out of scope: real-time co-editing, full-text search inside PDFs, third-party integrations. Those are separate products that sit on top of the storage core.

</details>

---

## Step 3: How big is this thing?

Same product, two very different scales. Do the math before you design.

| Scale | Uploads/sec | Downloads/sec | Storage/year | Egress peak |
|-------|-------------|--------------|--------------|------------|
| 10k users | ~0.08 sustained | ~0.8 sustained | ~13 TB | ~100 Mbps |
| 100M users | ~3,300 sustained, ~10k peak | ~33k sustained, ~100k peak | ~580 PB (after dedup) | ~6.4 Tbps |

<details markdown="1">
<summary><b>Show: how the numbers come out</b></summary>

**10k users:**

- 10,000 users, 5 uploads/week, 5 MB average file.
- 50,000/week = ~7,000/day = **~0.08/sec sustained, ~0.25/sec peak**. Tiny.
- Downloads at 10x: ~0.8/sec.
- Storage: 7,000/day x 5 MB = ~13 TB/year.

One server. One Postgres. One S3 bucket. The throughput is boring. What is interesting is the UX for a 5 GB upload and the share-link permission model.

**100M users:**

- 100M users, 20 uploads/week, 8 MB average.
- 2B/week = **~3,300/sec sustained, ~10,000/sec peak**.
- Downloads at 10x: ~33k/sec sustained, ~100k/sec peak.
- Storage: 286M/day x 8 MB = ~2.3 PB/day = ~840 PB/year raw. With ~30% dedup savings: ~**580 PB/year**.
- Egress at peak: 100k x 8 MB = 800 GB/s = **~6.4 Tbps**. You cannot serve this without a CDN.

**The two numbers that matter:**

The system is read-heavy by request count but write-heavy by bytes. CDN absorbs most download requests. Storage cost is the headline expense.

840 PB/year at $0.023/GB/month for S3 Standard is roughly $230M/year for raw storage. Lifecycle policies (tier down to cheaper storage) and dedup (don't store duplicates) are not optional optimizations. They are survival.

Why presigned URLs save you: a 10 Gbps NIC handles ~1.25 GB/s. That is ~150 concurrent 8 MB uploads. At 10,000 concurrent uploads peak you would need 70 servers just to forward bytes. Presigned URLs let the client upload directly to S3. Your servers never touch the bytes.

The metadata database is tiny compared to the bytes. 100B file rows at ~500 bytes each is ~50 TB. Sharded Postgres handles it. The bytes go to S3. The database holds the index.

</details>

> **Take this with you.** Storage cost at scale is the real design constraint. Lifecycle tiers and dedup are the business model, not optional features.

---

## Step 4: The smallest thing that works

Forget 100M users. We have 10 users, one workflow: Alice uploads a file and shares it with Bob.

Three boxes. Nothing else.

```mermaid
flowchart LR
    A([Alice]):::user --> API[/"Upload Service<br/>(init + finalize)"/]:::app
    API --> S3[("S3<br/>bytes")]:::db
    API --> DB[("Postgres<br/>files table")]:::db
    B([Bob]):::user --> SLR[/"Share Link<br/>Resolver"/]:::app
    SLR --> DB
    SLR -.signed URL.-> S3

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

The end-to-end flow has two phases: upload and share-link redeem.

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant App
    participant S3
    participant DB
    participant Bob

    Alice->>App: POST /uploads/init
    App->>S3: create presigned PUT URL
    App->>DB: INSERT upload_session
    App-->>Alice: presigned URL

    Alice->>S3: PUT file bytes
    S3-->>Alice: ETag

    Alice->>App: POST /uploads/finalize (ETag)
    App->>DB: INSERT files row (status=ready)
    App-->>Alice: file_id

    Alice->>App: POST /files/{id}/share_links
    App->>DB: INSERT share_links (token=random)
    App-->>Alice: share URL

    Bob->>App: GET /share/{token}
    App->>DB: look up token
    App->>S3: sign download URL (15 min)
    App-->>Bob: 302 redirect
    Bob->>S3: GET file bytes
```

<details markdown="1">
<summary><b>Show: the two tables</b></summary>

```sql
CREATE TABLE files (
    file_id      UUID PRIMARY KEY,
    owner_id     BIGINT NOT NULL,
    name         TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    content_hash BYTEA NOT NULL,
    status       SMALLINT NOT NULL DEFAULT 1,  -- 1=uploading, 2=ready, 3=quarantined, 4=deleted
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE share_links (
    token           VARCHAR(32) PRIMARY KEY,  -- 192-bit random
    file_id         UUID NOT NULL,
    created_by      BIGINT NOT NULL,
    permission      SMALLINT NOT NULL,        -- 1=view, 2=download, 3=edit
    expires_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
);
```

Five columns in each. This is the right place to start. Everything added from here is a response to a real problem.

</details>

> **Take this with you.** Start from the smallest thing that works. The interesting part of the interview is what happens next.

---

## Step 5: The first crack

The next morning the product team says: *"A user tried to upload a 3 GB file over hotel WiFi. It died at 90%. They had to start over. They left a 1-star review."*

You look at your code. `PUT file bytes` is one big HTTP request. Any network blip restarts the whole thing.

This is the trap. **Stop treating the upload as one atomic unit. Treat it as a sequence of chunks.**

Three serious options exist. Think through each before peeking.

**A. Direct upload (one big POST).** Client streams the whole file in one request to your server.

**B. Chunked resumable (S3 multipart).** Client splits the file into pieces (8 MB each). Uploads each piece separately. Retries only the failed piece.

**C. Presigned S3 URL per chunk.** Your server mints one presigned URL per chunk. Client uploads each chunk directly to S3. Your server never sees the bytes.

The right answer is **C, combined with S3 multipart**. Each chunk gets its own presigned URL. Chunks upload in parallel. A failed chunk retries on its own. After all chunks land, the client calls finalize and S3 stitches them together.

```mermaid
flowchart LR
    subgraph Phase1["Init"]
        C1([Alice]) --> A1["POST /uploads/init<br/>(size, hash)"]:::app
        A1 --> B1["check dedup<br/>check quota<br/>create S3 multipart"]:::app
        B1 --> C2["presigned URL<br/>per chunk"]:::app
    end

    subgraph Phase2["Upload chunks (parallel)"]
        C3([Alice]) --> S3A[("S3<br/>chunk 1")]:::db
        C3 --> S3B[("S3<br/>chunk 2")]:::db
        C3 --> S3C[("S3<br/>chunk N")]:::db
    end

    subgraph Phase3["Finalize"]
        C4([Alice]) --> A2["POST /uploads/finalize<br/>(ETags)"]:::app
        A2 --> S3D["S3 complete<br/>multipart"]:::db
        A2 --> DB2[("Postgres<br/>files row")]:::db
    end

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

A 1 GB upload uses ~125 chunks at 8 MB each. If chunk 87 fails, you retry chunk 87. You do not restart from chunk 1.

<details markdown="1">
<summary><b>Show: the chunked upload sequence in full</b></summary>

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant US as Upload Service
    participant S3
    participant DB as Postgres

    Alice->>US: POST /uploads/init {size, content_hash}
    US->>DB: check dedup by hash
    DB-->>US: no match

    rect rgb(241, 245, 249)
        Note over US,DB: reserve quota atomically
        US->>DB: UPDATE users SET reserved_bytes += size WHERE has_room
    end

    US->>S3: create_multipart_upload
    S3-->>US: s3_upload_id
    US->>US: presign one URL per chunk
    US->>DB: INSERT upload_session
    US-->>Alice: {upload_id, chunk_size, presigned_urls[]}

    par chunk 1
        Alice->>S3: PUT chunk 1 (presigned URL)
        S3-->>Alice: ETag 1
    and chunk 2
        Alice->>S3: PUT chunk 2 (presigned URL)
        S3-->>Alice: ETag 2
    and chunk N
        Alice->>S3: PUT chunk N (presigned URL)
        S3-->>Alice: ETag N
    end

    Alice->>US: POST /uploads/finalize {parts: [ETags]}
    US->>S3: complete_multipart_upload
    S3-->>US: final S3 key

    rect rgb(241, 245, 249)
        Note over US,DB: one transaction
        US->>DB: upsert blob (refcount++)
        US->>DB: insert files row (status=uploading)
        US->>DB: insert audit
        US->>DB: COMMIT
    end

    US-->>Alice: 200 {file_id, status: "scanning"}
```

</details>

> **Take this with you.** Chunked upload with presigned URLs solves two problems at once: the client retries individual chunks (resilience) and the bytes never touch your servers (cost).

---

## Step 6: Build the architecture, one layer at a time

We have chunked upload and share links. Now build the system around them. Add one layer at a time and explain why.

### v1: the core

```mermaid
flowchart TB
    C([Alice]):::user --> API["Upload Service<br/>(init + finalize)"]:::app
    API --> DB[("Postgres")]:::db
    API --> S3[("S3<br/>bytes")]:::db

    classDef user fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef app  fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db   fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

Fine for 1,000 users. Downloads stream from S3 through a signed URL. One server. One DB.

### v2: downloads go viral

A popular file gets 10,000 downloads in an hour. S3 egress at $0.09/GB turns into a $500 bill for one afternoon. Add a CDN.

```mermaid
flowchart TB
    C([Alice / Bob]):::user --> CF["CloudFront<br/>(CDN)"]:::edge
    CF -.miss.-> S3[("S3<br/>bytes")]:::db
    C --> API["Upload + File API"]:::app
    API --> DB[("Postgres")]:::db
    API --> S3

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

Download API returns a signed CloudFront URL (15-minute TTL). Second download of the same file comes from the CDN edge. S3 egress drops by ~90%.

### v3: malware is uploaded

An infected PDF gets shared and downloaded 500 times before anyone notices. Add async virus scanning.

```mermaid
flowchart TB
    C([Client]):::user --> GW["API Gateway<br/>(auth, rate limit)"]:::edge
    GW -->|upload init/finalize| US["Upload Service"]:::app
    GW -->|download / share| FA["File + Share API"]:::app
    US --> DB[("Postgres")]:::db
    US --> S3[("S3")]:::db
    FA --> DB
    FA --> CF["CloudFront"]:::edge
    CF -.miss.-> S3

    DB -->|CDC / outbox| Q{{"SQS<br/>file.finalized"}}:::queue
    Q --> VS["Virus Scan<br/>Worker"]:::app
    VS --> DB

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Scan runs async. Upload returns immediately with `status=scanning`. Downloads of unscanned files return 425 Too Early. Scanned-clean files flip to `status=ready`. Infected files flip to `status=quarantined` and all their share links are revoked.

### v4: cold storage and dedup

Storage cost is growing 30% per quarter. 70% of bytes haven't been touched in 90 days. And fifty people keep uploading the same software installer.

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        C([Web / Mobile / Desktop]):::user
        GW["API Gateway"]:::edge
    end

    subgraph WritePath["Upload path"]
        US["Upload Service<br/>(presigned URLs, dedup, quota)"]:::app
    end

    subgraph ReadPath["Download / share path"]
        FA["File + Share API"]:::app
        PR["Permission Resolver<br/>(cached)"]:::app
        CF["CloudFront<br/>(CDN)"]:::edge
    end

    DB[("Postgres<br/>files · blobs · shares<br/>share_links · audit")]:::db
    S3[("S3<br/>/raw/<hash><br/>lifecycle: 90d→IA, 365d→Glacier")]:::db
    Cache[("Redis<br/>perm cache")]:::cache

    Q{{"SQS / Kafka<br/>file.finalized · file.deleted"}}:::queue

    subgraph Async["Async workers"]
        VS["Virus Scan<br/>Worker"]:::app
        LM["Lifecycle Manager<br/>(refcount GC, cold tier,<br/>orphan cleanup)"]:::app
    end

    C --> GW
    GW -->|init/finalize| US
    GW -->|download/share| FA
    US --> DB
    US --> S3
    FA --> PR
    PR --> Cache
    PR -.miss.-> DB
    FA --> CF
    CF -.miss.-> S3
    DB -->|CDC outbox| Q
    Q --> VS
    Q --> LM
    VS --> DB

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Each box, in one line:

| Box | What it does |
|-----|-------------|
| **API Gateway** | Authenticates callers, rate-limits bots, dedupes mobile retries. |
| **Upload Service** | Mints presigned URLs, checks dedup and quota. Never touches bytes. |
| **File + Share API** | Generates signed CloudFront URLs. Resolves share tokens. |
| **Permission Resolver** | "Can user X download file Y?" Combines owner, invite, and folder checks. Cached 30s. |
| **CloudFront** | Edge cache. Makes the first 1% of downloads pay for the other 99%. |
| **Postgres** | Source of truth for metadata. Sharded by owner_id at scale. |
| **S3** | Source of truth for bytes. Keyed by content hash. Lifecycle rules move cold objects cheaply. |
| **Redis** | Permission cache. Most "can I access this?" checks never hit the DB. |
| **SQS / Kafka** | Decouples virus scan and GC from the write path. |
| **Virus Scan Worker** | Runs ClamAV async. Flips status on the file row. |
| **Lifecycle Manager** | Decrements refcounts on delete. Aborts abandoned uploads. |

> **Take this with you.** If the virus scan worker dies at 3 a.m., uploads still succeed. Scans just queue up. Anything reactive lives after the queue, not before it.

---

## Step 7: One upload, end to end

Alice uploads a 1.5 GB video. Watch what happens.

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant GW as API Gateway
    participant US as Upload Service
    participant DB as Postgres
    participant S3
    participant Q as SQS
    participant VS as Virus Scan

    Alice->>GW: POST /uploads/init {size, content_hash}
    GW->>US: forward (auth ok)
    US->>DB: check blob by content_hash
    DB-->>US: no match

    rect rgb(241, 245, 249)
        Note over US,DB: reserve quota atomically
        US->>DB: UPDATE users SET reserved_bytes += 1.5GB WHERE has_room
        DB-->>US: ok
    end

    US->>S3: create_multipart_upload
    S3-->>US: s3_upload_id
    US->>DB: INSERT upload_session
    US-->>GW: 201 {upload_id, chunk_size, presigned_urls[]}
    GW-->>Alice: 201

    Note over Alice,S3: Alice uploads ~190 chunks directly to S3 (parallel)
    Alice->>S3: PUT chunk 1..N (presigned)
    S3-->>Alice: ETags

    Alice->>GW: POST /uploads/finalize {parts: [ETags]}
    GW->>US: forward
    US->>S3: complete_multipart_upload
    S3-->>US: final S3 key

    rect rgb(241, 245, 249)
        Note over US,DB: one transaction
        US->>DB: upsert blob (refcount=1)
        US->>DB: insert files row (status=uploading)
        US->>DB: insert audit
        US->>DB: COMMIT
    end

    US->>Q: emit file.finalized
    US-->>GW: 200 {file_id, status: "scanning"}
    GW-->>Alice: 200

    Q->>VS: file.finalized event
    VS->>VS: scan bytes
    VS->>DB: UPDATE files SET status = ready
```

Three things worth pointing at:

1. The blob upsert, file row, and audit write happen in one transaction. Crash mid-write rolls back cleanly. State is never partial.
2. Quota is reserved at init, not finalize. If Alice's phone and laptop both start uploading at the same instant, the `UPDATE WHERE has_room` serializes them.
3. The virus scan runs after Alice gets her 200 OK. Scan results come later, asynchronously.

---

## Step 8: Share links and permissions

Sharing has two flavors and three permission levels.

**Flavors:**

- **Direct invite.** Owner enters someone's email. That user sees the file in "Shared with me."
- **Share link.** Owner generates a URL. Anyone with the URL gets in.

**Permissions:** view (preview only), download (fetch original), edit (upload new version).

Try to answer before peeking: what does the share_links table look like? How do you expire a link? Password-protect one? Stop an attacker from guessing tokens? What happens when Bob clicks the link?

<details markdown="1">
<summary><b>Show: how share links work end to end</b></summary>

**Token generation.**

```python
import secrets
token = base62(secrets.token_bytes(24))   # 24 bytes = 192 bits
```

192 bits is too large to brute-force. You will never get a collision. Just as important: the token has no relationship to the file it unlocks. Leaking the token-generation algorithm leaks nothing.

**The resolution flow:**

```mermaid
sequenceDiagram
    autonumber
    participant Bob
    participant SLR as Share Link Resolver
    participant DB as Postgres
    participant CF as CloudFront

    Bob->>SLR: GET /share/<token>
    SLR->>DB: look up token

    alt token not found or revoked
        SLR-->>Bob: 404 Not Found
    else expired
        SLR-->>Bob: 410 Gone
    else password required, none given
        SLR-->>Bob: 401 Unauthorized
    else all checks pass
        SLR->>SLR: sign CloudFront URL (15 min TTL)
        SLR->>DB: increment redemptions counter
        SLR-->>Bob: 302 redirect to signed URL
        Bob->>CF: GET <signed URL>
        CF-->>Bob: file bytes (from cache or S3)
    end
```

**Why the 15-minute signed URL matters.** If the share link itself was the download credential, a view-only share would leak the raw file the moment someone right-clicked "save target as." Mint a fresh signed URL on every redemption, scoped to what the permission allows.

**Password protection.** Hash the password with bcrypt when the link is created. Verify on redeem. Never put the password in the URL.

**Revoking a link.** Set `revoked_at = NOW()` on that one row. The other 999 links for the same file keep working. This is why we use one row per link, not one share per file.

**The schema:**

```sql
CREATE TABLE shares (
    share_id    UUID PRIMARY KEY,
    file_id     UUID NOT NULL,
    granted_to  BIGINT NOT NULL,
    granted_by  BIGINT NOT NULL,
    permission  SMALLINT NOT NULL,    -- 1=view, 2=download, 3=edit
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ
);

CREATE TABLE share_links (
    token              VARCHAR(32) PRIMARY KEY,  -- 192-bit random
    file_id            UUID NOT NULL,
    created_by         BIGINT NOT NULL,
    permission         SMALLINT NOT NULL,
    expires_at         TIMESTAMPTZ,
    password_hash      BYTEA,
    require_account    BOOLEAN DEFAULT FALSE,
    max_redemptions    INT,
    redemptions        INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at         TIMESTAMPTZ
);
CREATE INDEX idx_links_file ON share_links (file_id);
```

**Folder shares.** If you share a folder, every file inside inherits the permission. At access-check time, walk the parent chain: "is any folder above this file shared with me?" Cache aggressively. This is the hottest read path in the whole system.

</details>

> **Take this with you.** One row per share link. Revoke by setting `revoked_at` on that row. Never make the file ID the share credential.

---

## Step 9: Storage tiers (saving money on cold files)

A file uploaded today might be downloaded 50 times this week. A file from two years ago is probably never touched again. Paying the same price for both is wasteful.

S3 has three tiers:

| Tier | Cost/GB/month | Retrieval time | Use case |
|------|--------------|---------------|---------|
| **S3 Standard** (hot) | $0.023 | < 100 ms | Recently active files |
| **S3 Infrequent Access** (warm) | $0.0125 | < 100 ms | Quiet 30-365 days |
| **Glacier** (cold) | $0.0036 | 1-5 min fast, 3-5 hr standard | Quiet 365+ days |

Try to draw the tiering flowchart yourself first: when does a file move from hot to warm to cold? What happens when a cold file gets accessed?

<details markdown="1">
<summary><b>Show: the tiering flow</b></summary>

```mermaid
flowchart TD
    A([New file uploaded]) --> B["S3 Standard - hot"]:::app
    B --> C{Accessed in last 90 days?}
    C -->|Yes| B
    C -->|No| D["S3 IA - warm"]:::cache
    D --> E{Accessed in last 365 days?}
    E -->|Yes| D
    E -->|No| F["S3 Glacier - cold"]:::db
    F --> G{User clicks Download?}
    G -->|No| F
    G -->|Yes| H["Restore: 1-5 min expedited<br/>or 3-5 hr standard"]:::queue
    H --> B

    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Glacier is ~6x cheaper than Standard. On 580 PB, that is the difference between $160M/year and $25M/year. Lifecycle policy is not an optimization. It is the business model.

Three gotchas:

- **Glacier retrieval surprises users.** Standard retrieval takes 3-5 hours. Show "Restoring. We will email you when ready." Users hate surprise waits more than honest ones.
- **Do not tier small files.** S3 IA has a 128 KB minimum-object-size charge. Tiering a 10 KB file actually costs more. Exclude files smaller than 128 KB from the lifecycle rule.
- **Cold-tier deletes have penalties.** A file deleted in Glacier still incurs the 90-day minimum storage charge. Soft-delete first. Hard-delete after the regret window.

</details>

> **Take this with you.** S3 lifecycle rules are three lines of config. At PB scale, they save tens of millions of dollars per year.

---

## Step 10: Content-addressed dedup

Fifty users upload the same 200 MB software installer. Do you store it 50 times?

No. Hash the file content. Two files with the same bytes have the same hash. Store the bytes once. Let many `files` rows point at the same blob.

```
             blobs table                    files table
         (one per unique bytes)         (one per user pointer)

         hash = abc...              <-- "installer-2024.exe"  (Alice)
         refcount = 3               <-- "setup.exe"           (Bob)
                                    <-- "v1.0-install.exe"    (Carol)

         hash = def...              <-- "report.pdf"          (Alice)
         refcount = 1
```

When Alice deletes her copy: decrement refcount from 3 to 2. Bob and Carol still reference the blob. Blob stays alive. When refcount finally hits zero, schedule the bytes for deletion after a 24-hour grace period.

Consumer file-sharing services see ~30% storage savings from dedup. On 580 PB that is ~170 PB saved. At $0.023/GB/month, that is ~$50M/year.

One privacy note: knowing your file's hash matches another user's tells you they have the same content. For consumer use that is fine. For high-privacy products (legal, medical), disable cross-tenant dedup.

> **Take this with you.** Blob is the bytes. File is the user-named pointer. Keep them in separate tables. Refcount the blob. The rest follows.

---

## Follow-up questions

Try answering each in 2-4 sentences before reading the solution.

1. **Resume the next day.** Alice uploads 3 GB of a 5 GB file, then closes her laptop. The next morning she reopens the app. What happens? How does the client know which chunks already landed? How long do you keep half-finished uploads around?

2. **Quota race.** Alice has 100 MB of quota left. Her phone and laptop both start uploading 80 MB files at the same instant. Both pass the quota check at init. Both upload. Now she is 60 MB over quota. How do you prevent this?

3. **Dedup details.** Three users upload the same 200 MB installer. How do you store it once? What does "delete" mean when one user deletes their copy? What about privacy?

4. **Token guessing.** Your tokens are 192 bits, so brute force is out. But a researcher finds your `created_at` timestamps in the response. Is this a real attack? What other side channels leak?

5. **Big delete.** A user with a 50 TB account deletes 10 TB in one click. Your metadata DB does 200,000 row updates and S3 issues 200,000 delete requests. What goes wrong? How do you smooth it out?

6. **Late-positive virus scan.** A scan flags a file as malware after 500 people have already downloaded it. What is your response? Can you tell who downloaded it? What about the share links?

7. **Edit conflict.** Two users with Edit permission upload a new version of the same file within 10 seconds. Whose version wins? How does the loser find out?

8. **Viral file.** A YouTuber's public share link gets 1 million downloads in 24 hours for a 200 MB tutorial video. CDN cache hits 99%, but the 1% miss rate still hammers one S3 prefix. What do you do?

9. **GDPR delete.** A user wants their data fully erased. They have 12,000 files, some deduped with other users. They also created share links and were granted shares on other users' files. How do you erase them?

10. **Per-tenant billing.** You sell this to enterprises. One customer wants a monthly bill: storage GB by tier, egress GB, virus-scan calls, API requests. How do you attribute every byte and every call to the right tenant?

---

## Related problems

- **[Video Streaming (006)](../006-video-streaming/question.md).** Same shape: bytes in S3, metadata in Postgres, CDN in front. Video adds adaptive bitrate transcoding. The storage and CDN layers overlap heavily.
- **[Distributed Cache (009)](../009-distributed-cache/question.md).** The permission resolver cache and the CDN edge cache both follow the same eviction and warming patterns.
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md).** The "show me my files" dashboard and share-link resolution are textbook read-heavy paths.
- **[Write-Heavy System Patterns (018)](../018-write-heavy-patterns/question.md).** The audit log here is exactly a write-heavy append-only system.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: File Upload & Share Service

### The short version

This looks like a thin HTTP wrapper around S3. It is not. The interesting design is everything around the bytes:

- **How does a 5 GB upload survive a bad network?** Chunked upload with presigned URLs. Client splits the file into 8 MB pieces. Each piece uploads on its own. Failed chunks retry without restarting the whole file.
- **How do you store the same file once when 50 people upload it?** Content-addressed dedup. Hash the file content (SHA-256). Two files with the same bytes share one set of bytes in S3.
- **How do you revoke one share link without breaking 999 others?** One row per link in `share_links` with a `revoked_at` column. Revoke is one UPDATE.
- **How does a file nobody has touched in two years stop costing money?** S3 lifecycle policy moves it to cheaper tiers (S3 IA after 90 days, Glacier after 365 days).

The data model fits on a napkin. Seven tables: `files`, `file_versions`, `blobs`, `shares`, `share_links`, `upload_sessions`, `audit`. Bytes live in S3, addressed by their content hash. Metadata is sharded by owner because almost every query is "show me my stuff."

Uploads go client-to-S3 directly via presigned URLs. Your app servers never touch the bytes. That one decision saves you an order of magnitude on bandwidth cost.

---

### 1. The two questions that matter most

**What is the biggest file size?** Anything above ~100 MB forces chunked or presigned uploads. 5 GB forces S3 multipart.

**Sync or share-only?** Sync (Dropbox desktop) is a different problem: delta sync, conflict resolution, file watchers. Share-only (Google Drive web) is what this design covers.

Everything else (versioning, virus scan, GDPR, quotas) follows from those two answers.

---

### 2. The math, in plain numbers

| Scale | Uploads/sec | Downloads/sec | Storage/year | Egress peak |
|-------|------------|--------------|-------------|------------|
| 10k users | ~0.08 sustained, ~0.25 peak | ~0.8 | ~13 TB | ~100 Mbps |
| 100M users | ~3,300 sustained, ~10k peak | ~33k sustained, ~100k peak | ~580 PB (after 30% dedup) | ~6.4 Tbps |

Three numbers that matter more than throughput:

- **Storage cost is the headline expense.** At PB scale, $0.023/GB/month for S3 Standard is hundreds of millions per year. Lifecycle tiers and dedup are survival, not optimization.
- **The system is read-heavy by request count, write-heavy by bytes.** CDN absorbs most downloads. S3 ingests all upload bytes.
- **Metadata DB is tiny.** 100B file rows at ~500 bytes each is ~50 TB. Sharded Postgres handles it. The bottleneck is bytes, not rows.

---

### 3. The API

Five endpoints carry the whole product.

```
POST /api/v1/uploads/init
Authorization: Bearer <token>

{
  "file_name": "vacation.mp4",
  "size": 1572864000,
  "mime_type": "video/mp4",
  "content_hash": "sha256:abc123...",
  "parent_folder_id": "fld_xyz",
  "client_idempotency_key": "uuid"
}
```

| Status | Meaning | Body |
|--------|---------|------|
| 201 Created | New upload session | `{upload_id, chunk_size, presigned_urls[]}` |
| 200 OK | Dedup hit. File already exists. No upload needed. | `{file_id, deduped: true}` |
| 400 | File too big | `{error: "file_too_large"}` |
| 402 | Out of quota | `{error: "quota_exceeded", available_bytes: ...}` |

Client then `PUT`s directly to the presigned S3 URLs. Your server is not in the path.

```
POST /api/v1/uploads/{upload_id}/finalize
{ "parts": [{"part": 1, "etag": "abc"}, ...] }

POST /api/v1/files/{file_id}/share_links
{
  "permission": "download",
  "expires_at": "2026-08-01T00:00:00Z",
  "password": "optional",
  "max_redemptions": null
}

GET /api/v1/share/{token}          -- redeem a share link
GET /api/v1/files/{file_id}/download  -- direct download (307 to signed URL)
```

Three small but load-bearing choices:

- **Idempotency on upload init is required.** Mobile clients retry on timeout. Without it, retries create new sessions and you get orphaned half-uploads everywhere.
- **The content hash at init is what makes "re-uploading my photo library" instant.** Client computes SHA-256. Server checks for a matching blob. If found, return the existing file_id and skip the upload entirely.
- **Finalize takes ETags because S3 multipart finalize needs them.** S3 stitches chunks together based on the part list with ETags.

---

### 4. The data model

Seven tables. Two big, five supporting.

```mermaid
erDiagram
    blobs ||--o{ files : "content_hash"
    files ||--o{ file_versions : has
    files ||--o{ shares : "direct invite"
    files ||--o{ share_links : "link share"
    files ||--o{ audit : events

    blobs {
        bytea content_hash PK
        bigint size_bytes
        text storage_key
        int refcount
        smallint storage_tier
    }
    files {
        uuid file_id PK
        bigint owner_id
        uuid parent_folder_id
        text name
        bigint size_bytes
        bytea content_hash
        smallint status
        smallint storage_tier
    }
    share_links {
        varchar token PK
        uuid file_id
        bigint created_by
        smallint permission
        timestamptz expires_at
        bytea password_hash
        int redemptions
        timestamptz revoked_at
    }
```

<details markdown="1">
<summary><b>Show: the full SQL for the two core tables</b></summary>

```sql
CREATE TABLE blobs (
    content_hash     BYTEA PRIMARY KEY,
    size_bytes       BIGINT NOT NULL,
    storage_key      TEXT NOT NULL,          -- S3 key /raw/<hash>
    refcount         INT NOT NULL DEFAULT 1,
    first_uploaded   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_tier     SMALLINT NOT NULL DEFAULT 1  -- 1=hot, 2=warm, 3=cold
);

CREATE TABLE files (
    file_id          UUID PRIMARY KEY,
    owner_id         BIGINT NOT NULL,
    parent_folder_id UUID,
    name             TEXT NOT NULL,
    size_bytes       BIGINT NOT NULL,
    content_hash     BYTEA NOT NULL REFERENCES blobs(content_hash),
    current_version  INT NOT NULL DEFAULT 1,
    status           SMALLINT NOT NULL DEFAULT 1, -- 1=uploading, 2=ready, 3=quarantined, 4=deleted
    storage_tier     SMALLINT NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_files_owner  ON files (owner_id, parent_folder_id);
CREATE INDEX idx_files_hash   ON files (content_hash);   -- dedup lookups

CREATE TABLE upload_sessions (
    upload_id         UUID PRIMARY KEY,
    user_id           BIGINT NOT NULL,
    expected_size     BIGINT NOT NULL,
    expected_hash     BYTEA,
    total_chunks      INT NOT NULL,
    s3_upload_id      TEXT NOT NULL,
    status            SMALLINT NOT NULL DEFAULT 1,  -- 1=active, 2=finalized, 3=abandoned
    idempotency_key   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX idx_session_idem ON upload_sessions (user_id, idempotency_key);

CREATE TABLE share_links (
    token              VARCHAR(32) PRIMARY KEY,
    file_id            UUID NOT NULL REFERENCES files(file_id),
    created_by         BIGINT NOT NULL,
    permission         SMALLINT NOT NULL,
    expires_at         TIMESTAMPTZ,
    password_hash      BYTEA,
    require_account    BOOLEAN DEFAULT FALSE,
    max_redemptions    INT,
    redemptions        INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at         TIMESTAMPTZ
);
CREATE INDEX idx_links_file ON share_links (file_id);
```

</details>

Four choices worth defending out loud:

**`blobs` is separate from `files`.** A blob is the actual bytes, addressed by hash. A file is a user-named pointer to a blob. Many files can point at one blob. `refcount` tracks how many files reference each blob. When it hits zero, the blob is eligible for deletion with a 24-hour grace period.

**Sharded by `owner_id`.** Almost every query is "list my files in folder X." Co-locating one user's files on one shard makes those queries single-shard. Cross-shard share lookups use a separate global index on `shares.granted_to`.

**`upload_sessions` lives in Postgres, not Redis.** Sessions can live for hours and must survive cache eviction. Volume is low (one row per in-flight upload).

**`share_links.token` is opaque.** No relationship to the file, the owner, or the creation time. Leaking the generation algorithm leaks nothing about existing tokens.

---

### 5. Core algorithms

**Upload init and finalize:**

<details markdown="1">
<summary><b>Show: init_upload and finalize_upload</b></summary>

```python
def init_upload(user_id, file_name, size, content_hash, idempotency_key):
    existing = db.find_session_by_idempotency(user_id, idempotency_key)
    if existing:
        return existing

    if content_hash:
        blob = db.find_blob(content_hash)
        if blob and blob.size_bytes == size:
            file_id = create_file_pointing_at_blob(user_id, file_name, blob)
            return {"deduped": True, "file_id": file_id}

    if not reserve_quota(user_id, size):
        raise QuotaExceeded

    s3_upload_id = s3.create_multipart_upload(bucket="user-data", key=f"raw/pending/{uuid4()}")
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

    result = s3.complete_multipart_upload(session.s3_upload_id, parts)

    with db.transaction():
        blob = db.upsert_blob(session.expected_hash, session.expected_size, result.key)
        file_id = db.insert_file(session.user_id, session.file_name, blob)
        db.insert_audit(file_id, "file.created")
        db.mark_session_finalized(upload_id)

    publish_event("file.finalized", file_id)
    return file_id
```

</details>

**Share link resolution** (the hot path):

```python
def resolve_share_link(token, password=None):
    link = db.find_share_link(token)
    if not link or link.revoked_at:
        return 404
    if link.expires_at and link.expires_at < now():
        return 410
    if link.max_redemptions and link.redemptions >= link.max_redemptions:
        return 410
    if link.password_hash and not bcrypt.verify(password, link.password_hash):
        return 401

    signed_url = cloudfront.sign(
        key=link.file.blob.storage_key,
        expires_in=900  # 15 minutes
    )
    db.increment_redemptions(token)
    return 302, signed_url
```

**Dedup upsert at finalize:**

```sql
INSERT INTO blobs (content_hash, size_bytes, storage_key, refcount)
VALUES (?, ?, ?, 1)
ON CONFLICT (content_hash) DO UPDATE SET refcount = blobs.refcount + 1;
```

If the blob already exists, no new S3 object is written. The `files` row points at the existing blob.

---

### 6. The architecture

```mermaid
flowchart TB
    subgraph Edge["Client edge"]
        C([Web / Mobile / Desktop]):::user
        GW["API Gateway<br/>(auth · rate limit · WAF)"]:::edge
    end

    subgraph WritePath["Upload path"]
        US["Upload Service<br/>(presigned URLs · dedup · quota)"]:::app
    end

    subgraph ReadPath["Download / share path"]
        FA["File + Share API"]:::app
        PR["Permission Resolver<br/>(cached 30s)"]:::app
        CF["CloudFront<br/>(CDN · 60s TTL)"]:::edge
    end

    DB[("Postgres<br/>files · blobs · shares<br/>share_links · audit")]:::db
    S3[("S3<br/>/raw/<hash><br/>90d→IA, 365d→Glacier")]:::db
    Cache[("Redis<br/>perm cache")]:::cache

    Q{{"SQS / Kafka<br/>file.finalized · file.deleted"}}:::queue

    subgraph Async["Async workers"]
        VS["Virus Scan Worker<br/>(ClamAV)"]:::app
        LM["Lifecycle Manager<br/>(refcount GC · orphan cleanup)"]:::app
    end

    C --> GW
    GW -->|init / finalize| US
    GW -->|download / share| FA
    US --> DB
    US --> S3
    FA --> PR
    PR --> Cache
    PR -.miss.-> DB
    FA --> CF
    CF -.miss.-> S3
    DB -->|CDC outbox| Q
    Q --> VS
    Q --> LM
    VS --> DB

    classDef user  fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef edge  fill:#e2e8f0,stroke:#475569,color:#1e293b
    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

Five things to notice:

- The Upload Service mints presigned URLs and never touches the bytes. That single decision is what lets one small pod handle thousands of uploads per second.
- CloudFront sits in front of S3 for downloads. Short TTL (60 seconds) so revocations propagate fast. Without it, a viral file melts your S3 egress bill.
- The Permission Resolver is a separate concern because it is the hottest read path. "Can user X do Y on file Z?" combines owner check, direct share, and folder share inheritance. Cache 30 seconds per `(user, file)` pair. Most lookups never touch the DB.
- Virus scan and lifecycle GC are downstream of SQS/Kafka, not on the write path. If the scan worker falls behind, uploads still succeed.
- The metadata DB is sharded by `owner_id`. Cross-shard share lookups go through a global index.

---

### 7. A request, end to end

```mermaid
sequenceDiagram
    autonumber
    participant Alice
    participant GW as API Gateway
    participant US as Upload Service
    participant DB as Postgres
    participant S3
    participant Q as SQS
    participant VS as Virus Scan

    Alice->>GW: POST /uploads/init {size, content_hash}
    GW->>US: forward (auth ok)
    US->>DB: check blob by content_hash
    DB-->>US: no match

    rect rgb(241, 245, 249)
        Note over US,DB: atomic quota reservation
        US->>DB: UPDATE users SET reserved_bytes += size WHERE has_room
        DB-->>US: ok
    end

    US->>S3: create_multipart_upload
    S3-->>US: s3_upload_id
    US->>DB: INSERT upload_session
    US-->>GW: 201 {upload_id, presigned_urls[]}
    GW-->>Alice: 201

    Note over Alice,S3: chunks upload directly to S3 in parallel
    Alice->>S3: PUT chunks 1..N (presigned)
    S3-->>Alice: ETags

    Alice->>GW: POST /uploads/finalize {parts: [ETags]}
    GW->>US: forward
    US->>S3: complete_multipart_upload
    S3-->>US: final S3 key

    rect rgb(241, 245, 249)
        Note over US,DB: one transaction
        US->>DB: upsert blob (refcount=1)
        US->>DB: insert files row (status=uploading)
        US->>DB: insert audit
        US->>DB: COMMIT
    end

    US->>Q: emit file.finalized
    US-->>GW: 200 {file_id}
    GW-->>Alice: 200

    Q->>VS: file.finalized
    VS->>VS: scan bytes
    VS->>DB: UPDATE files SET status = ready
```

Target latencies:

| Operation | P99 |
|-----------|-----|
| Upload init | ~200 ms (dedup lookup when cache cold) |
| Finalize | ~500 ms (S3 multipart completion) |
| Permission resolution | ~50 ms (cached) |
| Download (CDN hit) | ~30 ms (edge latency) |

---

### 8. Storage tiers

```mermaid
flowchart TD
    A([New file uploaded]) --> B["S3 Standard"]:::app
    B --> C{Accessed in last 90 days?}
    C -->|Yes| B
    C -->|No| D["S3 Infrequent Access"]:::cache
    D --> E{Accessed in last 365 days?}
    E -->|Yes| D
    E -->|No| F["S3 Glacier"]:::db
    F --> G{User downloads?}
    G -->|No| F
    G -->|Yes| H["Restore: 1-5 min expedited<br/>or 3-5 hr standard"]:::queue
    H --> B

    classDef app   fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef cache fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    classDef db    fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef queue fill:#ddd6fe,stroke:#6d28d9,color:#4c1d95
```

| Tier | Cost/GB/month | Retrieval | Retrieval cost |
|------|--------------|---------|---------------|
| **S3 Standard** | $0.023 | < 100 ms | free |
| **S3 IA** | $0.0125 | < 100 ms | $0.01/GB |
| **Glacier** | $0.0036 | 1-5 min fast, 3-5 hr standard | $0.03/GB |

On 580 PB cold: Glacier is ~$25M/year. Standard is ~$160M/year. The lifecycle policy is the business model.

Three gotchas: Glacier retrieval surprises users (show progress UI), small files under 128 KB cost more to tier to IA than to leave hot, and cold-tier deletes incur a 90-day minimum storage penalty (soft-delete first, hard-delete later).

---

### 9. Scaling journey: 10 to 1M users

```mermaid
flowchart LR
    S1["Stage 1<br/>10-1k users<br/>1 VM + local disk<br/>~$20/mo"]:::s1
    S2["Stage 2<br/>~10k users<br/>+ S3 presigned<br/>+ share links<br/>~$100/mo"]:::s2
    S3["Stage 3<br/>100k users<br/>+ chunked upload<br/>+ CDN + scan<br/>+ lifecycle<br/>~$10k/mo"]:::s3
    S4["Stage 4<br/>1M users<br/>+ regional buckets<br/>+ sharded DB<br/>+ per-tenant KMS<br/>~$200k/mo"]:::s4

    S1 --> S2 --> S3 --> S4

    classDef s1 fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef s2 fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef s3 fill:#fef3c7,stroke:#a16207,color:#713f12
    classDef s4 fill:#fce7f3,stroke:#be185d,color:#831843
```

#### Stage 1: 10 to 1,000 users

One VM. Files saved to local disk under `/var/data/<user_id>/<file_id>`. Postgres on the same machine. Direct POST upload, files capped at 100 MB. Direct invite sharing only. No virus scan, no versioning, no quota. ~$20/month. Ships in a weekend.

The throughput is tiny (well under 1 upload per minute). Nothing is big enough to fail mid-upload. No presigned URLs needed yet.

#### Stage 2: 10,000 users

Something breaks: local disk fills up. A user's 2 GB upload drops at 1.8 GB and they have to start over.

Fixes:
- Move bytes to S3 via presigned PUT URLs. App server leaves the byte path.
- Add anonymous share links. `share_links` table with 192-bit tokens.
- Add view/download/edit permission scopes.
- Add per-user quota with soft-delete and 30-day trash.

Still no chunked upload. Still no CDN. One DB. ~$100-300/month.

#### Stage 3: 100,000 users

Several things break at once:
- A user uploads a 4 GB video on hotel WiFi. Fails at 80%. Whole thing restarts. 1-star review.
- A malware PDF gets shared and downloaded 500 times before anyone notices.
- Storage cost at $3-5k/month growing 30% per quarter. 70% of bytes untouched after 30 days.
- S3 egress at $2k/month because every download streams full-price from S3.

Fixes, in order:
- Chunked upload via S3 multipart. A flaky 4 GB upload now survives.
- Virus scan pipeline via SQS. Async, does not block uploads.
- CloudFront in front of S3 with 60-second TTL on signed URLs. Egress drops ~90%.
- S3 lifecycle policy: 90 days to IA, 365 to Glacier. Saves ~70% on cold bytes.
- Two Postgres read replicas. Dashboards read from replicas.
- Atomic quota reservation with `UPDATE WHERE has_room`.

Still single-region. DB does not need sharding yet (100M rows at 500 bytes is 50 GB). ~$10-20k/month.

#### Stage 4: 1 million users

New pains:
- EU users complain about latency uploading to us-east-1.
- A healthcare customer demands data residency.
- A viral share link gets 1M downloads in 24 hours. CloudFront absorbs 99% but the 1% concentrates on one S3 prefix and triggers S3 throttling.
- Metadata DB primary at 60% CPU at peak.

Fixes:
- Regional S3 buckets per region. Files land in the user's home region.
- Shard metadata DB by `owner_id`. Each region is primary for its own users.
- Share link tokens encode the file's home region in the first few characters so any region routes correctly.
- CloudFront with multiple origins and hash-prefix-sharded S3 keys so viral files spread across prefixes.
- Per-user quota in Redis with `INCRBY` reservations for the race-free fast path.
- Per-tenant KMS keys for enterprise (customer-controlled kill switch).

The architecture is the same shape as Stage 3, multiplied across regions. ~$200-500k/month, dominated by S3 storage and egress.

---

### 10. Reliability

**Interrupted upload resume.** Upload sessions live 24 hours in `upload_sessions`. Client calls `GET /uploads/{upload_id}` to ask which chunks have landed. Server queries S3 `ListParts` and returns uploaded part numbers. Client re-uploads only missing parts. After 24 hours, the Lifecycle Manager calls `s3.abort_multipart_upload` and marks the session abandoned.

**Orphan chunks.** Lifecycle Manager runs every 6 hours. For each session with `status=active AND expires_at < now()`, abort the S3 multipart. Safety net: a global S3 lifecycle rule aborts any multipart older than 7 days.

**Virus scan failures.** Three flavors:
- Worker dies mid-scan. SQS visibility timeout expires. Another worker picks up the message. Idempotent.
- Scan API is down. Worker retries with backoff. If down over an hour, files remain `status=uploading` and downloads return 425 Too Early.
- Scan finds a virus after downloads have already happened. Flip `status=quarantined`. Set `revoked_at` on all share links for the file. Notify authenticated downloaders by email.

**Metadata DB primary failure.** Promote a replica. Reads continue from other replicas during the 30-60 second promotion. In-flight upload sessions see a few errors and retry via the idempotency key.

**S3 outage.** Presigned PUTs return 5xx. Signed GETs return 5xx. CloudFront serves whatever it has cached for downloads. Metadata operations still work. Honest answer: wait for S3 to recover. Multi-region replication helps for reads but is expensive and only justified for enterprise HA tiers.

---

### 11. Observability

| Metric | Why it matters |
|--------|---------------|
| `upload.init.rate` | Drop signals auth or API issues. |
| `upload.success_rate` (finalize/init) | Headline UX SLO. If 60% of inits never finalize, something is broken. |
| `upload.duration` by file size bucket | Tells you "all uploads are slow" from "1 GB+ uploads are slow." |
| `download.cache_hit_rate` (CDN) | Should be > 95% in steady state. |
| `share_link.resolution.p99` | Hot path latency. |
| `share_link.brute_force_alerts` | Tokens with > 50 failed redemption attempts in an hour. |
| `quota.exceeded.rate` | Spikes signal a rogue user or integration. |
| `virus_scan.queue_depth` | If growing, scanner cannot keep up. Recent uploads are in a scan gap. |
| `virus_scan.positive_rate` | Sudden spike means a malware campaign. |
| `blob.refcount.zero.count` | Eligible-for-GC blobs. Should drain over time. |
| `storage.by_tier.bytes` | Hot/warm/cold breakdown. Input for cost forecasting. |
| `egress.bytes_per_region` | Where the money goes. |

Page on: upload success rate under 90% for 5 min. Virus scan queue depth over 10k. CDN origin error rate over 1%.

Ticket on: per-user bandwidth anomaly. Quota race detected. Storage growth more than 2 sigma above forecast.

---

### 12. Follow-up answers

**1. Resumable upload across days.**

Client persists `upload_id` locally. On reopen, calls `GET /uploads/{upload_id}`. Server queries S3 `ListParts`, returns uploaded part numbers and original chunk size. Client uploads only missing parts and finalizes. If the session is past its 24-hour TTL, client gets 410 Gone and must start fresh. Abandoned sessions get GC'd every 6 hours by the Lifecycle Manager calling `AbortMultipartUpload`.

**2. Quota race.**

Fix with an explicit reservation:

```sql
UPDATE users
   SET reserved_bytes = reserved_bytes + ?
 WHERE user_id = ?
   AND used_bytes + reserved_bytes + ? <= quota_bytes
RETURNING reserved_bytes;
```

If this returns 0 rows, the upload is rejected with 402. Reservation is held until finalize (moves to `used_bytes`) or session expiry (released). At higher scale, run the same logic in Redis with `INCRBY` and compare-and-swap, with periodic reconciliation back to the DB.

**3. Content-addressed dedup.**

A `blobs` table keyed by SHA-256. On finalize:

```sql
INSERT INTO blobs (content_hash, size_bytes, storage_key, refcount)
VALUES (?, ?, ?, 1)
ON CONFLICT (content_hash) DO UPDATE SET refcount = blobs.refcount + 1;
```

If the blob exists, no new S3 object is written. The `files` row points at the existing blob. Delete decrements `refcount` atomically. When it hits zero, schedule the S3 object for deletion after a 24-hour grace period. For sensitive use cases (legal, medical), disable cross-tenant dedup and dedup only within one account.

**4. Share link enumeration.**

192 bits of entropy makes direct brute force impossible. Side channels are the real concern:
- Timing: "token not found" and "token found but expired" should take the same time. Use a unified error path.
- Error leakage: return the same 404 for "no such token" and "expired." Do not include `expired_at` in unauthenticated responses.
- Web logs: tokens appear in access logs. Treat them as secrets. Hash before logging.
- Rate limiting: per-IP limits on `/share/*` thwart high-volume probing.

**5. Large delete tombstone backlog.**

200k file row updates and 200k S3 DELETEs done synchronously cause DB lock contention, S3 throttling, and HTTP timeouts. The user clicks Delete again and doubles the load.

Fix: write a single `deletion_jobs` row `(user_id, target_folder_id, requested_at)` and return 202 Accepted with a `job_id`. A background worker processes in batches of 1,000: soft-delete in DB, decrement blob refcounts, enqueue S3 deletion (S3 bulk-delete handles 1,000 objects per call). After 30 days of trash retention, a sweeper hard-deletes blobs whose refcount reached zero.

**6. Late-positive virus scan.**

In order:
1. Flip `status` to quarantined.
2. `UPDATE share_links SET revoked_at = NOW() WHERE file_id = ?`.
3. Invalidate CloudFront for the file's URL prefix.
4. Query audit for `event_type = 'file.downloaded' AND file_id = ?` to identify authenticated downloaders.
5. Notify them in-app and by email: "A file you downloaded was later found to contain malware."
6. Notify the uploader.

Pre-mitigation: keep the post-finalize, pre-scan window short. Faster scanning narrows the exposure gap.

**7. Edit conflict.**

Two users with Edit upload new versions within 10 seconds. Default behavior: both succeed, both create version rows. `files.current_version` points to the last one to land. The losing user's version exists in `file_versions`.

Surface a conflict notification: "User B also uploaded a new version at the same time. Theirs is now current. Yours is in history at version N."

For stronger guarantees, accept `If-Match: <current_version>` on upload. A mismatch returns 412 Precondition Failed and the client shows a conflict picker.

**8. Viral file.**

1M downloads of a 200 MB file in 24 hours. 99% CDN hit. The 1% miss is ~10k requests to S3 over the day, but if they cluster they can hit S3's 5,500 GET/s per-prefix limit.

Mitigations:
- Pre-warm CDN edges when a high-traffic link is created (push to all CloudFront edges immediately).
- Hash-prefix-shard S3 keys: store blobs at `/raw/<hash[0:2]>/<hash[2:4]>/<hash>` so popular files land on different prefixes.
- CloudFront Origin Shield: a regional cache between edges and S3, collapsing many edge misses into one S3 fetch.

**9. GDPR delete.**

1. Mark account `status = deleting`, log the user out, freeze to read-only.
2. Enqueue a `deletion_jobs` row for background processing.
3. Walk owned files: decrement each blob's refcount, revoke all share links the user created.
4. Walk received shares: set `revoked_at` where the user is `granted_to`. The file stays for the owner.
5. Walk audit log: replace `actor_id` with a hash, drop PII from payloads.
6. Delete the user row after the grace period (typically 30 days).
7. Email a deletion certificate.

The tricky part: files deduped with other users. Decrementing refcount may leave the blob alive. That is correct. The user's pointer is gone even if the bytes persist (referenced by someone else). If the user demands the bytes be deleted regardless, copy the blob to a user-private path for remaining references, then delete. Do this only on explicit request.

**10. Per-tenant cost attribution.**

Every billable action is tagged with `tenant_id`:
- **Storage:** S3 inventory runs daily, listing all objects with size and tier. Keys encode `tenant_id` (`/raw/<tenant>/<hash>`). Daily job aggregates by tenant.
- **Egress:** CloudFront real-time logs include the URL. URLs encode `tenant_id`. Daily job aggregates bytes-out per tenant.
- **API requests:** API Gateway access logs include the JWT's `tenant_id` claim.
- **Virus scan calls:** Scan worker writes each scan to a `scan_invocations` table with `tenant_id`.

A nightly job rolls these into a `billing_lines` table with columns for `storage_hot_gb`, `storage_warm_gb`, `storage_cold_gb`, `egress_gb`, `api_requests`, `scan_calls`. The sum of per-tenant attributions should match your AWS bill within ~1%. Gaps are platform overhead.

---

### 13. Trade-offs worth saying out loud

**Single big PUT vs chunked.** Single PUT is simpler for files under 100 MB. Chunked is necessary above 5 GB (S3's single-PUT limit) and strongly recommended above 100 MB for network resilience. Right answer: hybrid. Single PUT below a threshold, chunked above.

**Client-side encryption.** Optional, important for high-security customers. Encrypt with a key the server never sees. Tradeoff: no dedup possible (ciphertext differs for identical plaintext), no server-side preview, key management is the customer's burden. Implement as opt-in for enterprise tier.

**Dedup by content hash.** Saves ~30% storage at consumer scale. Adds complexity: refcount management, GC, blob lifecycle, privacy. Worth it at scale. Skip for the first 1,000 users.

**Lifecycle to cold tier.** Saves 50-70% of storage cost on the cold tail. Costs: retrieval latency surprises users, retrieval fees on access, minimum-storage-duration penalties on early delete. Tune the transition age to your actual access pattern. 90 days is sometimes too aggressive for bursty files.

**Postgres vs DynamoDB for metadata.** Postgres gives joins, transactions, and a familiar query model. DynamoDB gives infinite horizontal scale and predictable latency. Under 100M files, Postgres is simpler. Above that, sharding Postgres becomes painful and DynamoDB is worth considering. Do not switch preemptively.

**Sync vs async virus scan.** Sync blocks the upload UX for minutes on big files. Async accepts a 1-3 minute exposure window. Almost everyone picks async. The exposure is small; the UX win is large.

---

### 14. Common mistakes

**Tunneling uploads through your app server.** The biggest scaling mistake. Bandwidth cost is per-byte. Doubling traffic doubles your NIC bill. Presigned-direct-to-S3 is non-negotiable above ~100 concurrent uploads.

**Single POST for all uploads.** Works until the first 4 GB upload fails on hotel WiFi. Chunked is mandatory above ~100 MB.

**No quota enforcement at all.** "We will add it later" turns into "one user uploaded their Steam library and ate our budget." Quota at signup is easier to retrofit than quota after the fact.

**Forgetting to GC abandoned uploads.** S3 multipart uploads that never finalize keep costing money. A nightly sweeper plus an S3 lifecycle rule that aborts multiparts older than 7 days is the safety net.

**Share links that are just file IDs in the URL.** `https://app.com/file/abc123` is not a share link. It is a permanent backdoor. Use an opaque high-entropy token with explicit expiry and revocation.

**No virus scan at all.** Fine for an internal tool. Indefensible for a public product. Basic ClamAV catches most known malware.

**Hot path doing folder traversal for permissions.** "Is this file in any folder shared with me?" walked on every download is slow at scale. Cache or materialize the access set per user.

**Skipping the `status` field on files.** Without an explicit state machine (uploading, ready, quarantined, deleted), you get edge cases: downloads of half-finalized files, deletes of in-flight uploads. The `status` smallint pays for itself in week 1.

**Mixing user files and system files in one bucket without prefixing.** Lifecycle rules apply per bucket or prefix. If you mix, you cannot tier user files independently of thumbnails or temp data. Pick a prefix scheme on day one.

**No audit log.** When a security report comes in ("user X claims their file was leaked"), the absence of "who accessed this and when" turns a 1-hour investigation into a week-long one. Audit is cheap to build, painful to retrofit.

If you can hit 7 of these 10 and walk through the upload-protocol trade-off and the scaling journey in the same conversation, you are interviewing well above the bar for this problem.
{% endraw %}
