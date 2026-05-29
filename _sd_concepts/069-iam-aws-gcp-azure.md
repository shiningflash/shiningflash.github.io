---
concept_id: 69
slug: iam-aws-gcp-azure
title: "IAM: AWS IAM vs GCP IAM vs Azure AD"
tease: "Permission models compared."
section: "Cloud Comparisons"
status: live
---

Every cloud has a system for "who can do what to which resource." AWS IAM, GCP IAM, and Azure (Entra ID, formerly Azure AD) all answer that question, and they all do it differently enough that knowledge transfers poorly. The same intention ("let this service read this bucket") is expressed in three different vocabularies, three different scope models, and three different audit shapes. This is the single largest cross-cloud knowledge gap, and the most common source of subtle privilege-escalation bugs.

## The three models compared

```mermaid
flowchart TB
    subgraph AWS["AWS IAM — policy-centric"]
        direction LR
        A1[("attach JSON policies to<br/>users / roles / groups / resources")]:::server
        A2[("policies list:<br/>Actions, Resources, Conditions")]:::server
        A3[("evaluation: explicit deny wins,<br/>otherwise allow if any policy permits")]:::server
    end

    subgraph GCP["GCP IAM — role-binding"]
        direction LR
        G1[("bind roles (collections of permissions)<br/>to principals on a resource hierarchy")]:::server
        G2[("hierarchy: organization → folder<br/>→ project → resource;<br/>policies inherit downward")]:::server
        G3[("roles can be predefined or custom")]:::server
    end

    subgraph AZ["Azure (Entra ID + RBAC)"]
        direction LR
        AZ1[("Entra ID handles identity<br/>(users, groups, service principals)")]:::server
        AZ2[("Azure RBAC assigns roles at<br/>management group → subscription → resource group → resource")]:::server
        AZ3[("strong on enterprise SSO,<br/>conditional access policies")]:::server
    end

    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## The same intent, three different shapes

"Let service A read objects from bucket B":

```mermaid
flowchart TB
    subgraph AWSP["AWS IAM"]
        direction TB
        A1["1. Create an IAM Role for service A"]:::infra
        A2["2. Attach this policy:<br/>{<br/>  'Action': 's3:GetObject',<br/>  'Resource': 'arn:aws:s3:::bucket-B/*'<br/>}"]:::infra
        A3["3. Service A assumes the role"]:::infra
        A1 --> A2 --> A3
    end

    subgraph GCPP["GCP IAM"]
        direction TB
        G1["1. Create a service account for A"]:::infra
        G2["2. Grant role on bucket B:<br/>roles/storage.objectViewer<br/>to the service account"]:::infra
        G3["3. Service A authenticates as the service account"]:::infra
        G1 --> G2 --> G3
    end

    subgraph AZP["Azure"]
        direction TB
        AZ1["1. Create a managed identity for A"]:::infra
        AZ2["2. Assign role on storage:<br/>Storage Blob Data Reader<br/>to the managed identity"]:::infra
        AZ3["3. Service A authenticates via managed identity"]:::infra
        AZ1 --> AZ2 --> AZ3
    end

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

The intent is the same; the vocabulary, scope, and tooling are very different. This is why "I am an AWS expert" does not automatically transfer to GCP or Azure.

## What actually differs

```mermaid
flowchart TB
    F1["Policy expressiveness<br/>AWS: most expressive (Conditions on tags, IP, MFA, ...)<br/>GCP: simpler, role-based, IAM Conditions for context-aware<br/>Azure: RBAC roles + custom roles + ABAC conditions"]:::infra
    F2["Hierarchy model<br/>AWS: flat (account is the boundary)<br/>GCP: org → folder → project → resource (deep inheritance)<br/>Azure: management group → subscription → resource group"]:::infra
    F3["Service identity<br/>AWS: IAM Roles (instance profile or IRSA on EKS)<br/>GCP: Service Accounts (Workload Identity on GKE)<br/>Azure: Managed Identities (system-assigned or user-assigned)"]:::infra
    F4["Cross-cloud federation<br/>AWS: OIDC federation (very common for GitHub Actions)<br/>GCP: Workload Identity Federation<br/>Azure: federated credentials"]:::infra
    F5["Audit log<br/>AWS: CloudTrail<br/>GCP: Cloud Audit Logs<br/>Azure: Activity Log + Entra ID sign-in logs"]:::infra

    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
```

The single biggest practical difference is **scope inheritance**. GCP's deep hierarchy means a role granted at the organization level applies everywhere below; this is powerful and dangerous. AWS's flat-per-account model is more verbose but less surprising. Azure sits in between.

## When to pick which

You almost never pick an IAM system standalone; you inherit it with the cloud. But the IAM model is one of the most important parts of "should we adopt this cloud":

```mermaid
flowchart TB
    Q1{"What is the use case?"}:::query
    A1["AWS IAM.<br/>If you want maximum policy expressiveness<br/>and the account-as-boundary mental model fits."]:::strong
    A2["GCP IAM.<br/>If hierarchical inheritance maps to your org structure<br/>(folders for teams, projects for environments)."]:::strong
    A3["Azure / Entra ID.<br/>If you're already running Active Directory,<br/>or need enterprise SSO and conditional access."]:::strong

    Q1 -->|"AWS-shaped"| A1
    Q1 -->|"GCP-shaped"| A2
    Q1 -->|"Microsoft / enterprise"| A3

    classDef query fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

## Common mistakes

- **Long-lived static credentials.** Use roles, service accounts, managed identities. Static keys age into incidents.
- **Wildcard permissions.** `Action: "*"` on `Resource: "*"` is the most common cloud security finding. Be specific.
- **No least-privilege review.** Permissions accumulate; nobody removes them. Run access reviews quarterly.
- **Personal IAM users in production.** Federate identity from your IdP (Okta, Entra, Google Workspace) and use roles. Personal users are an audit nightmare.
- **Inheritance surprises.** A role granted at the org level on GCP inherits everywhere. Inheritance is great until it isn't.
- **No audit log retention.** Audit logs are how you reconstruct an incident. Keep them for years; ship to cold storage if needed.
- **Mixing service identity with user identity.** A service should never use a user's credentials. Always its own machine identity.
- **Custom roles before measuring need.** Predefined roles fit 90% of cases. Custom roles are a maintenance burden.

## Quick recap

- AWS IAM: policy-centric, account-as-boundary, most expressive policies.
- GCP IAM: role-binding on a deep hierarchy with inheritance.
- Azure / Entra: identity + RBAC + strong enterprise SSO.
- The same intent looks completely different in each model.
- Use machine identities (roles, service accounts, managed identities). Never static keys.
- Audit logs and least-privilege reviews are not optional.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
