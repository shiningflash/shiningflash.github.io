---
concept_id: 68
slug: cdn-cloudfront-cloudcdn-frontdoor
title: "CDN: CloudFront vs Cloud CDN vs Azure Front Door"
tease: "PoP coverage, edge functions, pricing."
section: "Cloud Comparisons"
status: live
---

A CDN is a cache at the network edge that brings content closer to your users. AWS CloudFront, Google Cloud CDN, and Azure Front Door are the three big-cloud offerings. They all do the same fundamental job, with similar PoP (point of presence) footprints, similar pricing structures, and increasingly similar edge-compute capabilities. The decision usually tracks "which cloud is the origin on?" because tight origin-integration is the one place these CDNs genuinely beat dedicated competitors like Cloudflare and Fastly.

## The three at a glance

```mermaid
flowchart TB
    subgraph CF["AWS CloudFront"]
        direction LR
        C1[("450+ PoPs globally")]:::server
        C2[("Lambda@Edge + CloudFront Functions<br/>for edge logic")]:::server
        C3[("tight S3, ALB, API Gateway integration")]:::server
    end

    subgraph GCN["GCP Cloud CDN"]
        direction LR
        G1[("Google's global load balancer<br/>doubles as the CDN")]:::server
        G2[("anycast IP for the whole network")]:::server
        G3[("tight GCS, GKE Ingress integration")]:::server
    end

    subgraph FD["Azure Front Door"]
        direction LR
        A1[("global edge with Azure network")]:::server
        A2[("Rules Engine + AFD Edge Functions")]:::server
        A3[("tight Azure App Service / AKS integration")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## What actually differs

```mermaid
flowchart TB
    F1["Edge compute<br/>CloudFront Functions: cheap, fast, JS only, simple<br/>Lambda@Edge: heavier, more languages, slower<br/>Cloud CDN: relies on App Engine / Cloud Run for edge logic<br/>Azure Front Door: Rules Engine + AFD Edge Functions"]:::infra
    F2["Origin shielding<br/>Multi-tier caching to reduce origin load<br/>CloudFront: explicit origin shield region<br/>Cloud CDN and Front Door: automatic with the global LB"]:::infra
    F3["Pricing structure<br/>All three charge: egress per GB + per request<br/>Egress price varies by region (Asia/SA more expensive)<br/>Edge function compute extra"]:::infra
    F4["WAF / DDoS<br/>All three integrate with their cloud's WAF<br/>(AWS WAF, GCP Cloud Armor, Azure WAF)"]:::infra
    F5["Custom domain / TLS<br/>All three free-issue certs (ACM, Google-managed, AFD-managed)<br/>HTTP/2 and HTTP/3 generally supported"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

The most under-appreciated edge feature is **CloudFront Functions** (note: not Lambda@Edge). They are JavaScript-only, sub-millisecond cold start, very cheap, and great for header rewriting, simple auth, A/B routing. Cloudflare Workers occupy the same niche cross-cloud and are often preferred for that reason.

## Cloudflare and Fastly: the cross-cloud options

Neither CloudFront, Cloud CDN, nor Front Door are dominant outside their own clouds. Cloudflare and Fastly own the cross-cloud CDN market and consistently rank higher on features (Workers' developer experience, Fastly's instant cache purge, both companies' security tooling).

If your origin is on AWS but you want best-in-class edge compute, Cloudflare Workers + AWS origin is a very common architecture. The cloud-native CDN is the right pick when origin-integration matters more than edge feature parity.

## When to pick which

```mermaid
flowchart TB
    Q1{"Where is the origin?"}:::query
    Q2{"Is best-in-class edge compute<br/>or DX a priority?"}:::query

    A1["CloudFront.<br/>Default for AWS origins (S3, ALB).<br/>Use CloudFront Functions for simple edge logic."]:::strong
    A2["Cloud CDN.<br/>Default for GCP. Anycast IP comes naturally with the global LB."]:::strong
    A3["Azure Front Door.<br/>Microsoft ecosystem; deep App Service integration."]:::strong
    A4["Cloudflare or Fastly.<br/>Cross-cloud, best edge DX,<br/>most aggressive feature pace."]:::strong

    Q1 -->|"AWS"| A1
    Q1 -->|"GCP"| A2
    Q1 -->|"Azure"| A3
    Q2 -->|"yes"| A4

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## Common mistakes

- **No cache-control headers.** The CDN cannot cache what your origin does not tell it to cache. Always send explicit Cache-Control.
- **Caching private content.** `Cache-Control: public` on a logged-in user's response leaks to the next user behind the same edge. Always use `private` for personalised content.
- **Caching errors.** A 500 cached for 5 minutes is a 5-minute outage. Set error response TTL to zero (or very short).
- **Treating purge as instant.** Purge propagation is seconds (Fastly) to minutes (CloudFront). Don't depend on "I purged it, so it's gone everywhere now."
- **No CDN in front of an API.** Even uncached API responses benefit from TLS termination at the edge and edge auth/rate limiting.
- **Forgetting cold edges.** A new region's first hit is a miss; for predictable launches, pre-warm by sampling traffic ahead of time.
- **No metrics on hit rate.** If you do not know your cache hit ratio, you do not know if your CDN is working. Track per-PoP and per-route.

## Quick recap

- All three big-cloud CDNs do the same job with similar PoP footprints.
- Pick the one matching your origin cloud for the tightest integration.
- Cloudflare and Fastly often beat all three on edge DX, especially for Workers / Compute.
- The biggest operational wins (cache headers, purge strategy, private content) are universal.
- CDN in front of static assets is universally a win; in front of APIs it requires more care but is still worth it.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
