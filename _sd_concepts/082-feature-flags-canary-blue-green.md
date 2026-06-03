---
concept_id: 82
slug: feature-flags-canary-blue-green
title: "Feature flags, canary, blue-green: the three deployment safety patterns"
tease: "Ship the code without shipping the risk."
section: "Operational"
status: draft
---

Blue-green keeps two full copies of production and switches the load balancer between them on deploy: instant rollback, expensive infrastructure. Canary points a small fraction of real traffic at the new version first, watches the metrics, and ramps up only if nothing breaks: cheap, gradual, requires good metrics. Feature flags decouple "the code is deployed" from "the feature is on" so you can turn a feature off at any second without redeploying, and target it per user, per segment, per cohort: maximum control, real configuration debt. This page will walk through each pattern, when to use which, the canonical tools (LaunchDarkly, Split, GitHub Actions, Argo Rollouts, Spinnaker), what good metrics for a canary actually look like, the unreasonably common failure modes (canary served only to bots, flag config drift across environments, blue-green database migrations that aren't), and the rule of thumb for combining all three in a single deploy pipeline.

*Page coming soon.*
