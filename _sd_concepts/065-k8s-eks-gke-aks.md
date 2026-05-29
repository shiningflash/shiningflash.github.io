---
concept_id: 65
slug: k8s-eks-gke-aks
title: "Managed Kubernetes: EKS vs GKE vs AKS"
tease: "Control plane, upgrade story, networking."
section: "Cloud Comparisons"
status: live
---

A managed Kubernetes service runs the control plane (API server, scheduler, controller manager, etcd) for you, while you provide the worker nodes (or even let the cloud do that too). All three big clouds offer one. The application surface is identical Kubernetes; the differences are in the control plane SLA, how easily you can upgrade, networking model, integration with cloud-native services, and how much "managed" really means.

## The three at a glance

```mermaid
flowchart TB
    subgraph EKS["AWS EKS"]
        direction LR
        E1[("control plane fully managed,<br/>$0.10/hr per cluster")]:::server
        E2[("nodes: managed node groups,<br/>Fargate for serverless pods")]:::server
        E3[("CNI: AWS VPC-native CNI<br/>(each pod gets a real VPC IP)")]:::server
    end

    subgraph GKE["GCP GKE"]
        direction LR
        G1[("control plane managed,<br/>Autopilot mode hides nodes entirely")]:::server
        G2[("longest history; Kubernetes was born at Google")]:::server
        G3[("CNI: VPC-native,<br/>strong integration with GCP networking")]:::server
    end

    subgraph AKS["Azure AKS"]
        direction LR
        A1[("control plane managed,<br/>free in standard tier")]:::server
        A2[("strong AD integration,<br/>Azure-native networking")]:::server
        A3[("Workload Identity, Container Apps as a lighter alternative")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## The single biggest differentiator: GKE Autopilot

GKE has a mode called **Autopilot** that fully manages the nodes too. You define pods; Google handles provisioning, scaling, security patches, upgrades, and capacity. It is the closest to "real serverless Kubernetes." You pay per pod resource usage, not per node.

```mermaid
flowchart TB
    subgraph STANDARD["Standard mode (all three clouds)"]
        direction LR
        S1["you manage node pools:<br/>type, size, scaling rules, upgrades"]:::infra
        S2["control plane is managed;<br/>nodes are yours"]:::infra
    end

    subgraph AUTOPILOT["GKE Autopilot (unique)"]
        direction LR
        AU1["you don't see nodes at all"]:::strong
        AU2["pay per pod CPU/memory<br/>(not per node)"]:::strong
        AU3["Google handles capacity,<br/>upgrades, hardening"]:::strong
    end

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

EKS Fargate and AKS Virtual Nodes offer partial versions of this but with more limitations. For "I want Kubernetes but I do not want to think about nodes," Autopilot is the deepest implementation.

## What actually differs

```mermaid
flowchart TB
    F1["Upgrade story<br/>GKE: easiest, regular release channels<br/>EKS: manual control plane upgrades, careful coordination<br/>AKS: automated for control plane, manual for node pools"]:::infra
    F2["Networking / CNI<br/>EKS: VPC CNI (each pod has a VPC IP; IP exhaustion is a real concern)<br/>GKE: VPC-native, alias IPs (no IP exhaustion)<br/>AKS: Azure CNI or Kubenet"]:::infra
    F3["Identity / IAM<br/>EKS: IAM Roles for Service Accounts (IRSA)<br/>GKE: Workload Identity (tightest integration)<br/>AKS: Workload Identity (newer, on parity)"]:::infra
    F4["Cost<br/>EKS: $0.10/hr per cluster<br/>GKE: free or $0.10/hr (autopilot is per-pod)<br/>AKS: free standard tier; paid for SLA"]:::infra
    F5["Ecosystem integration<br/>EKS: deepest AWS integration<br/>GKE: deepest GCP integration<br/>AKS: deepest Azure integration"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

The often-overlooked **networking** difference matters at scale. EKS VPC CNI assigns each pod a real VPC IP, which is great for AWS service integration but exhausts subnet IP space fast. Large clusters need careful subnet planning or alternative CNIs (Cilium). GKE's alias IPs handle this more gracefully.

## When to pick which

```mermaid
flowchart TB
    Q1{"Which cloud are you on?"}:::query
    Q2{"Do you want to stop managing<br/>nodes entirely?"}:::query

    A1["EKS.<br/>AWS default. Deep IAM and AWS service integration.<br/>Plan for IP exhaustion at scale."]:::strong
    A2["GKE Autopilot.<br/>The closest to 'serverless Kubernetes'.<br/>Strong default for new GCP workloads."]:::strong
    A3["GKE Standard.<br/>Mature, best upgrade story.<br/>Strong choice if you want full node control."]:::mid
    A4["AKS.<br/>Microsoft ecosystem, AD integration,<br/>Container Apps for lighter workloads."]:::strong

    Q1 -->|"AWS"| A1
    Q1 -->|"GCP"| Q2
    Q2 -->|"yes"| A2
    Q2 -->|"no"| A3
    Q1 -->|"Azure"| A4

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef mid fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

For teams new to Kubernetes: GKE Autopilot has the gentlest learning curve. For teams already on AWS: EKS is the natural choice despite the operational tax. For Microsoft shops: AKS plus Container Apps covers most needs.

## When to skip managed Kubernetes

- Small team, simple workload. A few containers behind a load balancer (ECS Fargate, Cloud Run, Container Apps) is much simpler than Kubernetes.
- No need for the operator/CRD ecosystem.
- Predictable, low-traffic services.

Kubernetes is genuinely powerful and genuinely complex. "Use Kubernetes" should be a deliberate choice, not a default.

## Common mistakes

- **Kubernetes for everything.** Most small services do not need it. ECS, Cloud Run, App Service, and Container Apps are lighter and cheaper.
- **No upgrade plan.** Control plane and node versions both age. Skipping versions is harder; staying current is operational discipline.
- **EKS without IP planning.** VPC CNI exhausts /22 subnets quickly. Plan for /16s or use Cilium.
- **One huge cluster.** Multi-tenancy in Kubernetes is genuinely hard. Separate clusters per environment (dev/stage/prod) is the safer default.
- **Manual cluster management.** Terraform, Pulumi, or the cloud's IaC. Click-ops a cluster and you will pay for it later.
- **No GitOps.** Manual kubectl on prod ages badly. ArgoCD or Flux give you auditable, declarative state.
- **Forgetting cost.** Kubernetes is operationally expensive even at low utilisation. Watch idle node-hours.

## Quick recap

- All three offer managed control planes; the application surface is identical.
- GKE Autopilot is uniquely close to "serverless Kubernetes."
- Networking, upgrade story, and IAM are where the real differences live.
- Pick by cloud first. Skip Kubernetes entirely if a lighter container runtime fits.
- Plan for IP exhaustion (EKS), upgrade cadence, and multi-cluster strategy.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
