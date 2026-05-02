---
# the default layout is 'page'
icon: fas fa-info-circle
order: 4
---

<style>
/* ══════════════════════════════════════════════
   ABOUT PAGE — Premium Design
   Chirpy CSS variables ensure dark/light support.
   Custom accent palette layered on top.
══════════════════════════════════════════════ */

:root {
  --c-green:  #10b981; --c-green-bg:  rgba(16,185,129,.09);
  --c-blue:   #3b82f6; --c-blue-bg:   rgba(59,130,246,.09);
  --c-amber:  #f59e0b; --c-amber-bg:  rgba(245,158,11,.09);
  --c-violet: #8b5cf6; --c-violet-bg: rgba(139,92,246,.09);
  --c-pink:   #ec4899; --c-pink-bg:   rgba(236,72,153,.09);
  --c-teal:   #14b8a6; --c-teal-bg:   rgba(20,184,166,.09);
  --c-orange: #f97316; --c-orange-bg: rgba(249,115,22,.09);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-mode="light"]) {
    --c-green:  #34d399; --c-green-bg:  rgba(52,211,153,.11);
    --c-blue:   #60a5fa; --c-blue-bg:   rgba(96,165,250,.11);
    --c-amber:  #fbbf24; --c-amber-bg:  rgba(251,191,36,.11);
    --c-violet: #a78bfa; --c-violet-bg: rgba(167,139,250,.11);
    --c-pink:   #f472b6; --c-pink-bg:   rgba(244,114,182,.11);
    --c-teal:   #2dd4bf; --c-teal-bg:   rgba(45,212,191,.11);
    --c-orange: #fb923c; --c-orange-bg: rgba(251,146,60,.11);
  }
}
[data-mode="dark"] {
  --c-green:  #34d399; --c-green-bg:  rgba(52,211,153,.11);
  --c-blue:   #60a5fa; --c-blue-bg:   rgba(96,165,250,.11);
  --c-amber:  #fbbf24; --c-amber-bg:  rgba(251,191,36,.11);
  --c-violet: #a78bfa; --c-violet-bg: rgba(167,139,250,.11);
  --c-pink:   #f472b6; --c-pink-bg:   rgba(244,114,182,.11);
  --c-teal:   #2dd4bf; --c-teal-bg:   rgba(45,212,191,.11);
  --c-orange: #fb923c; --c-orange-bg: rgba(251,146,60,.11);
}

/* ─── Hero ─── */
.ap-hero {
  position: relative;
  border-radius: 18px;
  padding: 2.5rem 2.2rem;
  margin-bottom: 2.5rem;
  border: 1px solid var(--main-border-color);
  background: var(--sidebar-bg);
  overflow: hidden;
}
.ap-hero::before {
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(circle, rgba(0,0,0,.04) 1px, transparent 1px) center/22px 22px,
    linear-gradient(135deg, rgba(59,130,246,.08) 0%, rgba(139,92,246,.06) 50%, rgba(16,185,129,.05) 100%);
  pointer-events: none;
}
.ap-hero > * { position: relative; }

.ap-hero-name {
  font-size: clamp(1.7rem, 4vw, 2.2rem);
  font-weight: 800;
  margin: 0 0 0.25rem;
  background: linear-gradient(90deg, var(--c-blue) 0%, var(--c-violet) 55%, var(--c-green) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1.2;
}
.ap-hero-title {
  font-size: 1rem; font-weight: 500;
  color: var(--text-color); opacity: .82; margin: 0 0 .3rem;
}
.ap-hero-loc {
  font-size: .85rem; opacity: .6; margin-bottom: .9rem;
}
.ap-hero-loc i { margin-right: 4px; color: var(--c-pink); }

.ap-badges { display: flex; flex-wrap: wrap; gap: 7px; margin: .8rem 0 1.2rem; }

.ap-hero-bio {
  font-size: .96rem; line-height: 1.78;
  color: var(--text-color); opacity: .88;
  margin-bottom: 1.4rem; max-width: 700px;
}

/* Stat grid */
.ap-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: .8rem; margin: 1.2rem 0 1.5rem;
}
.ap-stat {
  text-align: center; padding: 1rem .5rem;
  border-radius: 12px; border: 1px solid var(--main-border-color);
  background: var(--main-bg); transition: transform .2s, box-shadow .2s;
}
.ap-stat:hover { transform: translateY(-3px); box-shadow: 0 6px 22px rgba(0,0,0,.12); }
.ap-stat-num {
  font-size: 1.65rem; font-weight: 800; line-height: 1;
  background: linear-gradient(135deg, var(--c-blue), var(--c-violet));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.ap-stat-lbl { font-size: .74rem; opacity: .62; margin-top: 4px; line-height: 1.3; }

/* Focus bullets */
.ap-focus { display: flex; flex-direction: column; gap: .35rem; margin-top: 1rem; }
.ap-focus-item { display: flex; align-items: flex-start; gap: .65rem; font-size: .93rem; opacity: .9; }
.ap-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 7px; }
.dot-green { background: var(--c-green); }
.dot-blue  { background: var(--c-blue); }
.dot-violet{ background: var(--c-violet); }

/* ─── Section headers ─── */
.ap-section { display: flex; align-items: center; gap: .7rem; margin: 2.8rem 0 1.2rem; }
.ap-sec-icon {
  width: 38px; height: 38px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  font-size: .92rem; flex-shrink: 0;
}
.ap-sec-title {
  font-size: 1.3rem; font-weight: 700;
  color: var(--heading-color); margin: 0;
  padding-bottom: 3px; border-bottom: 2px solid;
}

/* Color utility classes */
.ic-blue   { background: var(--c-blue-bg);   color: var(--c-blue);   border: 1px solid var(--c-blue); }
.ic-green  { background: var(--c-green-bg);  color: var(--c-green);  border: 1px solid var(--c-green); }
.ic-amber  { background: var(--c-amber-bg);  color: var(--c-amber);  border: 1px solid var(--c-amber); }
.ic-violet { background: var(--c-violet-bg); color: var(--c-violet); border: 1px solid var(--c-violet); }
.ic-pink   { background: var(--c-pink-bg);   color: var(--c-pink);   border: 1px solid var(--c-pink); }
.ic-teal   { background: var(--c-teal-bg);   color: var(--c-teal);   border: 1px solid var(--c-teal); }
.ic-orange { background: var(--c-orange-bg); color: var(--c-orange); border: 1px solid var(--c-orange); }

.bc-blue   { border-color: var(--c-blue)!important; }
.bc-green  { border-color: var(--c-green)!important; }
.bc-amber  { border-color: var(--c-amber)!important; }
.bc-violet { border-color: var(--c-violet)!important; }
.bc-pink   { border-color: var(--c-pink)!important; }
.bc-teal   { border-color: var(--c-teal)!important; }
.bc-orange { border-color: var(--c-orange)!important; }

.c-blue   { color: var(--c-blue)!important; }
.c-green  { color: var(--c-green)!important; }
.c-amber  { color: var(--c-amber)!important; }
.c-violet { color: var(--c-violet)!important; }
.c-pink   { color: var(--c-pink)!important; }
.c-teal   { color: var(--c-teal)!important; }
.c-orange { color: var(--c-orange)!important; }

/* ─── Experience cards ─── */
.ap-exp-card {
  border: 1px solid var(--main-border-color);
  border-left: 4px solid var(--main-border-color);
  border-radius: 0 14px 14px 0;
  padding: 1.3rem 1.5rem; margin-bottom: 1.1rem;
  background: var(--main-bg); transition: box-shadow .2s, transform .2s;
}
.ap-exp-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.1); transform: translateX(3px); }

.ap-exp-head {
  display: flex; justify-content: space-between;
  align-items: flex-start; flex-wrap: wrap; gap: .4rem; margin-bottom: .45rem;
}
.ap-exp-role  { font-size: 1.05rem; font-weight: 700; margin: 0; color: var(--heading-color); }
.ap-exp-co    { font-size: .92rem; font-weight: 600; }
.ap-exp-loc   { font-size: .82rem; opacity: .6; }
.ap-exp-date  {
  font-size: .79rem; opacity: .65; white-space: nowrap;
  background: var(--sidebar-bg); padding: 2px 9px;
  border-radius: 20px; border: 1px solid var(--main-border-color); align-self: flex-start;
}
.ap-exp-summary { font-size: .91rem; margin: .35rem 0 .5rem; opacity: .87; line-height: 1.65; }

.ap-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: .71rem; font-weight: 700; padding: 2px 9px;
  border-radius: 20px; vertical-align: middle; margin-left: 5px;
}
.badge-amber  { background: var(--c-amber-bg);  color: var(--c-amber);  border: 1px solid var(--c-amber); }
.badge-blue   { background: var(--c-blue-bg);   color: var(--c-blue);   border: 1px solid var(--c-blue); }
.badge-green  { background: var(--c-green-bg);  color: var(--c-green);  border: 1px solid var(--c-green); }
.badge-violet { background: var(--c-violet-bg); color: var(--c-violet); border: 1px solid var(--c-violet); }

/* Tech tags */
.ap-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: .7rem; }
.ap-tag {
  display: inline-block; padding: 2px 10px; font-size: .73rem;
  border-radius: 20px; border: 1px solid var(--main-border-color);
  background: var(--sidebar-bg); color: var(--text-color); white-space: nowrap;
}

/* details / summary */
details { margin-top: .55rem; }
details summary {
  cursor: pointer; list-style: none; padding: .3rem 0;
  font-size: .84rem; font-weight: 600; color: var(--link-color);
  display: inline-flex; align-items: center; gap: 5px; user-select: none;
}
details summary::-webkit-details-marker { display: none; }
details summary .chev { font-size: .72rem; transition: transform .2s; display: inline-block; }
details[open] summary .chev { transform: rotate(90deg); }
details ul { margin-top: .55rem; font-size: .87rem; padding-left: 1.3rem; }
details ul li { margin-bottom: .28rem; line-height: 1.55; }
details .det-body { margin-top: .55rem; }

/* ─── Skill grid ─── */
.ap-skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  gap: .9rem;
}
.ap-skill-card {
  border: 1px solid var(--main-border-color);
  border-radius: 12px; padding: 1rem 1.2rem; background: var(--main-bg);
}
.ap-skill-card h4 {
  font-size: .88rem; font-weight: 700; margin: 0 0 .6rem;
  color: var(--heading-color); display: flex; align-items: center; gap: 6px;
}

/* ─── Project cards ─── */
.ap-proj-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}
.ap-proj-card {
  border: 1px solid var(--main-border-color); border-radius: 14px;
  padding: 1.2rem 1.4rem; background: var(--main-bg);
  transition: box-shadow .2s, transform .2s;
  display: flex; flex-direction: column;
}
.ap-proj-card:hover { box-shadow: 0 5px 22px rgba(0,0,0,.11); transform: translateY(-3px); }
.ap-proj-head { display: flex; align-items: center; gap: .6rem; margin-bottom: .4rem; }
.ap-proj-icon {
  width: 34px; height: 34px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: .9rem; flex-shrink: 0;
}
.ap-proj-name { font-size: .97rem; font-weight: 700; margin: 0; color: var(--heading-color); }
.ap-proj-desc { font-size: .85rem; opacity: .8; flex: 1; margin: 0 0 .8rem; line-height: 1.62; }
.ap-proj-links { display: flex; gap: .7rem; margin-top: auto; }
.ap-proj-links a {
  font-size: .8rem; font-weight: 600; color: var(--link-color);
  text-decoration: none; display: inline-flex; align-items: center; gap: 4px;
}
.ap-proj-links a:hover { text-decoration: underline; }

/* ─── Certification grid ─── */
.ap-cert-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: .8rem;
}
.ap-cert-card {
  border: 1px solid var(--main-border-color); border-radius: 11px;
  padding: .9rem 1rem; background: var(--main-bg);
  display: flex; align-items: flex-start; gap: .7rem;
  transition: box-shadow .2s, transform .2s;
}
.ap-cert-card:hover { box-shadow: 0 3px 14px rgba(0,0,0,.09); transform: translateY(-2px); }
.ap-cert-logo {
  width: 34px; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: .75rem; font-weight: 800; flex-shrink: 0; text-align: center; line-height: 1.1;
}
.ap-cert-name   { font-size: .83rem; font-weight: 700; color: var(--heading-color); line-height: 1.3; }
.ap-cert-issuer { font-size: .76rem; opacity: .6; margin-top: 2px; }
.ap-cert-year   { font-size: .71rem; opacity: .5; margin-top: 1px; }

/* ─── Award items ─── */
.ap-award-list { display: flex; flex-direction: column; gap: .75rem; }
.ap-award-item {
  display: flex; align-items: flex-start; gap: .9rem;
  padding: .9rem 1.1rem; border-radius: 11px;
  border: 1px solid var(--main-border-color); background: var(--main-bg);
  transition: transform .2s;
}
.ap-award-item:hover { transform: translateX(4px); }
.ap-award-ic {
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem; flex-shrink: 0;
}
.ap-award-title { font-size: .93rem; font-weight: 700; color: var(--heading-color); }
.ap-award-sub   { font-size: .79rem; opacity: .62; margin-top: 2px; line-height: 1.4; }

/* ─── Volunteer cards ─── */
.ap-vol-card {
  border: 1px solid var(--main-border-color);
  border-left: 4px solid var(--c-violet);
  border-radius: 0 12px 12px 0; padding: 1.1rem 1.4rem; margin-bottom: 1rem;
  background: var(--main-bg); transition: box-shadow .2s;
}
.ap-vol-card:hover { box-shadow: 0 3px 14px rgba(0,0,0,.09); }
.ap-vol-head { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .3rem; }
.ap-vol-role { font-size: 1rem; font-weight: 700; margin: 0; color: var(--heading-color); }
.ap-vol-date { font-size: .78rem; opacity: .55; align-self: center; }
.ap-vol-org  { font-size: .87rem; font-weight: 600; opacity: .8; margin: .2rem 0 .4rem; }

.ap-chips { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .6rem; }
.ap-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 10px; border-radius: 20px; font-size: .76rem; font-weight: 600;
}
.chip-violet { background: var(--c-violet-bg); color: var(--c-violet); border: 1px solid var(--c-violet); }
.chip-green  { background: var(--c-green-bg);  color: var(--c-green);  border: 1px solid var(--c-green); }
.chip-pink   { background: var(--c-pink-bg);   color: var(--c-pink);   border: 1px solid var(--c-pink); }

/* ─── Language cards ─── */
.ap-lang-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: .85rem;
}
.ap-lang-card {
  border: 1px solid var(--main-border-color); border-radius: 12px;
  padding: 1.1rem 1rem; background: var(--main-bg);
  text-align: center; transition: transform .2s;
}
.ap-lang-card:hover { transform: translateY(-2px); }
.ap-lang-flag  { font-size: 2rem; line-height: 1; margin-bottom: .35rem; }
.ap-lang-name  { font-size: .95rem; font-weight: 700; color: var(--heading-color); }
.ap-lang-level { font-size: .76rem; opacity: .6; margin-top: 2px; }
.ap-lang-bar {
  height: 5px; background: var(--main-border-color);
  border-radius: 4px; margin-top: .55rem; overflow: hidden;
}
.ap-lang-fill { height: 100%; border-radius: 4px; }

/* ─── Connect ─── */
.ap-connect {
  border-radius: 18px; padding: 2.2rem 2rem; margin-top: 2.8rem;
  text-align: center; background: var(--sidebar-bg);
  border: 1px solid var(--main-border-color);
  position: relative; overflow: hidden;
}
.ap-connect::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(circle, rgba(0,0,0,.04) 1px, transparent 1px) center/22px 22px,
    linear-gradient(135deg, rgba(59,130,246,.07) 0%, rgba(139,92,246,.05) 55%, rgba(16,185,129,.04) 100%);
  pointer-events: none;
}
.ap-connect > * { position: relative; }
.ap-connect-quote {
  font-size: 1.07rem; font-weight: 600; line-height: 1.65;
  max-width: 560px; margin: 0 auto 1.2rem; color: var(--text-color);
}
.ap-connect-btns { display: flex; flex-wrap: wrap; justify-content: center; gap: .8rem; }
.ap-connect-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: .5rem 1.3rem; border-radius: 24px;
  font-size: .87rem; font-weight: 600;
  border: 1px solid var(--main-border-color); background: var(--main-bg);
  color: var(--text-color); text-decoration: none; transition: all .2s;
}
.ap-connect-btn:hover {
  background: var(--c-blue-bg); border-color: var(--c-blue);
  color: var(--c-blue); transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(0,0,0,.1);
}

/* misc */
.ap-pub-card {
  border: 1px solid var(--main-border-color);
  border-left: 4px solid var(--c-teal);
  border-radius: 0 12px 12px 0;
  padding: 1.3rem 1.5rem; background: var(--main-bg);
}
.ap-cp-card {
  border: 1px solid var(--main-border-color);
  border-radius: 12px; padding: 1.2rem 1.5rem; background: var(--main-bg);
}
.ap-cp-card ul { margin: 0; font-size: .92rem; padding-left: 1.3rem; }
.ap-cp-card ul li { margin-bottom: .3rem; }
</style>

<!-- ══════════════════════════════════════════
     HERO
══════════════════════════════════════════ -->
<div class="ap-hero">
  <h1 class="ap-hero-name">Amirul Islam Al Mamun</h1>
  <div class="ap-hero-title">ML Data Engineer &nbsp;·&nbsp; Senior Backend Engineer &nbsp;·&nbsp; Python · Cloud · Microservices · System Design</div>
  <div class="ap-hero-loc"><i class="fas fa-map-marker-alt"></i> Malmö, Sweden</div>

  <div class="ap-badges">
    <a href="https://www.linkedin.com/in/amirulislamalmamun/"><img src="https://img.shields.io/badge/-amirulislamalmamun-blue?style=flat-square&logo=Linkedin&logoColor=white" alt="LinkedIn"></a>
    <a href="https://github.com/shiningflash"><img src="https://img.shields.io/badge/-shiningflash-black?style=flat-square&logo=github&logoColor=white" alt="GitHub"></a>
    <a href="https://medium.com/@amirulislamalmamun"><img src="https://img.shields.io/badge/-@amirulislamalmamun-03a57a?style=flat-square&labelColor=000000&logo=Medium" alt="Medium"></a>
    <a href="mailto:amirulislamalmamun@gmail.com"><img src="https://img.shields.io/badge/-Email-c14438?style=flat-square&logo=Gmail&logoColor=white" alt="Email"></a>
  </div>

  <p class="ap-hero-bio">
    I care about how things work — and how they keep working. My job as a data engineer is to make complexity disappear and reliability feel effortless. I started as a backend developer obsessed with clean code and fell in love with data. Today I design systems that move it faster, safer, and with purpose.<br><br>
    With nearly <strong>6 years</strong> of experience, I've built high-performance, cloud-native data platforms and backends powering products used by <strong>1M+ users</strong> across Europe and Southeast Asia. At <strong>Truxel</strong>, I architect real-time IoT pipelines with sub-second latency for renewable energy. At <strong>Supertal</strong>, I scaled e-commerce platforms to a million users — and earned a <strong>double promotion in 7 months</strong>. I lead with clarity, build with intention, and ship systems teams can trust.
  </p>

  <div class="ap-stats">
    <div class="ap-stat">
      <div class="ap-stat-num">6+</div>
      <div class="ap-stat-lbl">Years Experience</div>
    </div>
    <div class="ap-stat">
      <div class="ap-stat-num">1M+</div>
      <div class="ap-stat-lbl">Users Served</div>
    </div>
    <div class="ap-stat">
      <div class="ap-stat-num">16K+</div>
      <div class="ap-stat-lbl">LinkedIn Following</div>
    </div>
    <div class="ap-stat">
      <div class="ap-stat-num">1500+</div>
      <div class="ap-stat-lbl">Problems Solved</div>
    </div>
    <div class="ap-stat">
      <div class="ap-stat-num">20+</div>
      <div class="ap-stat-lbl">Keynote Talks</div>
    </div>
    <div class="ap-stat">
      <div class="ap-stat-num">500+</div>
      <div class="ap-stat-lbl">Volunteers Led</div>
    </div>
  </div>

  <div class="ap-focus">
    <div class="ap-focus-item"><span class="ap-dot dot-green"></span> Turning complex data systems into clean, reliable, and scalable pipelines.</div>
    <div class="ap-focus-item"><span class="ap-dot dot-blue"></span> Bringing engineering discipline to AI-driven, real-time data environments.</div>
    <div class="ap-focus-item"><span class="ap-dot dot-violet"></span> Writing code that's not only fast — but easy for teams to trust and extend.</div>
  </div>
</div>

<!-- ══════════════════════════════════════════
     PROFESSIONAL EXPERIENCE
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-blue"><i class="fas fa-briefcase"></i></div>
  <h2 class="ap-sec-title bc-blue">Professional Experience</h2>
</div>

<!-- Truxel -->
<div class="ap-exp-card bc-green">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">ML Data Engineer <span class="ap-badge badge-green"><i class="fas fa-bolt"></i> Data Platform Owner</span></p>
      <span class="ap-exp-co c-green">Truxel</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Sweden · Hybrid</span>
    </div>
    <span class="ap-exp-date">Jan 2025 – Present</span>
  </div>
  <p class="ap-exp-summary">
    As <strong>Data Platform Owner</strong>, I design and operate real-time data platforms for renewable energy systems — enabling large-scale IoT telemetry ingestion, analytics, and ML-driven optimization of battery systems, PV inverters, and energy meters with <strong>sub-second latency</strong> and <strong>99.9% uptime</strong>.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> View contributions &amp; impact</summary>
    <ul>
      <li>Designed <strong>real-time ETL pipelines</strong> processing high-frequency IoT energy data (batteries, PV inverters, meters), achieving sub-second latency with 99.9% reliability for real-time monitoring and control.</li>
      <li>Built <strong>cloud-native infrastructure</strong> on <strong>GCP</strong> (BigQuery, Pub/Sub, Cloud Storage, Cloud Functions), integrated with <strong>PostgreSQL</strong> and <strong>TimescaleDB</strong> for scalable analytics and historical insights.</li>
      <li>Developed <strong>Python-based ingestion services</strong> using <strong>MQTT</strong> and <strong>Modbus (TCP/RTU)</strong>; reduced message delays and bottlenecks by over <strong>30%</strong>.</li>
      <li>Implemented <strong>Dagster</strong> and <strong>Airflow</strong> orchestration for energy market, grid frequency, and FCR-N/FCR-D balancing data — improving transparency and scheduling efficiency.</li>
      <li>Designed schemas using <strong>Avro</strong> and <strong>BigQuery</strong> optimised for OLAP queries; modelled data with <strong>dbt</strong> for reporting and analytics layers.</li>
      <li>Built <strong>Grafana</strong> dashboards and alerting pipelines for grid performance and battery diagnostics, enabling proactive maintenance decisions.</li>
      <li>Contributed to backend architecture, CI/CD pipelines (<strong>Docker</strong>, <strong>Kubernetes</strong>, <strong>GitHub Actions</strong>), and system documentation for long-term maintainability.</li>
      <li>Enabling data-driven insights and predictive control for renewable energy — helping drive Europe's transition to smarter, greener, and more resilient power infrastructure.</li>
    </ul>
  </details>
  <div class="ap-tags">
    <span class="ap-tag">Python</span><span class="ap-tag">Kafka</span><span class="ap-tag">MQTT</span><span class="ap-tag">Modbus</span><span class="ap-tag">Dagster</span><span class="ap-tag">Airflow</span><span class="ap-tag">BigQuery</span><span class="ap-tag">Pub/Sub</span><span class="ap-tag">PostgreSQL</span><span class="ap-tag">TimescaleDB</span><span class="ap-tag">dbt</span><span class="ap-tag">Docker</span><span class="ap-tag">Kubernetes</span><span class="ap-tag">GCP</span><span class="ap-tag">Grafana</span>
  </div>
</div>

<!-- Upwork -->
<div class="ap-exp-card bc-orange">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">Backend Engineer <span class="ap-badge badge-amber">Freelance</span></p>
      <span class="ap-exp-co c-orange">Upwork</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Sweden · Remote</span>
    </div>
    <span class="ap-exp-date">Sep 2024 – Jan 2025</span>
  </div>
  <p class="ap-exp-summary">
    Delivered backend development and automation solutions for international clients, building RESTful services and integration workflows with Python-based architectures.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> View contributions &amp; impact</summary>
    <ul>
      <li>Built and optimised <strong>RESTful APIs</strong> using Python, improving backend performance and maintainability across client projects.</li>
      <li>Scripted and automated <strong>Printful</strong> platform workflows, enhancing operational efficiency in daily fulfilment tasks.</li>
      <li>Conducted analysis, design, and development of user functional requirements — ensuring seamless user experience across delivered systems.</li>
      <li>Delivered Python backend solutions for web services, data processing, and automation pipelines.</li>
    </ul>
  </details>
  <div class="ap-tags">
    <span class="ap-tag">Python</span><span class="ap-tag">REST APIs</span><span class="ap-tag">Automation</span><span class="ap-tag">FastAPI</span>
  </div>
</div>

<!-- WellDev -->
<div class="ap-exp-card bc-blue">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">Senior Software Engineer <span class="ap-badge badge-blue"><i class="fas fa-users"></i> Tech Lead</span></p>
      <span class="ap-exp-co c-blue">WellDev</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Bangladesh → Switzerland (Remote)</span>
    </div>
    <span class="ap-exp-date">Jan 2024 – Aug 2024</span>
  </div>
  <p class="ap-exp-summary">
    Led backend engineering across enterprise document processing and NLP-based analytics platforms. Boosted API performance by <strong>35%</strong>, slashed code complexity by <strong>50%</strong>, hit <strong>100% unit test coverage</strong>, and introduced <strong>JWT-based multi-tenant security</strong>. Also supported talent acquisition through technical interviews.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> View contributions &amp; impact</summary>
    <ul>
      <li><strong>API Performance:</strong> Boosted API speed by <strong>35%</strong> by optimising <strong>FastAPI</strong> services, <strong>PostgreSQL</strong> queries, and <strong>Redis</strong> caching.</li>
      <li><strong>Document Management System:</strong> Developed a document management solution with AWS integration, enhancing performance by <strong>30%</strong>.</li>
      <li><strong>Code Quality:</strong> Led a major project refactor — reduced code complexity by <strong>50%</strong> and improved overall system performance by <strong>30%</strong>.</li>
      <li><strong>Test Coverage:</strong> Achieved <strong>100% unit test coverage</strong> on critical services; raised overall project coverage from <strong>60% → 90%</strong> via PyTest and CI/CD pipelines.</li>
      <li><strong>Microservices:</strong> Improved scalability and service performance by <strong>30%</strong> with Docker and Kubernetes orchestration.</li>
      <li><strong>Security &amp; Multi-Tenancy:</strong> Built custom middleware with <strong>JWT</strong> auth, <strong>OAuth 2.0</strong>, and role-based multi-tenancy across enterprise clients.</li>
      <li><strong>NLP Pipeline:</strong> Refined text analysis platform using Python and TensorFlow for natural language processing workloads.</li>
      <li><strong>Python Library:</strong> Optimised an internal Python library for file and log management, achieving near 100% coverage and scalable microservices architecture.</li>
      <li><strong>Leadership:</strong> Supported team management, mentored junior engineers, conducted technical interviews for talent acquisition, and led security code reviews.</li>
    </ul>
  </details>
  <div class="ap-tags">
    <span class="ap-tag">Python</span><span class="ap-tag">FastAPI</span><span class="ap-tag">PostgreSQL</span><span class="ap-tag">Redis</span><span class="ap-tag">Docker</span><span class="ap-tag">Kubernetes</span><span class="ap-tag">AWS</span><span class="ap-tag">RabbitMQ</span><span class="ap-tag">Celery</span><span class="ap-tag">TensorFlow</span><span class="ap-tag">PyTest</span><span class="ap-tag">JWT</span><span class="ap-tag">OAuth 2.0</span>
  </div>
</div>

<!-- Supertal -->
<div class="ap-exp-card bc-amber">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">Senior Software Engineer <span class="ap-badge badge-amber"><i class="fas fa-arrow-up"></i> Double Promoted</span></p>
      <span class="ap-exp-co c-amber">Supertal Pte. Ltd.</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Remote · Singapore</span>
    </div>
    <span class="ap-exp-date">Nov 2021 – Dec 2023 · 2 yrs</span>
  </div>
  <p class="ap-exp-summary">
    Joined as Software Engineer; earned a <strong>65% salary increase and promotion to Senior in just 7 months</strong> due to outstanding impact. Led backend development across warehouse management, e-commerce, and agritech platforms targeting Southeast Asia's fast-growing market. Scaled platforms to <strong>1M+ users</strong>.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> View projects, contributions &amp; impact</summary>
    <div class="det-body">
      <p style="font-size:.88rem;font-weight:700;margin-bottom:.3rem;color:var(--heading-color);">Projects</p>
      <ul>
        <li><strong>Coolkas WMS (Jakarta):</strong> Developed a Warehouse Management System MVP using Django, FastAPI, and PostgreSQL, handling millions of transactions. Integrated MongoDB and Redis — achieved <strong>20% improvement in order fulfilment speed</strong>.</li>
        <li><strong>Saturdays Lifestyle E-commerce (Jakarta):</strong> Boosted platform performance by <strong>40%</strong>, reduced customer-facing latency, and introduced CI/CD pipelines reducing service downtime.</li>
        <li><strong>Beleaf Agritech (Indonesia):</strong> Led development of an Agritech MVP using <strong>Node.js</strong>, <strong>Nest.js</strong>, and MongoDB. Implemented cloud solutions with AWS and GCP, enhancing scalability in the agricultural tech sector.</li>
        <li><strong>Mamba Retail (Jakarta):</strong> Spearheaded the development team for a Retail Chain Store system — introduced CI/CD automation and delivered efficiency improvements across the chain.</li>
      </ul>
      <p style="font-size:.88rem;font-weight:700;margin:.6rem 0 .3rem;color:var(--heading-color);">Leadership &amp; Team</p>
      <ul>
        <li>Led cross-functional teams across multiple time zones — handling architecture decisions, stakeholder communication, and delivery planning.</li>
        <li>Mentored junior engineers through technical challenges and career growth; conducted in-depth code and security reviews.</li>
        <li>Played a key role in recruitment — conducted technical interviews and supported team planning and reporting.</li>
        <li>Integrated <strong>ERPNext</strong> into WMS and e-commerce platforms to streamline operational workflows.</li>
        <li>Designed <strong>CI/CD</strong> with <strong>Jenkins</strong> and implemented event-driven services with <strong>RabbitMQ</strong> and <strong>Celery</strong>.</li>
      </ul>
    </div>
  </details>
  <div class="ap-tags">
    <span class="ap-tag">Python</span><span class="ap-tag">Django</span><span class="ap-tag">FastAPI</span><span class="ap-tag">Node.js</span><span class="ap-tag">Nest.js</span><span class="ap-tag">PostgreSQL</span><span class="ap-tag">MongoDB</span><span class="ap-tag">Redis</span><span class="ap-tag">RabbitMQ</span><span class="ap-tag">Docker</span><span class="ap-tag">Jenkins</span><span class="ap-tag">AWS</span><span class="ap-tag">GCP</span><span class="ap-tag">ERPNext</span>
  </div>
</div>

<!-- Evaly -->
<div class="ap-exp-card bc-blue">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">Software Engineer</p>
      <span class="ap-exp-co c-blue">Evaly.com.bd</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Dhaka, Bangladesh</span>
    </div>
    <span class="ap-exp-date">Feb 2021 – Oct 2021</span>
  </div>
  <p class="ap-exp-summary">
    Led backend development for one of Bangladesh's largest e-commerce platforms — handling millions of transactions during high-traffic events like <em>Evaly-Cyclone</em> (Bangladesh's equivalent of Black Friday). Improved transaction accuracy by <strong>25%</strong> and reduced eHealth load times by <strong>40%</strong>.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> View projects &amp; impact</summary>
    <div class="det-body">
      <ul>
        <li><strong>eBilling Platform:</strong> Designed a scalable eBilling system handling millions of transactions. Improved transaction accuracy by <strong>25%</strong> through order reconciliation; introduced database sharding and load balancing for peak traffic. Deployed with Celery + RabbitMQ on AWS via Docker.</li>
        <li><strong>Evaly Core 2.0:</strong> Optimised the core platform to v2.0 — enabled scaling to millions of transactions during Evaly-Cyclone events with system stability and Celery-based async processing.</li>
        <li><strong>eHealth Order System:</strong> Led backend development of an order management system for Evaly's eHealth platform — reduced load times by <strong>40%</strong> using AsyncIO, PostgreSQL, and Redis for high availability.</li>
        <li>Built scalable microservices using Django and DRF; automated testing and deployment with Jenkins and PyTest.</li>
      </ul>
    </div>
  </details>
  <div class="ap-tags">
    <span class="ap-tag">Python</span><span class="ap-tag">Django</span><span class="ap-tag">DRF</span><span class="ap-tag">PostgreSQL</span><span class="ap-tag">Redis</span><span class="ap-tag">Celery</span><span class="ap-tag">RabbitMQ</span><span class="ap-tag">AsyncIO</span><span class="ap-tag">AWS</span><span class="ap-tag">Docker</span>
  </div>
</div>

<!-- LEADS -->
<div class="ap-exp-card bc-teal">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">Software Engineer Intern</p>
      <span class="ap-exp-co c-teal">Leads Corporation Ltd.</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Dhaka, Bangladesh</span>
    </div>
    <span class="ap-exp-date">Sep 2020 – Dec 2020</span>
  </div>
  <p class="ap-exp-summary">
    Contributed to the <strong>VerifID eKYC platform</strong> — now used by <strong>12+ banks in Bangladesh</strong>, allowing customers to open bank accounts from home. Reduced verification time by <strong>30%</strong> through OCR and facial recognition integration.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> View contributions &amp; impact</summary>
    <ul>
      <li>Developed the backend for a digital identity verification and bank onboarding service supporting thousands of daily requests.</li>
      <li>Integrated <strong>OpenCV</strong>, <strong>Pytesseract</strong>, and Face Recognition to ensure secure and accurate identity verification — reduced verification time by <strong>30%</strong>.</li>
      <li>Built RESTful APIs with <strong>Python Flask</strong> and <strong>MySQL</strong>; deployed on <strong>Azure</strong> with Redis for fast data access.</li>
      <li>Optimised the system to scale across multiple financial institutions, enhancing the remote onboarding experience.</li>
      <li>Implemented unit testing for reliable and secure code operations across financial institutions.</li>
    </ul>
  </details>
  <div class="ap-tags">
    <span class="ap-tag">Python</span><span class="ap-tag">Flask</span><span class="ap-tag">MySQL</span><span class="ap-tag">Redis</span><span class="ap-tag">OpenCV</span><span class="ap-tag">Pytesseract</span><span class="ap-tag">Azure</span>
  </div>
</div>

<!-- Teaching Assistant -->
<div class="ap-exp-card bc-violet">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">Undergraduate Teaching Assistant <span class="ap-badge badge-violet"><i class="fas fa-chalkboard-teacher"></i> Mentor</span></p>
      <span class="ap-exp-co c-violet">BRAC University</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Dhaka, Bangladesh</span>
    </div>
    <span class="ap-exp-date">Oct 2019 – Oct 2020 · 1 yr</span>
  </div>
  <p class="ap-exp-summary">
    Assisted in teaching and mentoring students across <strong>Discrete Mathematics</strong> and <strong>Object-Oriented Programming</strong>, helping them build strong foundations in problem-solving and software development.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> Courses &amp; topics</summary>
    <ul>
      <li><strong>Discrete Mathematics [CSE230]:</strong> Combinatorics, Logic, Boolean Algebra, Functions, Advanced Probability, Number Theory, Graph Theory, Trees, and Relations.</li>
      <li><strong>Object-Oriented Programming [CSE310]:</strong> Abstraction, Encapsulation, Inheritance, Polymorphism, and Functional Programming using Java and Python.</li>
      <li>Taught foundational topics including Data Structures, Algorithms, and Graph Theory — ensuring students developed thorough understanding for future coursework and careers.</li>
    </ul>
  </details>
  <div class="ap-tags">
    <span class="ap-tag">Algorithms</span><span class="ap-tag">Data Structures</span><span class="ap-tag">Graph Theory</span><span class="ap-tag">Java</span><span class="ap-tag">Python</span><span class="ap-tag">OOP</span><span class="ap-tag">Discrete Math</span>
  </div>
</div>

<!-- ══════════════════════════════════════════
     OPEN SOURCE PROJECTS
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-teal"><i class="fas fa-code-branch"></i></div>
  <h2 class="ap-sec-title bc-teal">Open Source &amp; Projects</h2>
</div>

<div class="ap-proj-grid">

  <div class="ap-proj-card">
    <div class="ap-proj-head">
      <div class="ap-proj-icon ic-blue"><i class="fas fa-paper-plane"></i></div>
      <h4 class="ap-proj-name">messaging-sdk</h4>
    </div>
    <p class="ap-proj-desc">A Python SDK simplifying interaction with messaging APIs and webhook functionality. Features automatic signature validation and a robust foundation for scalable messaging applications.</p>
    <div class="ap-tags" style="margin-bottom:.7rem;">
      <span class="ap-tag">Python</span><span class="ap-tag">FastAPI</span><span class="ap-tag">SDK</span><span class="ap-tag">Webhooks</span>
    </div>
    <div class="ap-proj-links">
      <a href="https://github.com/shiningflash/messaging-sdk"><i class="fab fa-github"></i> GitHub</a>
      <a href="https://pypi.org/project/messaging-py-sdk/"><i class="fas fa-box"></i> PyPI</a>
    </div>
  </div>

  <div class="ap-proj-card">
    <div class="ap-proj-head">
      <div class="ap-proj-icon ic-green"><i class="fas fa-rocket"></i></div>
      <h4 class="ap-proj-name">fastapi-backend-starter-kit</h4>
    </div>
    <p class="ap-proj-desc">A modern FastAPI starter with PostgreSQL, Docker, Alembic, and Pytest — for building scalable async API applications and microservices. Designed for developers, by developers.</p>
    <div class="ap-tags" style="margin-bottom:.7rem;">
      <span class="ap-tag">Python</span><span class="ap-tag">FastAPI</span><span class="ap-tag">PostgreSQL</span><span class="ap-tag">Docker</span><span class="ap-tag">Alembic</span><span class="ap-tag">Pytest</span>
    </div>
    <div class="ap-proj-links">
      <a href="https://github.com/shiningflash/fastapi-backend-starter-kit"><i class="fab fa-github"></i> GitHub</a>
    </div>
  </div>

  <div class="ap-proj-card">
    <div class="ap-proj-head">
      <div class="ap-proj-icon ic-amber"><i class="fas fa-calendar-check"></i></div>
      <h4 class="ap-proj-name">django-reservation-system</h4>
    </div>
    <p class="ap-proj-desc">A powerful Django Reservation System with REST APIs for managing users, rooms, bookings, and payments. Fully Dockerized with Swagger documentation and production-ready scalability.</p>
    <div class="ap-tags" style="margin-bottom:.7rem;">
      <span class="ap-tag">Python</span><span class="ap-tag">Django</span><span class="ap-tag">DRF</span><span class="ap-tag">Docker</span><span class="ap-tag">Swagger</span>
    </div>
    <div class="ap-proj-links">
      <a href="https://github.com/shiningflash/django-reservation-system"><i class="fab fa-github"></i> GitHub</a>
    </div>
  </div>

  <div class="ap-proj-card">
    <div class="ap-proj-head">
      <div class="ap-proj-icon ic-pink"><i class="fas fa-heartbeat"></i></div>
      <h4 class="ap-proj-name">VH Online Hospital</h4>
    </div>
    <p class="ap-proj-desc">An Android platform connecting patients with remote doctors — built during COVID-19. Integrated real-time chat and video calling for remote medical consultations, especially for underserved communities.</p>
    <div class="ap-tags" style="margin-bottom:.7rem;">
      <span class="ap-tag">Android</span><span class="ap-tag">Java</span><span class="ap-tag">REST APIs</span><span class="ap-tag">Video Call</span>
    </div>
    <div class="ap-proj-links">
      <a href="https://github.com/shiningflash"><i class="fab fa-github"></i> GitHub</a>
    </div>
  </div>

</div>

<!-- ══════════════════════════════════════════
     SKILLS & TECH STACK
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-green"><i class="fas fa-terminal"></i></div>
  <h2 class="ap-sec-title bc-green">Skills &amp; Tech Stack</h2>
</div>

<div class="ap-skill-grid">

  <div class="ap-skill-card">
    <h4><i class="fas fa-code c-blue"></i> Programming &amp; Backend</h4>
    <div class="ap-tags">
      <span class="ap-tag">Python</span><span class="ap-tag">FastAPI</span><span class="ap-tag">Django</span><span class="ap-tag">DRF</span><span class="ap-tag">Flask</span><span class="ap-tag">AsyncIO</span><span class="ap-tag">Node.js</span><span class="ap-tag">Nest.js</span><span class="ap-tag">C++</span><span class="ap-tag">Java</span><span class="ap-tag">RESTful APIs</span><span class="ap-tag">Microservices</span><span class="ap-tag">Event-Driven</span>
    </div>
  </div>

  <div class="ap-skill-card">
    <h4><i class="fas fa-stream c-green"></i> Data Engineering &amp; Streaming</h4>
    <div class="ap-tags">
      <span class="ap-tag">Real-time ETL</span><span class="ap-tag">Dagster</span><span class="ap-tag">Airflow</span><span class="ap-tag">Kafka</span><span class="ap-tag">MQTT</span><span class="ap-tag">RabbitMQ</span><span class="ap-tag">Modbus</span><span class="ap-tag">Spark</span><span class="ap-tag">dbt</span><span class="ap-tag">Data Modeling</span><span class="ap-tag">Data Warehousing</span><span class="ap-tag">OLTP &amp; OLAP</span>
    </div>
  </div>

  <div class="ap-skill-card">
    <h4><i class="fas fa-database c-teal"></i> Databases &amp; Storage</h4>
    <div class="ap-tags">
      <span class="ap-tag">PostgreSQL</span><span class="ap-tag">TimescaleDB</span><span class="ap-tag">PostGIS</span><span class="ap-tag">MySQL</span><span class="ap-tag">MongoDB</span><span class="ap-tag">Redis</span><span class="ap-tag">BigQuery</span><span class="ap-tag">DynamoDB</span><span class="ap-tag">Redshift</span><span class="ap-tag">Elasticsearch</span><span class="ap-tag">SQL Optimisation</span>
    </div>
  </div>

  <div class="ap-skill-card">
    <h4><i class="fas fa-cloud c-violet"></i> Cloud &amp; Infrastructure</h4>
    <div class="ap-tags">
      <span class="ap-tag">GCP</span><span class="ap-tag">BigQuery</span><span class="ap-tag">Pub/Sub</span><span class="ap-tag">Cloud Storage</span><span class="ap-tag">Cloud Functions</span><span class="ap-tag">AWS Lambda</span><span class="ap-tag">S3</span><span class="ap-tag">EC2</span><span class="ap-tag">SQS</span><span class="ap-tag">SNS</span><span class="ap-tag">EventBridge</span><span class="ap-tag">Azure</span><span class="ap-tag">Docker</span><span class="ap-tag">Kubernetes</span><span class="ap-tag">Terraform</span><span class="ap-tag">Linux</span>
    </div>
  </div>

  <div class="ap-skill-card">
    <h4><i class="fas fa-cogs c-orange"></i> CI/CD &amp; Observability</h4>
    <div class="ap-tags">
      <span class="ap-tag">GitHub Actions</span><span class="ap-tag">GitLab CI/CD</span><span class="ap-tag">Jenkins</span><span class="ap-tag">PyTest</span><span class="ap-tag">TDD</span><span class="ap-tag">Grafana</span><span class="ap-tag">Kibana</span><span class="ap-tag">CloudWatch</span><span class="ap-tag">Time-Series Analytics</span>
    </div>
  </div>

  <div class="ap-skill-card">
    <h4><i class="fas fa-sitemap c-amber"></i> Architecture &amp; Leadership</h4>
    <div class="ap-tags">
      <span class="ap-tag">System Design</span><span class="ap-tag">Cloud-Native Architecture</span><span class="ap-tag">Multi-Tenant Systems</span><span class="ap-tag">Performance Optimisation</span><span class="ap-tag">Distributed Systems</span><span class="ap-tag">Design Patterns</span><span class="ap-tag">Technical Mentoring</span><span class="ap-tag">Code Reviews</span>
    </div>
  </div>

</div>

<!-- ══════════════════════════════════════════
     EDUCATION
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-amber"><i class="fas fa-graduation-cap"></i></div>
  <h2 class="ap-sec-title bc-amber">Education</h2>
</div>

<div class="ap-exp-card bc-amber">
  <div class="ap-exp-head">
    <div>
      <p class="ap-exp-role">Bachelor of Computer Science <span class="ap-badge badge-amber"><i class="fas fa-star"></i> 100% Scholarship</span></p>
      <span class="ap-exp-co c-amber">BRAC University</span> &nbsp;·&nbsp; <span class="ap-exp-loc">Dhaka, Bangladesh</span>
    </div>
    <span class="ap-exp-date">2017 – 2020</span>
  </div>
  <p class="ap-exp-summary">
    Result: <strong>92%</strong> &nbsp;·&nbsp; Awarded a <strong>full 100% scholarship</strong> covering the entire undergraduate duration — in recognition of outstanding academic performance, programming competitions, and prior achievements &nbsp;·&nbsp; <strong>CGPA 4.0/4.0 in last 4 consecutive semesters</strong>.
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> Thesis, coursework &amp; extracurriculars</summary>
    <div class="det-body">
      <p style="font-size:.88rem;margin-bottom:.4rem;"><strong>Thesis:</strong> <em>A Deep Learning Approach to Integrate Human-Level Understanding in a Chatbot</em></p>
      <p style="font-size:.88rem;margin-bottom:.4rem;"><strong>Roles:</strong> ACM Programmer · Programming Mentor · Problem Setter · Contest Judge · Undergraduate Teaching Assistant</p>
      <p style="font-size:.88rem;font-weight:700;margin:.5rem 0 .3rem;color:var(--heading-color);">Relevant Coursework</p>
      <div class="ap-tags" style="margin-bottom:.6rem;">
        <span class="ap-tag">Data Structures</span><span class="ap-tag">Algorithms</span><span class="ap-tag">Neural Networks</span><span class="ap-tag">Artificial Intelligence</span><span class="ap-tag">Software Engineering</span><span class="ap-tag">OOP</span><span class="ap-tag">Database Systems</span><span class="ap-tag">Operating Systems</span><span class="ap-tag">Computer Architecture</span><span class="ap-tag">Data Communication</span><span class="ap-tag">Calculus</span>
      </div>
      <p style="font-size:.88rem;font-weight:700;margin:.5rem 0 .3rem;color:var(--heading-color);">Extracurriculars</p>
      <ul style="font-size:.87rem;">
        <li>Teaching Assistant (Discrete Mathematics &amp; OOP) for over 1 year</li>
        <li>Competitive Programming Mentor and BootCamp Trainer (Mar 2018 – Jul 2020)</li>
        <li><strong>Champion</strong> — BUCC Intra-University Programming Contest (Junior, Fall 2017)</li>
        <li>Solved <strong>1500+</strong> coding challenges across LeetCode, Codeforces, HackerRank, UVa, and others</li>
        <li>Participated in <strong>18+</strong> national programming contests and <strong>5+</strong> hackathons on behalf of the university</li>
        <li>Problem Setter and Judge at <strong>6+</strong> programming contests</li>
        <li>Internship project (VerifID) now provides digital onboarding to <strong>12+ banks</strong> in Bangladesh</li>
      </ul>
    </div>
  </details>
</div>

<!-- ══════════════════════════════════════════
     RESEARCH & PUBLICATIONS
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-teal"><i class="fas fa-book-open"></i></div>
  <h2 class="ap-sec-title bc-teal">Research &amp; Publications</h2>
</div>

<div class="ap-pub-card">
  <p style="font-size:1rem;font-weight:700;margin:0 0 .3rem;color:var(--heading-color);">A Deep Learning Approach to Integrate Human-Level Understanding in a Chatbot</p>
  <p style="font-size:.84rem;opacity:.65;margin:0 0 .7rem;">
    10th International Conference on Natural Language Processing (NLP 2021) &nbsp;·&nbsp; Sydney, Australia &nbsp;·&nbsp; Oct 10, 2021
  </p>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> Abstract &amp; details</summary>
    <div class="det-body">
      <p style="font-size:.88rem;line-height:1.68;margin-bottom:.6rem;">
        Implemented <strong>Sentiment Analysis</strong>, <strong>Emotion Detection</strong>, <strong>Intent Classification</strong>, and <strong>Named-Entity Recognition (NER)</strong> to build a chatbot with human-level conversational understanding. Demonstrated a <strong>30% improvement in interaction quality</strong>. Long-term vision: a fully human-like chatbot that is more interactive and contextually aware.
      </p>
      <div class="ap-tags" style="margin-bottom:.6rem;">
        <span class="ap-tag">Python</span><span class="ap-tag">NLP</span><span class="ap-tag">TensorFlow</span><span class="ap-tag">PyTorch</span><span class="ap-tag">Scikit-learn</span><span class="ap-tag">NLTK</span><span class="ap-tag">NumPy</span><span class="ap-tag">Pandas</span>
      </div>
      <p style="font-size:.85rem;">
        <a href="https://aircconline.com/csit/abstract/v11n23/csit112309.html"><i class="fas fa-external-link-alt"></i> Read Abstract</a> &nbsp;·&nbsp;
        <a href="https://lnkd.in/gcqsU52V"><i class="fab fa-github"></i> GitHub Repository</a>
      </p>
    </div>
  </details>
</div>

<!-- ══════════════════════════════════════════
     CERTIFICATIONS
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-orange"><i class="fas fa-certificate"></i></div>
  <h2 class="ap-sec-title bc-orange">Certifications</h2>
</div>

<!-- Featured certs -->
<div class="ap-cert-grid">

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-blue" style="font-size:.65rem;">IBM</div>
    <div>
      <div class="ap-cert-name">SQL for Data Engineers</div>
      <div class="ap-cert-issuer">IBM</div>
      <div class="ap-cert-year">Dec 2025</div>
    </div>
  </div>

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-violet" style="font-size:.6rem;">edX</div>
    <div>
      <div class="ap-cert-name">Advanced Data Engineering</div>
      <div class="ap-cert-issuer">edX</div>
      <div class="ap-cert-year">Jul 2025</div>
    </div>
  </div>

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-green" style="font-size:.6rem;">HR</div>
    <div>
      <div class="ap-cert-name">Rest API (Intermediate) Certificate</div>
      <div class="ap-cert-issuer">HackerRank</div>
      <div class="ap-cert-year">Feb 2025</div>
    </div>
  </div>

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-green" style="font-size:.6rem;">HR</div>
    <div>
      <div class="ap-cert-name">Problem Solving (Intermediate)</div>
      <div class="ap-cert-issuer">HackerRank</div>
      <div class="ap-cert-year">Dec 2024</div>
    </div>
  </div>

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-teal" style="font-size:.55rem;">DL.AI</div>
    <div>
      <div class="ap-cert-name">Neural Networks &amp; Deep Learning</div>
      <div class="ap-cert-issuer">DeepLearning.AI</div>
      <div class="ap-cert-year">Jul 2020</div>
    </div>
  </div>

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-amber" style="font-size:.55rem;">UMN</div>
    <div>
      <div class="ap-cert-name">Software Dev Processes &amp; Methodologies</div>
      <div class="ap-cert-issuer">University of Minnesota</div>
      <div class="ap-cert-year">Oct 2020</div>
    </div>
  </div>

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-pink" style="font-size:.55rem;">NASA</div>
    <div>
      <div class="ap-cert-name">Global Problem-Solver</div>
      <div class="ap-cert-issuer">NASA Space Apps COVID-19 Challenge</div>
      <div class="ap-cert-year">May 2020</div>
    </div>
  </div>

  <div class="ap-cert-card">
    <div class="ap-cert-logo ic-orange" style="font-size:.55rem;">UMich</div>
    <div>
      <div class="ap-cert-name">Web App Technologies &amp; Django</div>
      <div class="ap-cert-issuer">University of Michigan</div>
      <div class="ap-cert-year">Aug 2020</div>
    </div>
  </div>

</div>

<details style="margin-top:.8rem;">
  <summary><i class="fas fa-chevron-right chev"></i> Show all 20 certifications</summary>
  <div class="det-body">
    <div class="ap-cert-grid" style="margin-top:.6rem;">

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-blue" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">Advanced PostgreSQL</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Oct 2024</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-blue" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">Python Automation and Testing</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Oct 2024</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-teal" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">Azure Essential Training for Developers</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Oct 2024</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-blue" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">Learning Kubernetes</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Sep 2024</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-orange" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">DevOps Foundations: Your First Project</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Sep 2024</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-green" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">Elasticsearch Essential Training</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Sep 2023</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-orange" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">AWS Essential Training for Developers</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Aug 2023</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-violet" style="font-size:.6rem;">LI</div>
        <div>
          <div class="ap-cert-name">Programming Foundations: Design Patterns</div>
          <div class="ap-cert-issuer">LinkedIn</div>
          <div class="ap-cert-year">Aug 2023</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-amber" style="font-size:.6rem;">Udemy</div>
        <div>
          <div class="ap-cert-name">NodeJS Complete Course</div>
          <div class="ap-cert-issuer">Udemy</div>
          <div class="ap-cert-year">May 2022</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-green" style="font-size:.55rem;">Google</div>
        <div>
          <div class="ap-cert-name">Introduction to Git and GitHub</div>
          <div class="ap-cert-issuer">Google</div>
          <div class="ap-cert-year">Sep 2020</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-teal" style="font-size:.55rem;">ICPC</div>
        <div>
          <div class="ap-cert-name">IUBAT National Collegiate Programming Contest</div>
          <div class="ap-cert-issuer">ICPC</div>
          <div class="ap-cert-year">Aug 2018</div>
        </div>
      </div>

      <div class="ap-cert-card">
        <div class="ap-cert-logo ic-violet" style="font-size:.55rem;">BRACU</div>
        <div>
          <div class="ap-cert-name">Programming Skill Bootcamp Trainer</div>
          <div class="ap-cert-issuer">BRAC University</div>
          <div class="ap-cert-year">Aug 2019</div>
        </div>
      </div>

    </div>
  </div>
</details>

<!-- ══════════════════════════════════════════
     COMPETITIVE PROGRAMMING
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-pink"><i class="fas fa-trophy"></i></div>
  <h2 class="ap-sec-title bc-pink">Competitive Programming</h2>
</div>

<div class="ap-cp-card">
  <ul>
    <li><strong>Judge, Moderator &amp; Problem Setter</strong> of <strong>6+</strong> national programming contests at <a href="https://toph.co/u/amirul_islam">Toph</a> — including 16th December Contest 2019, BRACU Intra-University, Girls Programming Contest 2019.</li>
    <li><strong>Authored 12+ original problems</strong> spanning number theory, graph theory, dynamic programming, and data structures — with brute-force to optimised solution sets.</li>
    <li><strong>Solved 1500+ online problems</strong> across <a href="https://leetcode.com/shiningflash/">LeetCode</a>, <a href="https://www.hackerrank.com/shiningflash">HackerRank</a>, Codeforces, UVa, SPOJ, LightOJ, and others.</li>
    <li>Participated in <strong>18+ national programming contests</strong> and <strong>5+ hackathons</strong> representing BRAC University.</li>
    <li>Managed contest test cases covering edge cases, stress tests, and multiple solution approaches per problem.</li>
  </ul>
</div>

<!-- ══════════════════════════════════════════
     HONORS & AWARDS
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-amber"><i class="fas fa-award"></i></div>
  <h2 class="ap-sec-title bc-amber">Honors &amp; Awards</h2>
</div>

<div class="ap-award-list">

  <div class="ap-award-item">
    <div class="ap-award-ic ic-green"><i class="fas fa-arrow-up"></i></div>
    <div>
      <div class="ap-award-title">Double Promotion at Supertal — 65% Salary Increase</div>
      <div class="ap-award-sub">Recognised as a key performer and leader within 7 months — promoted from Software Engineer to Senior Software Engineer ahead of schedule · 2022</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-amber"><i class="fas fa-star"></i></div>
    <div>
      <div class="ap-award-title">100% Full-Funded Scholarship — BRAC University</div>
      <div class="ap-award-sub">Awarded for outstanding academic performance, programming competitions, and prior achievements · Jan 2017</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-pink"><i class="fas fa-globe"></i></div>
    <div>
      <div class="ap-award-title">Global Problem-Solver — NASA Space Apps COVID-19 Challenge</div>
      <div class="ap-award-sub">Selected globally for impactful solution to COVID-19 crisis using data science and Python · 2020</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-amber"><i class="fas fa-trophy"></i></div>
    <div>
      <div class="ap-award-title">Champion — BUCC Intra-University Programming Contest (Junior)</div>
      <div class="ap-award-sub">Solved all problems and claimed first place · Fall 2017 · BRAC University</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-violet"><i class="fas fa-medal"></i></div>
    <div>
      <div class="ap-award-title">2nd Runner Up — BUCC Intra-University Programming Contest (Senior)</div>
      <div class="ap-award-sub">Team Leader &amp; Contestant, team: SketchUP &amp; sketchUP · Fall 2018 &amp; Spring 2019</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-blue"><i class="fas fa-code"></i></div>
    <div>
      <div class="ap-award-title">8th Place — UITS Inter-University Programming Contest</div>
      <div class="ap-award-sub">Team Leader &amp; Contestant, team: silkRoad · 2019</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-teal"><i class="fas fa-code"></i></div>
    <div>
      <div class="ap-award-title">12th Place — INWED Techfest Programming Contest, IUB</div>
      <div class="ap-award-sub">Team Leader &amp; Contestant, team: bracu_silkRoad · 2019</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-pink"><i class="fas fa-pen"></i></div>
    <div>
      <div class="ap-award-title">Authored 12+ Problems — Competitive Programming Contests</div>
      <div class="ap-award-sub">Problems published at Toph.co including "Answer the Queries", "National Flag" and more · Dec 2019</div>
    </div>
  </div>

  <div class="ap-award-item">
    <div class="ap-award-ic ic-orange"><i class="fas fa-check-circle"></i></div>
    <div>
      <div class="ap-award-title">Solved 1500+ Online Problems</div>
      <div class="ap-award-sub">Across Codeforces, UVA, LightOJ, LeetCode, HackerRank, SPOJ and more · Jul 2021</div>
    </div>
  </div>

</div>

<!-- ══════════════════════════════════════════
     VOLUNTEERING & COMMUNITY LEADERSHIP
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-violet"><i class="fas fa-hands-helping"></i></div>
  <h2 class="ap-sec-title bc-violet">Volunteering &amp; Community Leadership</h2>
</div>

<div class="ap-vol-card">
  <div class="ap-vol-head">
    <p class="ap-vol-role">🎤 Keynote Speaker</p>
    <span class="ap-vol-date">Apr 2022 – Present</span>
  </div>
  <div class="ap-vol-org">Self-Employed &nbsp;·&nbsp; Science &amp; Technology</div>
  <div class="ap-chips">
    <span class="ap-chip chip-violet"><i class="fas fa-microphone"></i> 20+ Talks</span>
    <span class="ap-chip chip-green"><i class="fas fa-users"></i> 5,000+ Inspired</span>
    <span class="ap-chip chip-pink"><i class="fas fa-globe"></i> Global Reach</span>
  </div>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> Details &amp; notable events</summary>
    <ul style="font-size:.87rem;">
      <li>Delivered over <strong>20 keynote addresses</strong> (onsite &amp; online), inspiring more than <strong>5,000</strong> students, professionals, and aspiring engineers globally.</li>
      <li>Shared actionable insights on career preparation, tech trends, and software industry best practices — equipping participants with skills to excel in a competitive field.</li>
      <li>Engaged in thought leadership on the <em>"Future of Tech"</em>, influencing decision-making and innovation strategies in universities and professional organisations.</li>
      <li>Provided tailored advice on resume building, technical interview prep, and engineering practices — helping hundreds secure industry roles.</li>
      <li><strong>IEEE Seminar at BRAC University:</strong> Keynote on <em>"Guidelines for Future Software Engineers"</em> and <em>"Preparation for the Software Industry"</em> for 100+ students and faculty. <a href="https://www.facebook.com/ieeebracuCS/posts/pfbid07hjcybLssRSNCGm7EPHJXpzrAoa1iTdcLsu7KYp12JgKUo3pTENRghhNu1cAXMU5l">Event Post</a></li>
      <li>Conducted corporate sessions on clean coding, DevOps, and CI/CD practices — inspiring improvements in engineering workflows at software companies.</li>
    </ul>
  </details>
</div>

<div class="ap-vol-card">
  <div class="ap-vol-head">
    <p class="ap-vol-role">🧑‍🏫 Programming Mentor</p>
    <span class="ap-vol-date">Mar 2018 – Jul 2020</span>
  </div>
  <div class="ap-vol-org">BRAC University &nbsp;·&nbsp; Education</div>
  <div class="ap-chips">
    <span class="ap-chip chip-violet"><i class="fas fa-clock"></i> 2.5 Years</span>
    <span class="ap-chip chip-green"><i class="fas fa-graduation-cap"></i> CSE Bootcamps</span>
  </div>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> Details</summary>
    <ul style="font-size:.87rem;">
      <li>Guided junior contestants through classes, workshops, CSE Boot Camps, and programming contests.</li>
      <li>Introduced students to data structures, algorithms, and software engineering best practices.</li>
      <li><strong>Skills taught:</strong> Competitive Programming, Problem Solving, C++, Python, Dynamic Programming, Graph Theory, Number Theory.</li>
    </ul>
  </details>
</div>

<div class="ap-vol-card" style="border-left-color: var(--c-pink);">
  <div class="ap-vol-head">
    <p class="ap-vol-role">❤️ Head of Human Resources</p>
    <span class="ap-vol-date">Feb 2020 – Present</span>
  </div>
  <div class="ap-vol-org">Voice Of Humanity Foundation &nbsp;·&nbsp; Social Services</div>
  <div class="ap-chips">
    <span class="ap-chip chip-pink"><i class="fas fa-user-md"></i> 100+ Doctors Mobilised</span>
    <span class="ap-chip chip-violet"><i class="fas fa-hands"></i> 400+ Volunteers</span>
  </div>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> Details</summary>
    <ul style="font-size:.87rem;">
      <li>Mobilised <strong>100+ professional doctors</strong> and <strong>400+ volunteers</strong> to provide free and emergency medical support during the COVID-19 crisis.</li>
      <li>Currently focused on supporting disabled individuals, street children, and underprivileged rural communities with free medical care, education, and food.</li>
    </ul>
  </details>
</div>

<div class="ap-vol-card" style="border-left-color: var(--c-green);">
  <div class="ap-vol-head">
    <p class="ap-vol-role">📚 Founding Member &amp; Advisor</p>
    <span class="ap-vol-date">Feb 2018 – Present</span>
  </div>
  <div class="ap-vol-org">Alokito Pathshala (আলোকিত পাঠশালা) &nbsp;·&nbsp; Social Services</div>
  <div class="ap-chips">
    <span class="ap-chip chip-green"><i class="fas fa-book"></i> Nonprofit Library</span>
    <span class="ap-chip chip-violet"><i class="fas fa-child"></i> Underprivileged Children</span>
  </div>
  <details>
    <summary><i class="fas fa-chevron-right chev"></i> Details</summary>
    <ul style="font-size:.87rem;">
      <li>Co-founded a <strong>nonprofit library and mini-school</strong> for underprivileged children in our village.</li>
      <li>Finance, teach, and organise cultural events for social welfare and community development.</li>
    </ul>
  </details>
</div>

<!-- ══════════════════════════════════════════
     LANGUAGES
══════════════════════════════════════════ -->
<div class="ap-section">
  <div class="ap-sec-icon ic-teal"><i class="fas fa-language"></i></div>
  <h2 class="ap-sec-title bc-teal">Languages</h2>
</div>

<div class="ap-lang-grid">
  <div class="ap-lang-card">
    <div class="ap-lang-flag">🇧🇩</div>
    <div class="ap-lang-name">Bangla</div>
    <div class="ap-lang-level">Native</div>
    <div class="ap-lang-bar"><div class="ap-lang-fill" style="width:100%;background:linear-gradient(90deg,var(--c-green),var(--c-teal));"></div></div>
  </div>
  <div class="ap-lang-card">
    <div class="ap-lang-flag">🇬🇧</div>
    <div class="ap-lang-name">English</div>
    <div class="ap-lang-level">Fluent — Professional</div>
    <div class="ap-lang-bar"><div class="ap-lang-fill" style="width:92%;background:linear-gradient(90deg,var(--c-blue),var(--c-violet));"></div></div>
  </div>
  <div class="ap-lang-card">
    <div class="ap-lang-flag">🇸🇪</div>
    <div class="ap-lang-name">Swedish</div>
    <div class="ap-lang-level">Learner · SFI</div>
    <div class="ap-lang-bar"><div class="ap-lang-fill" style="width:28%;background:linear-gradient(90deg,var(--c-amber),var(--c-orange));"></div></div>
  </div>
</div>

<!-- ══════════════════════════════════════════
     CONNECT
══════════════════════════════════════════ -->
<div class="ap-connect">
  <p class="ap-connect-quote">
    💬 I believe good systems are built the same way good teams are —<br>with <strong>clarity</strong>, <strong>consistency</strong>, and <strong>care</strong>.
  </p>
  <p style="font-size:.9rem;opacity:.75;margin-bottom:1.2rem;">Open to data engineering discussions, speaking invitations, and collaboration opportunities.</p>
  <div class="ap-connect-btns">
    <a class="ap-connect-btn" href="mailto:amirulislamalmamun@gmail.com"><i class="fas fa-envelope"></i> Email</a>
    <a class="ap-connect-btn" href="https://www.linkedin.com/in/amirulislamalmamun/"><i class="fab fa-linkedin"></i> LinkedIn</a>
    <a class="ap-connect-btn" href="https://github.com/shiningflash"><i class="fab fa-github"></i> GitHub</a>
    <a class="ap-connect-btn" href="https://medium.com/@amirulislamalmamun"><i class="fab fa-medium"></i> Medium</a>
  </div>
</div>
