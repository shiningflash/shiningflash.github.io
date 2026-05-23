---
layout: practice-problem
track: system-design
problem_id: 16
title: Design a Load Balancer
slug: 016-load-balancer
category: Networking
difficulty: Easy
topics: [l4, l7, health checks, sticky sessions, algorithms, failover]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/016-load-balancer"
solution_lang: markdown
---

{% raw %}
## Scene

You sit down for the interview. The interviewer sketches a box on the whiteboard and labels it `backend`. They draw a few stick figures on the left and label them `users`. They draw an arrow from the users to the box.

> *"You have a simple service serving 100 users from one box. There is a single nginx in front. Walk me from there to 1 million users, focusing on the load balancing layer at each step. What does the LB actually do, and why?"*

They sit back. "I do not want a treatise on Kubernetes. I want you to tell me, at each stage, what the load balancer is doing, why it is there, and what breaks when you outgrow it."

This is a concept question disguised as a scaling question. Most candidates skip past load balancers because "everyone just uses nginx" or "AWS has ALB, what is there to design." That is exactly the wrong instinct. The interviewer is testing whether you can explain *what an LB does at the packet level*, when L4 stops being enough, why sticky sessions are a tax not a feature, and what happens when the LB itself becomes the single point of failure.

You are going to walk from one nginx to a global anycast LB stack. At every step name what breaks, then name what fixes it.

## Step 1: clarify before you design

Take 5 minutes. Aim for at least 8 questions. The answers shape whether you need L4 or L7, whether sticky sessions matter, whether geo-distribution is on the table, and whether you can afford a managed cloud LB or have to run your own.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Protocol.** "Is this raw TCP, HTTP/1.1, HTTP/2, gRPC, WebSockets?" L4 is fine for raw TCP. HTTP/2 changes how you count "connections" for least-connections. WebSockets are long-lived and break round-robin completely. gRPC is HTTP/2-on-steroids and behaves like one long connection per client.
2. **TLS termination.** "Does the LB terminate TLS, or does it pass encrypted bytes through to the backend?" Termination at the LB centralizes certs and lets you do L7 routing. Pass-through (SNI routing only) hides traffic from the LB but loses path-based routing.
3. **Sticky sessions.** "Do backends hold per-user state in memory? Or are they stateless?" If stateless, any algorithm works. If they hold sessions (carts, WebSocket state, in-memory auth), you need either sticky routing or a shared session store, and each option has costs.
4. **Geo-distribution.** "Are users in one region, or worldwide? Do we have one data center or many?" One region: a single LB layer is enough. Worldwide: you need DNS-based or anycast routing in front of regional LBs.
5. **Traffic shape.** "What is the request rate, the bandwidth, the concurrent connection count? Is traffic spiky?" An LB that handles 1k req/s on tiny JSON is different from one handling 100 Gbps of video streams.
6. **Backend health.** "How fast do backends fail? How fast can we detect it? Is a 1-minute outage of a backend acceptable, or do we need sub-second failover?" Drives the health check interval and the algorithm choice (least-conn naturally avoids slow backends; round-robin does not).
7. **Cost sensitivity.** "Can we use a managed cloud LB (ALB, GCLB), or do we run our own (nginx, HAProxy, Envoy)?" Managed is cheaper in eng time and more expensive per byte. At a certain scale the bill flips.
8. **Failover for the LB itself.** "If the LB dies, what happens? Is one instance acceptable with a 30-second DNS failover, or do we need active-active LBs behind a virtual IP?" Most candidates forget the LB is a SPOF until pushed.

A strong candidate also names what is out of scope: WAF rules, DDoS mitigation, bot detection. Those often sit alongside the LB but are separate concerns.

</details>

## Step 2: capacity estimates

The interviewer gives you:

- Start: 100 users, ~10 requests/second, single nginx, single backend.
- End: 1 million daily active users, ~30k requests/second peak, ~5 Gbps peak bandwidth, average request 4 KB, average response 60 KB.
- HTTP/1.1 today; HTTP/2 likely later.
- Two regions to start, four eventually.
- Backends are stateless web servers; sessions live in a shared cache.

Compute at each scale:

1. Requests per second (sustained and peak).
2. Concurrent connections.
3. Bandwidth in and out at the LB.
4. New connections per second (TLS handshakes are expensive).
5. How many backend instances you would need behind the LB at each stage.

<details>
<summary><b>Reveal: the math</b></summary>

**Stage 1 (100 users, 10 req/s).**
- Bandwidth: 10 × 60 KB = 600 KB/s ≈ 5 Mbps. Negligible.
- Concurrent connections: tens at most.
- Backends: 1 is enough; nginx is sitting there mostly so you can swap the backend later without changing DNS.

**Stage 2 (10k users, ~500 req/s peak).**
- Bandwidth: 500 × 60 KB = 30 MB/s ≈ 240 Mbps. A single 1 Gbps NIC handles this.
- Concurrent connections: ~2,000 (10k users × ~20% active at any moment × a connection or two each).
- New conns/sec: most browsers keep-alive, so ~50/sec for new sessions. TLS cost is manageable.
- Backends: 3 to 5. One nginx still fine.

**Stage 3 (100k users, ~5k req/s peak).**
- Bandwidth: 5k × 60 KB = 300 MB/s ≈ 2.4 Gbps. Getting close to single-NIC limits.
- Concurrent connections: ~20k. nginx handles this on a beefy box but you want headroom.
- New conns/sec: ~500/sec. TLS termination starts to need a real CPU budget (each handshake is ~1-3ms of CPU on modern x86 with ECDSA certs; 500/sec × 2ms = 1 core busy just on handshakes).
- Backends: 20 to 50, partitioned by service (API, web, auth, search).

**Stage 4 (1M users, ~30k req/s peak, 5 Gbps).**
- Bandwidth: 5 Gbps sustained, 15+ Gbps peak. No single LB instance.
- Concurrent connections: 200k+. WebSocket-heavy workloads can push this to millions.
- New conns/sec: ~3k/sec. TLS at this rate is the dominant LB cost; offload to hardware or scale horizontally.
- Backends: hundreds of pods across services; LB topology is now three layers (global, regional, local).

**Key insight from the math.**

The single-LB story breaks at three different scales for three different reasons:
- **Bandwidth** breaks first if your responses are large (video, file downloads).
- **TLS CPU** breaks first if you have many short-lived clients (mobile apps, IoT).
- **Connection count** breaks first if you have long-lived connections (WebSockets, server-sent events, gRPC).

Naming which one will break first for your workload is what separates a thoughtful answer from a generic one.

</details>

## Step 3: L4 vs L7

Before you design the topology, you have to know what an LB *is*. There are two species, and they do different jobs.

Sketch the difference. What does each see on the wire? What can each do? When do you pick one over the other?

<details>
<summary><b>Reveal: L4 vs L7 in one table</b></summary>

| Aspect | L4 (transport layer) | L7 (application layer) |
|--------|----------------------|------------------------|
| What it parses | TCP/UDP headers: source IP, dest IP, ports | Full HTTP request: method, path, headers, cookies, body |
| Routing decision | By IP and port | By path, host, header, cookie, query string |
| TLS | Pass-through (SNI-aware at best) or terminate | Always terminates if it wants to read paths |
| State per connection | Just the 5-tuple | Per-request state (headers, parsed URL, cookies) |
| Throughput | High; can be done in kernel or hardware (DPDK, ASIC) | Lower; userspace HTTP parser is the bottleneck |
| Latency added | Sub-millisecond | 1 to 3 ms |
| When you want it | Raw TCP services, databases, internal RPC where the client speaks one protocol | Anything internet-facing serving HTTP, where you need path routing, A/B tests, rate-limiting per route |
| Examples | AWS NLB, GCP TCP/UDP LB, HAProxy in TCP mode, IPVS, LVS | AWS ALB, GCP HTTPS LB, nginx, HAProxy in HTTP mode, Envoy, Traefik |

**The cleanest mental model:**

- L4 is **a smart NAT**. It rewrites the destination IP/port and sends bytes along. It does not know "what" you sent.
- L7 is **a reverse proxy**. It accepts your HTTP request, parses it, decides where to send it based on what is inside, and may even modify the response.

**When you specifically need L7:**

- Path-based routing: `/api/*` to one pool, `/static/*` to another.
- Host-based routing: `acme.example.com` to tenant-A pool.
- Cookie-based stickiness: read a session cookie to pick a backend.
- Rewriting requests: strip headers, inject `X-Forwarded-For`, change paths.
- Per-route rate limits: 100 req/s on `/login` per IP, no limit on `/static`.
- A/B testing: 5% of `?variant=new` traffic to the canary pool.

**When L4 is enough (and cheaper):**

- Database load balancing (e.g., a pool of read replicas behind one VIP).
- Internal RPC where all callers speak one binary protocol.
- WebSocket gateways where after the upgrade the LB is just shuffling bytes anyway.
- DDoS-scrubbing tier where you want maximum packet throughput and minimum parsing.

The common production pattern: **L4 at the edge, L7 inside**. The edge LB does TLS termination and crude DDoS sponging; the L7 LB inside does path routing and per-service policy. Each does what it is best at.

</details>

## Step 4: the architecture (sketch)

Here is the load balancing stack at non-trivial scale, with some pieces missing. Fill in the five `[ ? ]` boxes. Hint: think about what resolves a domain to an IP, what terminates TLS, what holds the list of healthy backends, who decides a backend is unhealthy, and what actually talks to the backends.

```
                Client (browser, app)
                       │
                       │  "GET /something"
                       ▼
                ┌────────────┐
                │   [ ? ]    │   (turns a hostname into an IP;
                │            │    can also do basic geo-routing)
                └─────┬──────┘
                      │
                      ▼
                ┌────────────┐
                │   [ ? ]    │   (the LB itself; accepts the connection,
                │            │    terminates TLS, picks a backend)
                └─────┬──────┘
                      │
                ┌─────┴────────────┬──────────────┐
                │                  │              │
                ▼                  ▼              ▼
            ┌───────┐         ┌───────┐      ┌───────┐
            │backend│         │backend│      │backend│
            │   A   │         │   B   │      │   C   │
            └───────┘         └───────┘      └───────┘
                                  ▲
                                  │ periodic pokes ("are you alive?")
                                  │
                          ┌───────────────┐
                          │    [ ? ]      │   (decides which backends
                          │               │    are in or out of the pool)
                          └───────────────┘

           Config:                       Optional:
           ┌────────────────┐            ┌────────────────┐
           │     [ ? ]      │            │     [ ? ]      │
           │  (the list of  │            │  (offload TLS  │
           │   backends and │            │   handshakes;  │
           │   their state) │            │   often in HW) │
           └────────────────┘            └────────────────┘
```

<details>
<summary><b>Reveal: filled-in architecture</b></summary>

```
                Client (browser, app)
                       │
                       │  "GET /something"
                       ▼
                ┌────────────┐
                │    DNS     │   Returns one of several IPs (DNS
                │  resolver  │   round-robin) or a single anycast IP.
                └─────┬──────┘
                      │
                      ▼
                ┌────────────┐
                │    Load    │   Accepts the connection.
                │  Balancer  │   Picks a backend per the algorithm.
                │ (nginx,    │   Forwards the request.
                │  HAProxy,  │
                │  Envoy)    │
                └─────┬──────┘
                      │
                ┌─────┴────────────┬──────────────┐
                │                  │              │
                ▼                  ▼              ▼
            ┌───────┐         ┌───────┐      ┌───────┐
            │backend│         │backend│      │backend│
            │   A   │         │   B   │      │   C   │
            └───────┘         └───────┘      └───────┘
                                  ▲
                                  │ GET /healthz every 5s
                                  │
                          ┌───────────────┐
                          │ Health Checker│   Marks a backend unhealthy
                          │  (in-LB or    │   after N consecutive fails.
                          │   sidecar)    │   Re-enables after M successes.
                          └───────────────┘

           Config:                       Optional:
           ┌────────────────┐            ┌────────────────┐
           │ Backend Pool   │            │ TLS Terminator │
           │  Config        │            │  (dedicated    │
           │ (static file,  │            │   process or   │
           │  service       │            │   ASIC / SmartNIC
           │  discovery,    │            │   for high     │
           │  Consul,       │            │   handshake    │
           │  Kubernetes    │            │   rates)       │
           │  endpoints)    │            │                │
           └────────────────┘            └────────────────┘
```

Pieces and what they do:

- **DNS resolver.** First "load balancer" most people forget about. Returning multiple A records (DNS round-robin) gives you crude balancing at layer 0. Anycast IPs collapse this into one IP routed by BGP to the nearest LB pool.
- **Load Balancer.** The thing on the box. Terminates TLS (if L7), picks a backend per the configured algorithm, forwards. Examples: nginx, HAProxy, Envoy, Traefik for software; AWS ALB/NLB, GCP HTTPS LB, F5 BIG-IP for managed/hardware.
- **Backend pool config.** The list of backends. In old-school setups it is a static config file. In modern setups it is service discovery (Kubernetes Endpoints, Consul, etcd) and the LB watches for changes.
- **Health checker.** Active: LB calls `/healthz` on every backend every N seconds. Passive: LB watches actual request results and ejects on elevated 5xx rate. Most production LBs do both.
- **TLS terminator.** Often the same process as the LB. At very high handshake rates (mobile apps, IoT) you may offload to a dedicated TLS-only tier or to a SmartNIC/ASIC.

</details>

## Step 5: load balancing algorithms

You have a pool of backends. A request arrives. How does the LB choose? There are five algorithms you must know. Each has a workload it is best for and a failure mode that bites if you pick it for the wrong workload.

For each of the algorithms below, write down: how it works, when to use it, when it goes wrong.

1. Round robin
2. Least connections
3. IP hash
4. Consistent hash
5. Weighted round robin
6. EWMA latency (least response time)

<details>
<summary><b>Reveal: algorithms in detail</b></summary>

**1. Round robin.**

Send request 1 to backend A, request 2 to B, request 3 to C, request 4 to A, and so on.

- **When it works.** Stateless backends serving roughly uniform requests. Cheapest possible algorithm.
- **When it breaks.** If one request takes 10 seconds and another takes 10 ms, round-robin spreads slow requests evenly across all backends; one slow client can wedge every backend in turn. Round-robin also ignores backend load entirely; a backend already at 100% CPU keeps getting requests.
- **Variant: random.** Same drawbacks, plus the distribution is only uniform in expectation, not exactly.

**2. Least connections.**

Track in-flight connections per backend. Send the next request to the backend with the fewest.

- **When it works.** Variable request durations. A backend stuck on a slow request accumulates connections and naturally stops receiving new ones.
- **When it breaks.** With HTTP/2 or gRPC, one TCP connection carries many concurrent requests. "Connections" no longer correlates with load. You need "least active requests" instead, which means the LB has to parse HTTP/2 frames.
- **Implementation cost.** The LB has to keep per-backend counters and update them atomically. Cheap, but cross-LB-instance you cannot share state, so each LB only sees its own slice. At low backend count this causes imbalance.

**3. IP hash.**

Hash the client IP. Modulo the backend count. Same client always lands on the same backend.

- **When it works.** Poor-man's sticky sessions. No cookie needed. Useful when the client cannot store cookies (some IoT devices, raw TCP clients).
- **When it breaks.** NAT collapse: 10k corporate users behind one NAT all hash to one backend. That backend dies, the LB picks a new mapping, and *every one of those 10k clients lands on a different backend at once*, losing their sessions simultaneously. Mobile clients changing IPs (cell tower hops, WiFi to LTE) get rebalanced and lose stickiness anyway.

**4. Consistent hash.**

Hash the request key (often path, or user ID from a cookie) into a ring. Each backend owns a contiguous slice of the ring. Same key always lands on the same backend. Adding or removing a backend only redistributes 1/N of the keys.

- **When it works.** Cache pools, where you want repeat lookups for the same key to hit the same cache. Sharded backends, where each backend owns a partition. Any case where "same key → same backend" is more important than "even distribution."
- **When it breaks.** Hot keys: one user generates 90% of traffic; their backend melts while others idle. Solve with virtual nodes (each backend appears in many ring positions) and bounded-load consistent hashing (cap any one backend at 1.25x average; spill over to the next).

**5. Weighted round robin.**

Each backend has a weight. Backend A (weight 3) gets 3 requests per round; backend B (weight 1) gets 1.

- **When it works.** Heterogeneous backends. You added bigger boxes; give them more traffic. Canary deploys: weight the new version at 1, old version at 9; 10% of traffic to the canary.
- **When it breaks.** Weights are static; they do not reflect actual load. A weighted backend that is now overloaded keeps receiving its share. Pair weights with passive health checks to eject overloaded backends.

**6. EWMA latency (least response time / least pending).**

Track an exponentially weighted moving average of response time per backend. Send the next request to the backend with the lowest current EWMA.

- **When it works.** Heterogeneous backends in a noisy environment. Backends that get slower (GC pause, hot disk, bad neighbor on shared hardware) automatically receive less traffic until they recover.
- **When it breaks.** "Death spiral": a backend that crashes instantly responds with TCP RST. The EWMA looks great (1 ms!) and it gets all the traffic. Pair with health checks that watch error rate, not just latency. Also: EWMA is sensitive to the smoothing constant; too aggressive and the LB oscillates.

**The pragmatic default for HTTP services: least connections (with HTTP/2 counted as least active requests) plus passive health checks.** It is robust, simple, and the failure modes are well understood. Pick consistent hash if you have sharded state on the backends. Pick EWMA if your backends have wildly variable performance.

</details>

## Step 6: health checks and failover

A backend can die in many ways. It can crash (no TCP response). It can hang (TCP accepts, never responds). It can return 500s. It can be alive but serving stale data. It can be alive and fast for /healthz but slow for everything else. Your LB has to detect each of these and react.

Sketch your health-check strategy. Then answer: what happens when the LB itself dies?

<details>
<summary><b>Reveal: health check design and LB failover</b></summary>

**Active health checks.**

The LB periodically pokes each backend.

```
# nginx-style
upstream api {
    server 10.0.1.1:8080;
    server 10.0.1.2:8080;
    server 10.0.1.3:8080;
}

# Envoy-style health check config
health_checks:
  - timeout: 1s
    interval: 5s
    unhealthy_threshold: 3      # 3 consecutive failures to eject
    healthy_threshold: 2        # 2 consecutive successes to re-add
    http_health_check:
      path: "/healthz"
      expected_statuses: [200]
```

Choices to think about:

- **Interval.** Too short = wasted health check traffic and a backend deploying its app gets flapped in and out. Too long = slow detection. 5 to 10 seconds is the usual sweet spot.
- **Threshold.** 3 failures before ejection prevents flapping on a single hiccup. 2 successes before re-add prevents flapping on partial recovery.
- **What `/healthz` returns.** A real `/healthz` checks: can I reach my database? Can I reach my cache? Am I past startup warmup? Returning 200 just because the process is running is a lie that lets a broken backend keep serving.
- **Deep vs shallow.** A shallow check (`return 200`) catches process death. A deep check (verify DB connectivity) catches a broader set of problems but also fails as a group when the DB is down, which can cause the LB to eject every backend at once. Most teams ship both: shallow for the LB's frequent check, deep for monitoring dashboards.

**Passive health checks (outlier detection).**

The LB watches real traffic. If a backend returns elevated 5xx, eject it temporarily.

```
# Envoy outlier detection
outlier_detection:
  consecutive_5xx: 5            # eject after 5 consecutive 5xx
  interval: 10s                 # re-evaluation interval
  base_ejection_time: 30s       # eject for at least 30s
  max_ejection_percent: 50      # never eject more than half the pool
```

The `max_ejection_percent` is critical. Without it, a bad deploy or a downstream-dependency outage flips every backend to 5xx, the LB ejects all of them, and you have a hard outage. Capping at 50% means even in the worst case you still send traffic somewhere, even if it is to a broken backend; better a partial outage than a total one.

**What about the LB itself?**

If the LB is one box, it is a single point of failure. Two patterns to fix this:

1. **Active-passive with a virtual IP (VIP).** Two LB instances; one holds a VIP. The standby watches the active via VRRP or keepalived. On failure, the standby grabs the VIP. Failover in ~1 second. Same IP, same DNS, no client change. The downside: only one LB is doing work at a time; the other sits idle.
2. **Active-active with multiple IPs and DNS or anycast.** N LB instances all serve traffic. DNS returns multiple A records, or BGP anycasts a single IP to all of them. Clients land on whichever is reachable. If one dies, DNS clients retry on the next record; anycast clients are silently re-routed to the nearest survivor by BGP.

For internet-facing services at any non-trivial scale, active-active anycast is the default. Active-passive VIP is common in corporate data centers because it requires less BGP and DNS infrastructure.

**Cascading failure pitfall.**

When health checks eject too aggressively, you can create a thundering herd: backend A dies, the LB shifts all of A's traffic to B and C. B and C are now at 1.5x their previous load and start to time out. The LB ejects them too. Now there are no backends. The LB returns 503 to every client. Clients retry. The retries overload the next backend that comes up. The system is in a worse state than if A had just stayed in the pool serving 5xx.

Fixes:
- `max_ejection_percent: 50` (already mentioned). Never eject everyone.
- Circuit breakers on the backend side: when load exceeds a threshold, immediately return 503 (cheap) instead of trying to serve and timing out (expensive).
- Client-side retries with backoff and jitter, not tight loops.

</details>

## Step 7: write the config

You have the architecture and the algorithm. Now write a minimal but production-shaped config for the L7 LB. Two services behind one nginx: `/api/orders/*` to an `orders` pool of 3 backends, everything else to a `web` pool of 5 backends. TLS terminated at the LB. Health checks on `/healthz`. Sticky sessions for `web` (cookie-based), `least_conn` for `orders`.

Take 10 minutes. The point is to feel where the config gets noisy and where the defaults bite.

<details>
<summary><b>Reveal: nginx config and where the defaults bite</b></summary>

```nginx
# /etc/nginx/conf.d/api.conf

upstream orders {
    least_conn;
    server 10.0.1.20:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.21:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.22:8080 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

upstream web {
    # Cookie-based stickiness; "route" cookie maps client to server.
    # Free nginx only has ip_hash; sticky cookie is nginx-plus or use third-party module.
    # Shown here as it would appear in nginx-plus or HAProxy.
    sticky cookie srv_id expires=1h path=/;
    server 10.0.1.10:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.13:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.14:8080 max_fails=3 fail_timeout=30s;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/api.crt;
    ssl_certificate_key /etc/ssl/api.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:50m;
    ssl_session_timeout 1d;
    ssl_session_tickets on;

    # Timeouts: defaults are too long for an LB.
    proxy_connect_timeout 2s;
    proxy_send_timeout    10s;
    proxy_read_timeout    30s;

    # Headers the backend needs to know the real client.
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Retry on a different upstream if the first one returns transient errors.
    proxy_next_upstream     error timeout http_502 http_503 http_504;
    proxy_next_upstream_tries 2;
    proxy_next_upstream_timeout 5s;

    # Keepalive to backend.
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    location /api/orders/ {
        proxy_pass http://orders;
    }

    location / {
        proxy_pass http://web;
    }

    location = /healthz {
        access_log off;
        return 200 "ok\n";
    }
}

# Redirect plain HTTP to HTTPS.
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}
```

**Where defaults bite:**

1. **`proxy_read_timeout` defaults to 60s.** Way too long. A hung backend ties up an LB worker for a full minute. Set to your actual P99 + headroom.
2. **`proxy_connect_timeout` defaults to 60s.** A dead backend that does not RST (just black-holes) makes the LB wait a minute before failing over. Set to 2s.
3. **`proxy_next_upstream` defaults to `error timeout`.** Does not include `http_502 http_503 http_504`. So if a backend returns 503, the LB happily forwards it to the client instead of trying another backend. Almost always you want the retry.
4. **No `proxy_next_upstream_tries` limit.** Without it, a request that fails on every backend retries through all of them, potentially seconds of wasted work per failed request. Cap at 2 or 3.
5. **No `keepalive` on the upstream.** Without it, nginx opens a new TCP connection to the backend per request. Adds 1-2 RTT to every request and burns ephemeral ports. Always set keepalive.
6. **Default SSL session cache is tiny.** ~10k sessions. For a busy LB you want 50m or more. Without it, every returning client does a fresh handshake.
7. **`ssl_protocols` defaults vary by nginx version.** Old defaults include TLS 1.0/1.1, which are deprecated. Explicitly set `TLSv1.2 TLSv1.3`.

The config is short. The number of decisions in it is large. Every default that "just works" in the dev environment becomes a production incident at some scale.

</details>

## Follow-up questions

Try each in 2 to 4 sentences before reading the solution.

1. **Sticky sessions and uneven load.** You enable cookie-based stickiness so users keep landing on the same backend (in-memory cart). One backend ends up with the heaviest users. How do you mitigate without losing stickiness?
2. **TLS termination cost.** Your LB CPU is pegged at 80% and you trace it to TLS handshakes. What are your options, in order of cost?
3. **HTTP/2 multiplexing and least connections.** You switch the backends to HTTP/2. Suddenly the LB sends all traffic to one backend. Why, and what do you change?
4. **WebSockets.** You add a WebSocket-based feature. Each user opens one long-lived connection. After deploying, traffic distribution is wildly uneven for hours. What happened?
5. **Slow backend starving the pool.** One backend has a slow disk. Requests to it take 30s instead of 30ms. Round-robin keeps sending it requests; nginx worker threads pile up on it. What algorithm or config fixes this?
6. **DNS TTL.** You set DNS TTL to 1 hour and your LB IP changes during an emergency. Clients still hit the old IP for an hour. What is the right TTL, and what is the trade-off?
7. **Cross-region failover.** Your us-east region is down. How does traffic get to eu-west, and how long does it take? Walk through the layers.
8. **Path-based routing for a monolith split.** You are splitting a monolith. `/api/orders/*` should go to the new order-service, everything else stays on the monolith. What changes in the LB, and how do you migrate without breaking clients?
9. **Health check storm.** You have 200 LB instances each polling 500 backends every 5 seconds. The backends are seeing 20k req/s of `/healthz` traffic. How do you reduce this without losing health visibility?
10. **The LB is dropping connections during a deploy of the backend pool.** New backends register before they are ready; old backends are killed mid-request. What is the right deploy sequence?

## Related problems

- **[Distributed Cache (009)](../009-distributed-cache/question.md)**, which uses the same consistent-hash routing pattern internally. Understanding consistent hashing here makes the cache problem easier.
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md)**, where the LB tier is central to scaling reads. The algorithms here are the same; the workload shape changes.
- **[Write-Heavy System Patterns (018)](../018-write-heavy-patterns/question.md)**, where the LB sits in front of a write path and the choice of stickiness affects how the partitioning behaves.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Design a Load Balancer

### TL;DR

A load balancer is a reverse proxy with two jobs: pick a backend for each incoming request, and keep that backend list honest. The interesting design work is not the picking, it is the everything-around-it: what does the LB *see* (L4 sees IP/port, L7 sees full HTTP), how does it know a backend is healthy, what happens when it picks a sticky backend that then dies, and how do you keep the LB itself from being the single point of failure.

The right LB architecture is layered. At the edge you have DNS or anycast routing users to the nearest region. Inside each region you have an L7 LB that terminates TLS and does path-based routing to per-service pools. Inside each service tier you may have an L4 LB for raw throughput, or a sidecar mesh for service-to-service traffic. Each layer adds 1 to 3 ms of latency in exchange for a unit of control.

The scaling story is straightforward but easy to get wrong: a single nginx is "already an LB" at 100 users and stays adequate to 10k. Beyond that you need health checks, more backends, then a managed cloud LB to absorb TLS and DDoS, then a global LB for geo-routing, then sidecars for service mesh. Each step is driven by a specific failure: bandwidth, TLS CPU, connection count, or geographic latency.

### 1. Clarifying questions and why each matters

Already covered in `question.md`. The two questions that drive the most architectural decisions:

- **Protocol shape.** HTTP/2 with long-lived multiplexed connections is a fundamentally different load picture than HTTP/1.1 with short connections. WebSockets change it again. Round-robin is fine for HTTP/1.1, lies to you for HTTP/2, and is actively harmful for WebSockets.
- **Stickiness requirement.** If backends are stateless, you have all algorithms available. If they are stateful (sessions, WebSocket state, in-memory caches), every algorithm has a tax: sticky LB algorithms cause uneven load, stateless LB algorithms force you to externalize the state, and externalizing the state costs latency on every request.

### 2. Capacity estimates (full working)

| Stage | Users | Req/sec peak | Bandwidth | Concurrent conns | New TCP/sec | Notable cost |
|-------|-------|--------------|-----------|------------------|-------------|--------------|
| 1 | 100 | 10 | ~5 Mbps | ~50 | ~5 | None; box is bored |
| 2 | 10k | 500 | ~240 Mbps | ~2k | ~50 | NIC and nginx workers |
| 3 | 100k | 5k | ~2.4 Gbps | ~20k | ~500 | TLS CPU starts to matter |
| 4 | 1M | 30k | ~5-15 Gbps | ~200k+ | ~3k | TLS dominates; need multiple LBs |

Three different ceilings to watch for:

- **Bandwidth ceiling.** A single 10 Gbps NIC handles ~9 Gbps usable. Streaming or file-heavy workloads hit this first.
- **TLS handshake ceiling.** Each handshake is ~1-3 ms of CPU. At 1k handshakes/sec you spend ~2 cores. At 10k/sec you spend ~20 cores just on handshakes. Session resumption (TLS tickets, session IDs) cuts this by ~10x for returning clients.
- **Connection count ceiling.** Each kept-alive connection costs file descriptors and some kernel memory (~10 KB per TCP). 1M concurrent connections needs tuning (`ulimit`, `net.core.somaxconn`, `net.ipv4.tcp_max_syn_backlog`) and several GB of RAM just for the socket table.

The first ceiling you hit depends on workload: video CDN hits bandwidth, IoT hits handshakes, chat hits connection count.

### 3. API design

A load balancer is not a REST API. It is a TCP/HTTP proxy. There are two surfaces:

**The data plane** is the LB doing its job: accepting connections, picking backends, forwarding. No "API" in the REST sense; the API is "speak HTTP at me and I will proxy."

**The control plane** is the admin/config API: add a backend, remove a backend, change weights, drain a backend before deploy, view health state.

```
# Admin API (HAProxy runtime API, nginx plus API, Envoy xDS)
GET    /admin/v1/pools                          # list all backend pools
GET    /admin/v1/pools/{pool}/backends          # list backends in a pool with health
POST   /admin/v1/pools/{pool}/backends          # add a backend
DELETE /admin/v1/pools/{pool}/backends/{id}     # remove a backend
PUT    /admin/v1/pools/{pool}/backends/{id}     # change weight or state

POST   /admin/v1/pools/{pool}/backends/{id}/drain   # mark draining: no new conns,
                                                    #   let existing finish
POST   /admin/v1/pools/{pool}/backends/{id}/ready   # re-enable

GET    /admin/v1/pools/{pool}/health             # current health snapshot
GET    /admin/v1/stats                           # request rate, error rate, latency
```

A typical config example (nginx) so you can see the data model the LB actually runs on:

```nginx
upstream api_backend {
    least_conn;                                  # algorithm
    server 10.0.1.10:8080 weight=3 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:8080 weight=3 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:8080 weight=1 max_fails=3 fail_timeout=30s backup;
    keepalive 64;                                # keepalive conn pool per worker
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/api.crt;
    ssl_certificate_key /etc/ssl/api.key;
    ssl_session_cache   shared:SSL:50m;          # session resumption cache
    ssl_session_timeout 1d;

    location /api/orders/ {
        proxy_pass http://order_service;
    }
    location /api/ {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";          # keepalive to backend
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
    }
    location /healthz {
        return 200 "ok\n";
    }
}
```

HAProxy equivalent (because you will see it in production):

```
frontend api_frontend
    bind *:443 ssl crt /etc/ssl/api.pem alpn h2,http/1.1
    default_backend api_backend
    acl is_orders path_beg /api/orders/
    use_backend order_service if is_orders

backend api_backend
    balance leastconn
    option httpchk GET /healthz
    http-check expect status 200
    server api1 10.0.1.10:8080 check inter 5s fall 3 rise 2 weight 100
    server api2 10.0.1.11:8080 check inter 5s fall 3 rise 2 weight 100
    server api3 10.0.1.12:8080 check inter 5s fall 3 rise 2 weight 50 backup
```

### 4. Data model

The LB itself is mostly stateless. The state it has is small and lives in memory:

```
BackendPool {
    name: string
    algorithm: enum { round_robin, least_conn, ip_hash, consistent_hash, ewma, weighted_rr }
    health_check: HealthCheckConfig
    backends: List<Backend>
}

Backend {
    id: string                        # "10.0.1.10:8080"
    address: ip + port
    weight: int                       # for weighted algorithms
    state: enum { healthy, unhealthy, draining, maintenance }
    consecutive_failures: int         # for active health check
    consecutive_successes: int        # for active health check
    in_flight_requests: atomic int    # for least_conn
    ewma_latency_ms: float            # for EWMA algorithm
    recent_5xx_count: ring_buffer     # for passive outlier detection
    last_check_at: timestamp
}

HealthCheckConfig {
    type: enum { http, tcp, grpc }
    path: string                      # for http; "/healthz"
    interval_ms: int                  # e.g., 5000
    timeout_ms: int                   # e.g., 1000
    unhealthy_threshold: int          # consecutive fails to eject
    healthy_threshold: int            # consecutive successes to re-add
    expected_status: List<int>        # [200] or [200, 204]
}

# For sticky sessions (optional, only if cookie-based stickiness is enabled)
StickyTable {
    map: ConcurrentMap<cookie_value, backend_id>
    ttl: duration                     # entries expire to allow rebalancing
}
```

Important properties:

- **All of this fits in RAM.** A pool of 1000 backends with full state is well under 1 MB.
- **Updated in-place by the health checker.** No DB. No external store. The LB's own process owns the state.
- **Replicated across LB instances only loosely.** Each LB instance does its own health checks and maintains its own state. They do not share an opinion on which backends are healthy. This is by design: if one LB's network path to a backend is broken but another's is fine, they should each route to whichever backends they personally can reach.

For cross-LB-instance state (sticky session affinity), the right answer is usually to not share state and let the cookie itself carry the backend ID (signed and encrypted by the LB so clients cannot tamper).

### 5. Core algorithm

The LB's core loop is tiny:

```python
def handle_connection(conn):
    """Called once per incoming TCP connection (L4) or per HTTP request (L7)."""
    pool = match_pool_by_host_or_port(conn)

    while True:
        backend = pool.pick_backend(conn)
        if backend is None:
            return respond_503(conn, "no healthy backends")

        # Try to forward. If forward fails (backend dead between health checks),
        # try the next one. Cap retries to avoid wasting time on a broken pool.
        try:
            backend.in_flight.increment()
            response = forward(conn, backend)
            backend.in_flight.decrement()
            record_outcome(backend, response.status, response.latency)
            return respond(conn, response)
        except BackendError as e:
            backend.in_flight.decrement()
            record_failure(backend, e)
            if retries >= pool.max_retries:
                return respond_502(conn, "backend exhausted")
            continue


def pick_backend(pool, conn):
    """The algorithm. Returns a backend or None if pool is empty."""
    healthy = [b for b in pool.backends if b.state == "healthy"]
    if not healthy:
        return None

    if pool.algorithm == "round_robin":
        return healthy[pool.rr_counter.next() % len(healthy)]
    elif pool.algorithm == "least_conn":
        return min(healthy, key=lambda b: b.in_flight.get())
    elif pool.algorithm == "ip_hash":
        h = hash(conn.client_ip) % len(healthy)
        return healthy[h]
    elif pool.algorithm == "consistent_hash":
        return pool.hash_ring.lookup(conn.routing_key)
    elif pool.algorithm == "ewma":
        # Pick the backend with the lowest predicted response time.
        return min(healthy, key=lambda b: b.ewma_latency_ms + b.in_flight.get() * EXP_REQ_MS)
    elif pool.algorithm == "weighted_rr":
        return pool.weighted_rr.next(healthy)
```

The health check loop runs in parallel:

```python
def health_check_loop(pool):
    """One goroutine/thread per backend (or one batched checker per pool)."""
    while True:
        for backend in pool.backends:
            try:
                ok = do_http_check(backend, pool.health_check)
            except Exception:
                ok = False

            if ok:
                backend.consecutive_successes += 1
                backend.consecutive_failures = 0
                if backend.state == "unhealthy" and backend.consecutive_successes >= pool.healthy_threshold:
                    backend.state = "healthy"
                    emit_event("backend.recovered", backend)
            else:
                backend.consecutive_failures += 1
                backend.consecutive_successes = 0
                if backend.state == "healthy" and backend.consecutive_failures >= pool.unhealthy_threshold:
                    backend.state = "unhealthy"
                    emit_event("backend.ejected", backend)

        sleep(pool.health_check.interval_ms)
```

Passive outlier detection runs in the request path:

```python
def record_outcome(backend, status, latency_ms):
    backend.ewma_latency_ms = ALPHA * latency_ms + (1 - ALPHA) * backend.ewma_latency_ms

    if status >= 500:
        backend.recent_5xx_count.push(1)
    else:
        backend.recent_5xx_count.push(0)

    # If the last N requests had >K 5xx, eject for base_ejection_time.
    if backend.recent_5xx_count.recent_sum() >= OUTLIER_5XX_THRESHOLD:
        # But not if it would push pool below max_ejection_percent
        if eligible_to_eject(backend.pool):
            eject_temporarily(backend, OUTLIER_EJECTION_TIME)
```

### 6. Architecture (the full stack)

```
                            User worldwide
                                 │
                                 ▼
                         ┌──────────────┐
                         │     DNS      │  Returns anycast IP, or
                         │  (Route 53,  │  geo-aware A record per region.
                         │   Cloudflare)│  TTL 60s for fast failover.
                         └──────┬───────┘
                                │
                                ▼
                  ┌────────────────────────────┐
                  │   Anycast IP via BGP        │  Same IP advertised from
                  │   (Cloudflare, AWS Global   │  every region. BGP routes
                  │   Accelerator, GCP Premium  │  client to nearest.
                  │   Tier)                     │
                  └─────────┬──────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
   ┌────────────┐     ┌────────────┐     ┌────────────┐
   │ Region:    │     │ Region:    │     │ Region:    │
   │  us-east   │     │  eu-west   │     │  ap-south  │
   │            │     │            │     │            │
   │ ┌────────┐ │     │ ┌────────┐ │     │ ┌────────┐ │
   │ │ Edge L4│ │     │ │ Edge L4│ │     │ │ Edge L4│ │
   │ │  LB    │ │     │ │  LB    │ │     │ │  LB    │ │
   │ │ (NLB,  │ │     │ │        │ │     │ │        │ │
   │ │  DDoS  │ │     │ │        │ │     │ │        │ │
   │ │ scrub) │ │     │ │        │ │     │ │        │ │
   │ └───┬────┘ │     │ └───┬────┘ │     │ └───┬────┘ │
   │     │      │     │     │      │     │     │      │
   │ ┌───▼────┐ │     │ ┌───▼────┐ │     │ ┌───▼────┐ │
   │ │ L7 LB  │ │     │ │ L7 LB  │ │     │ │ L7 LB  │ │
   │ │ (ALB,  │ │     │ │        │ │     │ │        │ │
   │ │ Envoy, │ │     │ │        │ │     │ │        │ │
   │ │ nginx) │ │     │ │        │ │     │ │        │ │
   │ │ TLS +  │ │     │ │        │ │     │ │        │ │
   │ │ path   │ │     │ │        │ │     │ │        │ │
   │ │ routing│ │     │ │        │ │     │ │        │ │
   │ └─┬──┬─┬─┘ │     │ └────────┘ │     │ └────────┘ │
   │   │  │ │   │     │            │     │            │
   │ ┌─▼┐┌▼┐┌▼┐ │     │            │     │            │
   │ │  ││ ││ │ │     │            │     │            │
   │ │api││au││st│    │            │     │            │
   │ │pl ││th││at│    │            │     │            │
   │ │ ││ ││ │ │     │            │     │            │
   │ └──┘└─┘└─┘ │     │            │     │            │
   │  service tier│   │            │     │            │
   │  pods (each  │   │            │     │            │
   │  with sidecar│   │            │     │            │
   │  Envoy for   │   │            │     │            │
   │  mesh)       │   │            │     │            │
   └──────────────┘   └────────────┘     └────────────┘
```

Layer responsibilities:

- **DNS.** First selection point. Returns one of several IPs (round-robin) or a single anycast IP. Geo-aware DNS (Route 53 latency routing) is a poor-man's geo-LB; works when anycast is unavailable.
- **Anycast.** Same IP advertised from every region via BGP. ISPs route each client to the nearest LB pool. Failover is automatic and silent: if a region's BGP session drops, traffic shifts to the next-nearest region in seconds.
- **Edge L4 LB.** First line. Terminates TCP, absorbs DDoS, hands off to L7. Often this is a managed service (AWS NLB, Cloudflare's edge). Optimized for packet throughput, not parsing.
- **L7 LB.** Where TLS termination usually lives. Parses HTTP, does path/host routing, applies per-route rate limits, injects forwarding headers. Examples: nginx, HAProxy, Envoy, ALB.
- **Service tier.** Each backend service has its own pool. The L7 LB routes to the right pool based on path.
- **Sidecar mesh (Envoy, Linkerd).** For service-to-service traffic inside the cluster. Each pod has its own Envoy sidecar; the sidecar is the LB for outbound traffic. Eliminates the central LB hop for internal calls.

### 7. Read and write paths

There are no "read" and "write" paths in the LB itself. There is one path: a request comes in, the LB picks a backend, forwards, returns the response. But the journey of one request through the full stack is worth tracing:

**A request from a user in Sydney to api.example.com.**

1. **DNS resolution.** Browser asks the local resolver for `api.example.com`. Resolver checks cache; if miss, walks the DNS hierarchy. Authoritative server (Route 53) returns an anycast IP. **Latency: cached <1ms, uncached ~30ms.**
2. **Anycast routing.** TCP SYN goes to the anycast IP. BGP routes it to the ap-south LB pool (geographically nearest from Sydney). **Latency: ~10ms RTT to ap-south.**
3. **Edge L4 LB.** SYN arrives. NLB picks one of N edge LB instances (5-tuple hash, so the same connection always lands on the same instance). The instance forwards to one of the L7 LB instances. **Latency: <1ms.**
4. **L7 LB: TLS handshake.** Client and L7 LB do TLS 1.3 handshake. If client has a session ticket, this is 0-RTT. If new, 1 RTT. **Latency: 0-15ms depending on resumption.**
5. **L7 LB: HTTP parse and route.** LB reads the request line and headers. Matches path `/api/orders/123` to the order_service pool. **Latency: <1ms.**
6. **L7 LB: backend selection.** Pool uses least-connections. LB picks order-service pod #7 (currently 3 in-flight, lowest in pool). **Latency: <1ms.**
7. **L7 LB → backend.** LB opens (or reuses, from a keepalive pool) a TCP connection to pod #7. Forwards the parsed request. Adds `X-Forwarded-For`, `X-Real-IP`, removes `Authorization` from logs. **Latency: <1ms LB-to-pod inside the same region.**
8. **Backend processes.** Order service runs the query. Returns 200 with JSON. **Latency: 5-50ms depending on what it does.**
9. **L7 LB returns to client.** Response streams back. LB may decompress and re-compress (rare; usually pass-through), or just stream bytes. **Latency: dominated by TCP send time for the response size.**

Total: ~30-100ms for a fresh client, ~10-50ms for a returning client with TLS resumption and DNS cache. The LB layers added maybe 5ms total in best case.

### 8. Scaling journey: 10 to 1M users

This is the section the interviewer cares about most. Four stages. Each is driven by a specific failure, not by anticipated load.

#### Stage 1: 100 users, single nginx, one backend

**What you build:**

```
[Browser] → [nginx :443] → [backend :8080]
```

That single nginx is already an LB. It is doing:

- TLS termination (so the backend can speak plain HTTP and not deal with certs).
- A trivial "round-robin across one backend" (no-op, but the config is ready).
- A trivial `/healthz` check, often nothing more than a TCP connect.

This is intentional. You put nginx in front from day 1 not because you need load balancing yet, but because:

- You can swap the backend (deploy a new version on port 8081, switch upstream, no DNS change).
- You can add a second backend later without restructuring anything.
- TLS termination is centralized; the backend's deploys do not need cert renewal.

**Cost.** ~$5/month for a t3.micro running nginx + backend, or even less on a hobby tier.

**What you do not build.** No health checker beyond TCP connect. No failover (the box dies, the service is down; for 100 users this is okay). No sticky sessions; backends are stateless.

#### Stage 2: 10k users, 3-5 backends, active health checks

**What just broke.**

- The single backend can no longer handle peak load. CPU pegs during traffic bursts.
- You want to deploy without downtime. Killing the backend takes the site down for ~30 seconds.

**What you add.**

- Scale backends to 3-5 instances. Same nginx in front.
- Algorithm: `least_conn`. Round-robin is okay but least-conn handles variable request times better.
- Active health checks every 5 seconds against `/healthz`. Eject after 3 failures, re-add after 2 successes.
- Backend deploys: rolling. Drain one backend at a time (set `down` in nginx config and reload; nginx finishes in-flight requests on it; you redeploy; bring it back).
- `proxy_next_upstream error timeout http_502 http_503;` so the LB transparently retries on a different backend if the first one fails.

```nginx
upstream api {
    least_conn;
    server 10.0.1.10:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:8080 max_fails=3 fail_timeout=30s;
    keepalive 32;
}
```

**What you do not yet build.**

- No second LB instance. One nginx is still the SPOF; for 10k users a 30-second DNS failover is acceptable for the rare event.
- No L4 in front. nginx alone is doing both TLS and L7 routing.
- No anycast or geo-routing. Single region.

**Cost.** ~$50-100/month: a small LB box plus 3-5 backend boxes.

#### Stage 3: 100k users, two-layer LB, regional managed LB

**What just broke.**

- TLS CPU on the single nginx is starting to bite. 500 new connections/sec at 2 ms each = 1 core just for handshakes.
- One nginx box is a SPOF you can no longer accept. A 30-second outage during failover is too much.
- The team is splitting the monolith into services (api, auth, search, static). The single nginx config is becoming a wall of `location` blocks.
- You start getting attention from script-kiddies. Some basic DDoS sponging would be nice.

**What you add.**

- **Managed cloud L7 LB at the edge** (AWS ALB, GCP HTTPS LB, or Cloudflare in front). It terminates TLS, absorbs basic DDoS, and routes to per-service target groups.
- **Internal L7 LB per service tier** (Envoy or nginx). Each service team owns their pool config. The edge ALB routes `/api/orders/*` to the orders pool, `/api/auth/*` to the auth pool, and so on.
- **Sticky sessions** for the few services that need them (cart, real-time UI). Cookie-based; LB injects `AWSALB` or similar cookie that pins the user to a backend for 1 hour. If the backend dies, the cookie is reissued.
- **Active-active LBs.** ALB by default is multi-AZ; if you run your own LB, run ≥2 instances behind a VIP (keepalived) or behind another DNS round-robin.
- **HTTP/2 between client and LB.** Cuts new-connection rate by ~10x for browsers (one TCP carries many requests).

Configuration sketch (Envoy for the L7 tier):

```yaml
static_resources:
  listeners:
    - address: { socket_address: { address: 0.0.0.0, port_value: 8080 } }
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                http_filters: [ { name: envoy.filters.http.router } ]
                route_config:
                  virtual_hosts:
                    - name: api
                      domains: ["*"]
                      routes:
                        - match: { prefix: "/api/orders/" }
                          route: { cluster: orders_cluster }
                        - match: { prefix: "/api/auth/" }
                          route: { cluster: auth_cluster }
                        - match: { prefix: "/" }
                          route: { cluster: web_cluster }
  clusters:
    - name: orders_cluster
      type: STRICT_DNS
      lb_policy: LEAST_REQUEST
      load_assignment:
        cluster_name: orders_cluster
        endpoints:
          - lb_endpoints:
              - endpoint: { address: { socket_address: { address: orders.svc, port_value: 8080 } } }
      health_checks:
        - timeout: 1s
          interval: 5s
          unhealthy_threshold: 3
          healthy_threshold: 2
          http_health_check: { path: "/healthz" }
      outlier_detection:
        consecutive_5xx: 5
        base_ejection_time: 30s
        max_ejection_percent: 50
```

**What you do not yet build.**

- No global LB. Still one region. Users in Asia pay the latency tax to reach us-east; if that is unacceptable you go to stage 4 early.
- No sidecar mesh. Service-to-service still goes through the L7 LB or direct DNS.

**Cost.** ~$1-5k/month: ALB at ~$25/month + per-GB charges (~$0.008/GB), internal LB pods, more backends.

#### Stage 4: 1M users, global LB + regional + local + sidecar mesh

**What just broke.**

- Users in Asia, Europe, Americas all need <100ms latency. A single us-east LB cannot do this.
- TLS handshake CPU at 30k req/s is now thousands of dollars/month if you run your own. Managed TLS termination is cheaper per byte.
- Service-to-service traffic is hitting the L7 LB on the way out and back. Internal latency budgets are eaten by LB hops.
- Cross-region failover during regional outages takes too long (DNS TTL is the bottleneck).

**What you add.**

- **Global LB (anycast or geo-DNS).** Cloudflare, AWS Global Accelerator, GCP Premium Tier. Same IP, routed by BGP to the nearest healthy region. Failover is sub-second (BGP withdrawal) rather than DNS-TTL-bound.
- **Regional LBs** stay the same as stage 3 (ALB / Envoy / nginx). The global LB hands traffic to whichever regional LB is healthiest.
- **Sidecar mesh (Envoy, Linkerd, Istio).** Every pod gets a sidecar proxy. Service-to-service calls go pod → local sidecar → remote sidecar → remote pod. The sidecar is the load balancer for outbound. Eliminates the central L7 hop for internal traffic. Adds 1-2 ms per hop but gains: per-service mTLS, retries, circuit breakers, observability per call.
- **Bounded-load consistent hashing** for any backend pool with stateful affinity (cache nodes, session-affinity tiers). Spreads hot keys.
- **TLS offload to hardware or SmartNIC** at the edge. AWS NLB with TLS or dedicated TLS proxies. Cuts CPU on the L7 LB tier substantially.
- **Slow start for new backends.** When a backend joins the pool, ramp its weight from 0 to 100% over 30 seconds. Prevents cold caches from getting hammered.

Each layer adds latency:

| Layer | Latency added | What you gain |
|-------|---------------|---------------|
| DNS + Anycast | ~5-20ms (first connect only) | Geo-routing, regional failover |
| Edge L4 | <1ms | DDoS scrubbing, TLS offload |
| Regional L7 | 1-3ms | Path routing, TLS, per-route policy |
| Sidecar | 1-2ms per hop | mTLS, observability, retries |
| Backend pod | request time | the actual work |

So a request crosses three or four LB layers before hitting the backend. Each adds latency in exchange for a specific control point. The trade-off is explicit; you do not add a layer "in case."

**Cost.** ~$10-100k/month depending on bandwidth, regions, and how much of the stack is managed.

#### What you would do at 10x scale (10M+ users)

Honestly, the architecture above is what FAANG companies run. At 10M+ you are not changing topology; you are doing more of the same: more regions, more sophisticated outlier detection, custom-built LBs (Google's Maglev, Facebook's Katran) instead of off-the-shelf because you save real money on CPU. The interesting work shifts from "design the LB" to "tune the LB at scale": kernel bypass (DPDK, XDP), zero-copy forwarding, custom NIC offloads. None of that changes the interview answer.

### 9. Reliability

**The LB itself dies.** Covered in question.md Step 6. The two patterns: active-passive VIP with keepalived (one LB does work, one stands by, ~1-second failover) and active-active with anycast (all LBs do work, BGP shifts traffic on failure, sub-second).

**A backend dies.** Active health checks detect within 1-3 intervals (5-15 seconds). The LB stops sending it new requests. In-flight requests on the dead backend may fail; `proxy_next_upstream` retries them on a healthy backend.

**The whole backend pool dies.** Outlier detection's `max_ejection_percent: 50` ensures the LB never ejects everyone. Worst case: the LB returns 503 to clients while a human investigates. Better the LB tells the truth (503) than tries to forward to nowhere and hangs.

**A backend is alive but slow.** This is the dangerous one. Active health checks pass (it answers `/healthz`); passive checks pass (it returns 200s, just slowly). The slow backend accumulates connections; with round-robin you keep sending it more. The fix: `least_conn` naturally avoids it (it has the most in-flight). EWMA explicitly avoids it (it has the worst latency). Add request timeouts at the LB so a slow backend cannot tie up LB threads indefinitely.

**Cascading failure / thundering herd.** Backend A is slow. The LB ejects it. Its traffic flows to B and C, which now run hot. They get slow. The LB ejects them. Now no backends. The LB 503s. Clients retry, overwhelming the next backend that comes up.

Mitigations:
- `max_ejection_percent: 50`. Never eject everyone.
- Circuit breakers on the backend side: when load > threshold, return 503 immediately (cheap) instead of trying to serve (expensive). This is faster than the LB timing out.
- Client-side retries with exponential backoff and jitter, not tight loops.
- LB-side request hedging *carefully*. Hedging (send the same request to a second backend if the first is slow) can either save tail latency or melt down a pool. Use only with caps.

**DNS failure / regional outage.** If a region is BGP-withdrawn, anycast handles failover automatically. If DNS fails (rare), clients with cached entries continue working until TTL expires; new clients are stranded. This is why DNS TTL matters: 60 seconds is the usual production setting.

**TLS cert expiry.** A cert silently expiring takes the whole service down. Automate renewal (Let's Encrypt + cert-manager) and alert on certs expiring within 30 days.

### 10. Observability

What you must instrument from day one:

| Metric | Why |
|--------|-----|
| `lb.request.rate` per backend | The headline distribution metric; uneven values mean uneven balancing |
| `lb.request.error_rate` per backend | Single backend spiking errors = candidate for ejection |
| `lb.request.latency` p50/p95/p99 per backend | Find slow backends before EWMA / outlier ejects them |
| `lb.healthy_backend_count` per pool | Drops below threshold = page someone |
| `lb.ejected_backend_count` per pool | Spikes = something pool-wide is wrong, possibly the health check itself |
| `lb.tls.handshakes_per_sec` | TLS CPU bound; this is what tells you when to scale or offload |
| `lb.tls.session_resumption_rate` | If low (<70%), clients are not benefiting from session tickets |
| `lb.connection.active_count` | File descriptor and memory pressure indicator |
| `lb.connection.new_per_sec` | Should be much less than request rate (keep-alive working) |
| `lb.upstream.retry_rate` | If high, backends are flaky; the LB is masking it |
| `lb.upstream.queue_depth` | Requests waiting for an upstream connection |
| `lb.bandwidth.in / out` | NIC saturation watch |

Per-route in addition to per-backend: `lb.request.rate{path="/api/orders/*"}`. Lets you see if one route is overwhelming the pool.

Alerting:
- Page: healthy_backend_count < 50% of total for 1 min; LB instance unresponsive; TLS handshake error rate > 1%.
- Ticket: latency p99 regression > 30%; ejected_backend_count > 0 sustained for 10 min; bandwidth > 70% NIC capacity.

### 11. Common gotchas

1. **Sticky sessions and uneven load.** Cookie-stickiness means once a user is pinned, they stay pinned. Power users (admins, long sessions) accumulate on the same few backends, which then run hot. Fix: cap session TTL, allow re-balancing on backend changes, prefer stateless backends with shared session store over stickiness when possible.
2. **Slow backends starving worker threads.** nginx has a fixed worker pool. A slow backend ties up workers blocked on its response. Other clients queue. Fix: aggressive `proxy_read_timeout`, `proxy_connect_timeout`. Eject slow backends with outlier detection on latency, not just on 5xx.
3. **TLS termination CPU cost.** Each handshake costs CPU. ECDSA certs are ~5x cheaper than RSA at the same security level. TLS 1.3 with session tickets gets you 0-RTT for returning clients. Without these, your LB CPU climbs linearly with new-connection rate and you scale horizontally for no good reason.
4. **HTTP/2 changes the load picture.** One TCP connection carries many concurrent requests. `least_conn` counts connections, but the heavy backend has the same connection count as the idle one (1 each). You need to count *active requests* (Envoy calls this `LEAST_REQUEST`), which means the LB has to parse HTTP/2 frames. With HTTP/1.1, least_conn worked because connections = active requests.
5. **`X-Forwarded-For` trust.** Backends often log `X-Forwarded-For` as the "real" client IP. If the LB does not strip incoming `X-Forwarded-For` and append its own value carefully, a malicious client can spoof their IP. Always set `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` (nginx appends; does not replace), and on the backend trust only the rightmost N IPs where N = number of trusted proxy hops.
6. **Health check thundering herd.** 100 LB instances each polling 1000 backends every 5 seconds = 20k req/s of `/healthz` traffic to the backends. If health checks are deep (DB query), they can DoS your own DB. Fix: shallow health checks for LB polling; deep checks for monitoring dashboards.
7. **DNS round-robin and TTL.** Browsers cache DNS aggressively (sometimes forever). DNS round-robin is "load balancing in expectation," not enforcement. Do not rely on it for failover; the right tool is anycast or LB-level failover.
8. **Draining and graceful shutdown.** When you remove a backend, it must stop accepting new requests but finish in-flight ones. Most LBs have a "drain" state for this. If you skip it and just kill the backend, you drop the requests that were in flight.
9. **Anycast and connection state.** Anycast routes by BGP, which can re-route mid-connection if a route flaps. Long-lived TCP connections (WebSockets, gRPC streams) can break. Mitigation: anycast is fine for the SYN; pin the connection to a specific LB IP for the duration with an HTTP 302 or a TCP-level mechanism (some clouds offer "client affinity" on the global LB).
10. **WebSockets and round-robin.** A WebSocket is one long connection. Round-robin distributes the *initial connect* evenly; once connected, all the traffic over that connection lives on one backend forever. If user A connects to backend 1 and chats for 6 hours, backend 1 carries A's load for 6 hours. Use `least_conn` for the initial connect and accept that you will have some imbalance; rebalance on disconnect.

### 12. Follow-up answers

**1. Sticky sessions and uneven load.**

Cookie-based stickiness gives perfect affinity but creates skew when power users cluster. Options, in order of how much you give up:

- **Cap session TTL.** Re-balance after, say, 1 hour. Brief inconvenience to the user (cart sometimes re-resolves) in exchange for periodic rebalance.
- **Bounded-load stickiness.** If the target backend is at >1.25x average load, fall back to a different backend and re-emit the cookie. Slightly disrupts stickiness for the unlucky few but caps the imbalance.
- **External session store.** The backend becomes stateless; sessions live in Redis. Now any backend can handle any request. Pays a Redis hop per request (~1ms), but the LB is back to round-robin or least-conn. This is the right answer for new systems; legacy systems often cannot pay the rewrite cost.

The choice depends on what the session contains. Tiny session (auth token): externalize. Large session (in-progress workflow with megabytes): stickiness, accept the skew, monitor and intervene manually for outliers.

**2. TLS termination CPU cost.**

In order of cost:

1. **Use TLS 1.3 with session tickets.** Returning clients do 0-RTT. ~10x cheaper than fresh handshakes. Free; just enable.
2. **Use ECDSA certs instead of RSA.** ECDSA-P256 is ~5x faster than RSA-2048. Free; cert change only.
3. **Tune session resumption cache.** Bigger SSL session cache holds more clients between visits. ~$0 in CPU; some RAM.
4. **Scale the LB horizontally.** More LB instances = more cores doing handshakes. Linear cost in instances.
5. **TLS offload to a dedicated tier.** Run a TLS-terminating proxy in front (haproxy, NGINX), L7 LB behind it speaks plain HTTP. Splits the CPU burden cleanly.
6. **SmartNIC / ASIC offload.** Some cloud providers offer hardware TLS offload (AWS Nitro, Cloudflare's stack). Highest fixed cost, lowest per-handshake cost. Only worth it at very high handshake rates (>10k/sec).

Most teams stop at step 3 or 4. Steps 5-6 are for serious scale.

**3. HTTP/2 multiplexing and least connections.**

With HTTP/2, each client opens *one* TCP connection and multiplexes many requests over it. The LB's `least_conn` algorithm sees: every backend has 1 connection. The first backend (lowest ID) consistently wins ties; all new connects land there. After warm-up, one backend has 100 connections, the others have 1 each.

Fix: switch from "least connections" to "least active requests." Envoy's `LEAST_REQUEST` does this. nginx's `least_conn` is too literal with HTTP/2. The LB must parse HTTP/2 frames and count in-flight streams per backend, not connections.

If the LB is L4 and cannot parse HTTP/2, switch the algorithm to consistent hashing on a per-request key (e.g., `:authority` header) or move to an L7 LB.

**4. WebSockets and uneven distribution.**

WebSocket connect is one round trip; after that, the LB just shuffles bytes. Users connect once and stay connected for hours. If you have 10k users and 5 backends with round-robin, the *initial distribution* is even (2k per backend), but as users disconnect and reconnect over hours, the distribution drifts based on disconnect patterns. If a backend bounces (deploy, crash), all its connections reconnect and round-robin sends them all to the next backend, doubling its load.

Fixes:
- `least_conn` for the connect. Backends that accumulated more get fewer new ones.
- Drain gracefully on backend bounce. Close connections in waves over several minutes, not all at once.
- Cap connections per backend. If backend hits 5k connections, the LB stops sending new ones (returns 503; client retries to a different backend).
- Consider a dedicated WebSocket gateway layer separate from your HTTP LB. Different scaling story; different operational model.

**5. Slow backend starving the pool.**

`least_conn` is the simplest fix. The slow backend accumulates connections; once it has more in-flight than the others, the LB stops sending it requests. It naturally drains.

Combine with:
- `proxy_read_timeout 30s` (or whatever your hard cap is). After 30s, the LB gives up, frees the worker, and the request fails. Better than tying up a worker forever.
- Passive outlier detection on latency: if a backend's p99 is >3x pool median for 1 minute, eject for 30 seconds. Let it cool off. Bring back gradually.
- Backend-side circuit breaker: when the backend's own dependency (slow disk, slow DB) is detected, return 503 immediately rather than serving slowly. The LB ejects, the backend recovers, the LB re-admits.

EWMA explicitly avoids slow backends but is harder to tune. Start with `least_conn` + timeouts.

**6. DNS TTL.**

Long TTL: clients cache DNS for longer, fewer DNS queries, but slower to react to changes.
Short TTL: clients re-resolve often, faster failover, more DNS load.

Production default: 60 seconds. Failover happens within 1-2 minutes worst case. Some traffic-heavy services use 30s. Internal services where you have more control can use longer (300s).

For emergency LB IP changes: drop TTL to 30s 24h before the change so the resolver caches have short TTLs by the time you flip the record. After the change, raise TTL back.

The real fix is to not change LB IPs. Anycast IPs do not change; they just stop being advertised from a failed region. The IP-change problem is mostly a non-anycast problem.

**7. Cross-region failover.**

Layers, top to bottom:

1. **Anycast (if used).** BGP advertisement from the failed region is withdrawn (manually or automatically by health check). Routers learn within seconds; clients are silently routed to the next-nearest region. Sub-second failover for clients on networks with good BGP convergence; up to 30s on slow networks.
2. **Geo-DNS (if used instead of anycast).** Route 53's latency-routing or geolocation policies have health checks. When us-east health check fails, Route 53 returns eu-west's IP. Failover bound by DNS TTL (60s).
3. **Regional LB.** Each region's LB is internally HA. Failure within a region is handled by the regional LB.
4. **Client retries.** Clients with cached DNS still hit us-east for up to TTL seconds. They get timeouts/connection-refused and retry; SDKs with retry logic eventually succeed against eu-west.

End-to-end: anycast = ~5-30s; geo-DNS = ~60-300s. The slowest piece is whatever your DNS TTL is.

**8. Path-based routing for monolith split.**

Add a route to the L7 LB:

```nginx
location /api/orders/ {
    proxy_pass http://order_service;
}
location /api/ {
    proxy_pass http://monolith;
}
```

The order matters; more specific paths first.

Migration plan to avoid breaking clients:
- Phase 1: deploy `order_service` running in parallel with the monolith. Both can handle `/api/orders/*`.
- Phase 2: add the LB route but with a small weight (5%) using `split_clients`:
  ```nginx
  split_clients "${request_id}" $backend {
      5%     order_service;
      *      monolith;
  }
  ```
- Phase 3: monitor metrics. If order_service handles 5% cleanly, raise to 25%, then 50%, then 100%.
- Phase 4: remove order-handling from the monolith. Route 100% of `/api/orders/*` to order_service.

This is the strangler-fig pattern. The LB is the cutover point. Rollback is one config change.

**9. Health check storm.**

200 LB instances × 500 backends ÷ 5s = 20k req/s on `/healthz`. If the health check is deep (queries DB), you DoS your own DB.

Fixes:
- **Shallow health check.** `/healthz` returns 200 from the process. Cheap. Catches process death, not deep issues. Deep checks (DB connectivity) run on a slower interval (60s) and report to a different system, not the LB.
- **EDS / xDS push instead of pull.** Modern LBs (Envoy) can subscribe to a service-discovery system that *pushes* updates. The LB is told "backend X is unhealthy" by the discovery system. The discovery system does the actual health checking centrally (once, not 200 times). Cuts traffic by 200x.
- **Sampling.** Each LB only checks a random subset of backends each interval; rotates over time. Cuts per-backend load proportionally.
- **Outsource to the platform.** In Kubernetes, the `kubelet` runs liveness/readiness probes once per node; the LB watches Endpoints. Backends are health-checked once by the platform, not N times by N LBs.

In practice, EDS/xDS plus shallow checks gets you 99% of the way. The platform handles the rest.

**10. LB dropping connections during a deploy.**

Two failure modes:
- New backends register and start receiving traffic before they are warm. First requests hit a cold cache or unfinished init; clients see errors.
- Old backends are killed mid-request. In-flight requests fail.

Correct deploy sequence:

1. **New backend starts.** Process boots. App initializes (connects to DB, warms caches, etc.).
2. **Readiness probe.** Backend's `/ready` returns 503 until init finishes. Kubernetes/LB does not include it in the pool until `/ready` returns 200. This is separate from `/healthz`, which only indicates liveness.
3. **Slow start.** LB ramps the new backend's weight from 0 to 100% over 30 seconds. Avoids hammering a cold backend.
4. **Old backend drain.** Mark the old backend `draining`: no new connections accepted; in-flight requests finish.
5. **Old backend stop.** After drain timeout (e.g., 30 seconds), kill the old backend. If a request is still in flight after 30s, it gets dropped (acceptable; clients retry).
6. **Repeat per backend.** Rolling update: never lose more than (replicas - max_unavailable) at once.

Kubernetes does most of this with readiness probes + `preStop` hooks + `terminationGracePeriodSeconds`. Envoy and Istio do slow-start when configured. The mistake is skipping any of: readiness probe, slow start, drain. Each skipped step is a class of dropped requests.

### 13. Trade-offs and what a senior would mention

- **Hardware LB vs software LB vs cloud-managed.**
  - *Hardware* (F5, Citrix NetScaler): high upfront cost, very high throughput per unit, complex to operate, locked to one vendor. Common in enterprises with regulatory requirements.
  - *Software* (nginx, HAProxy, Envoy): commodity hardware, OSS, full control, you operate it. Default choice for most teams.
  - *Cloud-managed* (ALB, GCLB): zero operations, pay per request and per GB, less flexible config. Default for cloud-native teams below a certain bandwidth bill. Above a certain bill (~10s of TB/month outbound), self-managed is cheaper.

- **L4 vs L7.** L4 is faster, cheaper, and dumber. L7 is slower, more expensive, smarter. Pick L7 if you need anything HTTP-aware (path routing, cookies, headers, per-route policy). Pick L4 for raw TCP or when you specifically need the throughput and don't need parsing.

- **Sidecar mesh vs centralized LB.** Centralized: one LB tier in front of all services. Easy to reason about, single config point, single failure point. Sidecar: every pod has a proxy, decisions are local, full observability per call, more moving parts and more memory overhead (~50 MB per sidecar × thousands of pods = significant). Sidecar wins for service-to-service inside the cluster; centralized wins for ingress from the internet. Most large systems use both.

- **Sticky sessions vs stateless backends.** Stickiness is operationally simpler (no shared state to operate). Stateless is operationally cleaner (any LB algorithm works, any backend can serve any request). New systems should default to stateless with an external session store; legacy systems are often stuck with stickiness.

- **What I would revisit at 10x scale.**
  - Move to a custom LB if cloud LB costs dominate. Google built Maglev, Facebook built Katran for exactly this reason.
  - Push more logic into the sidecar mesh; let the central L7 do less.
  - Adopt TLS 1.3 with 0-RTT everywhere, even at internal hop boundaries.
  - Pre-compute hash rings for consistent-hash pools at config change time, not per-request.

### 14. Common interview mistakes

1. **Treating "load balancer" as a single thing.** The LB is layered. Saying "we use nginx" without acknowledging the DNS/anycast layer in front and the sidecar layer behind shows you have not thought about the topology.
2. **No mention of L4 vs L7.** Knowing the difference is the most basic concept question on this topic. Skipping it loses you the round.
3. **Round-robin everywhere.** Round-robin is the wrong default for variable-duration requests, HTTP/2, WebSockets, and pretty much any modern workload. `least_conn` (or its HTTP/2 equivalent, least active requests) is a better default.
4. **Ignoring sticky session costs.** Stickiness is easy to enable, hard to live with. Saying "we'll use cookie-based stickiness" without discussing the load skew and the backend-failover reshuffle is a junior answer.
5. **No mention of health check storms.** At any non-trivial scale, the LB tier polling backends becomes its own DoS vector. EDS/xDS (push) or platform-managed probes (Kubernetes) are the senior answer.
6. **Forgetting the LB is a SPOF.** Active-active anycast or active-passive VIP. Either is acceptable; not addressing it is not.
7. **TLS termination handwave.** "Terminate at the LB" is correct but incomplete. Mention session tickets, ECDSA, and at scale, hardware offload.
8. **Cascading failure / thundering herd not mentioned.** This is the most common production LB incident. `max_ejection_percent` and backend-side circuit breakers are the answer.
9. **No drain step in deploys.** Rolling deploys without drain drop requests. A senior candidate names readiness probes, slow start, and drain explicitly.
10. **Treating sidecar mesh as a buzzword.** If you mention service mesh, you should explain *why* (eliminates central LB hop for internal traffic; per-service mTLS and observability), not just *that*. Otherwise it sounds like architecture-by-fashion.

If you can hit 7 of these 10, you are interviewing at senior level on the topic. Most candidates miss L4/L7 framing, sticky session costs, and health check storms. Those three are what separate a thoughtful LB design from "we use nginx, it works."
{% endraw %}
