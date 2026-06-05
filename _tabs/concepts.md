---
layout: page
title: Concepts
icon: fas fa-book-open
order: 4
permalink: /concepts/
---

<link rel="stylesheet" href="/assets/css/practice.css">
<link rel="stylesheet" href="/assets/css/landing.css">

{%- assign c_sd  = site.sd_concepts     | where: "status", "live" | size -%}
{%- assign c_de  = site.de_concepts     | where: "status", "live" | size -%}
{%- assign c_ai  = site.ai_concepts     | where: "status", "live" | size -%}
{%- assign c_en  = site.energy_concepts                            | size -%}
{%- assign c_total = c_sd | plus: c_de | plus: c_ai | plus: c_en -%}

{%- assign s_sd = site.sd_concepts | group_by: "section" | size -%}
{%- assign s_de = site.de_concepts | group_by: "section" | size -%}
{%- assign s_ai = site.ai_concepts | group_by: "section" | size -%}
{%- assign s_en = site.energy_concepts | group_by: "section" | size -%}

<section class="pr-hero">
  <div class="pr-hero-inner">
    <span class="pr-eyebrow">Concept Libraries</span>
    <h1 class="pr-title">Plain-English answers to the questions every team keeps getting asked.</h1>
    <p class="pr-subtitle">
      Four reference libraries with short, scenario-driven explanations. Use them alongside the roadmaps, or as quick lookups before an interview. Each one is filterable and searchable.
    </p>
    <div class="pr-stats">
      <div class="pr-stat"><strong>{{ c_total }}</strong><span>Topics</span></div>
      <div class="pr-stat"><strong>4</strong><span>Libraries</span></div>
      <div class="pr-stat"><strong>0</strong><span>Prerequisites</span></div>
    </div>
  </div>
</section>

<div class="home-section">
  <h2 class="home-section-title">Pick a library</h2>
  <p class="home-section-lede">All four libraries follow the same shape: short pages, mermaid diagrams, code examples that do something, common mistakes, and a one-line take-home.</p>
  <section class="pr-tracks">

    <a class="pr-track-card" href="/practice/system-design/concepts/">
      <div class="pr-track-emoji">🧭</div>
      <h2 class="pr-track-name">
        System Design Concepts
        <span class="pr-track-status pr-track-status-live">Live</span>
      </h2>
      <p class="pr-track-desc">
        The most common system design questions answered in plain English: caching, load balancers, consistency, queueing, sharding, distributed transactions, plus AWS / GCP / Azure trade-offs.
      </p>
      <div class="pr-track-meta">
        <span><strong>{{ c_sd }}</strong> topics</span>
        <span>{{ s_sd }} sections</span>
        <span>Cloud comparisons</span>
      </div>
    </a>

    <a class="pr-track-card" href="/practice/data-engineering/concepts/">
      <div class="pr-track-emoji">🧱</div>
      <h2 class="pr-track-name">
        Data Engineering Concepts
        <span class="pr-track-status pr-track-status-live">Live</span>
      </h2>
      <p class="pr-track-desc">
        The hard parts of data engineering, distilled. SQL, modeling, file formats, batch, streaming, orchestration, quality, observability, cost, plus warehouse and lakehouse trade-offs.
      </p>
      <div class="pr-track-meta">
        <span><strong>{{ c_de }}</strong> topics</span>
        <span>{{ s_de }} sections</span>
        <span>Warehouse comparisons</span>
      </div>
    </a>

    <a class="pr-track-card" href="/practice/ai-engineering/concepts/">
      <div class="pr-track-emoji">🤖</div>
      <h2 class="pr-track-name">
        AI Engineering Concepts
        <span class="pr-track-status pr-track-status-live">Live</span>
      </h2>
      <p class="pr-track-desc">
        The patterns that show up in production LLM systems: tokens and cost math, prompting as code, RAG and retrieval, agents and tool use, evaluation, plus the production layer (latency, caching, routing, security, observability).
      </p>
      <div class="pr-track-meta">
        <span><strong>{{ c_ai }}</strong> topics</span>
        <span>{{ s_ai }} sections</span>
        <span>Interview craft included</span>
      </div>
    </a>

    <a class="pr-track-card" href="/energy/concepts/">
      <div class="pr-track-emoji">⚡</div>
      <h2 class="pr-track-name">
        Energy Concepts
        <span class="pr-track-status pr-track-status-live">Live</span>
      </h2>
      <p class="pr-track-desc">
        A Sweden-first explanation of how the power grid works for software engineers crossing into energy markets. Frequency, balance, ancillary services, day-ahead and intraday markets, retailers, BRPs, regulation.
      </p>
      <div class="pr-track-meta">
        <span><strong>{{ c_en }}</strong> topics</span>
        <span>{{ s_en }} sections</span>
        <span>Sweden-first</span>
      </div>
    </a>

  </section>
</div>

<div class="home-section">
  <h2 class="home-section-title">How to use a concept library</h2>
  <p class="home-section-lede">A library is a reference, not a course. Three habits make it more than a wiki.</p>
  <section class="pr-tracks">

    <div class="pr-track-card" style="cursor:default;">
      <div class="pr-track-emoji">🔎</div>
      <h2 class="pr-track-name">Search before you scroll</h2>
      <p class="pr-track-desc">
        Each library has a search box and section filters at the top. When you have a specific question, search first. The grid is for browsing; the search is for looking things up.
      </p>
    </div>

    <div class="pr-track-card" style="cursor:default;">
      <div class="pr-track-emoji">⭐</div>
      <h2 class="pr-track-name">Bookmark the take-home</h2>
      <p class="pr-track-desc">
        Every concept ends with a "quick recap" you can copy into your notes. Reading the take-home once a quarter is a cheap way to keep the basics warm before interviews.
      </p>
    </div>

    <div class="pr-track-card" style="cursor:default;">
      <div class="pr-track-emoji">🧭</div>
      <h2 class="pr-track-name">Pair with a roadmap</h2>
      <p class="pr-track-desc">
        Each library is the reference behind one of the <a href="/roadmaps/">roadmaps</a>. When a stage mentions something unfamiliar, the concept is one click away. Use them together.
      </p>
    </div>

  </section>
</div>

> **New here?** Start with the [roadmaps](/roadmaps/) for an ordered path. The concept libraries are the reference you hit when you need a quick answer along the way.
