---
layout: page
title: Practices
icon: fas fa-dumbbell
order: 5
permalink: /practice/
---

<link rel="stylesheet" href="/assets/css/practice.css">
<link rel="stylesheet" href="/assets/css/landing.css">

{%- assign sd = site.practice | where: "track", "system-design" -%}
{%- assign de = site.practice | where: "track", "data-engineering" -%}
{%- assign sd_cats = sd | group_by: "category" | sort: "size" | reverse -%}
{%- assign de_cats = de | group_by: "category" | sort: "size" | reverse -%}
{%- assign sd_more = sd_cats | size | minus: 4 -%}
{%- assign de_more = de_cats | size | minus: 4 -%}
{%- assign practice_total = sd | size | plus: de.size -%}

<section class="pr-hero">
  <div class="pr-hero-inner">
    <span class="pr-eyebrow">Hands-on Practice</span>
    <h1 class="pr-title">Real production problems, not toy puzzles.</h1>
    <p class="pr-subtitle">
      Curated, production-grade practice problems with reference solutions. Each track is built from a public source repository, so new questions appear here within minutes of being added there. Filterable by category, difficulty, and a curated must-have set for senior interviews.
    </p>
    <div class="pr-stats">
      <div class="pr-stat"><strong>{{ practice_total }}</strong><span>Problems</span></div>
      <div class="pr-stat"><strong>2</strong><span>Live tracks</span></div>
      <div class="pr-stat"><strong>0</strong><span>Prerequisites</span></div>
    </div>
  </div>
</section>

<div class="home-section">
  <h2 class="home-section-title">Pick a practice track</h2>
  <p class="home-section-lede">Each problem hides its solution by default. Try it first; the solution unlocks with one click and stays unlocked for your next visit.</p>
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

    <a class="pr-track-card" href="/practice/ai-engineering/">
      <div class="pr-track-emoji">🤖</div>
      <h2 class="pr-track-name">
        AI Engineering
        <span class="pr-track-status pr-track-status-soon">Roadmap & Concepts</span>
      </h2>
      <p class="pr-track-desc">
        No practice problems yet on this track. The <a href="/practice/ai-engineering/roadmap/">roadmap</a> and <a href="/practice/ai-engineering/concepts/">concept library</a> cover the patterns; production problems are on the way.
      </p>
      <div class="pr-track-meta">
        <span>Roadmap available</span>
        <span>Concept library live</span>
        <span>Practice coming</span>
      </div>
    </a>

  </section>
</div>

<div class="home-section">
  <h2 class="home-section-title">How to use a practice track</h2>
  <p class="home-section-lede">A practice track is a tool, not a checklist. Three habits make it useful.</p>
  <section class="pr-tracks">

    <div class="pr-track-card" style="cursor:default;">
      <div class="pr-track-emoji">🙈</div>
      <h2 class="pr-track-name">Solve before you peek</h2>
      <p class="pr-track-desc">
        Solutions are gated for a reason. Spend 15 to 30 minutes on a problem before opening the answer, even when the answer feels obvious. The struggle is where the learning happens.
      </p>
    </div>

    <div class="pr-track-card" style="cursor:default;">
      <div class="pr-track-emoji">⭐</div>
      <h2 class="pr-track-name">Start with must-haves</h2>
      <p class="pr-track-desc">
        Each track has a curated "interview must-have" filter. Those are the problems that show up in almost every senior loop. Solve those first; the rest are depth and variety.
      </p>
    </div>

    <div class="pr-track-card" style="cursor:default;">
      <div class="pr-track-emoji">🔁</div>
      <h2 class="pr-track-name">Revisit at intervals</h2>
      <p class="pr-track-desc">
        Solving once is not learning. Try a problem in week 1, again in week 4, again in week 12. The spaced repetition turns "I solved it once" into "I can explain it in an interview."
      </p>
    </div>

  </section>
</div>

> **Looking for the path?** The [roadmaps](/roadmaps/) put the practice in order. The [concept libraries](/concepts/) explain the underlying ideas.
