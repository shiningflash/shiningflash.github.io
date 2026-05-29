---
concept_id: 70
slug: observability-cloudwatch-cm-azuremon
title: "Observability: CloudWatch vs Cloud Monitoring vs Azure Monitor"
tease: "What each catches and where they fall short."
section: "Cloud Comparisons"
status: live
---

Each cloud ships a first-party observability stack: CloudWatch on AWS, Cloud Monitoring (Stackdriver) on GCP, Azure Monitor on Azure. Each one gives you metrics, logs, and (usually) traces, integrated with the cloud's own services and IAM. They are all serviceable; none of them dominate the dedicated observability market (Datadog, Honeycomb, New Relic, Grafana Cloud, Splunk). The question is rarely "which is best" but "first-party for the integration, third-party for the experience, or both."

## The three at a glance

```mermaid
flowchart TB
    subgraph CW["AWS CloudWatch"]
        direction LR
        C1[("Metrics, Logs, Alarms,<br/>X-Ray for traces")]:::server
        C2[("Logs Insights for log queries")]:::server
        C3[("automatic for AWS services;<br/>configurable for apps")]:::server
    end

    subgraph CM["GCP Cloud Monitoring + Logging"]
        direction LR
        G1[("Cloud Monitoring (metrics)<br/>Cloud Logging (logs)<br/>Cloud Trace (traces)")]:::server
        G2[("Log Explorer with structured queries")]:::server
        G3[("automatic for GCP services;<br/>OpenTelemetry-native")]:::server
    end

    subgraph AM["Azure Monitor"]
        direction LR
        A1[("Metrics, Log Analytics (KQL),<br/>Application Insights")]:::server
        A2[("KQL is unusually powerful<br/>(SQL-like, joins, summarise)")]:::server
        A3[("good integration with App Service / Functions")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## What each is genuinely good at

- **CloudWatch.** Metrics on every AWS service, automatically. Alarms wire cleanly into auto-scaling, EventBridge, SNS. Logs Insights is competent but the UI is dated.
- **Cloud Monitoring.** OpenTelemetry-native, clean integration with GKE, BigQuery sink for log analytics. The query language for logs is more straightforward than CloudWatch's.
- **Azure Monitor.** **KQL (Kusto Query Language)** is genuinely best-in-class for log analytics — SQL-like with first-class time-series operators. Application Insights is the strongest of the three for application-level tracing of .NET workloads.

## Where they all fall short

```mermaid
flowchart TB
    F1["Multi-cloud or hybrid<br/>None of the three handles non-native cloud well<br/>(cross-cloud aggregation is third-party territory)"]:::weak
    F2["Trace exploration<br/>Dedicated tools (Honeycomb, Datadog APM, Tempo)<br/>have richer high-cardinality trace UIs"]:::weak
    F3["Alert routing<br/>First-party alerting goes to email / SNS / PagerDuty<br/>Less flexible than dedicated tools (Datadog, Opsgenie)"]:::weak
    F4["Cost at scale<br/>All three charge per GB ingested + retention<br/>Log volumes can produce surprising bills;<br/>dedicated tools sometimes cheaper at scale"]:::weak
    F5["Dashboard UX<br/>All three lag dedicated tools (Grafana, Datadog dashboards)<br/>in expressiveness and shareability"]:::weak

    classDef weak fill:#fed7aa,stroke:#c2410c,color:#7c2d12,stroke-width:1.5px
```

The most common pattern in production: **first-party for infrastructure metrics + audit logs + cloud-native alerting; third-party for application observability + dashboards + incident response**.

## The hybrid pattern most teams adopt

```mermaid
flowchart TB
    CLOUD[("Cloud-native (CloudWatch /<br/>Cloud Monitoring / Azure Monitor)")]:::server
    APP[("Application code")]:::server
    OTEL[["OpenTelemetry collector"]]:::infra
    THIRD[("Third-party observability<br/>Datadog, Grafana Cloud, Honeycomb,<br/>New Relic, Splunk")]:::store

    CLOUD -->|"infra metrics,<br/>audit logs"| OTEL
    APP -->|"app metrics, logs, traces"| OTEL
    OTEL -->|"emit everything in one place"| THIRD

    UI(["Dashboards + alerting<br/>+ incident response"]):::client
    THIRD --> UI

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
```

This hybrid stack is now the dominant production pattern. OpenTelemetry makes the wiring portable: instrument once, ship metrics, logs, and traces to one or many destinations, swap backends without re-instrumenting.

## When to stay all-cloud-native

- Small team, single cloud, modest scale. The cloud's first-party stack is the path of least resistance.
- Compliance / data-residency requirements that complicate shipping data to a third-party SaaS.
- Cost discipline: third-party observability bills can exceed compute bills surprisingly fast.

## When to go third-party

- Multi-cloud or hybrid. Dedicated tools were built for this.
- Application observability matters more than infrastructure observability.
- The team values UI / dashboard quality and incident-response tooling.
- Per-engineer productivity gains from a better tool justify the price.

## Pick within each cloud

```mermaid
flowchart TB
    Q1{"Which cloud?"}:::query
    A1["CloudWatch + X-Ray (or third-party APM).<br/>For AWS-native default observability."]:::strong
    A2["Cloud Monitoring + Cloud Trace.<br/>For GCP. OpenTelemetry-friendly."]:::strong
    A3["Azure Monitor + Application Insights.<br/>For Azure. KQL gives the best log analytics."]:::strong

    Q1 -->|"AWS"| A1
    Q1 -->|"GCP"| A2
    Q1 -->|"Azure"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## Common mistakes

- **Cloud-native for application observability and dashboards.** The UIs are competent but rarely loved. Most teams outgrow them.
- **No correlation across services.** Without consistent trace IDs and request IDs, the three pillars do not connect during an incident.
- **Sending every log line.** Log volume drives cost. Sample debug, keep errors and audit at 100%.
- **No retention policy.** Logs and metrics retained forever at hot-tier prices. Tier to warm/cold; delete what is past compliance.
- **OpenTelemetry without a destination strategy.** OTel is the wiring; the backend is the decision. Pick one or two; do not multicast everywhere.
- **Manual instrumentation forever.** Auto-instrumentation libraries cover most frameworks today. Use them; only instrument by hand where they fall short.
- **Alerts on every metric.** Alert fatigue is real. Alert on user-facing symptoms, not on every internal signal.

## Quick recap

- All three clouds offer competent first-party observability stacks.
- KQL (Azure) is the best log query language of the three.
- Most production teams use a hybrid: first-party for infra + audit, third-party for application observability.
- OpenTelemetry is the portable instrumentation layer; pick the backend separately.
- Retention, sampling, and alert hygiene are the universal cost and signal disciplines.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
