---
concept_id: 75
slug: api-gateway
title: "API Gateway (vs load balancer vs reverse proxy)"
tease: "What an API Gateway adds on top of a load balancer, and when you actually need one."
section: "Load Balancing"
status: draft
---

A load balancer routes a packet to a healthy backend. A reverse proxy terminates TLS and forwards a request. An API Gateway does both, then adds auth, rate limiting, request transformation, response caching, schema validation, request stitching, and a single client-facing contract for whatever microservice mess is behind it. Whether you need one depends entirely on how many backends you have, who calls them, and whether you want each backend to re-implement the same five concerns. This page will walk through what an API Gateway actually does that a plain LB does not, the canonical patterns (Backend-for-Frontend, request aggregation, protocol translation), where managed gateways (Kong, Apigee, AWS API Gateway, GCP API Gateway, Azure APIM) fit, the gotchas around latency and single-point-of-failure, and the heuristic for when "just an LB" is the right answer instead.

*Page coming soon.*
