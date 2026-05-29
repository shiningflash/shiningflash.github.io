---
concept_id: 51
slug: authn-vs-authz
title: "Authentication vs authorization"
tease: "Two different problems, often conflated."
section: "Security"
status: live
---

Authentication answers "who are you?" Authorization answers "are you allowed to do this?" They sound related, and they often live next to each other in code, but they are completely separate problems with completely separate failure modes. The bugs that matter come from mixing them up: an attacker who is authenticated as Alice can do everything Alice can do, even if "Alice" should not have been able to do most of it in the first place. Separating the two cleanly is one of the simplest, highest-leverage discipline moves in security.

## The two questions

```mermaid
flowchart TB
    subgraph AUTHN["Authentication — who are you?"]
        direction LR
        AN1(["request arrives"]):::client
        AN2[["verify identity<br/>(password, JWT, mTLS, OAuth token)"]]:::infra
        AN3[("identity =<br/>user_id 42")]:::store
        AN1 ==> AN2 ==> AN3
    end

    subgraph AUTHZ["Authorization — can user 42 do this?"]
        direction LR
        AZ1(["request to delete project 99"]):::client
        AZ2[["check permissions<br/>(role, ACL, policy)"]]:::infra
        AZ3[("decision:<br/>allow or deny")]:::store
        AZ1 ==> AZ2 ==> AZ3
    end

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

Authentication establishes **who** the caller is. Authorization decides **what** that caller may do. Every request to a protected system passes through both gates, in that order.

## The full path of a request

```mermaid
sequenceDiagram
    autonumber
    participant U as Client
    participant API as API gateway
    participant AN as Auth (identity)
    participant AZ as Authz (permissions)
    participant SVC as Resource service

    U->>API: DELETE /projects/99<br/>Authorization: Bearer <token>
    API->>AN: validate token
    AN-->>API: user_id = 42, ok

    API->>AZ: can user 42 delete project 99?
    AZ-->>API: deny  (user 42 is a viewer on this project)

    API-->>U: 403 Forbidden
    Note over U: 403 means "I know who you are,<br/>but you cannot do this."
```

The two HTTP status codes mirror the two checks:

- **401 Unauthorized:** we don't know who you are (authentication failed).
- **403 Forbidden:** we know who you are, but you cannot do this (authorization failed).

Returning the wrong code is a small bug; mixing the two checks in code is a big one.

## Common authentication mechanisms

How identity is established depends on the trust model:

- **Password + session cookie.** The classic web pattern.
- **JWT or signed token.** Stateless, common in APIs and SPAs. See [JWT vs session cookies](/practice/system-design/concepts/052-jwt-vs-session-cookies/).
- **OAuth / OpenID Connect.** "Sign in with Google" delegated identity. See [API key vs OAuth vs mTLS](/practice/system-design/concepts/054-api-key-oauth-mtls/).
- **API key.** Static long-lived credential for machine-to-machine or backend integrations.
- **mTLS.** Both sides present certificates; identity proved by the cert chain.

All of these answer the same question: "after the handshake, who is this caller?"

## Common authorization models

Once you know who is calling, you decide whether they may act. Several models have proven useful:

```mermaid
flowchart TB
    subgraph RBAC["RBAC — Role-Based Access Control"]
        direction LR
        R1["user → role → permissions<br/>e.g. user 42 is 'admin',<br/>admins can delete projects"]:::strong
    end

    subgraph ABAC["ABAC — Attribute-Based Access Control"]
        direction LR
        R2["user, resource, action, context<br/>e.g. 'allow if user.dept == resource.dept<br/>and action != delete<br/>and time in business hours'"]:::strong
    end

    subgraph REBAC["ReBAC — Relationship-Based Access Control"]
        direction LR
        R3["graph of relationships<br/>e.g. 'user owns project'<br/>'project belongs to org'<br/>used by Google Drive, GitHub permissions"]:::strong
    end

    subgraph ACL["ACL — Access Control List"]
        direction LR
        R4["per-resource list of who can do what<br/>e.g. project 99 → { user 42: read, user 7: admin }<br/>the old-school filesystem model"]:::strong
    end

    classDef strong fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

Most systems start with RBAC ("user has role"), add ABAC when context matters ("only during business hours, only from corporate IP"), and grow toward ReBAC when relationships matter (a Google Doc shared with three people). No single model is right for everything.

## The two failure modes

- **Confused deputy / privilege escalation:** authentication is fine, but authorization is missing or wrong. The user is genuinely user 42, but the code allows them to delete a project they should not own. The famous "/api/orders/{id}" endpoint that returns any order if you change the id.
- **Identity confusion:** authorization runs against the wrong identity. The caller pretended to be a different user, or the token belongs to another tenant, or "user 42" is actually a service account that should not be acting as a human.

Mixing the two checks in code makes both modes more likely. Separating them mechanically (an identity layer that hands a verified principal to the authorization layer) catches both.

## Where each check belongs

```mermaid
flowchart LR
    R(["request"]):::client
    LB[["Edge / gateway"]]:::infra
    APP[["Application"]]:::server
    DB[("Data store")]:::store

    R ==>|"1. TLS, basic edge checks"| LB
    LB ==>|"2. authn: who is this?"| APP
    APP ==>|"3. authz: can they do it?"| APP
    APP ==>|"4. row-level checks where needed"| DB

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef infra fill:#fef3c7,stroke:#a16207,color:#713f12,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
    classDef store fill:#e9d5ff,stroke:#7e22ce,color:#581c87,stroke-width:1.5px
```

Authentication often happens once at the edge or in a middleware: validate the token, attach a verified user object to the request, never trust the client's claim of identity again. Authorization happens **everywhere** something is being accessed: per endpoint, per operation, often per row when multi-tenant.

## Two scenarios

**Scenario one: a multi-tenant SaaS.**

A user signs in (authentication: their JWT is valid; user_id = 42; tenant_id = 7). They request `GET /projects/99`. Authorization needs to check two things: does project 99 belong to tenant 7, and does user 42 have read access to it within that tenant. If either check is missed, you have a cross-tenant data leak; this is the canonical SaaS security bug.

**Scenario two: a machine-to-machine API.**

A partner service authenticates with an API key (or, better, mTLS). Authorization is "this key is allowed to read inventory but not write." Same two questions, applied to a service instead of a human. The mechanics differ; the structure does not.

## What this connects to

- **JWT vs session cookies.** Two authentication delivery mechanisms. See [JWT vs session cookies](/practice/system-design/concepts/052-jwt-vs-session-cookies/).
- **API key vs OAuth vs mTLS.** Three authentication styles for different trust models. See [API key vs OAuth vs mTLS](/practice/system-design/concepts/054-api-key-oauth-mtls/).
- **Idempotency.** Sometimes used as a weak form of "did I already do this for this caller?" but it is not authentication. See [Idempotency](/practice/system-design/concepts/021-idempotency/).
- **Secrets management.** Where authentication credentials live, and how they rotate. See [Secrets management](/practice/system-design/concepts/055-secrets-management/).

## Common mistakes

- **Authorization-by-obscurity.** "Nobody will guess this URL" is not a security model.
- **Authentication implies authorization.** "They signed in, so they can see this." No. Different question.
- **Implicit tenant scoping.** Forgetting to check tenant on every query in multi-tenant systems is the most common SaaS data leak. Use database-level tenant filters as a backstop.
- **Returning 401 when you mean 403.** Tells the attacker which one they need to fix.
- **Authorization checks only in the UI.** The API is the security boundary. The UI is decoration.
- **No deny-by-default.** A new endpoint shipped without an authorization rule defaults to "allowed" in many frameworks. Always start from "deny" and explicitly allow.
- **Reusing identity across boundaries.** A token meant for the audit service shouldn't authorise actions on the billing service. Scope tokens narrowly.

## Quick recap

- Authentication: who are you? Once per session or request, at the edge.
- Authorization: can you do this? Every time, per resource, per action.
- 401 means "we don't know you." 403 means "we know you, no."
- Separate them in code. Defaults to deny.
- The most common bug is good authentication paired with absent or sloppy authorization.

This concept sits in **Stage 4 (Scaling and reliability)** of the [System Design Roadmap](/practice/system-design/roadmap/).
