---
layout: practice-problem
track: system-design
problem_id: 7
title: Design Uber / Lyft (Ride Sharing)
slug: 007-ride-sharing
category: Geospatial
difficulty: Hard
topics: [geohash, h3, matching, dispatch, real-time location]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/007-ride-sharing"
solution_lang: markdown
---

{% raw %}
## Scene

The interviewer slides their laptop toward you and says:

> *Design Uber. A rider opens the app, taps "Request Ride," and within a few seconds a nearby driver accepts and starts heading their way. Walk me through how that works end to end.*

They lean back. There is a clock on the wall and they are watching the time.

This problem looks like "fetch a list of nearby drivers" but the interviewer is really asking three different things in one: how do you track a million moving vehicles in real time, how do you match a rider to one driver in under two seconds, and how do you keep the ride alive through twenty minutes of network drops, app backgrounds, and driver cancellations. Get the geospatial index wrong and the matching service grinds; get the state machine wrong and you charge people for rides that never happened.

Before you draw anything, ask what is actually in scope.

## Step 1: clarify before you design

Take 5 minutes. Do not draw boxes yet. What would you ask? Aim for at least seven questions that meaningfully change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Scope.** "Are we designing matching and dispatch only, or also payments, surge pricing, ETA prediction, in-ride chat, and driver onboarding?" Ride-sharing is huge; if you try to do everything in 45 minutes you will do nothing well. A reasonable scope: rider requests a ride, system finds and assigns a driver, both sides see updates until pickup. Surge and ETA can be mentioned briefly. Payments and onboarding are explicitly out.
2. **Scale.** "How many active drivers, how many rider requests per second, what cities?" Uber-like answers: ~1M drivers online during peak, ~5M riders active, ~100M trips/day globally, single hottest city ~50k drivers. The single-city number drives shard sizing.
3. **Matching latency target.** "From tap on 'Request Ride' to a driver assigned, what is the P99?" Under 2 seconds is the bar for the rider not to abandon. Driver acceptance can add a few more seconds.
4. **Driver location update frequency.** "How often do driver apps report position?" Typical: every 4 seconds when online, every 1 second once a ride is matched and they are en route. This drives ingest throughput.
5. **Matching policy.** "Closest driver wins? Best-rated within a radius? Optimized batch assignment across multiple pending requests?" Greedy nearest is simple. Batch optimization gives better global outcomes but adds latency and complexity.
6. **Cancellations and re-matching.** "What happens if the assigned driver cancels, or never accepts? Do we re-match automatically?" Yes, almost always. The state machine must handle this without billing surprises.
7. **Geographic distribution.** "Is matching global, or sharded by city/region?" City-sharded. There is no benefit to matching a rider in Tokyo against a driver in Lagos. The shard boundary is roughly a metropolitan area.
8. **Vehicle types and pools.** "UberX vs UberXL vs UberPool? Different driver pools or one pool with filters?" One pool with a `vehicle_class` attribute and filters at match time. Pool/shared rides add a routing dimension we will not solve here.

If you walked in asking only "how do we find nearby drivers?" you missed the harder half. The state machine, the location ingest, and the city-sharding are equally important.

</details>

## Step 2: capacity estimates

Inputs from the interviewer:

- 1M drivers online globally during peak hour
- 5M riders active during peak hour
- 100M trips/day
- Driver location update every 4 seconds when online, every 1 second once on a trip
- Single hottest city: 50k drivers online (NYC, Sao Paulo on New Year's Eve)
- Average trip duration: 15 minutes
- Match latency P99 target: 2 seconds

Compute (do this before revealing):

1. Trip requests per second (sustained, peak)
2. Location updates per second (sustained, peak)
3. Bandwidth for location ingest
4. Storage for location history per day
5. Concurrent active trips at any moment

<details>
<summary><b>Reveal: the math</b></summary>

**Trip requests per second.**
100M / 86400 ≈ 1160 requests/sec sustained. Peak is 5-10x sustained (Friday night rush, surge events) → **~10k requests/sec peak**.

**Location updates per second.**
- Idle online drivers: 1M × (1/4 sec) = **250k updates/sec** sustained.
- On-trip drivers: ~30% of online drivers are on a trip on average. 300k × (1/1 sec) = **300k more updates/sec**.
- Total: **~550k updates/sec sustained**, ~1M/sec peak.

This is the dominant write workload. The matching workload is tiny by comparison.

**Bandwidth for location ingest.**
Each location packet is ~100 bytes (driver_id, lat, lng, heading, speed, accuracy, ts, signature). 550k × 100B = **55 MB/sec sustained**. Fine for ingest, but you do not write all of that to durable storage; most of it is overwrite-in-place in a fast store.

**Storage for location history per day.**
If we kept every update: 550k × 86400 × 100B = ~4.7 TB/day. We do not keep every update. Two stores:
- **Current location store (hot, overwrite-in-place):** 1M rows × ~200B = ~200MB total. Trivial.
- **Trip path history (durable, ~1 update every 4 sec during a trip):** 100M trips × ~225 location pings each × 100B = ~2 TB/day. Compressed and aged off after 90 days for fraud and dispute resolution.

**Concurrent active trips.**
100M trips/day × 15 min / 1440 min/day = ~1M trips active at any moment. Sharded by city, the biggest cities have ~50-100k concurrent active trips each.

**Key insight from the math.** The system has two extremely different workloads in one. Location updates are 250k+/sec, mostly writes to a fast in-memory store. Trip matching is ~10k/sec, computationally cheap but latency-critical. Most of the architecture exists to keep these two paths separate so they do not interfere.

</details>

## Step 3: choose a geospatial index

You need to answer two queries quickly:

- "Given a rider at (lat, lng), find all online drivers within R meters."
- "When a driver moves, update their location in the index."

Naive approach: store every driver's (lat, lng) in a B-tree on lat, then filter by lng and distance. This is awful; the index does not understand 2D locality. Real options: geohash, quadtree, H3, S2. Take 10 minutes to compare them before revealing.

<details>
<summary><b>Reveal: geospatial index comparison</b></summary>

| Index | Shape | Strengths | Weaknesses |
|-------|-------|-----------|------------|
| **Geohash** | Rectangular grid, base-32 string prefix encoding (e.g., `dr5ru`). Longer prefix = smaller cell. | Trivial to compute, trivial to shard (just hash the prefix), works in any KV store. Range queries on prefix are easy. | Cells near the equator are wider than near the poles. Neighbor cells of a corner cell may share only one character of prefix, so "find neighbors" needs a small lookup table. Two points close in space can have very different geohash prefixes if they straddle a cell boundary. |
| **Quadtree** | Recursive 4-way subdivision of a rectangle. Each region is a node. | Adapts cell size to data density (deep trees in dense areas, shallow in sparse). Good for static datasets. | Tree updates on every move are expensive. Hard to shard because the tree shape is mutable. Out of favor for real-time. |
| **H3 (Uber's choice)** | Hexagonal hierarchical grid. Resolution 0 (largest) to 15 (smallest). At resolution 9, cells are ~174m across. | Hexagons have uniform distance to all 6 neighbors (squares have 4 close + 4 diagonal, which is awkward). Built-in `kRing` function: "give me all cells within k rings of cell X" is one call. Cell sizes are roughly uniform globally. | Hexagons cannot perfectly tile the sphere; H3 uses 12 pentagons to close the gaps, which become edge cases. Indexes are 64-bit integers, not human-readable. |
| **S2** | Quadrilateral cells on a projected sphere (Hilbert curve traversal). Used by Google. | Strong locality guarantees: nearby cells have nearby IDs along the Hilbert curve, so range scans work well. Variable resolution. | Cells are not uniform in shape (some are skinnier than others). Less intuitive than hexagons. |

**Recommendation: H3 at resolution 8 or 9.**

- **Uniform neighbor distance.** A driver in the center of an H3 cell is roughly equidistant from all 6 neighboring cells. With geohash, the diagonal neighbors are √2 times farther than the edge neighbors, and your "search within R meters" code has to handle that. With H3, "give me cells within 1 ring" is one function call (`kRing(cell, 1)`) and returns exactly the 7 cells (the center plus 6 neighbors).
- **Resolution 9 (174m edge length, ~0.1 sq km area).** Small enough that "all drivers in this cell" is a tractable list (~10-100 drivers per cell in a dense city), large enough that most matches happen within one ring.
- **Sharding.** Use a coarser resolution (resolution 5 or 6, several km across) as the shard key. A shard owns all the high-resolution cells inside one coarse cell. This keeps a city's drivers on a small number of shards and avoids cross-shard queries in 95% of matches.
- **Edge cases.** When a search radius spans the boundary between two coarse cells (rider near a city edge), the search has to query both shards. The matching service handles this by issuing 2 reads in parallel.

The other valid answer is S2 (Lyft used it historically). Geohash is fine for a v1; you would graduate to H3 once you hit scale. Quadtree on a real-time-updated dataset is a wrong answer in 2025.

</details>

## Step 4: sketch the high-level architecture

Fill in the `[ ? ]` placeholders. Hint: there is a long-lived connection from driver apps for location updates and dispatch, a fast in-memory index of where drivers are, a service that runs the matching algorithm, and a state machine that owns each ride from request to completion.

```
   Rider App                                            Driver App
       │                                                      │
       │ HTTPS                                                │ persistent WebSocket
       ▼                                                      ▼
  ┌─────────────┐                                      ┌──────────────┐
  │   API GW    │                                      │   [ ? ]      │  (long-lived connections,
  └──────┬──────┘                                      │              │   ingests location, pushes dispatch)
         │                                             └──────┬───────┘
         │                                                    │
         ▼                                                    ▼
  ┌─────────────┐                                      ┌──────────────┐
  │  Ride       │                                      │   [ ? ]      │  (fast in-memory store of
  │  Service    │◄─────────────────────────────────────┤              │   "where is each driver right now")
  │  (state     │       queries: nearby drivers        └──────────────┘
  │   machine)  │
  └──────┬──────┘
         │
         │ when match needed
         ▼
  ┌─────────────┐
  │   [ ? ]     │   (runs the matching algorithm: nearby + filters + scoring)
  └──────┬──────┘
         │
         │ chosen driver
         ▼
  push dispatch via the driver gateway

  Persistent records:
  ┌──────────────────┐    ┌──────────────────┐
  │   Trips DB       │    │   [ ? ]          │  (durable per-trip path history,
  │  (ride records)  │    │                  │   for fraud, disputes, analytics)
  └──────────────────┘    └──────────────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
   Rider App                                            Driver App
       │                                                      │
       │ HTTPS                                                │ persistent WebSocket
       ▼                                                      ▼
  ┌─────────────┐                                      ┌──────────────────┐
  │   API GW    │                                      │  Driver Gateway   │  Holds the WebSocket per
  │  (rider)    │                                      │  (stateful pods,  │  driver. Receives location
  └──────┬──────┘                                      │   sticky routing) │  packets, forwards dispatch
         │                                             └─────┬─────────┬──┘  offers back to the driver.
         │                                                   │         │
         │                                  location updates │         │ dispatch push
         │                                                   │         │
         ▼                                                   ▼         │
  ┌─────────────┐                                  ┌──────────────────┐│
  │  Ride       │                                  │ Driver Location  ││  Redis (or KeyDB) cluster
  │  Service    │◄────── nearby query ─────────────┤ Index (H3-keyed) ││  sharded by H3 coarse cell.
  │  (state     │                                  │ + Status flags   ││  Keys per H3 cell hold the
  │   machine)  │                                  └──────────────────┘│  set of drivers in that cell.
  └──────┬──────┘                                                      │
         │                                                              │
         │ when match needed                                            │
         ▼                                                              │
  ┌─────────────────┐                                                   │
  │  Matching       │   Pulls candidate drivers from the index,         │
  │  Service        │   applies filters (vehicle class, rating,         │
  │  (stateless)    │   pending status), scores, picks one.             │
  └────────┬────────┘                                                   │
           │                                                            │
           │ chosen driver_id ─────────────────────────────────────────►│
           │                                                            │
           ▼                                                       (sent to driver app)
  ┌─────────────────┐
  │   Trips DB       │   Postgres or DynamoDB. The canonical record
  │  (ride records)  │   of each ride. Sharded by city.
  └─────────────────┘

           ┌──────────────────────────────────────────────────────────────┐
           │                Trip Path History (durable)                    │
           │  Kafka → object store (S3) + ClickHouse for analytics.        │
           │  Per-trip pings sampled at ~1 per 4 sec while on-trip.        │
           └──────────────────────────────────────────────────────────────┘

           ┌──────────────────────────────────────────────────────────────┐
           │   Routing / ETA Service                                       │
           │  Separate. OSRM, Mapbox, or in-house. Asked for "ETA from     │
           │  point A to point B given current traffic." Used at quote     │
           │  time and during pickup tracking.                             │
           └──────────────────────────────────────────────────────────────┘
```

Component responsibilities:

- **Driver Gateway.** Stateful. Holds a WebSocket per online driver. One pod handles ~10k-50k connections. Sticky routing by driver_id so reconnects land on the same pod when possible (best-effort, not required for correctness).
- **Driver Location Index.** Redis (or KeyDB) cluster sharded by H3 coarse cell. The key is the H3 cell ID; the value is a set of driver_ids in that cell, plus side keys for per-driver status (`available`, `on_trip`, `offline`) and last-known position. Overwrite-in-place; we do not durably persist every ping here.
- **Ride Service.** Owns the ride state machine. Knows nothing about driver locations; calls the Matching Service when it needs a driver.
- **Matching Service.** Stateless. Given a pickup location, it queries the Driver Location Index for candidates, applies filters, scores them, and returns the chosen driver. Sub-second.
- **Trips DB.** Source of truth for ride records. Sharded by city so a region outage does not affect other cities.
- **Trip Path History.** Async pipeline. Driver Gateway forwards on-trip location pings to Kafka, which writes to object store and a columnar store for queries.
- **Routing / ETA Service.** Separate service for "give me the route and ETA from A to B." Heavy CPU; isolated so its load does not affect matching.

</details>

## Step 5: the matching algorithm

A rider taps "Request Ride" at location P. You need to assign one driver in under 2 seconds. What is the algorithm? Closest driver wins? Highest-rated within a radius? Bin-pack many pending requests against many available drivers using the Hungarian algorithm? Trade-offs?

<details>
<summary><b>Reveal: matching algorithm</b></summary>

Three approaches, increasing in sophistication:

**a. Greedy nearest.**

```
candidates = location_index.drivers_in_cells(kRing(cell_of(P), 2))
candidates = filter(c -> c.status == AVAILABLE and c.vehicle_class >= requested)
candidates = candidates.sort_by(eta_to(P))
return candidates[0]
```

Fast (sub-100ms). Easy to reason about. The standard answer at most companies most of the time.

Problem: locally optimal, globally bad. If two riders request simultaneously and the nearest driver happens to be near both, the second rider gets a much worse match than they would have under a paired assignment.

**b. Greedy with a brief hold.**

Same as greedy, but the matching service holds the request for ~500ms to collect any other pending requests in the same H3 area. Then it runs a small bipartite matching (Hungarian algorithm) on the batch: minimize total ETA across all pending pairs.

This is what Uber actually does in dense areas during peak. The 500ms hold is invisible to the rider (still under the 2-second target) and improves global ETA by 5-15%.

**c. Predictive matching.**

Same as (b) but the candidate pool includes drivers who are about to drop off their current rider in the next 60 seconds. The ETA for those drivers includes the remaining trip plus the deadhead. This is more efficient but adds a prediction layer (the rider's current trip ETA is itself a model).

**Recommendation: start with (a), evolve to (b).**

Filters you must apply before scoring:
- `status == AVAILABLE` (not on trip, not offline, not in "going home" mode).
- `vehicle_class` matches what the rider requested (UberX, XL, Black, etc.).
- Driver has acceptance rate above threshold (low-quality drivers deranked).
- Driver is not on the rider's block list (rare but exists).
- Driver did not just cancel a request from this rider in the last 5 minutes.

Scoring (when you have a candidate set of 5-20 drivers):
- `eta` (call Routing Service for actual road-network ETA, not straight-line distance).
- `driver_rating` (small bonus for higher rated drivers).
- `pickup_difficulty` (some streets are one-ways, hard to pull over; deprioritize matches that route the driver through known-bad pickup areas).
- `match_age` (penalize drivers who have been idle for >30 min; we want to send them work, but not at the expense of a much better match).

A common mistake: using straight-line ("haversine") distance instead of road-network ETA. A driver 200m away on the other side of a river is much farther than a driver 500m away on the same street. Always use the routing service for the final score.

**The Hungarian algorithm in 30 seconds.** Given N pending requests and N candidate drivers, you have a cost matrix `C[i][j]` = ETA from driver j to rider i. The Hungarian algorithm finds the assignment that minimizes total cost in O(N^3) time. For N up to ~50 this is sub-millisecond. Above that you bucket by H3 cell and run several smaller assignments in parallel.

</details>

## Step 6: location updates at scale

Drivers report position every 4 seconds when online, every 1 second when on a trip. With 1M online drivers, that is 250k+ packets per second arriving at your servers. They must be cheap to ingest and cheap to query. How is each update stored and routed?

<details>
<summary><b>Reveal: location update flow</b></summary>

Two parallel writes per update, each going to a different store:

**Write 1: Driver Location Index (hot, overwrite-in-place).**

This is the index that matching queries.

- The Driver Gateway receives the packet over WebSocket.
- It computes the H3 cell at resolution 9 from `(lat, lng)`.
- It updates two Redis keys:
  - `driver:{driver_id}` → hash containing `(lat, lng, h3_cell, status, vehicle_class, last_update_ts)`. Overwrite.
  - If the H3 cell changed (driver moved between cells, happens every few updates): remove from `cell:{old_h3}` set and add to `cell:{new_h3}` set. If cell did not change: no-op.

Two writes per packet, both in-memory. ~0.5ms per update. 250k updates/sec = 500k Redis ops/sec, comfortably within one Redis cluster of ~20 shards.

The `cell:{h3}` sets are how the matching service queries efficiently. "Find all drivers within 1 ring of cell X" is `SUNION cell:X cell:X_n1 cell:X_n2 ... cell:X_n6`, returning at most a few hundred driver_ids. Filter and score those.

**Write 2: Trip Path History (durable, only when on-trip).**

If the driver is on a trip:
- The Driver Gateway pushes the location to a Kafka topic `trip.location.pings`, keyed by trip_id.
- A consumer aggregates per trip and writes batches to object storage (S3) plus an analytical store (ClickHouse).
- Idle-online drivers (not on a trip) do not get persisted; their pings only update the hot index.

This split matters. We are not paying durable storage for "where was every driver every 4 seconds today"; we only pay for "where was every active trip every 4 seconds today." That is roughly 10x cheaper.

**Failure modes to call out:**

- **Stale entries.** If a driver app crashes and stops reporting, their entry in `driver:{driver_id}` stays until a TTL expires. We set TTL to 30 seconds; if no update arrives, the driver is considered offline and removed from the cell sets by a background sweep. The TTL is short enough that matching does not assign a phantom driver.
- **Hot cells.** A single H3 cell over JFK airport at 5pm can contain hundreds of drivers. The set is still small enough to read in <1ms, but the cell key becomes a hot key on its Redis shard. Mitigations: read replicas of hot cells, in-process caching of the cell read in the Matching Service for 1 second windows.
- **Out-of-order updates.** Driver app on a flaky network may deliver pings out of order. The Driver Gateway timestamps each packet at receipt and discards anything older than the current stored `last_update_ts`. Cheap and avoids the indexed location going backwards.

</details>

## Step 7: read the full solution

You have done the heavy lifting. The solution covers the ride state machine in detail (where most subtle bugs hide), surge pricing, multi-region deployment, what happens when the driver app loses connectivity mid-trip, and the dozen edge cases that only surface after real launch. Try the follow-ups before reading.

## Follow-up questions

Try answering each in 3 to 4 sentences before reading the solution.

1. **The matched driver does not accept within 15 seconds.** What does the system do? Re-match to the next-best driver? Notify the rider? What if a driver consistently ignores requests?
2. **A driver is in the middle of a trip when their app loses connectivity for 90 seconds.** How does the system know the trip is still going? What does the rider see? What if the driver never reconnects?
3. **Surge pricing.** A concert lets out and 5000 riders request at once in 10 city blocks. Demand is 10x supply. How does the price multiplier get computed and applied? Which service owns it?
4. **Two riders request at almost exactly the same time, and the same driver is the best match for both.** Walk through the race condition and how you prevent double-assignment.
5. **A rider's location is in a "hot" H3 cell with 200 candidate drivers (airport, downtown).** How do you avoid filtering through all 200 on every request?
6. **The H3 cell containing a popular pickup zone (airport curb) is on a single Redis shard. It becomes a hot key.** Diagnose and mitigate.
7. **Multi-city failure.** The us-east region (which serves NYC) goes down. What happens to in-progress trips there? Can riders in unaffected cities still request?
8. **A driver is briefly very close to the pickup but driving away (just dropped off a passenger and heading home).** Should the matcher assign them? How do you signal "going off duty soon"?
9. **Fraud: a driver app is reporting fake locations to game the system (teleporting to high-surge zones).** How do you detect this without slowing the ingest path?
10. **The Routing Service (ETA) is slow or down.** Matching depends on it. How do you fail gracefully?

## Related problems

- **[News Feed (002)](../002-news-feed/question.md)**, the location update fan-out and the per-cell hot-key problem rhyme with the celebrity-follower problem in news feed; the mitigations (replicas, in-process cache, jittered TTLs) are the same.
- **[Chat System (003)](../003-chat-system/question.md)**, in-ride messaging between rider and driver is a focused chat problem with the same persistent-connection and presence concerns; the driver gateway here is the same shape as the chat gateway there.
- **[Notification System (010)](../010-notification-system/question.md)**, dispatch push to the chosen driver, "your driver is arriving" push to the rider, and SMS fallback when the app is closed all flow through the notification system.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design Uber / Lyft (Ride Sharing)

### TL;DR

Ride sharing is three problems wearing a trench coat. First, a real-time geospatial index that tracks ~1M moving drivers with 250k+ location updates per second. Second, a matching pipeline that turns a rider's tap into a driver assignment in under 2 seconds. Third, a ride state machine that survives 15-25 minutes of driver cancellations, network drops, and app backgrounding without billing anyone for a ride that never happened.

The design partitions cleanly. Location updates flow through a stateful driver gateway into a Redis cluster keyed by H3 hexagonal cells; this index is overwrite-in-place and never queried for history. The matching service is stateless and reads from that index, applying filters and a road-network ETA score from a separate routing service. Trip records live in a sharded Postgres (or DynamoDB) keyed by city, with a per-trip path history streamed to Kafka and durable storage for fraud and disputes.

The interesting engineering is in the seams. The driver gateway has to be stateful (it holds a WebSocket per driver) which makes deployment harder. The matching service can be greedy or batched; batched gives 5-15% better global ETA at the cost of a 500ms hold. The state machine has cancellation, no-show, and reconnect transitions that all have to be idempotent because a flaky network will deliver every event twice. Surge pricing is its own subsystem reading aggregated supply/demand per cell and emitting multipliers that the quote endpoint reads. And every hot key, from airport pickup cells to celebrity drivers near a stadium, needs the same hot-key mitigations that show up in every other large system.

### 1. Clarifying questions

Covered in `question.md`. The eight questions: scope (matching only, or also payments/surge/ETA?), scale (drivers online, riders requesting, hottest city), matching latency target, location update frequency, matching policy (greedy vs batch), cancellation handling, geographic shard model, vehicle types. The two that most candidates miss: the hottest single-city number (which sizes a shard) and the matching-policy question (which forks the architecture).

### 2. Capacity estimates

Reiterated from the question:

- ~1160 trip requests/sec sustained, ~10k peak.
- ~250k idle-online location updates/sec + ~300k on-trip updates/sec = **~550k updates/sec sustained**, ~1M/sec peak.
- ~1M concurrent active trips globally; biggest cities ~50-100k each.
- ~2 TB/day of durable trip-path history (compressed, aged off at 90 days).

The decisive observation: location ingest dwarfs every other workload. The system must keep this load on its own infrastructure (the gateway and the hot index) so it does not affect matching latency or trip-state writes.

### 3. API design

**Request a ride (rider side).**

```
POST /api/v1/rides
Authorization: Bearer <rider_token>
Idempotency-Key: <uuid>

{
  "pickup":  { "lat": 40.7580, "lng": -73.9855, "address": "Times Sq" },
  "dropoff": { "lat": 40.7411, "lng": -74.0048, "address": "Chelsea" },
  "vehicle_class": "uberx",
  "payment_method_id": "pm_abc"
}
```

Responses:

| Status | Meaning | Body |
|--------|---------|------|
| 202 Accepted | Ride created in `requested` state; matching in progress | `{ "ride_id": "...", "state": "requested", "quote": { "fare_min": ..., "fare_max": ..., "surge": 1.2 }, "eta_seconds": 240 }` |
| 200 OK | Idempotency replay; same ride returned | same shape as 202 |
| 400 Bad Request | Invalid pickup, dropoff outside service area, etc. | |
| 402 Payment Required | Payment method invalid | |
| 409 Conflict | Rider already has an active ride | |
| 503 Service Unavailable | No drivers available in area after timeout | `{ "error": "no_drivers", "retry_after": 60 }` |

Notes:

- **202 not 201.** The ride exists but is not yet matched. The client subscribes to a WebSocket channel for updates (`ride:{ride_id}`).
- **Idempotency-Key is required.** Network failures cause clients to retry. Without idempotency you bill people twice. The server stores `(idempotency_key, ride_id)` for 24h; a repeat returns the existing ride.
- **The quote is bracketed (`fare_min`/`fare_max`), not exact.** Final fare depends on actual trip duration and any waiting time.

**Driver accepts a ride.**

```
POST /api/v1/rides/{ride_id}/accept
Authorization: Bearer <driver_token>

{ "driver_eta_seconds": 180 }
```

Responses:

| Status | Meaning |
|--------|---------|
| 200 OK | Driver is now assigned to the ride |
| 409 Conflict | Ride already accepted by another driver, or in a state that does not allow accept |
| 410 Gone | Rider cancelled or ride expired (the dispatch offer timed out) |

**Location update (driver side).** Not REST; sent over the persistent WebSocket as a binary frame:

```
[1 byte msg_type=LOC]
[8 bytes driver_id]
[4 bytes lat (fixed-point)]
[4 bytes lng (fixed-point)]
[2 bytes heading]
[2 bytes speed]
[1 byte accuracy]
[8 bytes ts_ms]
[16 bytes hmac_sig]
```

~46 bytes on the wire vs ~200 bytes for the equivalent JSON. At 250k packets/sec the savings matter.

### 4. Data model

**Drivers (mostly static profile, not the hot index).**

```sql
CREATE TABLE drivers (
    driver_id       BIGINT PRIMARY KEY,
    name            TEXT NOT NULL,
    vehicle_class   SMALLINT NOT NULL,   -- 1=uberx, 2=uberxl, 3=black, ...
    vehicle_plate   TEXT NOT NULL,
    rating_avg      NUMERIC(3,2) NOT NULL DEFAULT 5.00,
    rating_count    INT NOT NULL DEFAULT 0,
    home_city_id    INT NOT NULL,
    status          SMALLINT NOT NULL,   -- 1=active, 2=suspended, 3=offboarded
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_city_status ON drivers (home_city_id, status);
```

This table is read-mostly. It is not in the location update path; only ride creation and post-trip aggregation read it.

**Rides (the trip record).**

```sql
CREATE TABLE rides (
    ride_id         BIGINT PRIMARY KEY,    -- Snowflake-style, ts + shard + seq
    rider_id        BIGINT NOT NULL,
    driver_id       BIGINT,                 -- NULL until matched
    city_id         INT NOT NULL,           -- shard key
    state           SMALLINT NOT NULL,      -- see state machine below
    pickup_lat      DOUBLE PRECISION NOT NULL,
    pickup_lng      DOUBLE PRECISION NOT NULL,
    dropoff_lat    DOUBLE PRECISION NOT NULL,
    dropoff_lng    DOUBLE PRECISION NOT NULL,
    vehicle_class   SMALLINT NOT NULL,
    requested_at    TIMESTAMPTZ NOT NULL,
    matched_at      TIMESTAMPTZ,
    picked_up_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancel_reason   SMALLINT,
    fare_cents      INT,
    surge_mult      NUMERIC(3,2) NOT NULL DEFAULT 1.00,
    payment_method  TEXT,
    idempotency_key UUID
);
CREATE UNIQUE INDEX idx_idempotency ON rides (rider_id, idempotency_key);
CREATE INDEX idx_rider_active ON rides (rider_id) WHERE state IN (1,2,3,4);
CREATE INDEX idx_driver_active ON rides (driver_id) WHERE state IN (3,4);
```

Sharded by `city_id`. Rides never cross cities mid-flight; this gives clean shard boundaries and per-city blast radius.

The partial indexes are deliberate. `idx_rider_active` lets us enforce "one active ride per rider" with a cheap check; `idx_driver_active` is the same for drivers. After the ride completes the row no longer appears in either partial index, keeping them small.

**Driver Location Index (Redis, not SQL).**

Keys per cluster:

```
driver:{driver_id}     HASH    fields: lat, lng, h3_r9, h3_r6, status, vehicle_class, last_update_ts
                                 TTL: 30s (refreshed on every update)

cell:{h3_r9}           SET     members: driver_ids currently in that cell
                                 (no TTL; entries removed by background sweep when driver TTL expires)

driver_inflight:{driver_id} STRING  value: ride_id of active ride
                                     (set when matched, cleared when ride completes)
```

Sharded by `h3_r6` (a coarser H3 resolution, ~6km across) so all drivers in a metropolitan neighborhood land on the same Redis shard. ~20 shards total at peak, ~5GB per shard.

### 5. Core algorithm: H3 indexing and the matching loop

#### Why H3 at resolution 9

Resolution 9 has cells with an edge length of ~174m, area ~0.1 sq km. In a dense city you get ~10-50 available drivers per cell at peak. A `kRing(cell, 1)` query covers the cell plus its 6 neighbors, a ~750m radius. That is the right scale for "find me drivers close enough to be at the rider within a few minutes."

If a match is not found in the 1-ring (rare in dense areas, common in suburbs), expand to `kRing(cell, 2)` (~1.5km radius), then `kRing(cell, 3)` (~2.3km). Cap at ring 5; beyond that, ETA is too long to be acceptable and the system surfaces "no drivers available" to the rider.

#### The matching loop

```python
def match(ride):
    pickup_cell = h3.geo_to_h3(ride.pickup_lat, ride.pickup_lng, resolution=9)
    
    for k in [1, 2, 3, 5]:
        cells = h3.k_ring(pickup_cell, k)
        candidate_ids = redis.sunion(*[f"cell:{c}" for c in cells])
        
        # Coarse filter on cached driver attributes (no individual reads yet).
        candidates = location_index.bulk_lookup(candidate_ids)
        candidates = [
            d for d in candidates
            if d.status == AVAILABLE
            and d.vehicle_class >= ride.vehicle_class
            and d.driver_id not in ride.rider.blocked_drivers
        ]
        
        if len(candidates) == 0:
            continue
        
        # Score top N candidates with a real road-network ETA call.
        candidates = candidates[:20]   # cap to bound routing cost
        etas = routing_service.batch_eta(
            origins=[(c.lat, c.lng) for c in candidates],
            destination=(ride.pickup_lat, ride.pickup_lng)
        )
        
        scored = [
            (eta + rating_penalty(c.rating) + idle_bonus(c.last_idle_ts), c)
            for c, eta in zip(candidates, etas)
        ]
        scored.sort()
        
        best = scored[0][1]
        
        # Atomic claim. If two simultaneous matches pick the same driver, only one wins.
        if try_claim_driver(best.driver_id, ride.ride_id):
            return best.driver_id
        # else: someone else got them, loop to next-best
        for _, c in scored[1:]:
            if try_claim_driver(c.driver_id, ride.ride_id):
                return c.driver_id
    
    return None   # truly no drivers
```

`try_claim_driver` is a single Redis Lua script:

```lua
-- KEYS[1] = driver_inflight:{driver_id}, ARGV[1] = ride_id
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', 30) then
    return 1
else
    return 0
end
```

`SET ... NX EX 30` means "set only if not exists, expire in 30 seconds." If the driver is already claimed by another ride, this returns 0 and we move on. The 30-second expiry is a safety: if the matching service crashes before completing the dispatch, the lock auto-releases and the driver is matchable again.

#### Batch matching (advanced)

If the city is under heavy load, instead of matching one ride at a time, the matching service holds incoming requests for up to 500ms (the "dispatch window") and runs a Hungarian assignment over the pending batch:

```python
def batch_match(rides, drivers):
    # rides: list of pending requests in the same metropolitan area
    # drivers: candidate available drivers
    cost = [[eta(d, r.pickup) for r in rides] for d in drivers]
    # Hungarian / min-cost assignment, padded with dummy rows/cols if sizes differ
    assignment = hungarian(cost)
    return assignment
```

For up to ~50 rides and ~100 drivers, this runs in <50ms. Above that, partition by H3 sub-region and run several smaller assignments in parallel.

The 500ms hold is worth it when ETA improvements average 5-15%; it is not worth it when the city is sparse and you would be holding the request for nothing. The dispatch window is set per city by a control loop watching system-load metrics.

### 6. Architecture (detailed)

```
                                              Driver App
                                                   │
                                                   │  persistent WebSocket
                                                   │  (TLS, mTLS for driver auth)
                                                   ▼
   Rider App                              ┌──────────────────────┐
       │                                  │   Driver Gateway     │  Stateful pods. One driver
       │                                  │   (sticky routing)   │  one connection. Per pod:
       │ HTTPS                            │                      │  10-50k concurrent connections.
       ▼                                  │   - decode LOC frames│
  ┌─────────────┐                         │   - update H3 index  │
  │  API GW     │                         │   - push dispatch    │
  │  (rider)    │                         └────┬──────────┬──────┘
  └──────┬──────┘                              │          │
         │                                     │          │ on-trip pings
         │                                     ▼          ▼
         │                       ┌──────────────────┐  ┌─────────────────┐
         │                       │ Driver Location  │  │ trip.location.  │
         │                       │ Index            │  │ pings (Kafka)    │
         │                       │ Redis cluster,   │  └────────┬─────────┘
         │                       │ sharded by h3_r6 │           │
         │                       └────────┬─────────┘           │
         │                                ▲                     ▼
         │                                │              ┌──────────────┐
         ▼                                │              │ Trip History │
  ┌─────────────────┐                     │              │ Pipeline      │
  │  Ride Service   │                     │              │ (Kafka → S3   │
  │  (state machine,│                     │              │  + ClickHouse)│
  │   stateless)    │                     │              └──────────────┘
  └──┬─────────┬────┘                     │
     │         │                          │
     │         │ "find me a driver"       │
     │         ▼                          │
     │   ┌─────────────────┐              │
     │   │  Matching       │──────────────┘
     │   │  Service        │  reads candidates
     │   │  (stateless)    │
     │   └─────┬───────────┘
     │         │
     │         │ calls for ETA scoring
     │         ▼
     │   ┌─────────────────┐
     │   │  Routing /      │  OSRM or in-house. Stateless.
     │   │  ETA Service    │  Heavy CPU.
     │   └─────────────────┘
     │
     ▼
  ┌─────────────────┐
  │   Trips DB      │  Postgres or DynamoDB. Sharded by city_id.
  │                 │  Read replicas in each region.
  └─────────────────┘

  ┌─────────────────┐    ┌─────────────────┐
  │  Surge Service  │    │  Notification   │  Push to driver (dispatch),
  │  (per-cell      │    │  Service        │  push to rider (driver
  │   supply/demand)│    │                 │  arriving, in progress).
  └─────────────────┘    └─────────────────┘
```

Why each component is shaped this way:

- **Driver Gateway is stateful.** A WebSocket is a connection; you cannot route each frame to a random pod. Sticky routing by driver_id (consistent hash) plus a session table in Redis (which pod owns which driver) lets the Matching Service push dispatch by looking up "which pod has driver_id D?" and sending it there.
- **Matching Service is stateless.** It owns no connections. It reads from Redis, calls Routing, writes a claim to Redis, then asks the Driver Gateway to push the offer. Easy to scale horizontally; failures just retry.
- **Routing Service is separate.** Road-network ETA computation is CPU-heavy and prone to spikes. Isolating it means a routing slowdown does not crash matching; the matcher times out at, say, 300ms and falls back to haversine distance.
- **Trips DB is sharded by city.** Cities are natural blast-radius boundaries. NYC outage does not affect London.
- **Surge Service is separate.** It aggregates supply (drivers available) and demand (requests in last N seconds) per H3 cell and publishes multipliers. The quote endpoint reads from this; the matching path does not.

### 7. The match path (rider request → driver assigned)

End-to-end, what happens when a rider taps "Request Ride":

1. **t=0ms.** Client → API Gateway → Ride Service.
2. **t=20ms.** Ride Service does:
   - Idempotency check against `(rider_id, idempotency_key)`.
   - "Does rider have an active ride?" check via the partial index.
   - Look up surge multiplier for the pickup H3 cell.
   - Insert ride row with `state=1 (requested)`. Returns 202 to client with a quote.
3. **t=30ms.** Ride Service publishes `ride.requested` event to Kafka (also forwards to Matching Service directly for low latency).
4. **t=30ms.** Matching Service runs the matching loop described above.
   - **t=60ms.** SUNION on cell sets, ~5-50 candidate IDs.
   - **t=70ms.** Bulk lookup driver records from Redis, apply filters. ~10-20 remain.
   - **t=100ms.** Batch ETA call to Routing Service.
   - **t=200ms.** Score, pick best, claim via `SET NX`.
5. **t=200ms.** Matching Service publishes `dispatch.offer` event to the Driver Gateway pod owning the chosen driver.
6. **t=210ms.** Driver Gateway pushes the offer over WebSocket to the driver app.
7. **t=220ms.** Driver app shows the "new ride request" screen. Driver has up to 15 seconds to accept.
8. **Driver accepts (t=~3000ms typical).**
   - Driver app sends `POST /rides/{ride_id}/accept`.
   - Ride Service transitions state `requested → matched`, sets `driver_id`, `matched_at`.
   - Ride Service notifies the rider via their WebSocket: "Your driver is on the way."
9. **Driver does not accept (t=15000ms).**
   - Matching Service times out, releases the claim (`DEL driver_inflight:{driver_id}`), increments the driver's "ignored" counter, and re-runs matching to find the next driver. The rider sees no change in their UI other than a slightly longer wait.
   - After 3 ignores in a row, the driver is auto-set to `offline` and surfaced for a check-in (their app likely is in the background).

End-to-end latency from rider tap to driver assignment, P99 target: under 2 seconds when a driver accepts immediately. The 2-second budget breaks down: ~200ms for matching, plus the dispatch RTT, plus the driver's reaction time.

### 8. The ride state machine

This is where bugs accumulate if you handwave. The states:

```
   ┌─────────────┐
   │  requested  │  matching in progress; no driver assigned
   └──────┬──────┘
          │ driver accepts
          ▼
   ┌──────────────┐
   │   matched    │  driver_id set; driver en route to pickup
   └──────┬───────┘
          │ driver arrives + rider boards
          ▼
   ┌────────────────────┐
   │  in_progress       │  trip underway; on-trip pings being captured
   └──────┬─────────────┘
          │ driver taps "End Trip" at dropoff
          ▼
   ┌────────────────────┐
   │   completed        │  terminal. Fare charged. Receipt issued.
   └────────────────────┘

   From any non-terminal state:
   ┌────────────────────┐
   │   cancelled        │  terminal. Reason recorded. Cancel fee
   └────────────────────┘  may apply per business rules.

   Special: from `matched` only:
   ┌────────────────────┐
   │   no_show          │  terminal. Driver waited at pickup; rider didn't show.
   └────────────────────┘  Counts as a no-show cancel for billing.
```

Critical invariants:

- **Every transition is idempotent.** Network retries are common. `POST /accept` called twice should produce the same state and not change `matched_at`.
- **No backward transitions.** Once `in_progress`, you cannot go back to `matched`. The only exit is `completed` or `cancelled`.
- **One driver per ride; one ride per driver.** Enforced by the partial unique indexes on `(driver_id) WHERE state IN (3,4)` and by the Redis `driver_inflight:{driver_id}` key.
- **Cancel reason is required.** "rider cancelled," "driver cancelled," "system cancelled" (no drivers available), "no show," "fraud detected." Determines billing.

Implementation: model as a database row with a `state` column plus an audit trail in a separate `ride_events` table. Transitions are conditional updates:

```sql
UPDATE rides
SET state = 2, driver_id = $driver, matched_at = NOW()
WHERE ride_id = $ride AND state = 1
RETURNING state;
```

If `RETURNING` yields 0 rows, the transition failed (already matched, or cancelled). The driver gateway treats this as "you lost the race" and discards the offer.

### 9. Location update path

Already covered in detail in `question.md` Step 6. Repeating the key points:

- **Two writes per update:** the hot Redis index (overwrite-in-place) and, only for on-trip drivers, the durable Kafka stream for path history.
- **Cell membership updates lazily.** If a driver moves but stays in the same H3 r9 cell, only the `driver:{driver_id}` hash updates. The expensive set membership change happens only when the cell changes.
- **TTL on driver keys.** 30 seconds. If a driver app goes silent, the driver is auto-removed from candidate pools.
- **On-trip frequency.** 1Hz instead of 0.25Hz so the rider's "where is my driver?" view updates smoothly. The bandwidth cost is bounded (only ~30% of online drivers are on a trip).
- **Out-of-order rejection.** The Driver Gateway holds the last accepted `ts_ms` per driver and discards older packets. Cheap and avoids the indexed location going backwards on a flaky network.

One detail not yet covered: **batching from the driver app.** The driver app actually buffers location samples and sends them in bursts every 4 seconds, not as a continuous stream. This reduces TCP overhead and saves battery. The server cares only about the latest sample for the index; older ones in the batch go straight to the on-trip path history (if applicable).

### 10. Scaling

#### a. Driver Gateway

- Stateful pods, each holding 10-50k WebSocket connections.
- 1M concurrent drivers → ~30-50 pods at peak.
- Sticky routing via a session table: `gateway_session:{driver_id} → pod_id`, refreshed on connect/reconnect. The Matching Service looks up the pod by driver_id when it needs to push dispatch.
- Pod failure: connections drop, drivers reconnect (their apps retry exponentially). Capacity is over-provisioned 30% to absorb reconnects without a thundering herd.

#### b. Driver Location Index (Redis cluster)

- Sharded by H3 r6 cell. ~20 shards.
- Hot shards (containing NYC, SF, Mumbai) get more memory and CPU than cold ones (Wyoming).
- Read replicas of each shard: 2 replicas per primary in the same region. Matching service round-robins reads across replicas.
- Sustained ops: 500k writes/sec (location updates × 2 writes each) + ~50k reads/sec (matching queries). Within capacity of a 20-shard cluster.

#### c. Hot cells

The airport cell. The stadium cell during a game. These cells have hundreds of drivers and are queried many times per second. Mitigations, in order:

1. **In-process cache on Matching Service.** Cache the result of `cell:{h3}` reads for 1 second. Within a second, the membership barely changes. This cuts Redis read load on hot cells by 10-100x.
2. **Read replicas.** As mentioned.
3. **Sub-shard the hot cell.** If even with replicas the hot cell is the bottleneck, split it into `cell:{h3}:bucket0`, `cell:{h3}:bucket1`, etc., keyed by `hash(driver_id) mod N`. The Matching Service unions all buckets. Adds a small read cost but distributes writes.

#### d. Matching Service

- Stateless. Auto-scale on request rate.
- One instance per city is a reasonable starting point; bigger cities get more instances behind a city-level load balancer.
- Throughput per instance: ~500 matches/sec (each match takes ~200ms wall clock but most is waiting on Redis and Routing; concurrency is high).
- Total: ~50-100 instances globally at peak.

#### e. Trips DB

- Sharded by `city_id`. Each city is one shard logically; large cities have multiple shards by `hash(ride_id)` within the city.
- Read replicas in each region; writes go to the primary in the city's home region.
- Storage: 100M trips/day × 500B/row = ~50GB/day. Across cities, manageable per-shard.

#### f. Trip Path History

- Kafka cluster with topic `trip.location.pings`, partitioned by `trip_id`.
- Consumer writes to S3 in 5-minute batches, partitioned by `(date, city_id)`.
- A second consumer aggregates into ClickHouse for analytics.
- Retention: 90 days hot in ClickHouse for fraud and disputes; long-term in S3 indefinitely (regulatory).

### 11. Reliability

- **Driver Gateway pod loss.** All drivers on that pod disconnect. Apps retry with exponential backoff plus jitter (start at 1s, max at 30s). New pod absorbs reconnects. During the ~10s window, those drivers are not matchable; their TTL expires within 30s and they fall out of the cell sets cleanly. In-progress rides on those drivers are not affected (the ride state lives in the Trips DB, not the gateway).
- **Driver app loses connectivity mid-trip.** WebSocket disconnects. The trip stays `in_progress` because no event has transitioned it. The rider's app shows "driver location stale" after 30 seconds. If the driver reconnects within 5 minutes, on-trip pings resume (the gap is interpolated for ETA display; the actual fare is computed from the dropoff event, not the pings). If the driver does not reconnect within 15 minutes, an alert is raised; ops can manually mark the trip `cancelled` with reason `driver_disconnect`.
- **Redis cluster loss.** Catastrophic for matching. The cluster is replicated within-region; failover takes ~30 seconds during which matching is degraded (rides go into `requested` state and wait). On full cluster loss, location updates buffer in the Driver Gateway memory for up to 60 seconds; if the cluster does not recover, drivers are temporarily marked unmatchable and riders see "no drivers available."
- **Routing Service slow or down.** Matching service times out at 300ms and falls back to **haversine distance** (straight-line) for scoring. Quality drops (drivers across rivers may be ranked too high) but the system still functions. A health check on the routing service flips a circuit breaker; while open, all matches use haversine.
- **Trips DB primary failure.** Failover to replica (~30 sec). During the window, new ride requests return 503 in that city. In-progress rides in that city cannot transition state (no acceptance, no completion). Other cities are unaffected.
- **Whole region failure.** Drivers and riders in that region's cities are stranded. Cross-region failover is not feasible because location state is in-region; a NYC driver is not useful for matching a Tokyo ride. The mitigation is region redundancy within a continent (us-east + us-west for North America) and DNS-based failover for new traffic; in-progress trips in the failed region are lost (cancelled with reason `system_outage`) and refunded.

### 12. Observability

| Metric | Why |
|--------|-----|
| `match.latency.p99` by city | Headline SLO; >2s for 5 min = page |
| `match.success_rate` by city | % of requests that get a driver assigned within timeout |
| `match.no_drivers_rate` | If >5% in a city, supply problem (raise driver incentives) |
| `dispatch.accept_rate` | % of dispatch offers accepted; <40% = drivers gaming the system or bad matching |
| `dispatch.accept_latency.p50` | How long drivers take to accept; sharp rise = app problem |
| `location.ingest_rate` by region | Should be roughly drivers_online * (1/4 + on_trip_fraction * 0.75) |
| `location.stale_driver_count` | Drivers whose last update is >30s old; spikes suggest gateway problem |
| `redis.hot_cell.ops` for known hot cells (airport, stations) | Should not climb above shard capacity |
| `routing.latency.p99` | Affects match latency directly |
| `state_machine.illegal_transitions` | Should be near zero; nonzero = client bug or replay attack |
| `trip.in_progress_no_pings.count` | Trips with no location update in 60s; possible network or fraud |
| `surge.multiplier.max` by city | Sudden 5x surge in a sleepy area = sensor problem or real event |

Alerts:

- **Page** on: match P99 >2s for 5 min in any top-20 city; match success rate <90% for 5 min; gateway disconnect rate >5%/min; trip state DB unavailable.
- **Ticket** on: dispatch accept rate <40%; hot cell ops >shard capacity 80%; illegal transitions >0.

### 13. Follow-up answers

**1. The matched driver does not accept within 15 seconds.**

The Matching Service holds a soft claim on the driver via `driver_inflight:{driver_id}` with a 30-second TTL. When the dispatch times out at 15s:

- Driver Gateway notifies Matching Service.
- Matching Service explicitly releases the claim (`DEL driver_inflight:{driver_id}`) and increments a per-driver `ignored_count` counter in Redis.
- Matching Service re-runs the matching loop, excluding this driver from the candidate set for the next 5 minutes (so they do not get reoffered the same ride).
- The rider's UI updates "Still finding your driver..." but state stays `requested`. No fee.

If a driver ignores 3 dispatches in a row, their status is auto-flipped to `offline`. The driver app receives a notification ("You seem inactive. Are you still online?"). This prevents drivers who left their phone unattended from holding queue slots indefinitely.

**2. Driver app loses connectivity mid-trip for 90 seconds.**

The ride is in `in_progress`. The state machine does not care about the connection; only about state-change events (`pickup`, `complete`, `cancel`).

What happens:
- Driver Gateway sees the WebSocket dropped. Marks the driver `connection_lost` in the session table but does not change ride state.
- Location pings stop arriving. The rider's app shows "GPS lost" overlay after 30 seconds (UX choice).
- The driver's app queues location samples locally up to ~10 minutes worth.
- When the driver reconnects (90 seconds later), the gateway accepts the queued samples. They are timestamped, so out-of-order arrivals are handled. The on-trip path history gets backfilled.
- If the driver never reconnects: after 15 min with no pings during an `in_progress` ride, ops gets an alert. They review and either mark the trip `completed` with a best-guess fare based on the partial path, or `cancelled` with refund.

The fare is computed from the dropoff event submitted by the driver, not from the location pings. Lost connectivity does not invalidate the trip as long as the driver eventually submits the dropoff.

**3. Surge pricing.**

Surge is a multiplier on the base fare quote, computed per H3 cell from supply and demand:

```
multiplier = clip(demand_rate / supply_count, min=1.0, max=5.0)
```

Where `demand_rate` is ride requests in the cell in the last 60 seconds, and `supply_count` is available drivers in the cell.

Architecture:
- **Surge Service** is a separate service. It consumes the `ride.requested` event stream and joins against the Driver Location Index (snapshot every 10 seconds).
- Outputs per-cell multipliers to a key `surge:{h3_r8}` in Redis with a 30-second TTL.
- The Ride Service reads `surge:{cell_of(pickup)}` when generating a quote. If missing or stale, defaults to 1.0.

Why H3 r8 (coarser) for surge cells: surge is regional, not block-level. A 5x multiplier on one street block but 1x on the next would look bizarre to riders. H3 r8 is ~3km across, which feels like "this neighborhood is busy."

Why the 1.0 minimum: a "0.7x discount" would be marketed differently and lives in promotions, not surge.

Surge is contentious; mention that the actual production system has anti-gaming logic (drivers cannot teleport to high-surge cells to claim the bonus on rides started elsewhere), smoothing (the multiplier cannot jump from 1.0 to 5.0 in one tick; it ramps), and rider notifications ("Fares are higher right now due to high demand. Pay 2.1x?").

**4. Two riders request at almost the same time, same best-match driver.**

The race:
- Ride A and Ride B both start matching at t=0 and t=10ms.
- Both pull the same candidate driver D as best.
- Both attempt `SET driver_inflight:D NX`.

Only one wins. Say A wins at t=200ms. B's `SET NX` returns 0 at t=210ms.

B's Matching Service detects the conflict and moves to the next-best candidate. If B has more than one good option, the rider barely notices (maybe a 100ms longer match). If B has only one viable driver (sparse area), B waits 1-2 more seconds and tries again.

The lock is held in Redis with a 30-second TTL. If A's matching service crashes before sending the dispatch, the lock expires and D becomes claimable.

The "lost-race" case can also happen at the database level if two matching services try to write `driver_id` to two different rides for the same driver. The partial unique index `idx_driver_active` prevents this:

```sql
UPDATE rides SET state=2, driver_id=$D, matched_at=NOW()
WHERE ride_id=$R AND state=1;
```

If another row already has `driver_id=$D` with state in (3,4), this update would violate the partial unique index and error. The Matching Service treats this as "lost-race," releases its Redis claim, and retries with the next driver.

Belt-and-suspenders: Redis claim for fast-path mutual exclusion, DB partial unique index for ultimate correctness.

**5. Hot cell with 200 candidate drivers.**

Two costs to bound:
- The SUNION across cells returns up to 200 candidate IDs.
- For each, we do a bulk-lookup of driver attributes from Redis.
- For the top 20 by some cheap proxy (e.g., last-known position cached on the matching service), we call the Routing Service for true ETA.

Bounding strategies:
- **Cheap pre-filter first.** Before fetching driver attributes, sample the candidate set: take the 50 nearest by haversine distance (computed from cached positions in the matching service). Only fetch attributes for those 50.
- **Score-and-cap.** Apply filters (vehicle class, status, rating) and cap to 20 before the Routing Service call.
- **Cache cell membership.** As mentioned, in-process cache with 1-second TTL. A cell read may be served 100s of times from memory in a busy second.

Result: the hot cell adds a few ms of in-process work, not a Redis round-trip per candidate.

**6. Hot key on a popular pickup zone (airport curb).**

Symptoms: one Redis shard hits CPU 100%, `cell:{airport_h3}` reads dominate, every other key on that shard sees degraded P99.

Mitigations in order:
1. **In-process cache** on the Matching Service (1-second TTL). Cuts reads on hot cells by 10-100x.
2. **Read replicas of the shard.** Matching service round-robins reads across replicas.
3. **Sub-shard the hot cell.** Replace one `cell:{h3}` set with `cell:{h3}:bucket{0..15}` by `hash(driver_id) mod 16`. Reads become 16-way SUNION (still cheap), writes are distributed.
4. **Move the hot cell to a dedicated shard.** Tag certain cells (airports, train stations) at provisioning and pin them to a high-resource shard with extra replicas.

These layer. Most installs need just (1) and (2); (3) and (4) come up when an event happens that the system was not provisioned for.

**7. Region failure (us-east goes down).**

In-progress trips in us-east cities are lost. The state machine for those rides cannot transition because the Trips DB shards live in us-east. Mitigation:
- Trips DB is replicated across AZs within us-east, so AZ failures are absorbed.
- A full us-east failure (rare but happens) triggers cross-region failover to a hot standby in us-east-2 if available. Replication lag of ~5 seconds means up to 5 seconds of rides may be lost.
- Riders in unaffected cities (Europe, Asia, us-west) are fully functional; the cities are independent.
- Riders in us-east see the app refuse to start new rides during the outage; in-progress rides show "service interrupted" and are auto-cancelled with full refund.

Multi-region for matching is hard because location state is in-region and not useful elsewhere. Multi-region for trip records is feasible at higher cost (active-active per city is overkill; active-passive with replication is common).

**8. Driver near pickup but driving away (off duty or just dropped off).**

The driver's `status` field in the Driver Location Index distinguishes:
- `AVAILABLE`: eligible to receive dispatches.
- `ON_TRIP`: currently driving a rider.
- `GOING_OFFLINE`: driver tapped "Sign off after this ride."
- `OFFLINE`: not eligible.

A driver who just dropped off a rider transitions to `AVAILABLE` automatically. If they tap "End shift," they go to `GOING_OFFLINE` for the duration of any current ride and then `OFFLINE`. A `GOING_OFFLINE` driver is not in the candidate pool.

What about a driver who is `AVAILABLE` but heading in the wrong direction? That is a real problem. Two approaches:
- **Heading-aware scoring.** Penalize candidates whose heading vector points away from the pickup. Easy with the `heading` field already in each ping.
- **Predictive ETA.** Use the routing service to compute "if this driver continues their current heading and speed, what is the route and ETA to pickup?" The driver's current motion is baked into the ETA.

In practice, the routing service already handles this if it is given the driver's current location and asked for ETA to the pickup; the road network will reflect any one-way streets and U-turns. The simpler haversine fallback misses this, which is one more reason to prefer real routing.

**9. Fraud: driver app reporting fake locations.**

Fake locations are submitted to game surge zones, "deadhead" bonus, or to harvest free rides. Detection without slowing ingest:

- **Plausibility checks at the gateway.** If a driver's reported position jumps >1km between two pings 4 seconds apart, flag it. Real drivers do not teleport. This check is in-process, sub-ms.
- **Cross-check against the trip path.** For on-trip drivers, the GPS path should look like a road. A path that cuts across buildings is suspect. Run nightly batch job against the Trip History store.
- **Device attestation.** Use Play Integrity / DeviceCheck to verify the location was reported from a real device, not a mock-location app. Bake this into the WebSocket handshake; suspicious devices get a flag that downstream services react to (lower match priority, more aggressive fraud review).
- **Surge-zone teleportation.** A driver who appears in a high-surge zone but had no recent path leading there gets flagged. Pings going through reasonable road segments are weighted positively in the fraud model.

None of these are in the synchronous match path. Fraud is mostly an async detection problem. The synchronous protection is just the plausibility check.

**10. Routing Service slow or down.**

Match path falls back. The fallback is haversine distance (straight-line) for scoring. Code path:

```python
try:
    etas = routing_service.batch_eta(origins, dest, timeout=300ms)
except (TimeoutError, ServiceUnavailable):
    etas = [haversine(o, dest) / AVG_SPEED for o in origins]
    metrics.inc("matching.routing_fallback")
```

Quality drops because haversine ignores the road network. A driver across a river may score better than a driver one street away. But the system still functions and most matches are still acceptable (in dense urban grids, haversine correlates well with real driving distance).

A circuit breaker around the Routing Service trips after sustained failures and switches all matches to haversine for a cool-down period (30 seconds), then probes to see if the service is back.

For ETA presented to riders (the "your driver will arrive in 4 minutes" estimate), the fallback is "your driver will arrive in a few minutes": fuzzier text instead of a wrong number.

### 14. Trade-offs and what a senior would mention

- **Greedy match vs batch match.** Greedy is simpler, faster, locally optimal. Batch (with a 500ms hold) gives 5-15% better global ETA in dense areas. Recommendation: ship greedy first, add batched matching as an experiment per-city, keep the dispatch window tunable.
- **Why H3 not geohash.** Hexagonal neighbor uniformity matters when most matches are within 1-2 rings. Geohash neighbors have non-uniform distance, which means more rings of search to cover the same physical area. Operationally, H3 also has the `compact`/`uncompact` API for multi-resolution queries which is a small but real win.
- **Why stateful Driver Gateway.** Stateless is the dogma but a WebSocket cannot be stateless. The alternative (pull-based long polling) costs 3-5x more bandwidth and battery. Stateful with sticky routing and a session table is the right answer.
- **Why not use the Trips DB as the source of truth for driver location.** Could be done. But 250k writes/sec to a relational DB is much more painful than 250k overwrite-in-place ops to Redis. Location is "current truth, not historical truth"; treating it as a cache, not a record, is the right shape.
- **Surge complexity.** A real surge system has half a dozen knobs: demand smoothing, anti-gaming, regional caps, special events, regulatory compliance (some cities cap surge). The architecture above is the simple core; the production version has a lot more under the hood.
- **What I would revisit at 10x scale.**
  - Per-region matching services with cross-region "border" handling for trips that cross metro areas.
  - Tiered location index: hot (last 60s) in memory, warm (last 5 min) in Redis, archived in object storage. Drivers idle for >5 min get a cheaper representation.
  - Edge-deployed matching for hot cities. Round-trip from rider to a central data center is 50-100ms; pushing matching to a city-local micro data center could cut P99 by half.
  - Replace haversine fallback with a precomputed road-distance table for hot O-D pairs (airport to downtown is asked thousands of times per day; just memoize it).

### 15. Common interview mistakes

- **"Just store driver locations in Postgres with a GiST index."** Possible for v1 in one city. Falls over at 250k writes/sec sustained. Mention this is the toy answer and graduate to a Redis-backed H3 index for scale.
- **"Use the haversine formula."** Acceptable as a fallback. As the primary scoring function, it ignores the road network and assigns drivers on the wrong side of a river. The interviewer is testing whether you know the routing layer is separate.
- **No state machine.** A solution that talks about matching but never names the ride states (requested, matched, in_progress, completed, cancelled, no_show) is incomplete. The state machine is where most subtle production bugs live.
- **Ignoring idempotency.** Network retries on `POST /rides` cause double-bills. Idempotency keys are required, not optional.
- **No mention of the hot cell problem.** Every city has an airport. Every airport is a hot cell. If you cannot describe how to keep that one Redis key alive under load, you are missing a real operational concern.
- **Treating the Routing Service as a free function call.** It is the heaviest dependency in the match path. Bounding its concurrency, timeout, and fallback is essential.
- **Forgetting about cancellations.** Half of the state machine is cancel paths. If you only describe the happy path, you are leaving the interviewer to imagine the rest.
- **Confusing matching latency with acceptance latency.** Matching is <200ms. Driver acceptance can take 5-15 seconds. The 2-second P99 target applies to "from rider tap until matching service has picked a driver and dispatched the offer," not "until driver has tapped Accept." Be clear which you are measuring.
- **Overengineering the multi-region story.** Cities are independent. You do not need a globally-distributed multi-master location index. Per-region, per-city sharding is the right answer.

If you can hit 9 of these 15, you are interviewing at staff level. The most common gaps in real interviews are the state machine, hot cells, and the routing service fallback.
{% endraw %}
