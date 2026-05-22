---
layout: practice-problem
track: data-engineering
id: 36
title: Scheduled Pipeline Pay Only When Run
slug: 036-scheduled-pipeline-pay-only-when-run
category: Cloud Decisions
difficulty: Easy
topics: [scheduled jobs, Cloud Run Jobs, AWS Batch]
source_url: "https://github.com/shiningflash/data-engineering-practice-problems/tree/main/problems/036-scheduled-pipeline-pay-only-when-run"
solution_lang: markdown
---

{% raw %}

**Scenario:**
A small team has a daily Python ETL that takes about 15 minutes to run. They want it on a schedule (daily at 4 AM), but they want to pay only when it runs. They are price-sensitive and the script today runs on a small VM that sits idle 23 hours a day.

In the interview, the question is:

> A team wants their pipeline on a schedule but only wants to pay when it runs. What options do you give them, and what are the trade offs?

---

### Your Task:

1. List the practical options on AWS and GCP.
2. Compare them on cost, simplicity, and limits.
3. Pick one for the scenario.
4. Mention when the picture changes (longer jobs, more frequent runs, more steps).

---

### What a Good Answer Covers:

* EventBridge + Lambda; Cloud Scheduler + Cloud Function; Cloud Run Jobs.
* The 15-minute Lambda limit.
* AWS Batch / Step Functions; GCP Workflows.
* When to step up to Airflow / Dagster.
* Idle-cost math: the VM was costing $20/month; the function will cost cents.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution 36: Scheduled Pipeline, Pay Only When It Runs

### Short version you can say out loud

> A scheduled function or a scheduled container job. For a 15-minute Python ETL, my default is Cloud Run Job triggered by Cloud Scheduler on GCP, or AWS Batch triggered by EventBridge on AWS. Both bill only when the job runs. Lambda is tempting but is capped at 15 minutes, which is right on the edge for this script. The team's VM probably costs $20-50 a month sitting idle; the serverless version should be cents.

### The options that actually fit

```
GOAL:  every day at 4 AM, run this Python ETL, pay nothing in between

  AWS                                  GCP
  ────────────────────────             ─────────────────────────
  EventBridge → Lambda                  Cloud Scheduler → Cloud Function (gen 2)
       ↓ time limit 15 min                   ↓ time limit 60 min
       (works if job stays short)            (works for this scenario)

  EventBridge → AWS Batch               Cloud Scheduler → Cloud Run Job
       ↓ unlimited runtime                   ↓ unlimited runtime
       (good for longer jobs)                (my default for this scenario)

  EventBridge → Step Functions          Cloud Scheduler → Workflows
       ↓ multi step orchestration            ↓ multi step orchestration
       (good when more than one step)        (good when more than one step)

  Managed Airflow / Dagster cloud       Managed Airflow / Dagster cloud
       ↓ "I'll have many DAGs"               ↓ "I'll have many DAGs"
```

### Picking one for the scenario

15-minute Python ETL, one step, daily. My pick is **Cloud Run Job + Cloud Scheduler** on GCP, or **AWS Batch + EventBridge** on AWS.

Why not Lambda or Cloud Function:

* The job takes 15 minutes. Lambda's hard cap is 15 minutes. One slow day and the job dies mid-way.
* Cloud Function gen 2 has a 60-minute cap, so it would technically fit, but if the script grows in scope, you hit the cap.

Why Cloud Run Job:

* Pay-per-second, only while running. ~15 min × pennies/min = pennies per run.
* No runtime limit that the team will hit.
* The Python code runs in a container they control; system dependencies (parquet, gdal, oracle clients) are easy to bake in.
* Triggered by Cloud Scheduler with a cron expression.

Why AWS Batch on AWS:

* Same idea: a managed compute environment that spins up on demand.
* Slight upfront setup (compute environment, job queue, job definition).
* For a single job, AWS Step Functions calling ECS Fargate may be simpler.

### The actual setup, in shape

```yaml
# Cloud Run Job
gcloud run jobs create daily-etl \
  --image gcr.io/proj/etl:v1 \
  --region asia-southeast1 \
  --memory 2Gi --cpu 1 --task-timeout 30m

# Cloud Scheduler
gcloud scheduler jobs create http etl-trigger \
  --schedule "0 4 * * *" \
  --uri "https://...projects.../jobs/daily-etl:run" \
  --oidc-service-account-email ... \
  --location asia-southeast1
```

Cost for 15-minute runs daily: under a dollar per month for the compute, plus very small Scheduler fees. The VM the team is moving away from probably costs more than that idle.

### When the choice changes

**If the job is short (< 5 min) and single-step:**
Lambda or Cloud Function is the cheapest, simplest option. Just a function + EventBridge / Scheduler rule.

**If the job grows to multiple steps with branching or retries:**
Step Functions on AWS, Workflows on GCP. They handle orchestration, retries and conditional logic.

**If the team has many jobs (10+) and wants dependencies between them:**
This is where managed Airflow (MWAA, Cloud Composer) or Dagster Cloud earns its cost. A single scheduled cron is no longer enough.

**If the job needs GPUs or large memory:**
Cloud Run Jobs supports up to 32 GB and high CPU. For bigger workloads, AWS Batch with spot instances, or GKE/EKS.

**If the team needs strict cron semantics with missed-run replay:**
Airflow / Dagster handle this. Cloud Scheduler is simpler but does not retry missed schedules automatically (Cloud Scheduler does retry, but the semantics are different).

### What about the existing VM?

The VM is a comfortable place for people new to cloud, but it has hidden costs:

* Paying 24/7 for ~3% utilization.
* Manual OS patching, dependency upgrades, log rotation.
* Single point of failure if the VM dies.

Cost math, rough:

* Small VM (t3.small or e2-small), $15-25/month, year-round.
* Cloud Run Job same workload: ~$0.50-$1/month.

The savings are real, but the bigger win is one less server to babysit.

### Common mistakes interviewers want you to name

1. **Lambda for a 15-minute job.** Will time out occasionally.
2. **Spinning up an EC2 / VM** and scheduling with cron because "that's how Linux does it." Loses the cost benefit.
3. **Managed Airflow for one job.** Overkill, expensive idle cost.
4. **Cloud Run service instead of Cloud Run Job.** Service is for HTTP; Job is the one-shot runner.
5. **Forgetting timezone of the cron.** Cloud Scheduler defaults can surprise you.

### Bonus follow-up the interviewer might throw

> *"What if the job needs to read from a Postgres in the same VPC?"*

Both Cloud Run Job and AWS Batch can run inside a VPC. You attach a VPC connector (GCP) or a VPC subnet (AWS Batch). The job gets a private IP and can reach internal services. Slightly more setup, but the trade-off is worth keeping private databases off the public internet.
{% endraw %}
