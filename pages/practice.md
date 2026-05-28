---
layout: page
title: Practice
permalink: /practice/
---

<link rel="stylesheet" href="/assets/css/practice.css">

{%- assign sd = site.practice | where: "track", "system-design" -%}
{%- assign de = site.practice | where: "track", "data-engineering" -%}
{%- assign sd_cats = sd | group_by: "category" | sort: "size" | reverse -%}
{%- assign de_cats = de | group_by: "category" | sort: "size" | reverse -%}
{%- assign sd_more = sd_cats | size | minus: 4 -%}
{%- assign de_more = de_cats | size | minus: 4 -%}

<section class="pr-hero">
  <div class="pr-hero-inner">
    <span class="pr-eyebrow">Interview Prep</span>
    <h1 class="pr-title">Practice tracks for real engineering interviews</h1>
    <p class="pr-subtitle">
      Curated, production-grade problems with reference solutions. Each track is built from a public source repository, so new questions appear here within minutes of being added there.
    </p>
  </div>
</section>

<section class="pr-tracks">

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
      <span>{{ sd_cats | size }} categories</span>
    </div>
    <div class="pr-track-chips">
      {% for c in sd_cats limit: 4 %}
        <span class="pr-track-chip">{{ c.name }}<span class="pr-track-chip-count">{{ c.size }}</span></span>
      {% endfor %}
      {% if sd_more > 0 %}
        <span class="pr-track-chip pr-track-chip-more">+{{ sd_more }} more</span>
      {% endif %}
    </div>
  </a>

  <a class="pr-track-card" href="/practice/data-engineering/">
    <div class="pr-track-emoji">🧩</div>
    <h2 class="pr-track-name">
      Data Engineering
      <span class="pr-track-status pr-track-status-live">Live</span>
    </h2>
    <p class="pr-track-desc">
      Real production scenarios: late Kafka events, schema drift, silent ETL bugs, SQL plan reading, cost incidents. Inspired by what actually breaks in production.
    </p>
    <div class="pr-track-meta">
      <span><strong>{{ de | size }}</strong> problems</span>
      <span>Easy to Hard</span>
      <span>{{ de_cats | size }} categories</span>
    </div>
    <div class="pr-track-chips">
      {% for c in de_cats limit: 4 %}
        <span class="pr-track-chip">{{ c.name }}<span class="pr-track-chip-count">{{ c.size }}</span></span>
      {% endfor %}
      {% if de_more > 0 %}
        <span class="pr-track-chip pr-track-chip-more">+{{ de_more }} more</span>
      {% endif %}
    </div>
  </a>

  <a class="pr-track-card" href="/practice/system-design/roadmap/">
    <div class="pr-track-emoji">🧭</div>
    <h2 class="pr-track-name">
      System Design Roadmap
      <span class="pr-track-status pr-track-status-live">Live</span>
    </h2>
    <p class="pr-track-desc">
      A staged learning path covering every concept you need, in the order you need it. Foundations, storage, caching, messaging, scaling, distributed systems, and the interview craft.
    </p>
    <div class="pr-track-meta">
      <span><strong>7</strong> stages</span>
      <span>Beginner to Expert</span>
      <span>No prerequisites</span>
    </div>
  </a>

</section>

> **Tip:** Each problem hides its solution by default. Try the problem first; the solution unlocks with one click and stays unlocked for your next visit.
