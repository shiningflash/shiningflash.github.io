---
# the default layout is 'page'
icon: fas fa-info-circle
order: 4
---

<style>
  /* ── About Page Custom Styles ── */
  .about-hero {
    border-radius: 12px;
    padding: 2rem 1.8rem;
    margin-bottom: 2rem;
    border: 1px solid var(--bs-border-color);
    background: var(--bs-tertiary-bg);
  }
  .about-hero h1 { margin-bottom: 0.3rem; }
  .about-hero .subtitle {
    font-size: 1.15rem;
    opacity: 0.78;
    margin-bottom: 1rem;
  }
  .badge-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 0.8rem 0 1rem; }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
    margin: 1.5rem 0;
  }
  .stat-card {
    text-align: center;
    padding: 1rem 0.6rem;
    border-radius: 10px;
    border: 1px solid var(--bs-border-color);
    background: var(--bs-body-bg);
  }
  .stat-card .num { font-size: 1.6rem; font-weight: 700; color: var(--bs-primary); }
  .stat-card .label { font-size: 0.82rem; opacity: 0.7; }
  .section-title {
    font-size: 1.35rem;
    font-weight: 700;
    margin: 2rem 0 1rem;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid var(--bs-primary);
    display: inline-block;
  }
  .role-card {
    border: 1px solid var(--bs-border-color);
    border-radius: 10px;
    padding: 1.2rem 1.4rem;
    margin-bottom: 1rem;
    background: var(--bs-body-bg);
    transition: box-shadow 0.2s;
  }
  .role-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .role-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .role-title { font-size: 1.05rem; font-weight: 700; margin: 0; }
  .role-company { font-weight: 600; opacity: 0.85; }
  .role-meta { font-size: 0.85rem; opacity: 0.6; }
  .role-date { font-size: 0.85rem; opacity: 0.6; white-space: nowrap; }
  .tech-badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 0.6rem; }
  .tech-badge {
    display: inline-block;
    padding: 2px 10px;
    font-size: 0.75rem;
    border-radius: 20px;
    border: 1px solid var(--bs-border-color);
    background: var(--bs-tertiary-bg);
    white-space: nowrap;
  }
  .skill-group {
    border: 1px solid var(--bs-border-color);
    border-radius: 10px;
    padding: 1rem 1.2rem;
    margin-bottom: 0.8rem;
    background: var(--bs-body-bg);
  }
  .skill-group h4 {
    font-size: 0.95rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }
  .vol-card {
    border-left: 3px solid var(--bs-primary);
    padding: 0.8rem 1.2rem;
    margin-bottom: 0.8rem;
    border-radius: 0 8px 8px 0;
    background: var(--bs-body-bg);
  }
  .vol-card h4 { font-size: 1rem; font-weight: 700; margin-bottom: 0.2rem; }
  .vol-card .vol-org { font-weight: 600; opacity: 0.8; font-size: 0.9rem; }
  .vol-card .vol-date { font-size: 0.8rem; opacity: 0.55; }
  details { margin-bottom: 0; }
  details summary {
    cursor: pointer;
    font-size: 0.88rem;
    font-weight: 600;
    opacity: 0.75;
    padding: 0.3rem 0;
    list-style: none;
  }
  details summary::before { content: "▸ "; }
  details[open] summary::before { content: "▾ "; }
  details summary::-webkit-details-marker { display: none; }
  details > ul, details > p, details > div { margin-top: 0.5rem; }
  .focus-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
    font-size: 0.95rem;
  }
  .focus-item .icon { flex-shrink: 0; margin-top: 2px; }
  .connect-box {
    border-radius: 12px;
    padding: 1.5rem 1.8rem;
    margin-top: 2rem;
    border: 1px solid var(--bs-border-color);
    background: var(--bs-tertiary-bg);
    text-align: center;
  }
  .connect-box p { margin-bottom: 0.5rem; }
</style>

<!-- ════════════════════════════════════════════════
     HERO SECTION
     ════════════════════════════════════════════════ -->
<div class="about-hero">
  <h1>👋 Amirul Islam Al Mamun</h1>
  <div class="subtitle">ML Data Engineer · Backend Engineer · Malmö, Sweden</div>

  <div class="badge-row">
    <a href="https://www.linkedin.com/in/amirulislamalmamun/"><img src="https://img.shields.io/badge/-amirulislamalmamun-blue?style=flat-square&logo=Linkedin&logoColor=white" alt="LinkedIn"></a>
    <a href="https://github.com/shiningflash"><img src="https://img.shields.io/badge/-shiningflash-black?style=flat-square&logo=github&logoColor=white" alt="GitHub"></a>
    <a href="https://medium.com/@amirulislamalmamun"><img src="https://img.shields.io/badge/-@amirulislamalmamun-03a57a?style=flat-square&labelColor=000000&logo=Medium" alt="Medium"></a>
    <a href="mailto:amirulislamalmamun@gmail.com"><img src="https://img.shields.io/badge/-amirulislamalmamun@gmail.com-c14438?style=flat-square&logo=Gmail&logoColor=white" alt="Gmail"></a>
  </div>

  <p>
    I care about how things work and how they keep working. My job as a data engineer is to make complexity disappear and reliability feel effortless. I started as a backend developer obsessed with clean code and fell in love with data. Today I design systems that move it faster, safer, and with purpose.
  </p>

  <div class="stat-grid">
    <div class="stat-card">
      <div class="num">~6</div>
      <div class="label">Years Experience</div>
    </div>
    <div class="stat-card">
      <div class="num">1M+</div>
      <div class="label">Users Served</div>
    </div>
    <div class="stat-card">
      <div class="num">16K+</div>
      <div class="label">LinkedIn Followers</div>
    </div>
    <div class="stat-card">
      <div class="num">1500+</div>
      <div class="label">Problems Solved</div>
    </div>
  </div>

  <div class="focus-item"><span class="icon">👉</span> Turning complex data systems into clean, reliable, and scalable pipelines.</div>
  <div class="focus-item"><span class="icon">👉</span> Bringing engineering discipline to AI-driven, real-time data environments.</div>
  <div class="focus-item"><span class="icon">👉</span> Writing code that's not only fast — but easy for teams to trust and extend.</div>
</div>

<!-- ════════════════════════════════════════════════
     PROFESSIONAL EXPERIENCE
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-briefcase"></i> Professional Experience</div>

<!-- Truxel -->
<div class="role-card">
  <div class="role-header">
    <div>
      <p class="role-title">ML Data Engineer</p>
      <span class="role-company">Truxel</span> · <span class="role-meta">Sweden</span>
    </div>
    <span class="role-date">Jan 2025 – Present</span>
  </div>
  <p style="margin:0.5rem 0 0.3rem;font-size:0.92rem;">
    As <strong>Data Platform Owner</strong>, I design and operate real-time data platforms for renewable energy systems — enabling large-scale telemetry ingestion, analytics, and ML-driven optimization of energy assets.
  </p>
  <details>
    <summary>View contributions</summary>
    <ul>
      <li>Designed <strong>real-time data pipelines</strong> processing high-frequency IoT telemetry from battery systems, PV inverters, and energy meters with <strong>sub-second latency</strong> and 99.9% uptime.</li>
      <li>Developed <strong>Python-based data ingestion services</strong> integrating <strong>MQTT</strong>, <strong>Modbus (TCP/RTU)</strong>, and event pipelines for scalable device communication.</li>
      <li>Built <strong>cloud-native data infrastructure</strong> on <strong>GCP</strong> (BigQuery, Pub/Sub, Cloud Storage) integrated with <strong>PostgreSQL</strong> and <strong>TimescaleDB</strong>.</li>
      <li>Implemented <strong>event-driven data workflows</strong> using <strong>Dagster</strong> and <strong>Airflow</strong> for energy market data, grid frequency signals, and FCR balancing events.</li>
      <li>Designed schemas and pipelines using <strong>Avro</strong> and <strong>BigQuery</strong> for efficient OLAP queries and reporting.</li>
      <li>Built observability with <strong>Grafana</strong> dashboards and alerting for battery diagnostics and grid performance.</li>
      <li>Contributed to reliability engineering — <strong>Docker</strong>, <strong>Kubernetes</strong>, and <strong>CI/CD</strong> via GitHub Actions.</li>
      <li>Collaborated with engineers and product teams on data-driven energy optimization and real-time analytics.</li>
    </ul>
  </details>
  <div class="tech-badges">
    <span class="tech-badge">Python</span><span class="tech-badge">Kafka</span><span class="tech-badge">MQTT</span><span class="tech-badge">Modbus</span><span class="tech-badge">Dagster</span><span class="tech-badge">Airflow</span><span class="tech-badge">BigQuery</span><span class="tech-badge">Pub/Sub</span><span class="tech-badge">PostgreSQL</span><span class="tech-badge">TimescaleDB</span><span class="tech-badge">dbt</span><span class="tech-badge">Docker</span><span class="tech-badge">Kubernetes</span><span class="tech-badge">GCP</span><span class="tech-badge">Grafana</span>
  </div>
</div>

<!-- Upwork -->
<div class="role-card">
  <div class="role-header">
    <div>
      <p class="role-title">Backend Engineer (Freelance)</p>
      <span class="role-company">Upwork</span> · <span class="role-meta">Sweden</span>
    </div>
    <span class="role-date">Sep 2024 – Jan 2025</span>
  </div>
  <p style="margin:0.5rem 0 0.3rem;font-size:0.92rem;">
    Provided backend development and automation solutions for clients using Python-based architectures.
  </p>
  <details>
    <summary>View contributions</summary>
    <ul>
      <li>Built and optimized <strong>RESTful APIs</strong> using Python, improving backend performance and maintainability.</li>
      <li>Developed <strong>automation scripts</strong> and integrations for third-party platforms including <strong>Printful</strong>.</li>
      <li>Designed backend services focused on <strong>performance optimization</strong> and scalable architecture.</li>
      <li>Delivered Python backend solutions for web services, data processing, and automation workflows.</li>
    </ul>
  </details>
  <div class="tech-badges">
    <span class="tech-badge">Python</span><span class="tech-badge">REST APIs</span><span class="tech-badge">Automation</span><span class="tech-badge">Backend Development</span>
  </div>
</div>

<!-- WellDev -->
<div class="role-card">
  <div class="role-header">
    <div>
      <p class="role-title">Senior Backend Engineer</p>
      <span class="role-company">WellDev</span> · <span class="role-meta">Bangladesh → Switzerland (Remote)</span>
    </div>
    <span class="role-date">Jan 2024 – Aug 2024</span>
  </div>
  <p style="margin:0.5rem 0 0.3rem;font-size:0.92rem;">
    Led backend engineering across enterprise document processing and NLP-based analytics services. Boosted API speed by <strong>35%</strong> and introduced <strong>JWT-based multi-tenant security</strong>.
  </p>
  <details>
    <summary>View contributions</summary>
    <ul>
      <li>Improved API performance by <strong>35%</strong> by optimizing <strong>FastAPI</strong> services, <strong>PostgreSQL</strong> queries, and <strong>Redis</strong> caching.</li>
      <li>Built scalable microservices and document processing pipelines on <strong>Docker</strong> and <strong>Kubernetes</strong>.</li>
      <li>Developed secure middleware with <strong>JWT auth</strong>, <strong>OAuth 2.0</strong>, and role-based multi-tenancy.</li>
      <li>Built NLP and document analysis pipelines using <strong>Python</strong> and <strong>TensorFlow</strong>.</li>
      <li>Implemented <strong>CI/CD</strong> with GitLab Runner and GitHub Actions.</li>
      <li>Increased test coverage from <strong>60% → 90%</strong> using <strong>PyTest</strong>.</li>
      <li>Conducted code reviews, security audits, and technical mentoring.</li>
    </ul>
  </details>
  <div class="tech-badges">
    <span class="tech-badge">Python</span><span class="tech-badge">FastAPI</span><span class="tech-badge">PostgreSQL</span><span class="tech-badge">Redis</span><span class="tech-badge">Docker</span><span class="tech-badge">Kubernetes</span><span class="tech-badge">AWS</span><span class="tech-badge">RabbitMQ</span><span class="tech-badge">Celery</span><span class="tech-badge">TensorFlow</span><span class="tech-badge">PyTest</span>
  </div>
</div>

<!-- Supertal -->
<div class="role-card">
  <div class="role-header">
    <div>
      <p class="role-title">Senior Backend Engineer → Backend Engineer</p>
      <span class="role-company">Supertal Pte. Ltd.</span> · <span class="role-meta">Remote (Singapore)</span>
    </div>
    <span class="role-date">Nov 2021 – Dec 2023</span>
  </div>
  <p style="margin:0.5rem 0 0.3rem;font-size:0.92rem;">
    Led backend development for high-scale warehouse management, e-commerce, and agritech platforms across Southeast Asia. Promoted ahead of schedule. Scaled platforms to <strong>1M+ users</strong>.
  </p>
  <details>
    <summary>View contributions</summary>
    <ul>
      <li>Designed <strong>microservices architectures</strong> using Python (<strong>FastAPI</strong>, <strong>Django</strong>) for enterprise systems.</li>
      <li>Developed a <strong>Warehouse Management System</strong> handling <strong>millions</strong> of transactions with <strong>PostgreSQL</strong>, <strong>MongoDB</strong>, and <strong>Redis</strong>.</li>
      <li>Improved e-commerce platform performance by <strong>40%</strong> through database and backend optimization.</li>
      <li>Implemented event-driven services with <strong>RabbitMQ</strong> and <strong>Celery</strong> for async processing.</li>
      <li>Designed <strong>CI/CD</strong> with <strong>Jenkins</strong> for faster deployments.</li>
      <li>Led architecture discussions, code reviews, and team mentoring.</li>
      <li>Integrated <strong>ERPNext</strong> for operational workflows.</li>
    </ul>
  </details>
  <div class="tech-badges">
    <span class="tech-badge">Python</span><span class="tech-badge">Django</span><span class="tech-badge">FastAPI</span><span class="tech-badge">PostgreSQL</span><span class="tech-badge">MongoDB</span><span class="tech-badge">Redis</span><span class="tech-badge">RabbitMQ</span><span class="tech-badge">Docker</span><span class="tech-badge">Jenkins</span><span class="tech-badge">AWS</span><span class="tech-badge">GCP</span>
  </div>
</div>

<!-- Evaly -->
<div class="role-card">
  <div class="role-header">
    <div>
      <p class="role-title">Backend Engineer</p>
      <span class="role-company">Evaly.com.bd</span> · <span class="role-meta">Dhaka, Bangladesh</span>
    </div>
    <span class="role-date">Feb 2021 – Oct 2021</span>
  </div>
  <p style="margin:0.5rem 0 0.3rem;font-size:0.92rem;">
    Developed backend for one of Bangladesh's largest e-commerce platforms handling millions of transactions.
  </p>
  <details>
    <summary>View contributions</summary>
    <ul>
      <li>Built a <strong>high-throughput eBilling platform</strong> with <strong>Django</strong>, <strong>Celery</strong>, <strong>RabbitMQ</strong>, and <strong>PostgreSQL</strong>.</li>
      <li>Improved transaction accuracy by <strong>25%</strong> through order reconciliation.</li>
      <li>Built scalable microservices for high-traffic <strong>Evaly-Cyclone</strong> sales campaigns.</li>
      <li>Async task processing with <strong>Celery</strong> and <strong>Redis</strong> for peak load.</li>
      <li>Introduced <strong>database sharding</strong> and <strong>load balancing</strong> strategies.</li>
    </ul>
  </details>
  <div class="tech-badges">
    <span class="tech-badge">Python</span><span class="tech-badge">Django</span><span class="tech-badge">DRF</span><span class="tech-badge">PostgreSQL</span><span class="tech-badge">Redis</span><span class="tech-badge">Celery</span><span class="tech-badge">RabbitMQ</span><span class="tech-badge">AWS</span><span class="tech-badge">Docker</span>
  </div>
</div>

<!-- Leads -->
<div class="role-card">
  <div class="role-header">
    <div>
      <p class="role-title">Software Engineer Intern</p>
      <span class="role-company">Leads Corporation Ltd.</span> · <span class="role-meta">Dhaka, Bangladesh</span>
    </div>
    <span class="role-date">Sep 2020 – Dec 2020</span>
  </div>
  <p style="margin:0.5rem 0 0.3rem;font-size:0.92rem;">
    Developed backend for the <strong>VerifID eKYC</strong> platform — now providing digital onboarding to <strong>12+ banks</strong> in Bangladesh.
  </p>
  <details>
    <summary>View contributions</summary>
    <ul>
      <li>Built backend for remote identity verification and digital bank onboarding.</li>
      <li>Integrated <strong>OCR</strong> and <strong>facial recognition</strong> using <strong>OpenCV</strong> and <strong>Pytesseract</strong>.</li>
      <li>Implemented REST APIs with <strong>Python Flask</strong> and <strong>MySQL</strong>.</li>
      <li>Optimized onboarding workflows — reduced verification time by <strong>30%</strong>.</li>
    </ul>
  </details>
  <div class="tech-badges">
    <span class="tech-badge">Python</span><span class="tech-badge">Flask</span><span class="tech-badge">MySQL</span><span class="tech-badge">Redis</span><span class="tech-badge">OpenCV</span><span class="tech-badge">Pytesseract</span><span class="tech-badge">Azure</span>
  </div>
</div>

<!-- ════════════════════════════════════════════════
     SKILLS
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-code"></i> Tech Stack & Skills</div>

<div class="skill-group">
  <h4><i class="fas fa-terminal"></i> Programming & Backend</h4>
  <div class="tech-badges">
    <span class="tech-badge">Python</span><span class="tech-badge">FastAPI</span><span class="tech-badge">Django</span><span class="tech-badge">DRF</span><span class="tech-badge">Flask</span><span class="tech-badge">AsyncIO</span><span class="tech-badge">C++</span><span class="tech-badge">RESTful APIs</span><span class="tech-badge">Microservices</span><span class="tech-badge">Event-Driven Architecture</span><span class="tech-badge">Distributed Systems</span><span class="tech-badge">Design Patterns</span><span class="tech-badge">Git</span>
  </div>
</div>

<div class="skill-group">
  <h4><i class="fas fa-stream"></i> Data Engineering & Streaming</h4>
  <div class="tech-badges">
    <span class="tech-badge">Real-time ETL</span><span class="tech-badge">Dagster</span><span class="tech-badge">Airflow</span><span class="tech-badge">Kafka</span><span class="tech-badge">MQTT</span><span class="tech-badge">RabbitMQ</span><span class="tech-badge">Modbus</span><span class="tech-badge">Spark</span><span class="tech-badge">Data Modeling</span><span class="tech-badge">Data Warehousing</span><span class="tech-badge">dbt</span>
  </div>
</div>

<div class="skill-group">
  <h4><i class="fas fa-database"></i> Databases & Storage</h4>
  <div class="tech-badges">
    <span class="tech-badge">PostgreSQL</span><span class="tech-badge">TimescaleDB</span><span class="tech-badge">PostGIS</span><span class="tech-badge">MySQL</span><span class="tech-badge">MongoDB</span><span class="tech-badge">Redis</span><span class="tech-badge">BigQuery</span><span class="tech-badge">SQL Optimization</span><span class="tech-badge">OLTP &amp; OLAP</span>
  </div>
</div>

<div class="skill-group">
  <h4><i class="fas fa-cloud"></i> Cloud & Infrastructure</h4>
  <div class="tech-badges">
    <span class="tech-badge">GCP</span><span class="tech-badge">BigQuery</span><span class="tech-badge">Pub/Sub</span><span class="tech-badge">Cloud Storage</span><span class="tech-badge">Cloud Functions</span><span class="tech-badge">AWS Lambda</span><span class="tech-badge">API Gateway</span><span class="tech-badge">S3</span><span class="tech-badge">EC2</span><span class="tech-badge">DynamoDB</span><span class="tech-badge">RDS</span><span class="tech-badge">SQS</span><span class="tech-badge">SNS</span><span class="tech-badge">EventBridge</span><span class="tech-badge">CloudWatch</span><span class="tech-badge">Redshift</span><span class="tech-badge">Azure</span><span class="tech-badge">Docker</span><span class="tech-badge">Kubernetes</span><span class="tech-badge">Terraform</span><span class="tech-badge">Linux</span>
  </div>
</div>

<div class="skill-group">
  <h4><i class="fas fa-cogs"></i> CI/CD & Observability</h4>
  <div class="tech-badges">
    <span class="tech-badge">GitLab CI/CD</span><span class="tech-badge">GitHub Actions</span><span class="tech-badge">Jenkins</span><span class="tech-badge">PyTest</span><span class="tech-badge">TDD</span><span class="tech-badge">Grafana</span><span class="tech-badge">Kibana</span><span class="tech-badge">CloudWatch</span><span class="tech-badge">Time-Series Analytics</span>
  </div>
</div>

<div class="skill-group">
  <h4><i class="fas fa-sitemap"></i> Architecture & Practices</h4>
  <div class="tech-badges">
    <span class="tech-badge">System Design</span><span class="tech-badge">Cloud-Native Architecture</span><span class="tech-badge">Scalable Backends</span><span class="tech-badge">Multi-Tenant Systems</span><span class="tech-badge">Performance Optimization</span><span class="tech-badge">Data Structures &amp; Algorithms</span><span class="tech-badge">Code Reviews</span>
  </div>
</div>

<!-- ════════════════════════════════════════════════
     EDUCATION
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-graduation-cap"></i> Education</div>

<div class="role-card">
  <div class="role-header">
    <div>
      <p class="role-title">Bachelor of Computer Science</p>
      <span class="role-company">BRAC University</span> · <span class="role-meta">Dhaka, Bangladesh</span>
    </div>
    <span class="role-date">2017 – 2020</span>
  </div>
  <p style="margin:0.5rem 0 0;font-size:0.92rem;">
    Result: <strong>92%</strong> · <strong>100% (Full-Funded) Scholarship</strong> for excellence in Competitive Programming · <strong>CGPA 4.0/4.0</strong> in last 4 consecutive semesters.
  </p>
  <details>
    <summary>Activities, coursework &amp; thesis</summary>
    <div>
      <p style="font-size:0.9rem;margin-bottom:0.5rem;"><strong>Activities:</strong> ACM Programmer · Programming Mentor · Problem Setter · Contest Judge · Undergraduate Teaching Assistant</p>
      <p style="font-size:0.9rem;margin-bottom:0.5rem;"><strong>Thesis:</strong> <em>A Deep Learning Approach to Integrate Human-Level Understanding in a Chatbot</em></p>
      <p style="font-size:0.9rem;margin-bottom:0.5rem;"><strong>Relevant Coursework:</strong></p>
      <div class="tech-badges">
        <span class="tech-badge">Data Structures</span><span class="tech-badge">Algorithms</span><span class="tech-badge">Neural Networks</span><span class="tech-badge">Artificial Intelligence</span><span class="tech-badge">Software Engineering</span><span class="tech-badge">OOP</span><span class="tech-badge">Database Systems</span><span class="tech-badge">Operating Systems</span><span class="tech-badge">Computer Architecture</span><span class="tech-badge">Data Communication</span><span class="tech-badge">Calculus</span>
      </div>
      <p style="font-size:0.9rem;margin-top:0.6rem;margin-bottom:0.3rem;"><strong>Extracurriculars:</strong></p>
      <ul style="font-size:0.88rem;">
        <li>Teaching Assistant (Discrete Mathematics) for over 1 year</li>
        <li>Competitive Programming Mentor and BootCamp Trainer (Mar 2018 – Jul 2020)</li>
        <li>Champion in BUCC Intra-University Programming Contest</li>
        <li>Solved 1500+ coding challenges across LeetCode, Codeforces, HackerRank, UVa</li>
        <li>Participated in 18+ national programming contests and 5+ hackathons</li>
        <li>Problem Setter and Judge at 6+ programming contests</li>
        <li>Internship project (VerifID) now provides digital onboarding to 12+ banks in Bangladesh</li>
      </ul>
    </div>
  </details>
</div>

<!-- ════════════════════════════════════════════════
     COMPETITIVE PROGRAMMING
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-trophy"></i> Competitive Programming</div>

<div class="role-card">
  <ul style="margin:0;font-size:0.92rem;">
    <li><strong>Judge, Moderator and Problem Setter</strong> of <strong>6+</strong> programming contests at <a href="https://toph.co/u/amirul_islam">Toph</a></li>
    <li><strong>Authored 12+ problems</strong> in different programming contests at Toph</li>
    <li><strong>Solved 1500+ online problems</strong> on <a href="https://leetcode.com/shiningflash/">LeetCode</a>, <a href="https://www.hackerrank.com/shiningflash">HackerRank</a>, Codeforces, UVa and others</li>
  </ul>
</div>

<!-- ════════════════════════════════════════════════
     VOLUNTEERING & COMMUNITY
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-hands-helping"></i> Volunteering & Community</div>

<div class="vol-card">
  <h4>🎤 Keynote Speaker</h4>
  <span class="vol-org">Self-Employed</span> · <span class="vol-date">Apr 2022 – Present</span>
  <details>
    <summary>Details</summary>
    <ul style="font-size:0.88rem;">
      <li>Delivered over <strong>20 keynote addresses</strong> (onsite & online), inspiring more than <strong>5,000</strong> students, professionals, and aspiring engineers globally.</li>
      <li>Shared actionable insights on career preparation, tech trends, and software industry best practices.</li>
      <li>Engaged in thought leadership on the <em>"Future of Tech"</em>, influencing innovation strategies in universities and professional organizations.</li>
      <li>Provided tailored advice on resume building, technical interview prep, and engineering practices — helping hundreds secure industry roles.</li>
      <li><strong>IEEE Seminar at BRAC University:</strong> Keynote on <em>"Guidelines for Future Software Engineers"</em> and <em>"Preparation for the Software Industry"</em> at an IEEE-organized seminar for 100+ students and faculty. <a href="https://www.facebook.com/ieeebracuCS/posts/pfbid07hjcybLssRSNCGm7EPHJXpzrAoa1iTdcLsu7KYp12JgKUo3pTENRghhNu1cAXMU5l">Event Post</a></li>
      <li>Conducted corporate sessions on clean coding, DevOps, and CI/CD practices.</li>
    </ul>
  </details>
</div>

<div class="vol-card">
  <h4>🧑‍🏫 Programming Mentor</h4>
  <span class="vol-org">BRAC University</span> · <span class="vol-date">Mar 2018 – Jul 2020</span>
  <details>
    <summary>Details</summary>
    <ul style="font-size:0.88rem;">
      <li>Guided junior contestants through classes, workshops, CSE Boot Camps, and programming contests.</li>
      <li>Introduced students to data structures, algorithms, and software engineering best practices.</li>
      <li><strong>Skills taught:</strong> Competitive Programming, Problem Solving, C++, Python, Dynamic Programming, Graph Theory, Number Theory.</li>
    </ul>
  </details>
</div>

<div class="vol-card">
  <h4>❤️ Head of Human Resources</h4>
  <span class="vol-org">Voice Of Humanity Foundation</span> · <span class="vol-date">Feb 2020 – Present</span>
  <details>
    <summary>Details</summary>
    <ul style="font-size:0.88rem;">
      <li>Mobilized <strong>100+ professional doctors</strong> and <strong>400+ volunteers</strong> to provide free and emergency medical support during the COVID-19 crisis.</li>
      <li>Currently focused on supporting disabled individuals, street children, and underprivileged rural communities with free medical care, education, and food.</li>
    </ul>
  </details>
</div>

<div class="vol-card">
  <h4>📚 Founding Member & Advisor</h4>
  <span class="vol-org">Alokito Pathshala (আলোকিত পাঠশালা)</span> · <span class="vol-date">Feb 2018 – Present</span>
  <details>
    <summary>Details</summary>
    <ul style="font-size:0.88rem;">
      <li>Co-founded a <strong>nonprofit library and mini-school</strong> for underprivileged children in our village.</li>
      <li>Finance, teach, and organize cultural events for social welfare.</li>
    </ul>
  </details>
</div>

<!-- ════════════════════════════════════════════════
     HONORS & AWARDS
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-award"></i> Honors & Awards</div>

<div class="role-card">
  <ul style="margin:0;font-size:0.92rem;">
    <li><strong>Global Problem-Solver</strong> – NASA Space Apps COVID-19 Challenge (2020)</li>
    <li><strong>Champion</strong> – Intra-University Programming Contest, BRAC University (2017)</li>
    <li><strong>2nd Runner Up</strong> – BUCC Intra-University Programming Contest (Senior), Fall'18 & Spring'19</li>
    <li><strong>12th Place</strong> – INWED Techfest Programming Contest, IUB (2019)</li>
    <li><strong>8th Place</strong> – UITS Inter-University Programming Contest (2019)</li>
  </ul>
</div>

<!-- ════════════════════════════════════════════════
     CERTIFICATIONS
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-certificate"></i> Certifications</div>

<div class="role-card">
  <ul style="margin:0;font-size:0.92rem;">
    <li>Programming Skill Bootcamp Trainer</li>
    <li>Global Problem-Solver — NASA Space Apps COVID-19 Challenge</li>
    <li>Software Development Processes and Methodologies</li>
    <li>Programming Foundations: Design Patterns</li>
  </ul>
</div>

<!-- ════════════════════════════════════════════════
     PUBLICATIONS
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-book"></i> Publications</div>

<div class="role-card">
  <p class="role-title" style="margin-bottom:0.2rem;">A Deep Learning Approach to Integrate Human-Level Understanding in a Chatbot</p>
  <span class="role-meta">10th International Conference on Natural Language Processing (NLP 2021) · Sydney, Australia · Oct 10, 2021</span>
  <details>
    <summary>Details</summary>
    <p style="font-size:0.88rem;">
      Deep learning approach to enhancing chatbot interactions by integrating human-level understanding. Focuses on <strong>Sentiment Analysis</strong>, <strong>Emotion Detection</strong>, <strong>Intent Classification</strong>, and <strong>Named-Entity Recognition (NER)</strong>. Demonstrated <strong>30%</strong> improvement in chatbot interaction quality.
    </p>
    <div class="tech-badges" style="margin-bottom:0.5rem;">
      <span class="tech-badge">Python</span><span class="tech-badge">NLP</span><span class="tech-badge">TensorFlow</span><span class="tech-badge">PyTorch</span><span class="tech-badge">Scikit-learn</span><span class="tech-badge">NLTK</span><span class="tech-badge">NumPy</span><span class="tech-badge">Pandas</span>
    </div>
    <p style="font-size:0.88rem;">
      <a href="https://aircconline.com/csit/abstract/v11n23/csit112309.html">Read the Abstract</a> · <a href="https://lnkd.in/gcqsU52V">GitHub Repository</a>
    </p>
  </details>
</div>

<!-- ════════════════════════════════════════════════
     LANGUAGES
     ════════════════════════════════════════════════ -->
<div class="section-title"><i class="fas fa-language"></i> Languages</div>

<div class="role-card">
  <div class="tech-badges">
    <span class="tech-badge">🇬🇧 English (Fluent)</span>
    <span class="tech-badge">🇸🇪 Swedish (Learner, SFI)</span>
    <span class="tech-badge">🇧🇩 Bangla (Native)</span>
  </div>
</div>

<!-- ════════════════════════════════════════════════
     CONNECT
     ════════════════════════════════════════════════ -->
<div class="connect-box">
  <p style="font-size:1.1rem;font-weight:600;">💬 I believe good systems are built the same way good teams are — with clarity, consistency, and care.</p>
  <p style="font-size:0.95rem;">Let's connect: <a href="mailto:amirulislamalmamun@gmail.com">amirulislamalmamun@gmail.com</a> · <a href="https://www.linkedin.com/in/amirulislamalmamun/">LinkedIn</a> · <a href="https://github.com/shiningflash">GitHub</a></p>
</div>
