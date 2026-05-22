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
{%- assign sd = site.practice | where: "track", "system-design" -%}

<div class="pr-hero">
  <div class="pr-hero-inner">
    <span class="pr-eyebrow">Interview Prep</span>
    <h1 class="pr-title">Practice tracks for real engineering interviews</h1>
    <p class="pr-subtitle">
      Curated, production-grade problems with reference solutions. Each track is built from a public source repository, so new questions appear here within minutes of being added there.
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
      Real-world scenarios: late Kafka events, schema drift, silent ETL bugs, SQL plan reading, cost incidents. Inspired by what actually breaks in production.
    </p>
    <div class="pr-track-meta">
      <span><strong>{{ de | size }}</strong> problems</span>
      <span>Easy to Hard</span>
      <span>14 categories</span>
    </div>
  </a>

  <a class="pr-track-card" href="/practice/system-design/">
    <div class="pr-track-emoji">🏗️</div>
    <h2 class="pr-track-name">
      System Design
      <span class="pr-track-status pr-track-status-live">Live</span>
    </h2>
    <p class="pr-track-desc">
      Interview-style design questions: URL shorteners, news feeds, chat, ride sharing, video streaming. Capacity math, partial diagrams you complete, follow-up scenarios with answers.
    </p>
    <div class="pr-track-meta">
      <span><strong>{{ sd | size }}</strong> problems</span>
      <span>Medium to Hard</span>
      <span>9 categories</span>
    </div>
  </a>

</section>

> **Tip:** Each problem hides its solution by default. Try the problem first; the solution unlocks with one click and stays unlocked for your next visit.
