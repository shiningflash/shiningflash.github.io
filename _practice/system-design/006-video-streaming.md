---
layout: practice-problem
track: system-design
problem_id: 6
title: Design YouTube / Netflix (Video Streaming)
slug: 006-video-streaming
category: Streaming
difficulty: Hard
topics: [cdn, adaptive bitrate, transcoding, storage tiers, hls dash]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/006-video-streaming"
solution_lang: markdown
---

{% raw %}
## Scene

It is 2:30 PM. The interviewer just got off a call about a CDN cost overrun and they are still thinking about egress. They write on the whiteboard:

> *Design YouTube. Or Netflix, pick one. I want to see the end-to-end story.*

You are about to draw a box labeled "video service". Stop. The first thing to clarify is not how big, it is *which half of the system*. Video streaming is two systems pretending to be one. The upload and transcoding pipeline is write-heavy, batch, compute-bound. The playback path is read-heavy, latency-bound, CDN-bound. They share almost nothing except a metadata database and a storage bucket. A candidate who tries to design both at once with one architecture gets lost in ten minutes.

So my first question is: which side are we going deep on, or do you want both at moderate depth? For practice, assume both, but understand you would scope it on a real interview.

## Step 1: clarify before you design

Take five minutes. Don't draw anything. What would you ask the interviewer? Aim for seven or eight questions that meaningfully change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. YouTube or Netflix. These look the same but they are not. YouTube has user-generated uploads (any quality, any container, billions of long-tail videos). Netflix has a curated catalog (studio-mastered files, premium codecs, every title is hot). The pipeline, storage tiering, and DRM all differ. For this design, assume YouTube-style UGC with a long tail.
2. Live vs VOD. Live streaming and VOD share almost no infrastructure. Live needs sub-3-second glass-to-glass latency, edge ingest, low-latency HLS or WebRTC, and a real-time transcoding model. VOD is batch transcoded once and served forever. Scope to VOD; mention live as an extension.
3. Geographic scope. Global means CDN tiers, regional origin shields, and cross-region replication for source files. The CDN cost story dominates the architecture.
4. Quality levels and codecs. How many bitrates? Which codecs? The standard ladder is 240p / 360p / 480p / 720p / 1080p / 1440p / 4K. Codecs: H.264 for compatibility, H.265 (HEVC) for mobile bandwidth savings, AV1 for high-traffic videos where the compute cost amortizes. This single answer shifts transcoding compute by 5x.
5. Upload constraints. Max video length? Max file size? Resumable uploads required? YouTube allows 12-hour videos and 256GB files. Resumable upload is mandatory at that size; a flaky home connection cannot restart a 50GB upload from zero.
6. DRM and paid content. Free, ad-supported, paywalled? YouTube is free plus ads. Netflix needs Widevine / FairPlay / PlayReady DRM, which adds a license server, encrypted segments, and per-device key exchange. Different design.
7. Recommendations and search. Are search and recs in scope? These are huge separate systems. The right answer is "out of scope, but I'll show the integration point."
8. Analytics. View counts, watch time, retention curves: real-time or batch? View counts on the watch page can be eventually consistent (the 30-minute YouTube delay is famous). Real-time analytics for creators is a separate pipeline.

If you only asked "how many users" you missed the most important questions. The codec ladder and the live-vs-VOD scope each move the compute budget by an order of magnitude.

</details>

## Step 2: capacity estimates

Assume the interviewer gave you these numbers (YouTube-scale):

- 500 hours of video uploaded *per minute*
- 1 billion hours watched *per day*
- Average view: 10 minutes
- Average upload: 4 minutes
- Bitrate ladder: 240p (400 kbps), 360p (700 kbps), 480p (1.2 Mbps), 720p (2.5 Mbps), 1080p (5 Mbps), 1440p (9 Mbps), 4K (20 Mbps)
- Codecs: H.264 (always), H.265 (for 720p and above), AV1 (for the top 1% of hot videos)
- Source file retention: forever
- Target playback start latency: under 2 seconds

Compute (do this on paper before revealing):

1. Upload bytes per second (source files, before transcoding)
2. Number of new videos per day
3. Concurrent viewers
4. Egress bandwidth at peak
5. Storage for source files over one year
6. Storage for all transcoded variants
7. Transcoding compute (rough order of magnitude)

<details>
<summary><b>Reveal: the math</b></summary>

Upload rate. 500 hours per minute = 500 × 60 = 30,000 seconds of video per minute = 500 seconds of video per second. At an average source bitrate of 10 Mbps for a typical 1080p phone upload, ingest bandwidth is 500 × 10 Mbps = 5 Gbps sustained. Peak roughly 3x = 15 Gbps.

Videos per day. 500 hours × 60 min × 24 hours / 4 min average length = 450,000 new videos per day. About 5 new videos per second.

Concurrent viewers. 1B hours / day = 1B × 3600 / 86400 = 42 million viewer-seconds per second, i.e. 42M concurrent viewers on average. Peak 3x = 125M concurrent. At average bitrate 2 Mbps (most viewing is on mobile at 480p / 720p), egress is 125M × 2 Mbps = 250 Tbps peak. This number is the whole point of having a CDN.

Egress. 250 Tbps is roughly 25 PB/hour, 600 PB/day. At commodity CDN pricing this is the dominant cost of the system. Cache hit rate matters more than almost anything else.

Source storage per year. 500 sec/sec × 86400 × 365 × (10 Mbps / 8 bits) = 500 × 86400 × 365 × 1.25 MB = ~20 PB/year just for the source file. Sources are kept forever for re-transcoding (new codecs, new resolutions). This number compounds.

Transcoded variants. A typical ladder produces 7 resolutions × 2 codecs (avg) = ~14 variants. Each variant is smaller than source (compressed at lower bitrate), but in aggregate the variants are roughly 2-3x the source size. So ~50 PB/year of transcoded output. Combined with source: ~70 PB/year of new storage, growing.

Transcoding compute. Software H.264 encoding runs roughly at 1x to 5x real-time on a modern CPU core (depends on preset). 500 sec/sec input × 14 variants = 7000 sec/sec of output to encode. At 2x real-time average that is ~3500 CPU cores running continuously just for routine transcoding. AV1 encoding is 10-50x slower, so even encoding the top 1% of videos in AV1 adds another several thousand cores. Transcoding is the second-biggest cost line after CDN egress.

The takeaway. This system has two huge cost lines (CDN egress, transcoding compute) and one huge storage problem. Everything else is small. Most of the architecture exists to reduce one of those three numbers.

</details>

## Step 3: the upload pipeline

Before drawing the full architecture, think through the upload pipeline by itself. A creator uploads a 5GB MP4 from their phone. What happens? Take ten minutes to write the steps. Consider: how does the upload survive a dropped connection? Where does the file land? Who decides when to start transcoding? How does the creator know the upload succeeded vs the video is ready to publish?

<details>
<summary><b>Reveal: upload pipeline steps</b></summary>

The upload pipeline has six stages. Each must be independently resumable; an upload that fails at stage 5 should not redo stages 1 through 4.

1. Initiate. Client calls `POST /uploads` with metadata (filename, total size, sha256 of the source if known, intended title and description). Server returns an upload ID and a signed URL to the chunk endpoint. Server creates a row in `videos` table with `status = uploading`.

2. Chunked resumable upload (TUS protocol or S3 multipart). Client splits the file into 5-25 MB chunks. Each chunk is `PATCH /uploads/<id>` with a `Content-Range` header. Server writes the chunk to object storage (S3) at a per-upload prefix. The server tracks `bytes_received` per upload. On any failure, client calls `HEAD /uploads/<id>` to find out where to resume.
    - Why chunks, not single PUT. A 5GB single PUT cannot resume. With chunks, only the in-flight chunk has to retry. TUS adds a resumable spec on top of HTTP; alternatives are S3 multipart upload (let the client upload directly to S3 with presigned URLs) or a tus-style protocol on your own gateway.
    - Why direct-to-S3 is tempting and risky. Presigned URLs let the client upload directly to S3 and remove your gateway from the byte path. Saves you 15 Gbps of ingest. The trade-off: you no longer control the upload, so abuse detection, malware scan, and rate limiting are harder. Compromise: presigned for trusted creators, gateway for new accounts.

3. Finalize. When all chunks are received, client calls `POST /uploads/<id>/finalize`. Server assembles the chunks into a single source file (or marks the multipart upload complete in S3). Verifies sha256. Moves the source to `s3://video-source/{video_id}/source.mp4`. Updates `videos.status = transcoding`.

4. Enqueue transcoding jobs. Server publishes a message to Kafka topic `transcode.requested` with `{video_id, source_url, target_ladder}`. The target ladder is determined by source quality: a 480p source does not need a 4K variant.

5. Transcoding workers consume. A pool of GPU/CPU workers picks up jobs. For each variant in the ladder, a worker:
    - Downloads the source (or streams it).
    - Runs `ffmpeg` with the codec, bitrate, and segmentation parameters.
    - Outputs HLS segments (`.ts` or `.m4s`) and a per-variant playlist (`.m3u8`).
    - Uploads the segments to `s3://video-transcoded/{video_id}/{variant}/`.
    - On success, posts to Kafka `transcode.completed` with `{video_id, variant, segment_count}`.

6. Manifest assembly. A separate service watches `transcode.completed` events. When all variants in the ladder are done, it generates the master playlist (`master.m3u8` for HLS, `manifest.mpd` for DASH) that references each variant playlist. It writes the master to `s3://video-transcoded/{video_id}/master.m3u8`. Then it updates `videos.status = ready` and fires `video.published` to a Kafka topic that downstream systems (search indexer, notification service, recommendation service) consume.

The creator polls `GET /videos/{id}` to see status transition `uploading → transcoding → ready`. Some platforms (YouTube) show the video as available at 360p first, while higher resolutions are still encoding; that requires the manifest assembler to publish a partial master playlist after each variant completes.

</details>

## Step 4: sketch the high-level architecture

Here is an intentionally incomplete diagram. Fill in the six `[ ? ]` boxes. Hint: think about what sits between the client and storage on upload, what fans out transcoding work, where the manifest is built, what tiers the playback CDN has, and where metadata lives.

```
   ┌──────────┐
   │ Creator  │
   └────┬─────┘
        │  upload chunks
        ▼
   ┌─────────────────┐
   │   [ ? A ]       │  (handles chunked upload, validates, writes to source bucket)
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  Source object  │
   │  storage (S3)   │
   └────────┬────────┘
            │  enqueue transcode jobs
            ▼
   ┌─────────────────┐
   │   [ ? B ]       │  (job queue / message bus)
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │   [ ? C ]       │  (transcoding worker pool, GPU + CPU)
   └────────┬────────┘
            │  write transcoded segments
            ▼
   ┌─────────────────┐
   │  Transcoded     │
   │  object storage │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │   [ ? D ]       │  (assembles master.m3u8 / manifest.mpd, publishes ready event)
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │   [ ? E ]       │  (catalog: title, description, owner, status, available variants)
   └─────────────────┘

   ─── playback path ───

   Viewer ──► [ ? F ] ──► origin shield ──► transcoded object storage
              (edge CDN with cached segments and manifests)
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
   ┌──────────┐
   │ Creator  │
   └────┬─────┘
        │  upload chunks (TUS / S3 multipart)
        ▼
   ┌─────────────────┐
   │ Upload Gateway  │  Resumable upload, sha256 verify, rate limit,
   │ (stateless API) │  presigned-URL issuance, quota check.
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │  s3://video-    │  Source bucket. Lifecycle: move to cold tier
   │  source/        │  after 30 days if no re-transcode in flight.
   └────────┬────────┘
            │  Kafka: transcode.requested
            ▼
   ┌─────────────────┐
   │   Kafka topic   │  Partitioned by video_id. Durable, replayable.
   │ transcode.req   │  Backpressure when transcode farm saturated.
   └────────┬────────┘
            │
            ▼
   ┌──────────────────────┐
   │ Transcoding Workers  │  Kubernetes pool. GPU nodes for AV1 / HEVC,
   │ (FFmpeg + GPU/CPU)   │  CPU nodes for H.264. Autoscales on queue depth.
   │ Each worker: 1 job   │  One job = one (video_id, variant) pair.
   └────────┬─────────────┘
            │  write segments
            ▼
   ┌─────────────────┐
   │ s3://video-     │  Transcoded variants. Per-video prefix.
   │ transcoded/     │  Hot videos replicated to regional buckets.
   └────────┬────────┘
            │  Kafka: transcode.completed
            ▼
   ┌─────────────────┐
   │ Manifest        │  Consumes transcode.completed. When all variants
   │ Assembler       │  done, writes master.m3u8 / manifest.mpd.
   │                 │  Updates Metadata DB status -> ready.
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │ Metadata DB     │  Cassandra or DynamoDB. videos table:
   │ (videos, vari-  │  video_id PK; title, desc, owner_id, status,
   │ ants, segments) │  available_variants, created_at, view_count.
   └─────────────────┘

   ─── playback path ───

   ┌────────┐   ┌──────────┐    ┌────────────┐    ┌──────────────┐
   │ Viewer │──►│ Edge CDN │───►│  Regional  │───►│ Origin       │──► transcoded
   │ player │   │ (PoP, in │    │  origin    │    │ (S3 + small  │    object store
   │ ABR    │   │ city)    │    │  shield    │    │  signing svc)│
   └────────┘   └──────────┘    └────────────┘    └──────────────┘
       │
       │ first: GET /watch/{video_id} -> Watch Page
       │ then:  GET master.m3u8       -> CDN (cached)
       │ then:  GET segment_N.ts      -> CDN (cached) for each segment
       │
       └──► reports playback events to:
            ┌─────────────────┐
            │ Telemetry → Kafka│ → ClickHouse for analytics,
            │ (QoE, view, ad)  │   counter store for view counts.
            └─────────────────┘
```

Component responsibilities:

- Upload Gateway. Handles TUS or S3 multipart. Stateless. Verifies content-length, sha256. Enforces per-creator quotas. The gateway can offload the actual byte stream to S3 via presigned URLs for trusted creators.
- Source bucket (S3). Cheap, durable, eventual move to a colder tier (S3 Standard → S3 Infrequent Access → Glacier) by lifecycle policy.
- Kafka transcode topic. Durable buffer between upload and transcode. Lets the transcode farm be sized for steady-state, not peak.
- Transcoding Workers. The compute-bound part. One worker, one job. Idempotent: re-running a job overwrites the same output path.
- Transcoded bucket. Holds all variants. Hot videos get replicated to regional buckets near the CDN; cold videos stay in one region.
- Manifest Assembler. Stateless. Watches transcode events; emits master playlist when ready.
- Metadata DB. Catalog. Wide-column store (Cassandra) is a fine pick: one row per video keyed by video_id, columns for each variant's status.
- Edge CDN / origin shield / origin. Three-tier cache. The edge serves segments to viewers from local PoPs. On miss it pulls from the regional shield. Shield miss goes to origin (S3 + URL signer). The shield exists specifically to reduce S3 fan-out from N edges to 1.

</details>

## Step 5: playback path

Now zoom in on what happens when a viewer hits play. The viewer's player issues HTTP requests. What does it ask for, in what order, and how does the player decide which bitrate to use? Take ten minutes to think through, then reveal.

<details>
<summary><b>Reveal: playback sequence and ABR</b></summary>

The playback sequence for an HLS video:

1. Player loads the watch page. It calls `GET /api/videos/{video_id}` which returns metadata: title, owner, thumbnail URLs, the master playlist URL, available languages, ad markers.
2. Player fetches the master playlist. `GET https://video-cdn.example.com/{video_id}/master.m3u8`. This returns ~1 KB:
    ```
    #EXTM3U
    #EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240,CODECS="avc1.42E01E"
    240p/playlist.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360,CODECS="avc1.42E01E"
    360p/playlist.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.4D401F"
    720p/playlist.m3u8
    #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
    1080p/playlist.m3u8
    ```
    Each `BANDWIDTH` tells the player the bitrate of that variant. Each line points to a variant-level playlist.
3. Player picks a starting variant. Usually starts with 360p or 480p (don't start at 1080p; you don't know the network yet). Fetches that variant's playlist:
    ```
    #EXTM3U
    #EXT-X-TARGETDURATION:6
    #EXTINF:6.0,
    segment_0.ts
    #EXTINF:6.0,
    segment_1.ts
    #EXTINF:6.0,
    segment_2.ts
    ...
    ```
    Each segment is a self-contained ~6-second chunk of video, encoded at that variant's bitrate, addressable by HTTP.
4. Player fetches segment 0, decodes, starts playback. While segment 0 is decoding, it starts fetching segment 1. Buffer fills to ~30 seconds ahead.
5. Player measures download speed per segment. If segment 0 (a ~1MB chunk for 360p) downloaded in 200ms, that is 40 Mbps available bandwidth. Player can step up to 1080p (5 Mbps) safely with margin.
6. Player switches variants between segments. Variants are encoded with aligned segment boundaries specifically so the player can switch mid-stream. Next request goes to `1080p/segment_3.ts` instead of `360p/segment_3.ts`. The viewer sees the resolution jump.

Adaptive bitrate (ABR) algorithm. The player runs a simple state machine:

- Maintain a buffer of ~30 seconds of video ahead.
- Measure bandwidth as (segment size / segment download time), smoothed over the last few segments.
- Pick the highest variant whose bitrate is below (smoothed bandwidth × safety factor, e.g., 0.8).
- If buffer drops below 5 seconds, drop one variant immediately to refill faster.
- If buffer is full and bandwidth is high, try the next variant up.

This is why every variant must have identical segment boundaries. If 360p has segment boundaries at 6.0s, 12.0s, 18.0s, then 1080p must also break exactly at 6.0s, 12.0s, 18.0s. Otherwise switching mid-stream produces visible glitches.

HLS vs DASH. Both do the same thing:

- HLS: Apple's protocol. Manifests are `.m3u8` text files. Segments are `.ts` (MPEG-2 Transport Stream) or `.m4s` (fragmented MP4). Universal browser support. Default on iOS.
- DASH: ISO standard. Manifests are `.mpd` XML files. Segments are always `.m4s`. Default on Android.
- Modern players support both. You typically encode segments in fragmented MP4 (`.m4s`) and serve both an HLS-flavored `.m3u8` manifest and a DASH-flavored `.mpd` manifest pointing at the same byte files. This is called CMAF (Common Media Application Format).

Where the CDN comes in. Every one of these requests (master, variant playlist, every segment) is a plain HTTP GET against a URL that includes the video_id and segment number. The CDN treats them as static files. Hot videos have hit rates above 95%. The origin serves only the long tail and the first viewer of every new video.

</details>

## Step 6: storage tiering

You will accumulate exabytes of video over time. Some videos get a billion views (Gangnam Style). Most get fewer than 100 views ever. Storing them all on the same medium is wasteful. Think through the tiers, then reveal.

<details>
<summary><b>Reveal: storage tiers</b></summary>

A video has two storage components: the source file (the originally uploaded master) and the transcoded variants (what viewers actually watch). Each tiers independently.

| Tier | What lives here | Medium | Cost (rough, per GB-month) | Retrieval latency |
|------|-----------------|--------|---------------------------|--------------------|
| CDN edge cache | Hot segments (videos getting views right now) | Edge SSD/RAM at PoPs | n/a (cache, not storage) | sub-50ms |
| Origin shield cache | Warm segments (popular videos this region) | Regional SSD | $0.10 | sub-100ms |
| Hot object store | Transcoded variants for popular videos | S3 Standard (SSD-backed) | $0.023 | ~30ms |
| Warm object store | Transcoded variants for cold videos | S3 Infrequent Access (HDD-backed) | $0.0125 | ~30ms (but retrieval fee per GB) |
| Cold object store | Source files after 30 days, transcoded variants of dead videos | S3 Glacier Instant | $0.004 | seconds |
| Archive | Source files of videos with no views in a year | S3 Glacier Deep Archive (tape) | $0.00099 | 12 hours |

How content moves between tiers.

- New upload. Source goes to hot; transcoded variants go to hot. CDN warms naturally on first views.
- Daily view counts feed a tiering job. Variant gets demoted (hot → warm) when no views in 7 days. Demoted (warm → cold) when no views in 90 days.
- Promotion on read. If a cold variant gets a sudden spike (an old video goes viral), the first viewer pays a one-time retrieval cost, and the job promotes it back to hot.
- Source files. Kept forever in case you need to re-transcode (new codec like AV1 ships, you want to re-encode the catalog). After 30 days, source moves from hot to cold. Re-transcoding from cold takes seconds to minutes; acceptable for a background job.

The economics.

- 70 PB/year of new content, growing.
- If all of it lived in S3 Standard: $0.023/GB/mo × 70 PB × 12 = $20M/year just for the first year's content storage. After 10 years compounded: hundreds of millions.
- Tiered: roughly 5% stays hot, 15% warm, 80% cold. Blended cost: ~$0.005/GB/mo. Same data costs ~$4M/year. This is real money.

The trade-off you must articulate.

- More aggressive tiering means lower storage cost but more retrieval cost when a long-tail video gets a sudden view.
- The breakeven: tier moves should pay back within the demote-to-promote period. If most demoted videos stay demoted, demotion pays. If 30% get promoted back within a month, demotion was premature and net-negative.
- Real systems instrument both demote count and within-30-day promotion count; tune the demote threshold based on the ratio.

Where transcoding interacts with tiering.

- When a new codec ships (you decide to add AV1 for the top 1% of videos), you launch a backfill that reads source files and produces new variants. If sources are in cold storage, the backfill scheduler has to either (a) accept the per-GB Glacier retrieval cost or (b) wait for a periodic warm-up window where sources are bulk-restored for cheap. Mature systems do the latter.

</details>

## Follow-up questions

Try answering each in three or four sentences before reading the solution.

1. A creator deletes a video that has 100M views and is in every CDN edge cache. How do you make sure it stops playing for every viewer within 60 seconds? CDN cache invalidation at this scale is not free.
2. A new codec (AV1 successor, say "AV2") ships. You want to re-encode the top 10,000 most-watched videos to take advantage of better compression and lower bandwidth bills. Design the backfill, including how you decide which videos are worth re-encoding given that re-encoding consumes compute.
3. Live streaming. A creator wants to go live to 5M concurrent viewers with sub-3-second glass-to-glass latency. What changes in the architecture? Hint: transcoding becomes real-time, ingest is now WebRTC or RTMP, segments are LL-HLS or LL-DASH.
4. Thumbnails. Every video has 1-3 thumbnails plus auto-generated frame thumbnails for the seek-bar preview. How do you generate them, store them, and serve them at scale? They are tiny but plentiful (millions of thumbnails per day).
5. A copyright takedown notice arrives for a specific video. How does the system block playback globally within 5 minutes while also keeping the file available for legal review (you cannot just delete it)?
6. Watch time analytics. A creator wants to see "viewers dropped off at the 3:47 mark." Where does that data come from, and how do you compute it across billions of viewing sessions?
7. DRM. Switch to Netflix mode. Now every segment must be encrypted, every device must request a per-session decryption key, and the key must be unique per (user, session). Add the DRM components to your diagram and explain the key flow.
8. Subtitles and audio tracks. A video has English, Spanish, and Hindi audio plus 12 subtitle languages. How are these encoded into HLS / DASH? What does the manifest look like?
9. Origin shield went down. All your edges now hit S3 directly. What is the blast radius, and how do you survive until shield comes back?
10. The recommendation team wants real-time view-count signals (per video, per minute) for ranking the front page. They want it at less than 5-second freshness. Your current view-count pipeline is 30 minutes behind. Where in the architecture do they plug in, and what do you give up?

## Related problems

- [URL Shortener (001)](../001-url-shortener/question.md). The CDN concepts (edge cache, TTL trade-offs, hot key behavior) used here are introduced there in a simpler context.
- [Notification System (010)](../010-notification-system/question.md). The upload-complete event ("your video is ready") and the "new video from a creator you follow" notification both ride on that system. Same fan-out patterns.
- [News Feed (002)](../002-news-feed/question.md). The watch page is one row in a feed; the feed and video systems share the metadata store and the "creator follows" graph.
- [Distributed Cache (009)](../009-distributed-cache/question.md). The manifest cache and metadata cache lean on the same primitives.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design YouTube / Netflix (Video Streaming)

### TL;DR

Video streaming is two systems that share a database. The upload and transcoding pipeline is write-heavy, compute-bound, and batch. The playback path is read-heavy, latency-bound, and CDN-dominated. They share the metadata catalog and the transcoded object store. Everything else is separate. A diagram that mixes them up gets lost inside ten minutes.

The interesting engineering lives in three places. First, keeping the upload byte path off your origin servers using TUS or S3 presigned multipart, so 15 Gbps of ingest is somebody else's problem. Second, sizing the transcoding farm against bursty uploads while keeping codec costs sane (AV1 is roughly 30x slower than H.264). Third, building a three-tier CDN (edge, regional shield, origin) that gets above 95% hit rate so S3 egress only pays for the long tail. Storage tiering across hot SSD, warm HDD, and Glacier cuts the storage bill by 5x.

Numbers worth remembering: 500 hours uploaded per minute, 1B hours watched per day, 125M concurrent viewers at peak, 250 Tbps egress, 70 PB/year of new storage, thousands of CPU cores for steady-state transcoding.

### 1. Clarifying questions, recap

Already covered in `question.md`. The eight questions you have to ask:

- YouTube vs Netflix. UGC long-tail vs curated catalog. Storage tiering is the opposite shape (UGC is cold-heavy; catalog is nearly all hot).
- Live vs VOD. Live has its own architecture; VOD is the default.
- Geographic scope. Determines whether the CDN story is global or single-region.
- Codec ladder. H.264 only is one design. H.264 + H.265 + AV1 is a 5x compute story.
- Upload constraints. Resumable upload becomes mandatory above ~1GB.
- DRM. Adds license server, per-device key flow, encrypted segments.
- Recommendations and search. Mention the integration point; do not design them.
- Analytics freshness. Real-time vs batch determines whether you have one or two view-count pipelines.

If you started drawing without asking "live or VOD," you are about to design the wrong system.

### 2. Capacity estimates (full working)

- Ingest: 500 hours/min = 500 video-seconds/sec. At 10 Mbps avg source bitrate, 5 Gbps sustained, 15 Gbps peak. This is what your upload gateway (or S3, if you use presigned URLs) handles.
- New videos/day: 500 hours × 60 × 24 / 4-min average = ~450K new videos/day, ~5/sec sustained, ~15/sec peak.
- Concurrent viewers: 1B hours/day × 3600 / 86400 = 42M concurrent average, ~125M peak.
- Egress: 125M × 2 Mbps avg playback bitrate = 250 Tbps peak. The CDN sees this; your origin sees a fraction (4-5%).
- Source storage: 500 sec/sec × 86400 × 365 × (10 Mbps / 8) = ~20 PB/year of source files.
- Transcoded storage: ~14 variants per video, aggregating to ~2.5x source = ~50 PB/year of variants.
- Combined yearly growth: ~70 PB/year. Compounds.
- Transcoding compute: 500 sec/sec input × 14 variants / 2x real-time = ~3500 CPU cores continuously for H.264. Add several thousand more for AV1 on the top 1% of videos. GPU acceleration (NVENC, NVDEC) helps for H.264 but AV1 is still mostly CPU.

Two cost lines dominate everything: CDN egress and transcoding compute. Storage is third. The rest is rounding error.

### 3. API

Upload (creator-side):

```
POST /api/v1/uploads
Content-Type: application/json
Authorization: Bearer <token>

{
  "filename": "vacation.mp4",
  "size_bytes": 5368709120,
  "sha256": "abc123...",            // optional, client-computed
  "title": "Beach trip 2026",
  "description": "...",
  "visibility": "public"             // public | unlisted | private
}
```

Response 201:

```
{
  "video_id": "v_8h3jK2p",
  "upload_url": "https://upload.example.com/u/8h3jK2p",
  "chunk_size": 16777216,            // 16 MB
  "expires_at": "2026-05-23T18:00:00Z"
}
```

Chunk upload (TUS-style):

```
PATCH /u/<upload_id>
Upload-Offset: 33554432
Content-Length: 16777216
Content-Type: application/offset+octet-stream
<binary chunk>
```

Response 204 with `Upload-Offset: 50331648` (new total).

```
HEAD /u/<upload_id>     -> returns Upload-Offset for resume
```

Finalize:

```
POST /api/v1/uploads/<upload_id>/finalize

Response: 200
{
  "video_id": "v_8h3jK2p",
  "status": "transcoding"
}
```

Get video metadata (creator and viewer):

```
GET /api/v1/videos/<video_id>

Response:
{
  "video_id": "v_8h3jK2p",
  "title": "Beach trip 2026",
  "description": "...",
  "owner": { "user_id": "u_42", "name": "Amir" },
  "status": "ready",                  // uploading | transcoding | ready | blocked
  "duration_seconds": 248,
  "thumbnails": ["https://i.example.com/v_8h3jK2p/t0.jpg", ...],
  "manifests": {
    "hls": "https://cdn.example.com/v_8h3jK2p/master.m3u8",
    "dash": "https://cdn.example.com/v_8h3jK2p/manifest.mpd"
  },
  "available_variants": ["240p", "360p", "480p", "720p", "1080p"],
  "view_count": 14271
}
```

Manifest (served by CDN, not by your API):

```
GET https://cdn.example.com/v_8h3jK2p/master.m3u8     -> ~1 KB text
GET https://cdn.example.com/v_8h3jK2p/720p/seg_42.ts  -> ~2 MB binary
```

These are static files. Your API stays off the playback hot path.

Playback telemetry (player to backend):

```
POST /api/v1/telemetry/playback
{
  "video_id": "v_8h3jK2p",
  "session_id": "...",
  "events": [
    { "ts": 1716364800000, "type": "start", "variant": "720p" },
    { "ts": 1716364812000, "type": "rebuffer", "duration_ms": 850 },
    { "ts": 1716364900000, "type": "variant_switch", "from": "720p", "to": "1080p" },
    { "ts": 1716365100000, "type": "complete", "watched_seconds": 300 }
  ]
}
```

Batched, off the critical path, fire-and-forget.

A few load-bearing choices:

- Manifests and segments are served by the CDN, not by your service. They are static signed URLs. Your service produces the URL pattern when you assemble the manifest; the CDN serves the bytes.
- Idempotency. `POST /uploads` accepts a client-provided idempotency key. A re-sent finalize is safe (no-op if already finalized).
- Signed URLs. Manifests and segments have signed URLs with a short expiry (typically 4-8 hours) so they cannot be embedded on third-party sites for free. Important for cost control and for DRM gating.

### 4. Data model

```sql
-- The catalog row. One per video.
CREATE TABLE videos (
    video_id        VARCHAR(16) PRIMARY KEY,    -- short ID, base62
    owner_id        BIGINT NOT NULL,
    title           VARCHAR(200),
    description     TEXT,
    visibility      SMALLINT NOT NULL DEFAULT 1, -- 1=public, 2=unlisted, 3=private
    status          SMALLINT NOT NULL DEFAULT 0, -- 0=uploading, 1=transcoding, 2=ready, 3=blocked, 4=deleted
    duration_ms     BIGINT,                      -- known after transcode
    source_path     TEXT,                        -- s3://video-source/...
    created_at      TIMESTAMPTZ NOT NULL,
    published_at    TIMESTAMPTZ,
    sha256          BYTEA
);

CREATE INDEX idx_owner ON videos (owner_id, created_at DESC);

-- One row per (video, variant). Tracks transcoding progress.
CREATE TABLE variants (
    video_id        VARCHAR(16),
    variant         VARCHAR(20),                 -- "240p_h264", "1080p_h265", "1080p_av1"
    status          SMALLINT,                    -- 0=pending, 1=encoding, 2=ready, 3=failed
    bitrate_kbps    INT,
    codec           VARCHAR(16),                 -- "h264", "h265", "av1"
    container       VARCHAR(8),                  -- "ts", "m4s"
    segment_count   INT,
    output_prefix   TEXT,                        -- s3://video-transcoded/{id}/{variant}/
    worker_id       VARCHAR(64),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    PRIMARY KEY (video_id, variant)
);

-- One row per video summarizing what's playable.
CREATE TABLE manifests (
    video_id        VARCHAR(16) PRIMARY KEY,
    hls_master_url  TEXT,
    dash_mpd_url    TEXT,
    available_variants TEXT[],                   -- json or array
    updated_at      TIMESTAMPTZ
);

-- Aggregated view counts. Eventually consistent.
CREATE TABLE view_counts (
    video_id        VARCHAR(16) PRIMARY KEY,
    total_views     BIGINT,
    total_watch_seconds BIGINT,
    last_updated    TIMESTAMPTZ
);
```

A few choices worth defending out loud:

A wide-column store (Cassandra or DynamoDB) is the right pick at scale. The access pattern is read by `video_id` (point lookup), write by `video_id`. No relational joins. Cassandra's partition key on `video_id` gives constant-time reads, and variants can live as clustering columns inside the partition for free.

Postgres works fine until you hit ~10 billion videos. YouTube has 10B+ videos uploaded over its lifetime; Postgres at that size requires aggressive sharding and the operational burden is high. Cassandra was literally invented for this access pattern.

`variants` as separate rows, not a JSON column on `videos`. Each variant is updated independently as its transcode worker finishes. Atomic per-variant updates are cleaner than CAS on a JSON blob.

`view_counts` is separate. It is updated by a streaming aggregator on a different cadence than the video metadata. Mixing them would force every view-count update to go through the same write path as catalog edits.

### 5. Core algorithm: transcoding pipeline and manifest generation

#### 5a. Transcoding job graph

For one source video, the system spawns one job per `(variant, codec)` pair. For a 1080p source:

| Job | Codec | Bitrate | Resolution |
|-----|-------|---------|------------|
| 1 | H.264 | 400 kbps | 426x240 |
| 2 | H.264 | 700 kbps | 640x360 |
| 3 | H.264 | 1200 kbps | 854x480 |
| 4 | H.264 | 2500 kbps | 1280x720 |
| 5 | H.264 | 5000 kbps | 1920x1080 |
| 6 | H.265 | 1500 kbps | 1280x720 |
| 7 | H.265 | 3000 kbps | 1920x1080 |
| 8 | AV1 (if video is a "popular candidate") | 1000 kbps | 1280x720 |
| 9 | AV1 | 2000 kbps | 1920x1080 |

So 7-9 jobs per video. Each runs independently. Workers pick from a Kafka topic partitioned by `video_id` (so all variants of one video tend to run on adjacent workers, which simplifies log correlation; not strictly required).

#### 5b. One worker's loop

```
loop:
    job = consume_from_kafka("transcode.requested")     // (video_id, variant_spec)
    if job is None: sleep(0.5); continue

    mark_started(job)                                    // UPDATE variants SET status=1
    source = download_or_stream("s3://video-source/{video_id}/source.mp4")

    ffmpeg_args = build_args(
        input=source,
        codec=job.codec,
        bitrate=job.bitrate,
        resolution=job.resolution,
        segment_duration=6,                              // seconds
        output_format=job.container,                     // "m4s" or "ts"
    )
    run_ffmpeg(ffmpeg_args)                              // produces seg_0.m4s, seg_1.m4s, ...

    upload_segments_to_s3(job.output_prefix)
    write_variant_playlist("playlist.m3u8")              // per-variant HLS playlist
    upload(playlist.m3u8, job.output_prefix)

    mark_completed(job, segment_count)                   // UPDATE variants SET status=2
    publish_to_kafka("transcode.completed", job)
```

Important details:

Segments must be aligned across variants. Every variant cuts segments at the same wall-clock offsets (e.g., 0s, 6s, 12s, 18s). This is what lets the player switch variants mid-stream. Use ffmpeg's `-force_key_frames` to put a keyframe exactly at each segment boundary.

Segment duration trade-off. Six seconds is a typical compromise. Shorter (2s) means lower start latency for live, but more files and more CDN requests. Longer (10s) gives better compression but slower seek and slower variant switching. VOD usually picks 6s; live LL-HLS picks 2s or less.

Idempotency. Re-running the same job overwrites the same S3 keys. This matters because Kafka may redeliver after a worker crash.

Failure handling. A worker that crashes mid-job leaves a stale `status=encoding` row. A janitor process scans for rows with `started_at` older than 2x the expected job time and re-publishes them to Kafka. At-least-once delivery combined with idempotent output makes this safe.

#### 5c. Manifest generation

When `transcode.completed` is published, a separate Manifest Assembler service consumes it:

```
on event ("transcode.completed", video_id, variant):
    all_variants = SELECT * FROM variants WHERE video_id = ?
    if any variant has status != 2 (ready) and is required:
        return                          // wait for more events

    master = build_master_m3u8(all_variants)
    mpd    = build_dash_mpd(all_variants)

    write_to_s3(f"s3://video-transcoded/{video_id}/master.m3u8", master)
    write_to_s3(f"s3://video-transcoded/{video_id}/manifest.mpd", mpd)

    UPDATE videos SET status = 'ready', duration_ms = ... WHERE video_id = ?
    publish_to_kafka("video.published", {video_id})
```

The master m3u8 is a small text file that references each per-variant playlist. The per-variant playlists were already written by the workers; the assembler does not touch the segment files.

Progressive availability. A platform like YouTube shows the video as playable in 360p before 1080p is ready. The Manifest Assembler can publish a partial master playlist after the first variant completes, then re-publish as more variants come in. Each re-publish invalidates the CDN cache for `master.m3u8` (TTL is short, e.g., 60 seconds, exactly to support this).

### 6. Architecture

The full picture, drawn small enough to fit one screen. Upload pipeline up top, playback path below.

```
   ┌──────────┐
   │ Creator  │
   └────┬─────┘
        │ TUS / S3 multipart (chunked, resumable)
        ▼
   ┌──────────────────────┐
   │  Upload Gateway      │   Stateless. Auth, quota, chunk routing,
   │  (API pods)          │   sha256 verify, presigned-URL issuance.
   └─────────┬────────────┘
             │
             ▼
   ┌──────────────────────┐
   │ s3://video-source/   │   Durable source store. Lifecycle policy
   │ (S3 Standard)        │   moves to S3 IA at 30 days, Glacier at 90.
   └─────────┬────────────┘
             │ on finalize → Kafka
             ▼
   ┌──────────────────────┐
   │ Kafka                │   Topics: transcode.requested,
   │ (durable queue)      │           transcode.completed,
   │                      │           video.published.
   └─────────┬────────────┘
             │
             ▼
   ┌──────────────────────────────────────────┐
   │  Transcoding Farm (Kubernetes pool)      │
   │  ─────────────────────────────────────   │
   │   CPU nodes (H.264, H.265): N=~3000      │
   │   GPU nodes (NVENC for H.264):  M=~200   │
   │   CPU nodes (AV1, slow):       K=~2000   │
   │  Autoscaler watches Kafka lag.           │
   └─────────┬────────────────────────────────┘
             │
             ▼
   ┌──────────────────────┐
   │ s3://video-          │   Transcoded variants. Per-video prefix.
   │ transcoded/          │   Hot videos cross-region replicated.
   │ (S3 Standard, IA,    │   Tiering by view recency.
   │  Glacier)            │
   └─────────┬────────────┘
             │
             ▼
   ┌──────────────────────┐
   │ Manifest Assembler   │   Watches transcode.completed.
   │ (consumer service)   │   Builds master.m3u8 / manifest.mpd.
   │                      │   Updates Metadata DB on ready.
   └─────────┬────────────┘
             │
             ▼
   ┌──────────────────────┐
   │ Metadata DB          │   Cassandra (videos, variants, manifests).
   │ (sharded by          │   Read-replicated globally.
   │  video_id)           │
   └──────────────────────┘
                                ▲
                                │ reads from Watch Page API
                                │
   ─────────── Playback Path ────────────────────────────────────────
                                │
   ┌──────────┐                 │
   │  Viewer  │                 │
   │  player  │                 │
   └────┬─────┘                 │
        │ GET /watch/{id}        │
        ▼                       │
   ┌──────────────────────┐     │
   │ Watch Page API       │─────┘
   │ (returns metadata +  │
   │  signed manifest URL)│
   └──────────────────────┘

        │ GET master.m3u8         │ GET seg_N.ts/m4s
        ▼                         ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  CDN: 3-tier cache                                           │
   │  ─────────────────────────────────────────────────────────   │
   │   Edge PoPs (in-city) ──► Regional shields ──► Origin (S3)   │
   │   ~200+ PoPs               ~10-20 shields       1 per region │
   │   TTL 24h-7d for segs      TTL 7d               authoritative │
   │   Hit rate target: 95%+    Hit rate: 80%+                    │
   └──────────────────────────────────────────────────────────────┘

        │ playback events (batched)
        ▼
   ┌──────────────────────┐
   │ Telemetry → Kafka    │   Per-session events: start, rebuffer,
   │                      │   variant switch, complete.
   └─────────┬────────────┘
             ▼
   ┌──────────────────────┐
   │ Stream processor     │   Flink. Aggregates view counts, watch
   │ (Flink / KSQL)       │   time, QoE metrics. Windows: 1min, 1h.
   └─────────┬────────────┘
             ▼
   ┌──────────────────────┐
   │ View counter store   │   Redis (real-time counters) +
   │ + Analytics DB       │   ClickHouse (time-series).
   │ (Redis + ClickHouse) │
   └──────────────────────┘
```

Component-by-component:

- Upload Gateway. Stateless. Public HTTPS endpoint. Authenticates the creator. Issues per-upload IDs. Optionally proxies chunks to S3, or issues presigned URLs so the client uploads directly. The choice depends on whether you trust the creator and whether you want to MITM the bytes for malware scanning.
- Source bucket. S3 Standard initially. Lifecycle rules demote to IA at 30 days, Glacier Instant at 90 days. Sources are never deleted; you might need them to re-encode in a new codec.
- Kafka. Three topics: `transcode.requested` (one message per `(video_id, variant)`), `transcode.completed` (worker fans out completion events), `video.published` (downstream consumers: search indexer, notification, recs). Each topic partitioned by `video_id`.
- Transcoding Farm. A Kubernetes pool. H.264 jobs run on CPU or NVENC GPU nodes; H.265 mostly CPU; AV1 always CPU (and slow). Autoscaler watches Kafka consumer lag and scales worker replicas. The pool has separate node groups per codec because the optimal hardware differs.
- Transcoded bucket. Where every segment lands. Same lifecycle tiering as source but driven by view recency, not age.
- Manifest Assembler. Stateless consumer. One per Kafka consumer group. Builds and overwrites master playlists.
- Metadata DB (Cassandra). Wide-column. `video_id` is the partition key. Read-heavy (every watch page hits it once). Read replicas in every region.
- Watch Page API. Stateless. Reads from Metadata DB, builds signed CDN URLs, returns JSON. The only piece of your code on the playback critical path. Should be under 50ms P99.
- CDN. The most expensive line item. Three tiers, explained below.
- Telemetry pipeline. Player POSTs batches of events. Goes to Kafka. Flink aggregates. View counts land in Redis (for the watch page) and ClickHouse (for creator analytics).

### 7. Upload path, end to end

A creator uploads a 5 GB MP4. Full sequence:

1. Creator's client calls `POST /uploads`. The Upload Gateway:
    - Authenticates with bearer token.
    - Checks the creator's quota.
    - Creates a row in `videos` with `status = uploading`, mints `video_id = v_8h3jK2p`.
    - Returns the upload URL.
2. Client splits the file into 16 MB chunks (~320 chunks).
3. Client sends `PATCH /u/v_8h3jK2p` repeatedly, each with `Upload-Offset` and one chunk in the body.
    - If a chunk fails: client retries the same chunk. The gateway is idempotent on chunk write (same offset = same bytes).
    - If the connection drops for minutes: client calls `HEAD /u/v_8h3jK2p` to get the current offset, then resumes from there.
4. After the last chunk, the client calls `POST /uploads/v_8h3jK2p/finalize`.
5. Upload Gateway verifies the sha256 if provided. Marks `videos.status = transcoding`. Publishes a `transcode.requested` message per `(video_id, variant)` pair to Kafka. Typically 7-9 of these per video.
6. Transcoding workers consume the messages. Each worker:
    - Updates `variants.status = encoding` for its variant.
    - Downloads (or streams) the source.
    - Runs ffmpeg.
    - Uploads segments to `s3://video-transcoded/v_8h3jK2p/{variant}/`.
    - Writes per-variant playlist.
    - Updates `variants.status = ready`.
    - Publishes `transcode.completed`.
7. Manifest Assembler consumes `transcode.completed`. When all required variants are ready (or after the first variant if progressive availability is enabled):
    - Builds master playlist.
    - Updates `videos.status = ready`.
    - Publishes `video.published`.
8. Downstream consumers of `video.published`:
    - Search indexer updates the search index.
    - Notification service sends "new video from a creator you follow" pushes.
    - Recommendation service updates candidate sets.
9. The creator's client polls `GET /videos/v_8h3jK2p` and sees `status = ready`. They can publish.

Where the path can break:

- Chunk upload fails partway. Resume mechanism handles it. No data lost.
- Finalize succeeds but Kafka publish fails. The finalize endpoint is idempotent; client can retry. To handle a partial publish (some variant messages sent, some not), use a transactional outbox: write Kafka messages to a `pending_kafka_messages` table in the same transaction as the status update, then a separate publisher drains the table.
- Transcoder crashes mid-job. Janitor process scans for stuck rows and republishes. Workers are idempotent on output S3 keys.
- Source corrupted. sha256 verification at finalize catches it. Bad uploads are rejected.

### 8. Playback path, end to end

A viewer opens youtube-like.com/watch?v=v_8h3jK2p. Full sequence:

1. Browser loads HTML page.
2. JS calls `GET /api/v1/videos/v_8h3jK2p`. Watch Page API:
    - Looks up `videos` row in Cassandra. Cache hit in Redis or local in-process LRU for popular videos.
    - Looks up `manifests` row to get the master playlist URL.
    - Signs the master URL with a short-lived token (e.g., HMAC, expires in 4 hours).
    - Returns metadata and signed manifest URL.
3. Player (HLS.js, Shaka, ExoPlayer) fetches `master.m3u8` from the signed CDN URL.
    - CDN edge cache. Almost always a hit for popular videos. ~50ms.
    - On miss, edge fetches from regional shield. Shield aggregates requests from many edges; the same master playlist might be requested by 50 edges. Shield does one fetch from S3 and serves the next 49 from its cache.
4. Player picks a starting variant (typically the second-from-bottom, e.g., 360p). Fetches that variant's `playlist.m3u8`.
5. Player fetches segment 0, decodes, starts playback. Continues fetching ahead.
6. Player measures bandwidth from segment download times. Switches variants up or down between segments.
7. Telemetry. Player batches events (start, rebuffer, switch, pause, complete) and POSTs to `/telemetry/playback` every few seconds. Fire-and-forget; failure does not affect playback.

Latency budget for first frame:

| Step | Time | Notes |
|------|------|-------|
| TCP + TLS to watch page | 100-200 ms | HTTP/3 + 0-RTT helps |
| `GET /videos/<id>` API call | 50 ms | Mostly cached |
| `GET master.m3u8` (CDN hit) | 50 ms | Edge in same city |
| `GET playlist.m3u8` (CDN hit) | 50 ms | Same |
| `GET seg_0.ts` (CDN hit) | 200-500 ms | Depends on segment size |
| Decode first frame | 50 ms | |
| Total | ~500-900 ms to first frame | CDN hits assumed |

A 2-second start latency target is achievable with cache hits. Cache miss on segment 0 (a brand new video, no one watched yet) adds 100-300 ms for the shield-to-S3 fetch.

### 9. Scaling

#### 9a. The CDN: three tiers

This is where the egress bill lives.

| Tier | Where | What it caches | TTL | Target hit rate |
|------|-------|----------------|-----|-----------------|
| Edge | PoPs (one per major city, 200+ globally) | Segments and manifests of videos popular in this city | 24h-7d for segments; 60s for master.m3u8 | 95%+ |
| Regional shield | One per cloud region (10-20 globally) | Anything an edge fetched from this region | 7d | 80%+ on edge miss |
| Origin | S3 + signing service | Everything | n/a (authoritative) | n/a |

Why the shield matters. Without it, every edge miss goes to S3. 200 edges in a region, each missing the same segment, means 200 S3 GETs for one piece of content. The shield aggregates: edges miss the segment, all 200 ask the shield, the shield does 1 S3 GET and serves the other 199 from its cache. Without the shield, your S3 request rate scales with the number of edges; with it, S3 sees mostly cold-tail traffic.

Tuning for hit rate:

- Segment TTL. Seven days for segments. They never change once written (segments are content-addressed by video_id + segment number).
- Manifest TTL. 60 seconds. Master playlists do change (when a new variant becomes ready). Short TTL ensures viewers see the new variants quickly.
- Purge on takedown. Cache invalidation by URL pattern (`/v_8h3jK2p/*`). All major CDNs (Cloudflare, Fastly, Akamai, CloudFront) support pattern purges in seconds.

Cost. CDN egress costs $0.005-0.02 per GB depending on volume tier. At 600 PB/day this is $3M-12M/day if you paid for every byte. With 95% edge hit rate, only 5% of bytes hit the shield, and only 20% of that hits S3. So actual S3 egress is ~1% of total = ~6 PB/day from S3 alone. The CDN itself charges per byte served at the edge but at much lower rates than S3 egress.

#### 9b. Transcoding farm scaling

- Autoscaler signal: Kafka consumer lag on `transcode.requested`. If lag exceeds X messages, scale up. If lag is consistently 0, scale down.
- Separate pools per codec. H.264 jobs go to nodes with NVENC GPUs (massively faster). H.265 jobs go to either NVENC or CPU. AV1 jobs go to CPU pools with high core counts (AV1 GPU encoders exist but quality is currently worse than CPU at the same bitrate).
- Priority lanes. Premium creators or live-event archives get a high-priority Kafka topic. The high-priority worker pool drains it first. Default uploads use the standard pool.
- Spot / preemptible nodes. Transcoding is restartable. Run 60-80% of the pool on preemptible nodes. Workers checkpoint progress: if preempted halfway through encoding segment 47, the resumed worker restarts at segment 47, not from scratch.

#### 9c. Storage tiering

Already covered in `question.md` Step 6. The summary:

- Hot (S3 Standard): anything watched in the last 7 days. ~5% of catalog.
- Warm (S3 IA): watched in the last 90 days. ~15% of catalog.
- Cold (Glacier Instant): the long tail. ~80% of catalog.
- Archive (Glacier Deep Archive): source files of videos with no view in a year.

Blended cost goes from $0.023/GB-mo (all-hot) to ~$0.005/GB-mo (tiered). 5x savings.

The job that moves content between tiers reads `view_counts.last_viewed_at` from the analytics DB. Runs daily. Emits S3 lifecycle transitions in bulk.

#### 9d. Metadata DB scaling

- Cassandra cluster sharded by `video_id`. ~100 nodes for ~10 billion videos.
- Replication factor 3 within a region; one full replica per region.
- All reads are point reads or partition reads. No scatter-gather (except for "videos by owner_id" which uses a secondary table with `owner_id` as partition key).
- Hot videos: their row is cached in Redis with a TTL of a few hours, plus in-process LRU in the Watch Page API for the very top videos.

#### 9e. Geographic distribution

- Source bucket: one region (e.g., us-east) for write; cross-region replicated for read.
- Transcoded bucket: region of the worker that produced it; hot videos replicated to all regions.
- Metadata DB: multi-region replicated. Writes to nearest region; eventually consistent globally with ~1-2s replication lag.
- CDN: PoPs everywhere; shields per region; origin is S3 in the region nearest each shield.

### 10. Reliability

- CDN PoP outage. Traffic shifts to neighboring PoPs via the CDN's own routing. Latency rises for viewers in that city; nothing else breaks.
- Origin shield outage. Edges fall back to direct-to-S3. S3 request volume spikes 10-50x. S3 is provisioned for this burst (request-per-second limits are generous), and the edges have stale-while-revalidate set so most viewers see cached content from the edge even while the shield refresh is broken. Worst case: cold-tail videos cannot play until shield recovers.
- S3 outage in one region. Switch to cross-region replicas via signed URLs that point at the surviving region. Replication lag becomes visible: a video uploaded in the last few minutes might 404.
- Metadata DB partial failure. Cassandra survives node failures by definition (RF=3). A whole-region failure means writes from that region's creators stall; reads continue from other regions.
- Transcoding farm queue overflow. New videos sit in Kafka waiting their turn. Creators see "transcoding" status for longer. Eventually the autoscaler catches up.
- Kafka broker loss. Replicate Kafka with RF=3, leader election handles broker failure. Producer retries with idempotence enabled prevent duplicates.
- Janitor for stuck jobs. A periodic scan finds `variants` rows in `status=encoding` for longer than 2x expected duration. Republishes the job to Kafka. Combined with idempotent ffmpeg output, this is safe.

### 11. Observability

What must be instrumented from day one:

| Metric | Why |
|--------|-----|
| `upload.bytes_per_sec`, `upload.chunks_failed_rate` | Detect upload regressions |
| `upload.finalize.p99_latency` | Slow finalize = sha256 mismatch storm or backend overload |
| `kafka.transcode.requested.lag` | Transcoding pipeline depth; autoscaler input |
| `transcoder.job_duration` by variant and codec | Detect ffmpeg regressions |
| `transcoder.failure_rate` | Bad sources, OOMs, codec bugs |
| `manifest.assembly_lag` (seconds from last variant complete to master published) | Pipeline freshness |
| `cdn.edge_hit_rate` per PoP | Headline cost driver. Below 90% = investigate. |
| `cdn.shield_hit_rate` | Below 70% means shield is undersized or TTLs wrong |
| `cdn.s3_origin_request_rate` | Should be a tiny fraction of total |
| `playback.first_frame_p99_ms` | The user SLO |
| `playback.rebuffer_ratio` (rebuffer seconds / playback seconds) | QoE metric. Below 0.5% target. |
| `playback.variant_distribution` | Are viewers stuck on low quality? Means bandwidth problems or ABR bugs. |
| `db.cassandra.read_p99` | Watch page latency depends on this |
| `view_counter.lag_seconds` | If creators see "0 views" for a viral video, this is broken |

Page on: cdn.edge_hit_rate < 85% for 10 min, playback.first_frame_p99 > 3000 ms for 5 min, transcoder.failure_rate > 5%, s3_origin_request_rate > 10x baseline. File a ticket on: manifest.assembly_lag > 5 min, view_counter.lag > 30 min.

### 12. Follow-up answers

**1. Delete a video that is in every edge cache.**

The video has 100M views, so its segments are in hundreds of edge PoPs. The flow:

- Update `videos.status = deleted` in Cassandra immediately. The Watch Page API now refuses to issue signed URLs for it; new viewers see "video unavailable."
- Issue a CDN cache purge by URL pattern for `/v_8h3jK2p/*`. Major CDNs propagate purges in 5-30 seconds globally.
- For in-flight playback sessions that already have segments cached in the player: they continue playing until the cached buffer drains, then the next segment fetch fails (CDN purged). The viewer sees an error mid-video. This is the price of long edge TTLs.
- For paranoid takedowns (CSAM, court order), revoke the signed-URL signing key for that video. Even if a segment is somehow served, the signature is invalid. Belt and suspenders.

The 60-second target is achievable with CDN pattern purge plus signed-URL revocation. The 60-second window is documented; legal teams understand it.

**2. Backfill AV1 for the top 10,000 videos.**

- Why backfill. AV1 is ~30% smaller than H.264 at the same quality. For a video with 100M views at 5 Mbps, switching to AV1 saves 30% of bandwidth, which is real money.
- Selection. Sort videos by `total_watch_seconds` (more meaningful than view count). Take the top 10K. Estimate per-video savings: `(h264_bitrate - av1_bitrate) × 8 × watch_seconds_per_month`. Filter to videos where savings exceed 10x the one-time encoding cost.
- Compute estimate. Average video length 10 min. AV1 encoding at 0.5x real-time = 20 min compute per video × 10K = 200K compute-minutes = ~3300 hours per machine = ~140 machine-days for a single core. With 1000 cores running in parallel: ~3 hours wall-clock for the whole batch. Fits in a maintenance window.
- Execution. Add `av1` variant to the existing transcoding pipeline. Publish 10K `transcode.requested` messages with priority="backfill" (lower than user-uploaded). Manifest Assembler picks up `transcode.completed` events and adds AV1 variants to the existing master playlist. Players that support AV1 (newer Chrome, Firefox, mobile) will pick it; older players stick with H.264.
- Source files. Some sources may be in Glacier. The backfill job restores them in batches (bulk restore is much cheaper than per-object). Schedule the restore the day before the encode job.

**3. Live streaming.**

Live and VOD share almost no infrastructure. Changes:

- Ingest. Creator pushes via RTMP (legacy) or WebRTC (low-latency) to an ingest server (a regional pool of nginx-rtmp or pion-webrtc instances).
- Transcoding. Real-time, not batch. The ingest server transcodes on the fly into the ladder, producing segments as the stream comes in. Latency budget: 1-2 seconds for transcoding.
- Distribution. Low-Latency HLS (LL-HLS) or Low-Latency DASH (LL-DASH). Segment duration is short (1-2 sec) and HTTP chunked transfer is used so the segment is delivered while still being produced.
- CDN. Same CDN, but segments have very short TTLs and use shorter cache key lifetimes. The CDN's shield aggregates the "many viewers asking for segment N before it exists" case via HTTP request coalescing.
- Glass-to-glass latency. With LL-HLS: 3-5 sec. With WebRTC delivery (no segments, direct connection): under 1 sec but cannot scale to 5M viewers without an SFU mesh. For 5M viewers, LL-HLS at 3-5 sec is the practical choice.
- DVR / VOD conversion. As segments are generated, archive them. When the live stream ends, the same segments become the VOD asset. No re-transcoding needed.

**4. Thumbnails.**

- Generation. During transcoding, a separate ffmpeg pass extracts frames at fixed intervals (every 2 seconds for seek-bar thumbnails; 1-3 at percentiles 10%/50%/90% for the main thumbnail).
- Storage. Thumbnails are small JPGs (~10-50 KB each). Store in S3 alongside the video. A 4-minute video has ~120 seek thumbnails × 30 KB = 3.6 MB. At 450K videos/day = ~1.6 TB/day of thumbnails.
- Sprite sheets. For the seek bar, pack thumbnails into a sprite sheet (a single image with all thumbs in a grid) plus a JSON describing the grid. One image fetch instead of 120. This is what YouTube does.
- Serving. Same CDN. Thumbnails get long TTLs (1 year; immutable).
- Custom thumbnails. Creators upload their own. Upload Gateway handles it as a small file (no chunking needed); store next to the auto-generated ones with an `is_custom=true` flag.

**5. Copyright takedown.**

- Receive notice. A trust-and-safety team reviews the notice. If valid, they call an internal API: `POST /admin/videos/<id>/block`.
- Block. Update `videos.status = blocked`. Revoke the signed-URL signing key for that video. Trigger CDN purge for `/v_<id>/*`.
- Keep file accessible to legal. Do not delete the S3 objects. Move them to a restricted bucket with a separate access policy that only the legal team and a logged-access process can read. This is the "available for review" requirement.
- Audit trail. Every block has a record: who blocked, when, which takedown notice, expected unblock date. Required for compliance.
- Re-enable. If the takedown is withdrawn, restore the signing key and clear the block. Files are still in S3, just in the restricted bucket; move them back.

**6. Drop-off analytics.**

Players emit periodic playback heartbeats with `(video_id, session_id, position_seconds)`. The Flink job aggregates:

- For each video and each 10-second bucket of position, count the number of distinct sessions that reached that bucket.
- A retention curve is the distribution: at position 0:00, 100% of sessions. At 1:00, maybe 78%. At 5:00, maybe 41%. The shape tells the creator where viewers leave.
- Stored in ClickHouse, partitioned by video_id and bucketed by position. Query latency in hundreds of ms even on huge data.
- Creators see the curve in their Studio. Updated nightly (real-time would be expensive and would not change creator decisions).

**7. DRM (Netflix mode).**

- Every transcoded segment is encrypted with AES-128 CTR mode using a per-content encryption key (CEK).
- The CEK is wrapped (encrypted) with the device's public key obtained from the DRM provider (Widevine, FairPlay, PlayReady).
- When a viewer hits play:
    1. Player fetches manifest. Manifest references a license server URL.
    2. Player requests license from license server. License server authenticates the user (logged in, subscription active, geo allowed).
    3. License server returns the wrapped CEK, valid for this device and this session, with a TTL.
    4. Player decrypts segments on the fly using CEK.
- Add to architecture: License Server (stateless API), Key Management Service (KMS storing CEKs by video_id), integration with Widevine/FairPlay/PlayReady SDKs.
- Trade-off: per-session license issuance adds 50-200ms to playback start. Manifest can be cached but license cannot.

**8. Subtitles and multiple audio tracks.**

HLS master playlist has separate `#EXT-X-MEDIA` entries for each audio and subtitle track:

```
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en/playlist.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Spanish",LANGUAGE="es",URI="audio/es/playlist.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Hindi",LANGUAGE="hi",URI="audio/hi/playlist.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en.m3u8"
... (12 subtitle tracks)
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="audio",SUBTITLES="subs",CODECS="avc1.4D401F,mp4a.40.2"
720p/playlist.m3u8
```

Audio is transcoded as a separate variant (one per language). Subtitles are WebVTT files served as their own playlists. Player picks one of each based on user preference. Audio is muxed by the player at playback time, not at encode time, so we don't need 7 video × 3 audio = 21 variants; we need 7 video + 3 audio = 10.

**9. Origin shield outage.**

Blast radius: every CDN edge that gets a cache miss now fans out to S3 directly. S3 request rate spikes 10-50x. Most viewers see cached content from the edge and notice nothing. Cache misses (long-tail videos, first viewers of new videos) see higher latency (S3 fetch from the nearest replica, possibly across regions).

Survival:

- Edges have `stale-while-revalidate` set: serve stale segments while refresh fails. Viewers see no interruption.
- S3 is provisioned for the burst (request-per-second buckets are large). Worst case, you hit the S3 rate limit and start getting 503s. Mitigation: pre-provision higher S3 limits if you know shield is your only buffer.
- Long-tail videos may be unplayable until shield recovers. Acceptable cost for a 15-30 min outage.

**10. Real-time view counts for ranking.**

Current pipeline: Player → Kafka → Flink (1-min windows) → ClickHouse → reads. Lag: ~5-30 min.

For 5-second freshness:

- Add a parallel high-frequency aggregator. Same Flink job but with 5-sec windows and writing to a separate output (Redis with INCR on a `views:<video_id>:current_5s` key, then a rolling sum).
- Output is approximate: dedup is best-effort (no exactly-once across Kafka rebalances). For ranking signals this is acceptable.
- The recommendation team reads from the high-frequency store. The displayed view count on the watch page reads from the slower exactly-once pipeline.

The high-frequency path is approximate. The slow path is exact. Two pipelines is the price of having both.

### 13. Trade-offs worth saying out loud

- Build vs buy CDN. At YouTube scale Google built their own (Google Edge Network). At smaller scale you buy Cloudflare or Fastly. The breakeven is around 10 Tbps sustained egress; below that, buying is cheaper because you avoid PoP capex and operations. Above that, owning the CDN starts to make sense. A senior candidate names the breakeven, not just "buy" or "build."
- Codec choice trade-off.
    - H.264: encode fast, decode universal, file size baseline. Always ship.
    - H.265 (HEVC): 30% smaller files than H.264 at equal quality. Encode 2-5x slower than H.264. Decoder support: iOS yes, Android yes, web partial. Trade-off: bandwidth savings vs encode cost vs licensing fees (H.265 patent pool fees are real).
    - AV1: 30% smaller than H.265, but 10-30x slower to encode. Royalty-free. Decoder support: modern Chrome, Firefox, recent Android, modern Apple. Use for the top 1-5% of videos by watch time, where the bandwidth savings amortize the encode cost in days. Not viable for routine encoding yet.
- Storage tier transitions: when do they pay off? Demote a video after 7-day no-view. If 30% of demoted videos get re-promoted within 30 days, demotion was premature. Tune the threshold per content category: news ages fast (aggressive demote), evergreen tutorials less so. A senior candidate measures this.
- Push vs pull manifest updates. Master playlists change as variants come online. Push (websocket to player) would cut start latency for newly-uploaded videos, but adds complexity. Pull with short TTL is the standard answer; only adopt push at extreme scale.
- Single bucket vs region-per-bucket. Cross-region S3 replication for hot videos costs replication bandwidth. The trade-off: faster reads from local region vs bandwidth cost to replicate. Replicate hot videos (top 5% by views) eagerly; replicate the rest on first read miss (origin shield in another region triggers replication).
- What I would revisit at 10x scale.
    - Custom hardware encoding (Argos-class video transcoding ASICs that Google deploys). 10-100x more efficient than CPU encode at huge capex.
    - Per-shot encoding (encode each scene at the optimal bitrate, not a global ladder). Saves 20%+ bandwidth. Netflix does this.
    - Move manifests to a CDN-edge-computed format (build the manifest at the edge based on viewer's device and region) instead of pre-built static manifests.

### 14. Common interview mistakes

- Designing one system for upload and playback. They are two different systems sharing a database. A candidate who keeps them in one architecture diagram gets lost.
- Skipping the CDN tiers. "Use a CDN" is not enough. The shield is the critical piece for keeping S3 cost down. Mention all three tiers.
- No mention of segment alignment across variants. Players cannot switch mid-stream without aligned keyframes. The average candidate skips this.
- Hand-waving the transcoding compute. "We'll have transcoders" is not enough. Mention separate node pools per codec, autoscaling on queue depth, idempotent output for restartability, and the AV1 cost story.
- Forgetting resumable upload. A 5GB single PUT fails on a phone connection. Resumable upload (TUS or S3 multipart) is mandatory.
- No view-count pipeline. Every viewer triggers a view; you cannot UPDATE a DB row per view at 125M concurrent users. Async pipeline via Kafka + Flink is the standard answer.
- Ignoring storage tiering. The 5x cost reduction story matters; storage costs in PB are real money.
- Ignoring DRM when asked about Netflix. Even if not asked, mention the license server as the difference between YouTube and Netflix designs.
- Treating live as a small variation on VOD. Live needs real-time transcoding, RTMP/WebRTC ingest, LL-HLS or LL-DASH delivery, and a different latency budget. Acknowledge it is a different system.
- Overengineering thumbnails. They are tiny. A sprite sheet plus CDN handles them. Don't spend five minutes on this when the interviewer wants to hear about CDN tiering.

If you can hit 8 of these 10 in your design walkthrough, you are interviewing well. Hit 6 and you are at the bar for a senior role at a media company. The remaining 4 are what separate a senior from a staff engineer who has actually run a transcoding farm.
{% endraw %}
