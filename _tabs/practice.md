---
# Practice tab — landing hub. Lists all tracks; each card links to its own
# filterable problem index. Tracks are populated by the sync workflow that
# pulls problems from external repos using the same frontmatter contract.
icon: fas fa-dumbbell
order: 3
title: Practice
permalink: /practice/
---

<link rel="stylesheet" href="/assets/css/practice.css">

{%- assign de = site.practice | where: "track", "data-engineering" -%}

<div class="pr-hero">
  <div class="pr-hero-inner">
    <span class="pr-eyebrow">Interview Prep</span>
    <h1 class="pr-title">Practice tracks for real engineering interviews</h1>
    <p class="pr-subtitle">
      Curated, production-grade problems with reference solutions. Each track is
      built from a public source repository — new questions appear here within
      minutes of being added there.
    </p>
  </div>
</div>

<section class="pr-tracks">

  <a class="pr-track-card" href="/practice/data-engineering/">
    <div class="pr-track-emoji">🧩</div>
    <h2 class="pr-track-name">
      Data Engineering
      <span class="pr-track-status pr-track-status-live">Live</span>
    </h2>
    <p class="pr-track-desc">
      Real-world scenarios — late Kafka events, schema drift, silent ETL bugs,
      SQL plan reading, cost incidents. Inspired by what actually breaks in
      production.
    </p>
    <div class="pr-track-meta">
      <span><strong>{{ de | size }}</strong> problems</span>
      <span>Easy → Hard</span>
      <span>14 categories</span>
    </div>
  </a>

  <div class="pr-track-card" style="cursor: not-allowed; opacity: .75;">
    <div class="pr-track-emoji">🏗️</div>
    <h2 class="pr-track-name">
      System Design
      <span class="pr-track-status pr-track-status-soon">Coming Soon</span>
    </h2>
    <p class="pr-track-desc">
      End-to-end design questions: rate limiters, feeds, search, payments,
      chat — with capacity math, trade-off analysis and diagrams.
    </p>
    <div class="pr-track-meta">
      <span><strong>—</strong> problems</span>
      <span>Medium → Hard</span>
    </div>
  </div>

</section>

> **Tip:** Each problem hides its solution by default. Try the problem first — the solution unlocks with one click and stays unlocked for your next visit.
