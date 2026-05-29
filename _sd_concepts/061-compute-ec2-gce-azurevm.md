---
concept_id: 61
slug: compute-ec2-gce-azurevm
title: "Compute: EC2 vs Compute Engine vs Azure VM"
tease: "Pricing models, instance families, network egress."
section: "Cloud Comparisons"
status: live
---

All three clouds give you the same primitive: a virtual machine. You pick a size, a region, an image, and you get a Linux or Windows box charged by the hour or second. The mental model is identical. The differences that actually matter are pricing, instance variety, network performance, and the operational tooling around the VM. Most teams who feel "we picked the wrong cloud" discover the real problem was not understanding their own workload, not the cloud they chose.

## The three offerings at a glance

```mermaid
flowchart TB
    subgraph EC2["AWS EC2"]
        direction LR
        E1[("widest instance variety<br/>(M, C, R, X, P, G, ...)")]:::server
        E2[("spot, savings plans,<br/>reserved instances")]:::server
        E3[("deepest integration<br/>with the AWS ecosystem")]:::server
    end

    subgraph GCE["GCP Compute Engine"]
        direction LR
        G1[("simpler family naming<br/>(N, E, C, M, T, A)")]:::server
        G2[("sustained-use + committed-use<br/>+ preemptible")]:::server
        G3[("custom machine sizes<br/>(you pick exact CPU/RAM)")]:::server
    end

    subgraph AVM["Azure VM"]
        direction LR
        A1[("strong Windows / enterprise story")]:::server
        A2[("reserved + spot + Azure Hybrid Benefit")]:::server
        A3[("tight integration with AD,<br/>SQL Server, Windows licensing")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## The differentiators that actually matter

```mermaid
flowchart TB
    F1["Instance variety<br/>EC2 wins on raw count and specialty hardware<br/>(GPU, FPGA, ARM, Mac, HPC)"]:::infra
    F2["Custom sizing<br/>GCE alone lets you pick non-standard CPU/RAM combos<br/>(saves you from over-provisioning)"]:::infra
    F3["Sustained-use discount<br/>GCE applies it automatically; no commitment<br/>AWS and Azure require explicit reservations"]:::infra
    F4["Spot / preemptible<br/>All three offer it; GCE preemptibles are time-bounded (24h max)"]:::infra
    F5["Windows + AD ecosystem<br/>Azure dominates"]:::infra
    F6["Egress cost<br/>All three charge for outbound traffic<br/>Pricing varies; cross-region and internet egress add up fast"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

The most under-appreciated of these is **custom machine sizes on GCE**: if your workload actually needs 6 vCPU and 9 GB of RAM, you can ask for exactly that instead of paying for the standard "8 vCPU + 32 GB" instance one step up.

## Pricing models

All three clouds offer a similar matrix:

- **On-demand / pay-as-you-go.** Highest price, no commitment.
- **Reserved / committed-use.** 1- or 3-year commitment, 40-72% off, locked to family.
- **Spot / preemptible.** Spare capacity at 60-90% off, can be reclaimed at any time.
- **Savings plans (AWS) / sustained-use (GCE).** Either flexible commitment (AWS) or auto-applied discount for running long uptime (GCE).

The headline rates look similar; the lifecycle features differ:

- **AWS Savings Plans** are commitments to spend `$X/hour`, not to a specific instance family. Most flexible.
- **GCE sustained-use** kicks in automatically as a VM runs longer in a month. You do not have to pre-commit.
- **Azure Hybrid Benefit** applies existing Windows Server / SQL Server licences to cloud VMs. For shops with existing Microsoft licensing, this is large.

## When to pick which

```mermaid
flowchart TB
    Q1{"What is your ecosystem?"}:::query
    A1["AWS EC2.<br/>If you are already on AWS,<br/>or you need rare instance types."]:::strong
    A2["GCE.<br/>If you are on GCP, BigQuery,<br/>or want auto-applied discounts."]:::strong
    A3["Azure VM.<br/>If you are on Microsoft 365, AD,<br/>or have Windows licences to reuse."]:::strong

    Q1 -->|"AWS native"| A1
    Q1 -->|"GCP native, GKE, BigQuery"| A2
    Q1 -->|"Microsoft ecosystem"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

The honest answer for most teams is "the cloud you are already on." The compute primitive is similar enough across the three that switching for the VM service alone is rarely worth the cost of moving everything else with it.

## Common mistakes

- **Picking the wrong instance family.** Memory-optimised for a CPU-bound workload (or vice versa) doubles your bill for no benefit.
- **All on-demand forever.** Reservations or savings plans cut steady-state cost by 30-70%. Worth the commitment if your usage is predictable.
- **Forgetting egress.** Cross-region and internet egress are the silent line items that surprise teams. Budget for it.
- **Spot for stateful workloads.** Preemptible VMs can vanish in two minutes. Use them only for stateless, checkpointed, or batch work.
- **Manual instance management.** Auto-scaling groups (AWS), MIGs (GCE), VM Scale Sets (Azure) exist for a reason.
- **Ignoring custom sizing on GCE.** Standard-family overprovisioning is the most common waste on GCE.

## Quick recap

- Same primitive, three vendors. The compute layer is roughly equivalent across the three.
- EC2 has the widest instance catalogue; GCE has custom sizing and auto-discounts; Azure has the Windows / AD edge.
- Pick the cloud first, the instance type second. Cross-cloud moves rarely justify themselves at the compute layer alone.
- Reserve or commit when usage is steady; spot for batch; on-demand for spiky.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
