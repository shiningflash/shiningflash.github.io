---
layout: practice-problem
track: system-design
problem_id: 11
title: Design an Approval Management Service
slug: 011-approval-management
category: Workflow
difficulty: Easy
topics: [state machine, role routing, delegation, escalation, audit trail]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/011-approval-management"
solution_lang: markdown
---

{% raw %}
## Scene

You sit down. The interviewer pushes a doc across the table.

> *"Every company has approval flows. Purchase orders need a manager and finance to sign off. Leave requests go to your boss. Expense reports go to your boss, then to finance, then to your boss again if finance pushes back. Code reviews go to two engineers. We want one service that handles all of these. Design it."*

They pause. "Start small. How would you build it for a 50-person company first. Then we'll grow it."

This question looks deceptively simple. Candidates who jump straight to "we'll have an `approvals` table with a `status` column" miss every interesting thing about it. The interesting bits are: how do you let teams *define* their own workflows without redeploying, how do you survive an approver leaving the company mid-request, how do you handle the moment when the same person is the requester and the approver, and how do you keep an audit trail that satisfies a compliance auditor years later.

We are going to walk this from a 50-person startup to a 100,000-person enterprise. At every step, something breaks. Naming what breaks before adding the fix is the actual exercise.

## Step 1: clarify before you design

Take 7 minutes. This problem has more dimensions than most. Aim for 8 to 10 questions.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Single workflow type or many?** "Is this just leave requests, or does the same service handle leave + expense + PO + code review?" The answer is almost always "many, please design for that." This is the single decision that drives 80% of the architecture. One workflow per service is easy; an *engine* that runs many workflow types defined by config is the actual problem.
2. **Who defines the workflows?** "Do engineers ship YAML for each workflow, or do admin users build them in a UI?" Determines whether you need a workflow definition store + UI + versioning, or whether workflows are baked into deploys.
3. **Step types.** "What can a step *do*? Just 'wait for human approval'? What about 'run a script', 'call an external API', 'wait 24 hours', 'auto-approve if amount < $100'?" Tells you whether your engine is a state machine or a full workflow runtime.
4. **Parallel vs serial.** "Can step 2 wait on three approvers in parallel and require all of them? Any of them? Two-of-three?" Parallel approval (with quorum) is a common request that breaks a naive serial-only model.
5. **Delegation and out-of-office.** "If Alice is on vacation, does her approval auto-route to Bob? Does Alice configure this herself, or is it organizational policy?" Delegation chains are a real production source of bugs.
6. **Escalation.** "If an approver does not act in 48 hours, what happens? Auto-approve? Escalate to their manager? Page them?" This is the SLA layer on top of the engine.
7. **Cancellation and edit.** "Can the requester cancel a request mid-flight? Can they edit the amount of a PO that has been partially approved?" Editing usually means resetting the workflow to the start. Cancellation needs to release any holds (e.g., budget reservation).
8. **Audit trail.** "How long do we retain decisions? Who saw the request? Is the audit log immutable? Are we under SOX, HIPAA, GDPR?" Compliance changes the storage and retention model dramatically.
9. **Notification scope.** "When a request is created, who gets notified? Email, Slack, in-app? Is the notification system part of this design?" Usually notification is a separate service; this design *emits events* and the notification service consumes them.
10. **Org structure.** "Does the service know about org hierarchy (manager-of, team-of, department-of)? Or does it call out to an HR system?" The router needs this info; whether it stores it or queries an HRIS changes the latency budget.

A strong candidate also names what is *not* in scope: payment execution, budget enforcement, contract signing. These are downstream of approval; the approval engine emits "approved" and someone else acts on it.

</details>

## Step 2: capacity estimates

The interviewer gives you the small-company answer:

- 50 employees today
- Average 5 approval requests per employee per week
- Most workflows have 1-3 approvers
- Each approver typically responds within 1 day

Compute:

1. Requests per day, per second
2. Average lifecycle of a request (created → fully approved)
3. Decisions per day (one decision = one approver acting)
4. Active requests at any given time (request created but not yet finalized)

Now do the same for a 100k-employee enterprise.

<details>
<summary><b>Reveal: the math at both scales</b></summary>

**50-person startup:**

- 50 × 5 = 250 requests per week = ~36 per day. About 1 every 40 minutes during business hours. *Trivial.*
- Avg lifecycle ~ 1 to 2 days.
- Decisions per day: 36 requests × ~2 approvers = 72 decisions per day. ~5 per business hour.
- Active requests at any moment: ~50 to 70 in flight.

You could literally build this with a Google Sheet and a cron job. Instead we build the right shape, because we are scaling it.

**100k-person enterprise:**

- 100k × 5 = 500k requests per week ≈ 71k per day ≈ ~1 per second sustained. Peak hour roughly 3x: ~3 per second.
- Lifecycle: 1 to 5 days depending on workflow type. Compliance workflows can last weeks.
- Decisions per day: 71k × ~3 approvers (enterprise workflows are longer) = ~210k decisions per day ≈ ~3 per second sustained.
- Active requests at any moment: 71k/day × ~3 day avg lifecycle = ~200k in flight at any moment.

**Key insights from the math:**

- The volume is *small* compared to consumer-scale problems. A single Postgres handles all writes fine. The interesting scale problem is not write throughput; it is **organizational complexity**: 5000 different workflow definitions, 50k different approver roles, hundreds of integrations.
- "Active requests in flight" is the meaningful metric. At 200k in flight you need indexes that let "show me my pending approvals" return in 50ms for every employee.
- Reads massively dominate writes. Every employee opens their dashboard ~10x per day to check status. That is 1M dashboard loads per day even at the enterprise scale. Caching the read path matters more than optimizing writes.

</details>

## Step 3: the workflow definition language

Before you draw any architecture, you have to decide *how a workflow is described*. This is the data structure your engine reads to know "what step comes next." If you get this wrong, every later feature is a hack.

Here is an intentionally incomplete workflow definition for a leave request. Fill in the `[ ? ]` placeholders. The placeholders mark concepts the language must support: parallel approval, conditional branching, escalation timer, delegation, and the auto-approve shortcut.

```yaml
workflow: leave_request
version: 3

inputs:
  - employee_id: string
  - start_date: date
  - end_date: date
  - days: int     # derived from start/end

steps:

  - id: auto_approve_short
    when: [ ? ]                          # condition: < 3 days
    action: approve
    note: "Short leaves auto-approved by policy."

  - id: manager_approval
    after: auto_approve_short
    type: approval
    approver: "{{ employee.manager }}"
    timeout: [ ? ]                        # escalate after N hours
    on_timeout: [ ? ]                     # what to do (escalate? auto-reject?)
    on_delegation: [ ? ]                  # if approver has set OOO, route to whom?

  - id: hr_and_grandboss
    after: manager_approval
    when: days > 14                       # only for long leaves
    type: [ ? ]                           # parallel: both must approve
    branches:
      - approver: "{{ employee.manager.manager }}"
      - approver: "hr-leave-admin"
    quorum: [ ? ]                         # all? any? 2-of-N?

  - id: finalize
    after: hr_and_grandboss
    type: terminal
    state: approved
```

<details>
<summary><b>Reveal: the completed workflow language</b></summary>

```yaml
workflow: leave_request
version: 3

inputs:
  - employee_id: string
  - start_date: date
  - end_date: date
  - days: int

steps:

  - id: auto_approve_short
    when: days < 3
    action: approve
    note: "Short leaves auto-approved by policy."

  - id: manager_approval
    after: auto_approve_short
    type: approval
    approver: "{{ employee.manager }}"
    timeout: 48h
    on_timeout: escalate                  # send to grandparent (manager's manager)
    on_delegation: follow                 # if Alice has OOO set to Bob, route to Bob

  - id: hr_and_grandboss
    after: manager_approval
    when: days > 14
    type: parallel
    branches:
      - approver: "{{ employee.manager.manager }}"
      - approver: "hr-leave-admin"        # role, not a user
    quorum: all                           # both must approve

  - id: finalize
    after: hr_and_grandboss
    type: terminal
    state: approved
```

**The language has to support five things, and each maps to a real-world requirement:**

1. **Conditional steps (`when:`).** Auto-approve short leaves. Skip finance review for purchases under $100. Required for any non-trivial workflow.
2. **Timeouts (`timeout:` + `on_timeout:`).** Real humans miss things. Without timeouts your approval queue grows forever.
3. **Delegation (`on_delegation:`).** Alice goes on vacation. Bob is her delegate. The engine must follow the delegation chain (Alice → Bob → Carol if Bob is also out) without infinite-looping.
4. **Parallel steps with quorum (`type: parallel`, `quorum: all|any|N-of-M`).** Code reviews need 2 of 3 senior approvals. Document signoffs need *all* department heads. Hard to retrofit if your model is serial-only.
5. **Roles, not just users (`approver: "hr-leave-admin"`).** When Alice the HR admin leaves the company, the workflow should not break. Roles get resolved to users at runtime by the org service.

**Why YAML/JSON not code:** Workflow authors are often non-engineers (HR admins, finance leads). They edit through a UI that produces this YAML. The engine reads the YAML and executes. Storing workflows as data, not code, means you can deploy new workflows without releasing the service.

**Version field is non-optional.** Workflow `leave_request` version 3 was the spec when this request was created. The request executes against version 3 *forever*, even if version 4 ships tomorrow. Otherwise running requests would change shape mid-flight, which breaks audit and surprises users.

</details>

## Step 4: sketch the system architecture

You now know the data structure. Build the service around it. Fill in the eight `[ ? ]` boxes. The boxes mark the major roles: where requests come in, where workflow definitions live, the engine that executes them, where decisions are persisted, who knows the org chart, where notifications go, where the audit trail lives, and what the dashboard reads from.

```
                Client (web, mobile, Slack bot)
                              │
                              ▼
                    ┌──────────────────┐
                    │   [ ? ]          │  (auth, rate limit, request shaping)
                    └────────┬─────────┘
                             │
        create request       │       read dashboard
                             │
                ┌────────────┼────────────┐
                │                         │
                ▼                         ▼
        ┌─────────────┐            ┌─────────────┐
        │  [ ? ]      │            │  [ ? ]      │  (fast reads, "my pending")
        │ (executes)  │            │             │
        └──┬───┬──┬───┘            └─────────────┘
           │   │  │
           │   │  └─────────► [ ? ]   (resolves roles → users,
           │   │                       handles OOO / delegation)
           │   │
           │   └─────────► [ ? ]      (where workflow YAML lives,
           │                          versioned)
           │
           ▼
        ┌─────────────┐
        │   [ ? ]     │   (single source of truth for
        │             │    requests, decisions, state)
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │   [ ? ]     │   (immutable, append-only,
        │             │    queryable years later)
        └─────────────┘

        Events out:
            ┌─────────────┐
            │   [ ? ]     │  (downstream: notifications,
            │             │   integrations, analytics)
            └─────────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
                Client (web, mobile, Slack bot)
                              │
                              ▼
                    ┌──────────────────┐
                    │   API Gateway    │  (auth, rate limit, idempotency keys)
                    └────────┬─────────┘
                             │
        create request       │       read dashboard
                             │
                ┌────────────┼────────────┐
                │                         │
                ▼                         ▼
        ┌─────────────────┐         ┌──────────────────┐
        │  Workflow       │         │  Read Service    │  (cache + read replica;
        │  Engine         │         │  "my pending     │   serves dashboards)
        │  (executes      │         │   approvals"     │
        │   state         │         │   in <50ms)      │
        │   transitions) │         └────────┬─────────┘
        └─┬──┬──┬────────┘                  │
          │  │  │                            │
          │  │  └──────► ┌──────────────────┐│
          │  │           │  Org Service /   ││
          │  │           │  Role Resolver   ││
          │  │           │  (manager-of,    ││
          │  │           │   role members,  ││
          │  │           │   OOO delegation)││
          │  │           └──────────────────┘│
          │  │                                │
          │  └──────► ┌──────────────────┐    │
          │           │  Workflow        │    │
          │           │  Definition      │    │
          │           │  Store           │    │
          │           │  (YAML, versioned│    │
          │           │   per workflow)  │    │
          │           └──────────────────┘    │
          │                                   │
          ▼                                   │
        ┌──────────────────┐                  │
        │  Request DB      │◄─────────────────┘
        │  (Postgres)      │
        │  Tables:         │
        │   - requests     │
        │   - tasks (per   │
        │     pending      │
        │     approval)    │
        │   - decisions    │
        └────────┬─────────┘
                 │
                 │ CDC / outbox
                 ▼
        ┌──────────────────┐
        │  Audit Log       │  (append-only; S3 + Athena
        │  (immutable)     │   or ClickHouse; 7-year
        │                  │   retention default)
        └──────────────────┘

        Engine also publishes events:
            ┌──────────────────┐
            │  Kafka topic     │  approval.request.created
            │  approval.*      │  approval.task.assigned
            │                  │  approval.decision.recorded
            │                  │  approval.request.finalized
            └──────────────────┘
                Consumers:
                  - Notification Service (email, Slack)
                  - Integration adapters (Workday, NetSuite, Jira)
                  - Analytics (which workflows are slowest)
```

Component responsibilities:

- **API Gateway.** First line. Auth (which user is this), rate limit (no employee creates 10,000 requests in a minute), idempotency key handling (the mobile client retried submit).
- **Workflow Engine.** The brain. Reads the request's current state, decides what step is next, resolves the approver (calls Org Service), creates a *task* in the DB, emits an event. When a decision comes in, validates it, advances state, repeats.
- **Workflow Definition Store.** Where YAML lives. Versioned. New versions are draft → review → published. Published versions are immutable.
- **Org Service / Role Resolver.** Knows "Alice's manager is Bob, Bob's manager is Carol. The role 'finance-approver' currently has these 7 users. Alice has set OOO from May 5 to May 10 delegating to Dave." Usually a thin wrapper over Workday or your HRIS.
- **Request DB (Postgres).** Source of truth. Three core tables: `requests`, `tasks` (one row per pending approver action), `decisions` (immutable record of what each approver decided).
- **Read Service.** Optimized for "show me my dashboard." Reads from a denormalized cache populated by listening to engine events. Avoids hammering the primary DB for every dashboard load.
- **Audit Log.** Immutable. Every state transition, every decision, every escalation, every delegation lookup. Long retention (often 7 years for SOX, longer for healthcare). Cheap storage (S3) with a query layer (Athena or ClickHouse).
- **Event stream (Kafka).** The engine is the producer. Consumers handle the side-effect world: send notifications, sync to downstream systems, feed analytics.

</details>

## Step 5: role resolution and delegation

The system says "approver: `{{ employee.manager }}`". The engine has to turn that into a real person before assigning the task. And the answer might be different depending on who is out of office today. Walk through how role resolution works.

Sketch the lookup logic. What if Alice's manager Bob has set OOO and delegated to Carol, but Carol is on the same vacation and her delegate is Dave?

<details>
<summary><b>Reveal: role resolution algorithm</b></summary>

```python
def resolve_approver(spec, requester, when):
    """
    spec: a workflow approver string like "{{ employee.manager }}" or "finance-approver"
    requester: the employee who created the request
    when: timestamp of when we are evaluating (always = "now" for live requests,
          but stamped for audit replay)
    """
    # Step 1: resolve the spec to a target (user, manager-chain, or role)
    target = render_template(spec, {"employee": requester})

    # Step 2: if target is a role, pick the first available role member
    if is_role(target):
        members = org.role_members(target, at=when)
        if not members:
            raise NoApproverFound(f"role {target} has no members")
        candidate = pick_round_robin(members)
    else:
        candidate = target

    # Step 3: follow OOO/delegation chain with cycle and depth guard
    return follow_delegation(candidate, when, depth=0, visited=set())

def follow_delegation(user, when, depth, visited):
    if depth > 5:                       # never follow more than 5 hops
        raise DelegationTooDeep(user)
    if user.id in visited:              # break cycles (Alice delegates to Bob;
        raise DelegationCycle(visited)  # Bob delegates back to Alice)
    visited.add(user.id)

    if not user.exists:                 # left the company
        # Fall back to user's last manager, or workflow's "fallback" if defined.
        return fallback_for_departed(user)

    ooo = org.get_active_ooo(user, at=when)
    if ooo is None:
        return user                     # found a live approver

    if ooo.delegate is None:
        return user                     # OOO but no delegate; assign anyway
                                        # (will likely time out and escalate)

    return follow_delegation(ooo.delegate, when, depth + 1, visited)
```

Four real-world cases this handles:

1. **Alice's manager is Bob. Bob is in.** Resolves to Bob immediately.
2. **Bob is OOO, delegated to Carol. Carol is in.** Resolves to Carol. Follow once.
3. **Bob → Carol → Dave (Carol also OOO).** Resolves to Dave. Follow twice.
4. **Bob → Carol → Bob (Carol set her delegate to Bob by mistake).** Cycle detected. Raise. Fallback to assigning Bob anyway with a warning.

**Why the `when` parameter.** During audit replay, you must reconstruct who *would have been* the approver at the time the request was created, not who would be approver now. People change jobs, OOO settings shift, delegations expire.

**Pick strategy for role members.** Round-robin is the default for fairness. For high-priority requests you might use "least-loaded" (look at each member's current task count). Avoid "random" because it makes the audit story confusing.

**Departed users.** Someone gets fired or leaves. Their pending tasks are orphaned. A nightly sweep reassigns to fallback (their last manager). High-volume departures (layoffs) trigger a special bulk-reassign tool.

</details>

## Step 6: the audit trail (and why it must be immutable)

Five years from now, an auditor asks: "Show me every approval decision on purchase orders over $50,000 in Q3 2024." How does your system answer that, given that the people who made those decisions may have left, the workflow definitions have changed, and the approvers' roles may have been reorganized?

Sketch the audit log schema. What fields are non-negotiable, what is optional, and what must *never* be overwritten?

<details>
<summary><b>Reveal: audit log design</b></summary>

```sql
CREATE TABLE audit_log (
    event_id          UUID PRIMARY KEY,
    occurred_at       TIMESTAMPTZ NOT NULL,        -- wall clock
    request_id        UUID NOT NULL,                -- foreign reference, not FK
    workflow_id       TEXT NOT NULL,                -- "leave_request"
    workflow_version  INT NOT NULL,                 -- 3
    event_type        TEXT NOT NULL,                -- request.created, decision.recorded, etc.
    actor             JSONB,                        -- {"user_id": "...", "role": "...", "delegated_from": "..."}
    payload           JSONB NOT NULL,               -- event-specific
    snapshot          JSONB                         -- the request state at this moment
);

CREATE INDEX idx_audit_request ON audit_log (request_id, occurred_at);
CREATE INDEX idx_audit_workflow_time ON audit_log (workflow_id, occurred_at);
CREATE INDEX idx_audit_actor ON audit_log USING gin (actor);
```

**Non-negotiable rules:**

1. **Append-only.** No UPDATE, no DELETE, ever. The DB user that writes audit has INSERT-only privileges.
2. **Includes a snapshot.** Each event carries the request state at that moment. Lets you replay the request's life by walking events.
3. **Includes the workflow version.** If `leave_request` is on v5 today and this request ran against v3, the audit must show v3.
4. **Captures who and on whose behalf.** If Carol approved as Bob's delegate, both names are recorded.
5. **Hashed chain (optional, for high-compliance).** Each event has a `prev_hash` and `hash`. Tampering with one event invalidates the chain. Healthcare and finance industries sometimes require this.

**Retention:**

- Default 7 years (SOX retention horizon for US public companies).
- Stored in two tiers: last 90 days in Postgres for fast queries, older in S3 (Parquet) with Athena for ad-hoc auditor queries.
- Background job moves rows from hot to cold tier nightly.

**What audit answers:**

- "Who approved request X?" → query `request_id`.
- "Show all decisions by user Alice in 2024." → query `actor`.
- "All purchase orders over $50k approved by anyone other than the requester's direct manager." → join `audit` to `requests` snapshot data.
- "Replay request X to see exactly what the engine did at each step." → walk `event_id`s for that request in time order.

**Why not just rely on the primary DB tables.** The `requests` and `tasks` tables get updated when state changes. The current state of a request five years from now reflects the latest version, not the audit trail. Auditors need the *history*, not the current state.

</details>

## Step 7: the four real-world variants

The same engine runs all of these. Each one stresses a different part of the design. For each variant below, identify which feature of the engine is critical. Then peek at the answer.

**A. Purchase Order**

> Engineer submits PO for $12,000 for new servers. Workflow: manager approves → if amount > $5k, finance approves → if amount > $25k, CFO approves → procurement team executes.

**B. Leave Request**

> Same as the YAML we built. 1-2 days auto-approve, 3-14 days manager, 14+ adds HR + grandboss in parallel.

**C. Expense Report**

> Submit receipts. Manager reviews. If approved, goes to finance for reimbursement. Finance may push back ("Receipt is missing, please re-upload") which sends it *back* to the requester, then back to manager, then back to finance.

**D. Code Review**

> Pull request needs 2 approvals from senior engineers. Author cannot approve their own. CI must pass. If any approver requests changes, the request resets (loses approvals) when new commits are pushed.

<details>
<summary><b>Reveal: what each variant stresses</b></summary>

**A. Purchase Order: conditional branching.**

The workflow has three potential approval steps but only the ones that match the amount are executed. The engine evaluates the `when:` clause at each step. The PO at $12k goes through manager + finance but skips CFO. A $30k PO hits all three.

> Common bug: the workflow author writes `when: amount > 5000` in finance and `when: amount > 25000` in CFO. A $25,001 PO goes to *both* finance and CFO. Probably fine. A $5,001 PO goes to finance, then to CFO because $5001 > 25000 is false, so CFO is skipped. Logic correct. But if the workflow author writes `when: amount > 5000` in CFO too (copy-paste error), a $6000 PO needlessly goes to the CFO. Lint your workflow definitions.

**B. Leave Request: parallel approval with quorum.**

A 21-day leave goes to manager (serial), then *parallel* to HR-admin (role) AND grandboss (template-resolved). Both must approve before finalize. The engine creates two tasks at once, waits for both, then advances. If HR-admin approves but grandboss rejects, the whole request rejects.

> Common bug: someone writes `quorum: any` instead of `all`. Now one approver can rubber-stamp the request before the other has even seen it. Default `quorum` should be `all`; require explicit `any` in the YAML.

**C. Expense Report: backward transitions ("send back").**

Finance pushes back. The request goes *back* to the requester (state: returned_to_requester). The requester edits and resubmits. Now what? Two options:

- **Reset to start:** entire workflow restarts. Manager has to re-approve from scratch. Safe; loses prior context.
- **Resume from manager:** request re-enters at the manager step. Manager sees "Carol resubmitted with new receipts." Faster; requires the engine to support backward transitions explicitly.

Most real systems do **resume from manager** with a banner showing what changed. The engine has to support `on_action: return_to_step(<step_id>)` transitions.

> Common bug: when the request goes back to the requester, finance's pending task is left orphan. The engine must close that task with reason `request_returned` so it stops showing in finance's dashboard.

**D. Code Review: invalidation on input change.**

If two reviewers approve, then the author pushes new commits, do the approvals carry over? GitHub says no by default (commit invalidates approvals). The engine needs an `on_input_change: invalidate_approvals` hook.

> Common bug: "self-approval is not allowed" is a separate constraint from the workflow definition. The role-resolver for approvers must exclude the requester. Filter `approver != requester` in `resolve_approver`.

**The point of these four variants:** the same engine, same data model, same audit log, four totally different workflows. *That is the value of the design.* If you implemented a hardcoded "purchase_orders" service, you would have to build a separate service for every other workflow type.

</details>

## Follow-up questions (15)

Try answering each in 3 to 4 sentences before reading the solution.

1. **Self-approval prevention.** A user submits a PO on their own behalf and is in the finance approver group. How do you ensure they cannot approve their own request? Where in the system does this check live?

2. **Approver leaves the company while a request is in flight.** Their dashboard shows a pending task forever, but they cannot log in. What happens? How do you find these stale tasks?

3. **Delegation cycle.** Alice delegates to Bob. Bob delegates to Alice. The engine resolves an approver for Alice's request and infinite-loops. How do you prevent this?

4. **Workflow version migration.** You ship `leave_request` v4 which adds a new step. There are 800 in-flight requests on v3. What happens to them?

5. **Concurrent approval race.** Two managers are listed in `parallel` with `quorum: any`. Both click Approve at the same moment. Does the request advance twice? Get into a bad state? Detail the locking strategy.

6. **Auto-approval is broken.** Last night, finance's auto-approval rule (`when: amount < 100`) auto-approved 50,000 fraudulent micro-purchases. How would you detect this? How would you recover (reverse all those approvals)?

7. **Bulk import.** HR wants to import 5000 historical leave requests with their original timestamps and approver decisions. How do you load them through the engine while preserving the audit trail's accuracy?

8. **Performance: "my pending approvals" dashboard.** Carol is on 47 teams. She has ~120 pending tasks at any time. Her dashboard query takes 4 seconds. How do you fix it?

9. **Search across all approvals.** A finance auditor needs to find "all purchase orders mentioning vendor 'Acme Corp' approved in Q2." Your `requests` table has a JSON `inputs` column. Naive search is slow. What do you do?

10. **External integration: NetSuite sync.** When a PO is approved, your system must create a record in NetSuite. NetSuite returns 5xx errors 1% of the time. How do you guarantee the record is eventually created without ever duplicating?

11. **Notifications fan-out for a watcher list.** Alice's PO has 12 watchers (procurement, legal, IT, security, etc.). Every state change must notify all of them. How do you avoid notification storms when a request transitions through 8 states in 10 minutes?

12. **The "approve all" button.** Carol has 80 pending leave requests, all for the same week (school holiday). She wants to approve them all at once. Your UI builds the "approve all" button. What backend API does it call? What can go wrong?

13. **Visibility / privacy.** Salary-affecting decisions (raise requests) should not be visible to non-HR users, even in audit logs. How do you enforce this across the read service, the audit query interface, and the event stream?

14. **Workflow author makes an infinite loop.** Step A transitions to Step B which transitions back to Step A. You publish the workflow. The first request through it loops forever. How do you catch this *before* publication?

15. **Multi-region deployment.** Your company opens EU operations. EU employees' data must stay in EU. How does the engine handle a request where the requester is in EU but the approver is in US?

## Related problems

- **[Notification System (010)](../010-notification-system/question.md)**. Every approval event fires off notifications. The fan-out, retry, and quiet-hours machinery there is what consumes the approval engine's events. Designing notifications and approvals together is a common follow-up.
- **[Help Desk Ticketing (019)](../019-helpdesk-ticketing/question.md)**. A ticket has a similar lifecycle: created → assigned → in-progress → resolved → closed. The state machine, role-routing, and SLA timer patterns are the same. Help Desk adds intake-channel-routing on top.
- **[Write-Heavy System Patterns (018)](../018-write-heavy-patterns/question.md)**. The audit log here is exactly a write-heavy append-only system. The patterns from that problem apply directly.
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md)**. The "my pending approvals" dashboard is the read-heavy half of this design. Cache tiering and read-replica strategies from that problem apply.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Approval Management Service

### TL;DR

Approval is a workflow engine. You read a versioned definition (YAML or JSON), walk a state machine, and assign work to humans. The runtime itself is small. What makes the problem real is everything *around* it: turning role names like "the requester's manager" into actual people while handling out-of-office and delegation, surviving an approver who leaves the company, keeping an audit trail a regulator can trust five years later, and letting one engine run leave requests, purchase orders, code reviews, and twenty other shapes without becoming a hardcoded mess.

The data model fits on a napkin. Workflow definitions. Requests. Tasks (one per pending human action). Decisions (immutable record of what each human did). Audit log (every state transition, append-only). The interesting bit is how those tables relate at runtime, which we will draw in a moment.

Scale here is not a queries-per-second story. At 100k employees you see roughly one request per second. The pain comes from *organizational* complexity: 5000 different workflow variants, multi-region data residency, decades-long audit retention. The architecture starts as a single Postgres and grows in a few well-named stages, never preemptively.

### 1. Clarifying questions, recap

The most important question is the first one: *one workflow type or many?* A service for only leave requests is a CRUD app. A workflow engine that runs many workflow types defined by config is the actual system design. The second most important is *who authors workflows?* If it is HR admins through a UI, you need a definition store, versioning, validation, and a lint pass. If it is engineers shipping YAML in the repo, you can skip half of that but you also give up most of the value of building this as a service.

Everything else (delegation, escalation, audit retention) follows from those two answers.

### 2. Capacity, with the math

A 50-person startup generates around 36 requests per day. About one every 40 minutes. A single Postgres yawns. You could literally build this on a Google Sheet and a cron job.

A 100k-person enterprise generates around 71k requests per day. That is one per second sustained, three per second at peak. Dashboard reads dominate: 100k employees opening their inbox ten times a day works out to roughly 25 reads per second, 75 at peak.

Two numbers matter more than the throughput:

- **200k active requests in flight at any moment.** Every "show me my pending approvals" query has to find the right ones fast.
- **5000 workflow definitions** at a mature company. Hot ones (leave, expense) get hit thousands of times a day. Cold ones (annual security review) once a quarter.

Reads beat writes 25-to-1. Cache the read path or it gets ugly long before the writes ever do.

### 3. API

Two endpoints carry the whole product. *Create a request* and *record a decision*. Everything else is a read.

```
POST /api/v1/requests
Idempotency-Key: <uuid>

{
  "workflow_id": "leave_request",
  "workflow_version": null,           # null = latest published
  "inputs": { "start_date": "...", "end_date": "...", "days": 5 }
}
```

The response gives you back the request id and the tasks that just got created. If two parallel approvers need to act, you get two tasks back. If the workflow auto-approved this one (under-3-day leave), you get back a finalized request immediately.

```
POST /api/v1/tasks/{task_id}/decisions

{
  "decision": "approve" | "reject" | "request_changes" | "delegate",
  "comment": "...",
  "on_behalf_of": "user_bob"          # set if a delegate is acting
}
```

A few small but load-bearing choices:

- **Idempotency-Key is required on create.** Mobile retries the submit on timeout; without the key you get duplicate requests, double-charged budget reservations, and angry users.
- **`workflow_version: null` defaults to the latest published.** You can pin to a specific version for testing.
- **Tasks are the unit of work, not requests.** A request can have several tasks in flight at once (parallel approval). Approvers act on tasks. This matters for the database design too.

Status codes worth knowing: 409 on the decision endpoint means the task was already decided (someone else, or a delegate, beat you to it). 410 means the task was cancelled because the request was withdrawn or returned to the requester. Real UIs handle both.

### 4. Data model

Five tables. Two large, three small.

```sql
-- Workflows live here. Versioned, never edited in place.
CREATE TABLE workflow_definitions (
    workflow_id      TEXT NOT NULL,
    version          INT NOT NULL,
    status           TEXT NOT NULL,         -- 'draft' | 'published' | 'archived'
    definition       JSONB NOT NULL,
    published_at     TIMESTAMPTZ,
    published_by     TEXT,
    PRIMARY KEY (workflow_id, version)
);

-- One row per logical approval request.
CREATE TABLE requests (
    request_id          UUID PRIMARY KEY,
    workflow_id         TEXT NOT NULL,
    workflow_version    INT NOT NULL,
    requester_id        TEXT NOT NULL,
    state               TEXT NOT NULL,      -- current step id, or 'approved'/'rejected'/'cancelled'
    inputs              JSONB NOT NULL,
    state_data          JSONB,              -- engine working memory
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at        TIMESTAMPTZ,
    final_state         TEXT,
    idempotency_key     TEXT,
    FOREIGN KEY (workflow_id, workflow_version)
        REFERENCES workflow_definitions(workflow_id, version)
);
CREATE INDEX idx_req_requester ON requests (requester_id, created_at DESC);
CREATE INDEX idx_req_open ON requests (state) WHERE finalized_at IS NULL;

-- One row per pending human action.
CREATE TABLE tasks (
    task_id        UUID PRIMARY KEY,
    request_id     UUID NOT NULL REFERENCES requests(request_id),
    step_id        TEXT NOT NULL,
    assignee_id    TEXT NOT NULL,
    assigned_via   JSONB,                   -- delegation chain, if any
    state          TEXT NOT NULL,           -- 'pending' | 'decided' | 'cancelled' | 'expired'
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ              -- triggers escalation
);
CREATE INDEX idx_tasks_assignee_pending
    ON tasks (assignee_id) WHERE state = 'pending';

-- Immutable record of every human decision.
CREATE TABLE decisions (
    decision_id    UUID PRIMARY KEY,
    task_id        UUID NOT NULL REFERENCES tasks(task_id),
    request_id     UUID NOT NULL REFERENCES requests(request_id),
    actor_id       TEXT NOT NULL,
    on_behalf_of   TEXT,
    decision       TEXT NOT NULL,
    comment        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id)                        -- one decision per task, enforced by the DB
);

-- Append-only audit. INSERT privilege only; no UPDATE or DELETE.
CREATE TABLE audit_log (
    event_id           UUID PRIMARY KEY,
    occurred_at        TIMESTAMPTZ NOT NULL,
    request_id         UUID NOT NULL,
    workflow_id        TEXT NOT NULL,
    workflow_version   INT NOT NULL,
    event_type         TEXT NOT NULL,
    actor              JSONB,
    payload            JSONB NOT NULL,
    snapshot           JSONB
);
CREATE INDEX idx_audit_request ON audit_log (request_id, occurred_at);
```

A few choices worth defending out loud:

The `UNIQUE (task_id)` constraint on `decisions` is doing real work. When two managers in a parallel approval both click "approve" at the same instant, the database serializes them. The first insert wins, the second fails with a unique-violation, the API turns that into a friendly 409, and the request still advances exactly once. No locks at the application layer needed.

`workflow_definitions` is *immutable per version*. Publishing v4 of `leave_request` does not touch v3. In-flight requests stay on the version they were created against, forever. This is what lets you ship workflow changes without breaking running requests and what makes audit replay work years later.

The `audit_log` has no foreign key to `requests` on purpose. If you ever delete a request (GDPR, mistaken bulk import), the audit must survive. Audit is the truth-of-record, not the request table.

Postgres, not Cassandra or DynamoDB. The whole system is small. ACID matters here (claiming a task, recording a decision, advancing the request state all happen together). Postgres gives you all of that in one box.

### 5. The engine

The engine is a state machine executor. One function does most of the work, called every time something might let a request progress: a request was just created, a decision came in, a timeout fired, or an external event arrived (CI status for a code review workflow).

```python
def advance_request(request_id):
    with db.transaction():
        request = db.lock_for_update("requests", request_id)
        if request.finalized_at is not None:
            return                                      # nothing to do

        workflow = workflow_store.get(request.workflow_id, request.workflow_version)
        current_step = workflow.find_step(request.state)

        # Is the current step done?
        if current_step.type == "approval":
            tasks = db.query_tasks(request_id, current_step.id)
            if not quorum_met(tasks, current_step.quorum):
                return                                  # still waiting on humans

        next_step = workflow.next_step(current_step, request.inputs, request.state_data)

        if next_step.type == "terminal":
            db.finalize(request_id, state=next_step.state)
            emit("request.finalized", request_id)
            return

        if next_step.type == "approval":
            assignees = resolve_assignees(next_step, request.requester)
            for who in assignees:
                db.insert_task(request_id, next_step.id, who, expires_at=...)
                emit("task.assigned", task_id)

        elif next_step.type == "auto":
            outcome = execute_auto_step(next_step, request)
            db.update_state(request_id, outcome.state)
            return advance_request(request_id)          # recurse: auto-steps chain

        db.update_state(request_id, next_step.id)
        emit("request.advanced", request_id, new_state=next_step.id)
```

Three things make this safe:

The whole advance happens in one DB transaction. Crashes mid-way roll back. After restart, the engine sees the same state and tries again. No partial-advance state ever lands on disk.

The `SELECT... FOR UPDATE` lock on the request row serializes concurrent attempts to advance the same request. Without it, two simultaneous decisions could each try to push the request forward and corrupt the state machine.

The function is idempotent at step boundaries. Calling it twice on the same request either sees the same state and proceeds the same way, or sees that someone else already advanced past this step.

### 6. Resolving an approver (the part that goes wrong in production)

The workflow says `approver: "{{ employee.manager }}"`. The engine has to turn that into a real person before it can create a task. That sounds simple. Production says otherwise.

```python
def resolve_approver(spec, requester, when):
    target = render_template(spec, {"employee": requester})

    if is_role(target):                                 # e.g. "finance-admin"
        members = org.role_members(target, at=when)
        if not members:
            raise NoApproverFound(target)
        target = pick_round_robin(members)

    return follow_delegation(target, when, depth=0, visited=set())

def follow_delegation(user, when, depth, visited):
    if depth > 5:
        raise DelegationTooDeep(user)
    if user.id in visited:
        raise DelegationCycle(visited)
    visited.add(user.id)

    if not user.exists:
        return fallback_for_departed(user)              # try last manager, then workflow fallback

    ooo = org.get_active_ooo(user, at=when)
    if ooo is None or ooo.delegate is None:
        return user                                     # OOO with no delegate falls through

    return follow_delegation(ooo.delegate, when, depth + 1, visited)
```

The shape comes from four real situations:

Bob is in. Fine. Resolves to Bob immediately.

Bob is OOO, delegated to Carol. Carol is in. Resolves to Carol after one hop.

Bob is OOO to Carol. Carol is also OOO to Dave. Two hops. The visited-set guard makes sure we never loop forever if Bob → Carol → Bob.

Bob left the company. The user lookup fails, we fall back to his last known manager, then to the workflow's `fallback_approver` if even that fails.

The `when` parameter looks redundant but matters for audit replay. To reconstruct *who would have been the approver* on the day this request was created, you need a point-in-time view of the org. People change jobs. Delegations expire. Roles get re-membered.

Cache role membership for five minutes and OOO state for one minute. That alone drops HRIS load by 100x. Invalidate on org-system webhooks for the cases where freshness really matters.

When you do follow a delegation chain, write the full chain to the task as `assigned_via`. Dave's dashboard then shows "you are approving on behalf of Bob, via Carol." The audit records the same chain, which is what an auditor will want to see five years later.

### 7. Architecture

Here is the whole picture. Drawn small enough to fit one screen.

```
                 ┌────────────────────────────────────────────────────┐
                 │ Clients: web, mobile, Slack/Teams bot              │
                 └─────────────────────┬──────────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │   API Gateway    │  auth, idempotency,
                              │                  │  rate limit
                              └────┬────────┬────┘
                       create      │        │      read dashboard
                                   │        │
                                   ▼        ▼
              ┌─────────────────────────┐  ┌──────────────────────┐
              │   Workflow Engine        │  │   Read Service        │
              │   (stateless pods)       │  │   (denormalized       │
              │                          │  │    dashboard cache)   │
              │   ┌─ resolves approvers ─┼─►│                       │
              │   ┌─ reads workflow defs ┼─►├──────────────────────┘
              │   └─ writes request state│
              └─────────┬──────┬─────────┘
                        │      │
                        │      ▼
                        │   ┌──────────────────┐
                        │   │  Org Service      │  manager-of, role members,
                        │   │  (HRIS adapter +  │  OOO + delegation
                        │   │   short TTL cache)│
                        │   └──────────────────┘
                        ▼
              ┌──────────────────────────────────────┐
              │  Postgres                              │
              │   workflow_definitions (small, hot)   │
              │   requests                            │
              │   tasks                               │
              │   decisions                           │
              │   audit_log (recent 90 days)          │
              └────────────────┬──────────────────────┘
                               │
                  CDC / outbox │
                               ▼
              ┌──────────────────────────────────────┐
              │  Kafka                                 │
              │   approval.request.created            │
              │   approval.task.assigned              │
              │   approval.decision.recorded          │
              │   approval.request.finalized          │
              └──┬──────────────┬──────────────┬──────┘
                 │              │              │
                 ▼              ▼              ▼
        ┌─────────────┐  ┌──────────────┐  ┌────────────────┐
        │ Notification │  │  Downstream   │  │ Analytics +     │
        │ Service      │  │  integrations │  │ Audit cold      │
        │ (email,Slack)│  │  (NetSuite,   │  │ tier (S3 +      │
        │              │  │  Workday)     │  │ Athena, 7yr)    │
        └─────────────┘  └──────────────┘  └────────────────┘
```

Five things to notice while reading this:

The engine reads workflow definitions but does not call out to other services on the write path. The Org Service is the only external call (cached aggressively). Everything else is a Postgres transaction.

Notifications, integrations, and audit archival are downstream of Kafka. They are not in the write path of the engine. If the notification service is down, requests still get created and approved; the emails just queue up.

The Read Service is denormalized. It listens to Kafka events and maintains a "what's pending for each user" cache. Dashboard reads never touch the primary Postgres in the common case.

Audit lives in two tiers. Recent 90 days in Postgres for fast investigations. Older events in S3 Parquet for compliance queries via Athena. A nightly job moves rows between tiers.

The engine pods are stateless and horizontally scalable. State is in Postgres. You can roll them in the middle of the day with no impact.

### 8. What a request looks like, end to end

Here is the create-request flow drawn as a sequence:

```
   Client       API GW       Engine       Org Svc      Postgres      Kafka
     │            │            │             │            │            │
     │ POST /req  │            │             │            │            │
     ├───────────►│            │             │            │            │
     │            │ validate   │             │            │            │
     │            ├───────────►│             │            │            │
     │            │            │ resolve     │            │            │
     │            │            │ first       │            │            │
     │            │            │ approver    │            │            │
     │            │            ├────────────►│            │            │
     │            │            │◄────────────┤            │            │
     │            │            │             │            │            │
     │            │            │ BEGIN TX                 │            │
     │            │            ├──────────────────────────►            │
     │            │            │ INSERT requests          │            │
     │            │            │ INSERT tasks             │            │
     │            │            │ INSERT audit_log         │            │
     │            │            │ COMMIT                   │            │
     │            │            │◄──────────────────────────┤            │
     │            │            │             │            │            │
     │            │            │ emit request.created │   │            │
     │            │            │ emit task.assigned   │   │            │
     │            │            ├──────────────────────────────────────►│
     │            │ 201 OK     │             │            │            │
     │            │◄───────────┤             │            │            │
     │ 201 OK     │            │             │            │            │
     │◄───────────┤            │             │            │            │
     │            │            │             │            │            │
     │            │            │             │            │  consumer  │
     │            │            │             │            │            ├──► email Bob
     │            │            │             │            │            ├──► slack message
     │            │            │             │            │            └──► analytics
```

Recording a decision looks almost the same. The engine fetches the task, validates the caller, inserts a row in `decisions` (unique constraint catches double-decide races), updates the task, writes an audit event, and calls `advance_request` to see if the workflow can move forward. All in one transaction.

Reads have their own short flow. Client hits the API gateway, the request goes to the Read Service, the Read Service checks its Redis cache (`user:{uid}:pending_tasks`), and returns. Cache misses fall through to a read replica of Postgres; whichever hits, the result is fast.

Target latencies, for a sense of scale: create request P99 around 200ms (bottleneck is the role-resolver round-trip when cache is cold). Decision P99 around 150ms (role is usually warm because it was looked up when the task was created). Dashboard read P99 around 50ms.

### 9. Scaling journey: 10 to 1M users

This is the part interviewers care about most. At every stage, name what just broke and what fixes it. Build nothing preemptively.

**Stage 1: 10 to 100 users.** One Postgres, one app instance. Workflow YAML lives in the repo. Manager mappings hardcoded. No cache, no queue. Notifications go out as inline HTTP calls to SendGrid. About $80/month total. You ship in two weeks.

This is enough because you see ten requests a day. Postgres is loafing. The audit query "who approved request X" runs in 5ms. Building anything more is over-engineering.

**Stage 2: 1k users.** Something breaks: somebody asks for a new workflow type without a deploy. Now workflow YAML belongs in a database table with a minimal admin UI. While you are in there, you add versioning so published workflows are immutable. You also stop hardcoding manager mappings and integrate with the HRIS (Workday or BambooHR), with a 5-minute cache. Notifications stop being inline calls and start consuming a small `request_events` table that a notifier process polls. About $250/month.

Still no Kafka, no read replicas, no Redis. You see one request every couple of minutes. One Postgres is still fine.

**Stage 3: 10k to 100k users.** Now several things break at once. The dashboard for power approvers takes four seconds because hot users have 100+ pending tasks. Audit queries on 80M rows time out. Engine pods compete for the same `SELECT FOR UPDATE` lock under bursty load. The Workday API rate-limits you during peak hours.

The fixes, in order: add two Postgres read replicas (dashboards read from them, engine writes go to primary, ~1s replication lag is fine). Add a Redis cache for "my pending tasks" populated by listening to engine events; dashboards read Redis directly. Move audit older than 90 days to S3 Parquet, queryable via Athena. Partition the engine pods by `request_id` hash so they stop racing for the same locks across pods. Tighten the Org Service cache to pre-fetch on dashboard load. Bring in Kafka properly: notifications, audit tiering, and external integrations all become consumers.

Cost jumps to $2-5k/month for the bigger DB, replicas, Redis, Kafka, S3.

**Stage 4: 1M users.** New problems: EU operations open, EU data must stay in EU. One customer is a hospital and needs HIPAA-grade audit hash chaining. 5000+ workflow definitions, different teams want different RBAC. Some workflows have 30 approval steps and live for weeks.

Multi-region everything. Engine, DB, Redis, Kafka all per-region. Requester's home region (from HRIS) determines where the request lives and where audit is written. Cross-region approvals (US person approves an EU request) routed via authenticated cross-region API. Workflow definitions get their own RBAC by "policy domain." Audit events get a hash chain so tampering breaks the chain. Long-running workflows survive engine deploys because state lives entirely in DB and pods are interchangeable.

The architecture has not fundamentally changed since stage 3. You added regions, RBAC, and tenant isolation, but the core data model is the same one you wrote in stage 1.

What you would do at 10M users: by then you are bigger than any single company, which means you are selling this as SaaS (Workday, ServiceNow scale). At that point you might swap your homegrown engine for Temporal as the runtime and keep your approval-specific logic on top.

### 10. The four variants, fast

Same engine, four real workflows. Each stresses a different feature.

- **Purchase order** uses conditional branching. `when: amount > 5000` sends it to finance. `when: amount > 25000` adds the CFO. Lint your conditions or you get bugs like a $25,001 PO going to both finance and the CFO unnecessarily.
- **Leave request** uses parallel with quorum. Long leaves go to HR and the grandboss at the same time, both must approve. If one rejects, the other's task is cancelled and the request rejects.
- **Expense report** needs backward transitions. Finance says "missing receipt." The request goes back to the requester, who edits and resubmits. The engine supports `on_action: return_to(<step>)` for this. Subtle: pending tasks downstream get cancelled when the request rewinds.
- **Code review** needs external-event integration. The workflow waits for CI status, not a human. When a new commit lands, prior approvals get invalidated via `on_input_change: invalidate_approvals`.

One engine, four workflows, no special cases. That is the design victory.

### 11. Reliability

Engine crashes mid-advance roll back cleanly. State is in the DB, the transaction is atomic, the lock prevents concurrent advance attempts. After restart, the engine sees the request's current state and continues from there.

The escalation worker is separate from the engine. It scans for tasks where `expires_at < now()` and records timeout events. If it dies, escalations are delayed by however long it takes to restart. Idempotent: re-running the worker over the same expired tasks does nothing harmful.

Audit writes happen in the same transaction as the state change. If the audit insert fails, the state change rolls back. You never advance state without an audit record.

If the HRIS goes down, the Org Service serves stale data from cache. The engine keeps working with whoever was cached at last refresh. After an hour, the engine logs warnings. After 24 hours, it refuses to assign tasks that require role lookups (named-user assignments still work).

If a region goes down, that region's requests pause. Cross-region approvals routed through the down region queue in Kafka. When the region comes back, the queued operations replay.

### 12. Observability

| Metric | Why it matters |
|--------|----------------|
| `requests.created.rate` | Spike = bot. Drop = auth or HRIS broken. |
| `requests.in_flight` | Growing slowly = approvals are stalling on someone. |
| `request.cycle_time` p50, p95 per workflow | The headline SLO. Often audit-required. |
| `task.assignment_latency` p99 | If > 1s, role resolver is sluggish. |
| `escalations.fired.rate` | Spike = lots of stalled tasks. Could be workflow bug, could be flu season. |
| `delegation.depth.max` | Should never exceed 3-4. Higher = OOO chains that need fixing. |
| `delegation.cycles.detected` | Should be 0. Page if non-zero. |
| `engine.lock_wait` p99 | High = you need partitioning across pods. |
| `audit.write.lag` | Audit must never lag. Alert at > 5s. |

Page on: engine error rate > 1% over 5min, audit write failure (any), delegation cycle detected. File a ticket on: cycle time regression > 30%, HRIS cache age > 30 min.

### 13. Gotchas the senior interviewer is listening for

Some of these only come out when the interviewer asks "what happens if...". The senior candidate brings them up unprompted.

**Delegation cycles.** Alice delegates to Bob, Bob delegates to Alice. The recursion sees this and raises. Mitigation: assign to the original target with a warning. The UI tells them to fix their OOO settings.

**Departed approvers.** A nightly job finds tasks whose `assignee_id` no longer exists in HRIS and reassigns to the assignee's last manager. Mass layoffs need a one-shot rebalance tool that reassigns to a triage queue.

**Conditional clauses with overlapping ranges.** $5000 matches `> 1000`. $5000 also matches `> 5000` if you wrote it as `>=`. Boundary cases bite. Lint the workflow definition at publish time.

**Self-approval.** Someone in the finance role submits a finance-approval request. Filter `approver != requester` in `resolve_approver`. Critical. The interviewer will ask.

**Notification storms.** A request transitions through five states in two minutes. Naive design sends five emails. Aggregate per-recipient per-request on a 60-second window and send one summary.

**Send-back leaves orphan tasks.** The expense report goes back to the requester, but the finance-pending task is still showing in finance's dashboard. The engine has to close downstream tasks with reason `request_returned` when rewinding.

### 14. Follow-up answers

**1. Self-approval prevention.** Filter the requester out of the eligible approver set in `resolve_approver`. For role-based steps, pick the next available role member. For named-user steps where the user happens to be the requester, raise a workflow definition error. The check lives in the engine, not just the API, because someone could reassign a task to the requester via delegation otherwise.

**2. Approver leaves the company.** A nightly job:

```sql
SELECT t.task_id, t.assignee_id, r.requester_id
  FROM tasks t JOIN requests r ON t.request_id = r.request_id
 WHERE t.state = 'pending'
   AND t.assignee_id NOT IN (SELECT id FROM users WHERE active);
```

For each orphan, reassign to the original assignee's last manager from HRIS history. If not findable, fall back to the workflow's `fallback_approver`. Notify the new assignee with context: "this task was originally assigned to X who has since left." For layoffs, run the job on demand with a bulk-reassign mode.

**3. Delegation cycle.** The `visited` set in `follow_delegation` raises `DelegationCycle` on a repeat. Assign to the original target anyway, with a warning in the UI: "We detected a circular delegation; please update your OOO settings." Prevention: when a user sets their delegate, walk the chain and refuse if it includes them.

**4. Workflow version migration.** In-flight requests stay on their original version forever. `requests.workflow_version` is set at create time and never updated. Old versions are kept indefinitely. If you ship v4 with a critical fix and want in-flight requests to benefit, you do not modify v3; you manually apply a "patch" to specific requests (rare; carries audit annotation `workflow_patched`). Workflows can be archived but never deleted while any historical request references them.

**5. Concurrent approval race.** `UNIQUE (task_id)` on `decisions` is the lock. Two approvers click at once, two INSERTs race, the first wins, the second gets a unique-violation, the API returns 409 to that user. The first decision's `advance_request` runs, sees parallel-quorum-any is satisfied, and cancels the sibling tasks. The losing approver sees "task no longer requires action" (410 Gone).

**6. Auto-approval bug.** Detection: `metrics.auto_approve.rate` is normally stable, so a 100x spike triggers a page. Recovery: an `admin_reopen(request_id)` endpoint creates an `audit.admin_reopened` event, resets state to a configurable point, and cancels downstream effects. The downstream is whoever consumes the "approved" event; if NetSuite already wrote a payment record, NetSuite needs its own reversal. Going forward: cap auto-approve rate per workflow per hour; a circuit breaker switches to manual review on overrun.

**7. Bulk import.** A separate `bulk_import` endpoint bypasses the engine and writes directly to `requests`, `tasks`, `decisions`, and `audit_log` with the original timestamps. Each audit event is tagged with `source: bulk_import_<batch_id>` so future auditors can tell imported from live. The audit hash chain (if enabled) treats imported events as a separate chain. Admin-only. Heavily audited itself.

**8. Dashboard performance for power approvers.** Carol's 120 pending tasks make her dashboard slow because the frontend issues 120 sub-queries hydrating each task. Fix: the backend returns a denormalized "task list view" per assignee from the Read Service cache. Single Redis read. Cache updated incrementally on `task.assigned` and `task.decided` events. Paginate if she has > 50 tasks.

**9. Search across all approvals.** Postgres JSONB search on `requests.inputs` is slow without help. For most companies, a `tsvector` GIN index on `to_tsvector('english', inputs::text)` is enough. Above ~10M searchable requests, pipe `requests` to Elasticsearch or ClickHouse via CDC.

**10. NetSuite integration with idempotency.** A `netsuite-sync-worker` consumes `request.finalized` from Kafka. For each event: check an `external_syncs (request_id, target)` table; if status is `success`, skip. Otherwise call NetSuite with `idempotency_key = "ns-{request_id}"` (NetSuite uses it to dedupe). On 2xx, mark success. On 5xx, exponential backoff (1s, 5s, 25s, 2m, 10m, 30m, deadletter). On 4xx, mark `failed_permanent` and alert a human.

**11. Notification storm.** Already covered: 60-second aggregation window per recipient per request, sent as one digest. Configurable per user (instant, hourly digest, daily summary). The notification service owns preferences; the engine just emits raw events.

**12. The "approve all" button.** API: `POST /api/v1/tasks/bulk_decide` with `{"task_ids": [...], "decision": "approve"}`. Server iterates serially through the list (serial because each decision might advance a request and concurrent advances cause version skew). 80 decisions at 50ms each = 4 seconds. Returns a per-task result array. Some tasks might 409 if a delegate beat the user to it; the result shows that.

**13. Privacy and visibility scoping.** Workflow definitions get a `visibility_scope` field: `public | private | department | role:<role>`. Denormalized to `requests.visibility_scope`. All read APIs filter by it. Restricted workflows publish to a separate Kafka topic (`approval.events.restricted`) that only authorized consumers subscribe to. Notifications for restricted workflows omit details: "you have a pending approval; log in to see."

**14. Infinite-loop workflows.** Publish-time check: graph-traverse the workflow definition. If there is a cycle without any `when:` condition that can break it, refuse to publish. Some cycles are intentional (review → request changes → review), allowed only if at least one transition has a guard referencing input data that can change. Runtime safety net: max-transitions counter per request; > 100 transitions pauses for human review.

**15. Multi-region with data residency.** Each region has its full stack. Requester's home region (from HRIS) determines where the request lives. Cross-region approvals: the EU region creates the task and assigns to the US employee, who sees it via the US region's dashboard. When the US employee decides, the decision is forwarded to EU via an authenticated cross-region API call (queued in a `cross_region_decisions_outbox` table and retried idempotently). The decision is recorded in the EU region's tables and audit. The US region keeps only a "this US user sent a decision to EU region" record for its own audit, no PII about the EU request.

The lesson: data residency forces the request to be the unit of locality. The user can be anywhere; the request is somewhere specific.

### 15. Trade-offs worth saying out loud

**Why a custom engine and not Temporal or Step Functions.** Off-the-shelf workflow engines are great for general computation. They are awkward for approval-shaped workflows because the role, delegation, and audit story is approval-specific and would have to be built on top anyway. At 10M+ workflows you might pick Temporal as the runtime; the approval logic stays in your service either way.

**Why Postgres and not Cassandra.** Approval needs strong consistency. No double-approve. No lost decisions. Postgres gives ACID for free. Cassandra would force you to invent compensating logic for the same guarantees.

**Why YAML for workflow definitions and not code.** YAML lets non-engineers author workflows through a UI. Plugins force every workflow change through a deploy. The cost is limited expressiveness; for the few workflows that need real code (a custom integration step), the engine has an `exec` step that runs sandboxed JavaScript.

**Why an immutable audit log and not just event-sourcing the requests.** Event-sourcing would make audit queries fast but ties the application's data model to the audit format. Decoupling lets you refactor the application without breaking audit. Worth the duplication.

**What you would revisit at 10x scale.** Adopt Temporal as the runtime. Move workflow authoring into its own product with its own DB and RBAC. Move audit to a dedicated immutable-storage product (QLDB, or a hash-chained ledger).

### 16. Common interview mistakes

Most weak answers fall into one of these:

**Modeling requests with a hardcoded status enum.** If your design has `status pending | approved | rejected` and transitions live in if-statements, you have written CRUD, not a workflow service. The whole point is a data-driven engine.

**No version pinning on workflows.** If in-flight requests follow the latest version, you introduce time-traveling bugs and break audit replay.

**Self-approval allowed by default.** Junior candidates rarely think of it. The interviewer will ask.

**Audit as a side effect.** "I'll just log it." Audit has a schema, a retention policy, an immutability contract, and a query interface. It is a feature, not a log line.

**Treating notifications as part of the engine.** They are not. Engine emits events, notification service consumes. This separation is what lets you add Slack, Teams, or SMS without touching the engine.

**Designing for write throughput.** Even at enterprise scale you have ten writes per second. The hard numbers are about read latency for dashboards and audit queries.

**Forgetting parallel approval with quorum.** Serial-only works for 80% of workflows. The other 20% (medical, legal, compliance) need parallel. Retrofitting it later is expensive.

**Hand-waving the org service.** The role, delegation, and OOO machinery is half the system. Treating it as a single `manager_id` column loses the design.

**No mention of multi-region or data residency.** GDPR alone forces it at enterprise scale.

**Microservices "the right way" before understanding the workflow shape.** Start from the data model. Service boundaries follow from that, not the other way around.

If you can articulate seven of these ten without prompting, you are interviewing at staff level. The three that separate strong from average answers: engine versus CRUD, audit immutability, and role-resolution depth. Those are the answers a senior architect listens for.
{% endraw %}
