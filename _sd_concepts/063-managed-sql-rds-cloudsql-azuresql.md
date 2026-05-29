---
concept_id: 63
slug: managed-sql-rds-cloudsql-azuresql
title: "Managed SQL: RDS vs Cloud SQL vs Azure SQL"
tease: "Engine support, HA, backup, failover."
section: "Cloud Comparisons"
status: live
---

A managed SQL service runs Postgres, MySQL, or SQL Server for you: the cloud handles backups, replication, patching, failover, and (mostly) capacity. You handle schema, queries, and connection management. All three big clouds offer this, and the headline features look identical. The differences that matter are which engines they support natively, how failover actually works, what the limits are on big tables, and how much "managed" really means in practice.

## The three at a glance

```mermaid
flowchart TB
    subgraph RDS["AWS RDS"]
        direction LR
        R1[("engines: Postgres, MySQL, MariaDB,<br/>Oracle, SQL Server, Aurora")]:::server
        R2[("Multi-AZ for HA<br/>(sync replica)")]:::server
        R3[("Aurora: AWS-proprietary,<br/>up to 15 read replicas, separated storage")]:::server
    end

    subgraph CSQL["GCP Cloud SQL"]
        direction LR
        C1[("engines: Postgres, MySQL, SQL Server")]:::server
        C2[("HA via regional sync replica")]:::server
        C3[("AlloyDB for Postgres:<br/>Google's Aurora-equivalent")]:::server
    end

    subgraph ASQL["Azure SQL"]
        direction LR
        A1[("engines: Postgres, MySQL, MariaDB,<br/>Azure SQL Database (managed MS SQL)")]:::server
        A2[("Hyperscale tier: 100 TB,<br/>fast restore, fast read replicas")]:::server
        A3[("strong AD / Microsoft ecosystem integration")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## What actually differs

The flagship offerings (Aurora, AlloyDB, Hyperscale) are where each cloud has invested in proprietary differentiators:

- **AWS Aurora.** A MySQL- or Postgres-compatible engine where storage is decoupled from compute. Replication is at the storage layer; up to 15 read replicas; failover in seconds. Most "I need a serious database" deployments on AWS run on Aurora rather than vanilla RDS Postgres.
- **GCP AlloyDB.** Google's answer to Aurora; Postgres-compatible, columnar acceleration for analytical queries, replicated storage. Newer than Aurora, fewer features, but catching up.
- **Azure SQL Hyperscale.** Postgres or SQL Server with elastic compute and storage scaling to 100 TB; fast database copies; fast point-in-time restore.

The "vanilla" managed offerings (RDS Postgres, Cloud SQL Postgres, Azure Database for Postgres) are roughly equivalent: they run open-source Postgres with cloud-managed HA and backups.

```mermaid
flowchart TB
    F1["HA topology<br/>RDS Multi-AZ: sync replica, automatic failover (~30s)<br/>Cloud SQL HA: similar<br/>Azure: similar; Hyperscale adds zone-redundant compute"]:::infra
    F2["Backup + PITR<br/>All three offer point-in-time recovery to any second within retention<br/>Retention up to 35 days; longer with manual snapshots"]:::infra
    F3["Connection limits<br/>Same engine limits apply (Postgres ~5000 max connections by hardware)<br/>Each cloud offers a pooler: RDS Proxy, Cloud SQL Connector, Azure PgBouncer"]:::infra
    F4["Major-version upgrades<br/>All three support in-place upgrades, but the safe path is always:<br/>create new, replicate, test, cut over"]:::infra
    F5["Extensions / engine version<br/>RDS lags upstream Postgres by 6-12 months<br/>Cloud SQL slightly faster<br/>Azure varies"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

## When to pick which

```mermaid
flowchart TB
    Q1{"What is the workload?"}:::query
    A1["RDS or Aurora.<br/>AWS-native, broadest engine support,<br/>Aurora for serious Postgres / MySQL."]:::strong
    A2["Cloud SQL or AlloyDB.<br/>GCP-native, tight BigQuery integration,<br/>AlloyDB for serious Postgres."]:::strong
    A3["Azure SQL Hyperscale.<br/>Microsoft-native, best for SQL Server workloads,<br/>strong Hyperscale at large data sizes."]:::strong

    Q1 -->|"AWS, mixed workloads"| A1
    Q1 -->|"GCP, analytics-adjacent"| A2
    Q1 -->|"Microsoft, SQL Server, enterprise"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

For most teams: the right managed SQL is "whichever your cloud offers natively." The vanilla offerings are close enough that the differentiators (Aurora, AlloyDB, Hyperscale) become the real choice only when you start needing very large data, very high write throughput, or very fast failover.

## Common mistakes

- **Treating managed as "no DBA needed."** You still need to design schemas, index correctly, write good queries, monitor performance. Managed means the cloud handles HA, backups, and patching, not your application.
- **No connection pooler.** All three clouds have a managed pooler. Use it. See [Connection pooling](/practice/system-design/concepts/042-connection-pooling/).
- **One reservation forever.** Cloud-managed databases are sized; if your workload changes shape, the right instance size changes too.
- **Skipping read replicas.** A read replica is the cheapest way to offload reporting and analytics queries.
- **Major-version laziness.** Stuck on Postgres 11 forever because the upgrade is scary. Plan upgrade windows; new versions ship real performance improvements.
- **No PITR enabled.** Point-in-time recovery is a setting; without it, you can only restore daily snapshots. Always on.
- **Aurora / AlloyDB / Hyperscale without measuring.** They are more expensive. Use them when you need them, not by default.

## Quick recap

- All three clouds offer roughly equivalent managed Postgres / MySQL.
- The serious offerings (Aurora, AlloyDB, Hyperscale) add proprietary storage/compute decoupling for big workloads.
- HA topology, backup, PITR, and failover times are similar across the three.
- Pick by cloud first. Pick the flagship variant when you actually need it.
- A managed database still needs a pooler, indexes, and an upgrade plan.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
