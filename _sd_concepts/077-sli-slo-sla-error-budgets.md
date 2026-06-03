---
concept_id: 77
slug: sli-slo-sla-error-budgets
title: "SLI, SLO, SLA, and error budgets"
tease: "The language reliability engineers use to argue about how broken is too broken."
section: "Operational"
status: draft
---

SLI (Service Level Indicator) is the thing you measure. SLO (Service Level Objective) is the target you commit to internally. SLA (Service Level Agreement) is the contract you sign with a customer, almost always looser than the SLO. The error budget is what falls out: if your SLO is 99.9% availability over 30 days, you have 43 minutes and 12 seconds of "allowed" downtime. This page will cover the practical mechanics — how to pick an SLI that matches user experience (latency p99, error ratio, freshness), why "100% uptime" is the wrong goal, how teams use the remaining error budget to decide whether to ship risky changes or focus on reliability, the multi-window multi-burn-rate alerting that Google made standard, and the most common SLO mistakes (chasing nines that no user notices, choosing an SLI the on-call cannot influence, agreeing an SLA tighter than your SLO).

*Page coming soon.*
