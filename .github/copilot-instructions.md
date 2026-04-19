# Copilot Instructions — shiningflash.github.io

## Project Overview

Personal tech blog by **Amirul Islam Al Mamun**, hosted on GitHub Pages.
Built with **Jekyll** using the **Chirpy theme** (`jekyll-theme-chirpy ~> 6.5`).
URL: `https://shiningflash.github.io`

## Directory Structure

```
_posts/          Blog posts (Markdown, date-prefixed filenames)
_tabs/           Navigation pages (about, archives, categories, tags)
_data/           Site metadata (authors.yml, contact.yml, share.yml)
_plugins/        Jekyll hooks (lastmod, watcher-patch)
_config.yml      Chirpy theme configuration
assets/img/      Post images and site avatar
assets/lib/      Vendored JS/CSS libraries (do not modify)
.github/         CI/CD workflows + instruction files
```

## Post Conventions

### Filename Format
`YYYY-MM-DD-slug-with-hyphens.md` — always lowercase, no spaces.

### Front Matter (required fields)

```yaml
---
title: "Descriptive Title Here"
date: YYYY-MM-DD HH:MM +TZOFFSET
categories: [English, Programming]        # or [বাংলা] for Bangla posts
tags: [tag1, tag2, tag3]                   # lowercase, hyphenated
author: amirulislam                        # must match _data/authors.yml key
---
```

- `categories`: First element is language (`English` or `বাংলা`), then topic areas like `Programming`, `DevOps`, `AI`, `Life-Lesson`, `Experience`, `Motivation`, `Humor`.
- `tags`: Lowercase, hyphenated multi-word tags. Reuse existing tags when possible: `programming`, `backend-development`, `tech-talk`, `python`, `fastapi`, `flask`, `django`, `rest-api`, `experience`, `mental-health`, `ai`, `chatgpt`.
- `author`: Use `amirulislam` (defined in `_data/authors.yml`).

### Writing Style

Posts are written in a **conversational, first-person voice**. The tone is:

- **Personal and humanistic** — shares real experience, not textbook summaries
- **Technically deep** — includes concrete numbers, code snippets, architecture decisions
- **Accessible** — written so junior engineers and newcomers can follow
- **Bilingual** — some posts are in Bangla, some in English, some mix both naturally

Structural patterns observed across posts:

1. **Hook opener** — emoji + bold title restated, or a compelling personal anecdote
2. **Hero image** — `<img src="/assets/img/..." alt="..." width="400">` placed near the top (not all posts)
3. **Sections with `###` headings** — short, punchy section titles, often with emoji
4. **Horizontal rules** — `---` or `-----` used to separate major sections
5. **Bold key terms** on first mention — frameworks, metrics, concepts
6. **Code blocks** — use fenced markdown with language identifier (```python, ```yaml)
7. **Closing CTA** — invites readers to comment, connect, or stay tuned; sometimes includes email

### Image Handling

- Store images in `assets/img/`
- Reference with absolute path from site root: `/assets/img/filename.ext`
- Use raw HTML `<img>` tag with `width` attribute for sizing, not Markdown image syntax
- Alt text should be descriptive

## Tab Pages (`_tabs/`)

Each tab has minimal front matter:

```yaml
---
layout: page        # or specific layout (tags, categories, archives)
icon: fas fa-...    # FontAwesome icon class
order: N            # display order in sidebar
---
```

- `about.md` (order 4) — the only tab with substantial content; uses badge shields, sections with `##`/`###`, horizontal rules
- Other tabs (`archives`, `categories`, `tags`) are layout-only, no custom content

## Configuration (`_config.yml`)

- Theme: `jekyll-theme-chirpy`
- Timezone: `Asia/Dhaka`
- Pagination: 10 posts per page
- TOC: enabled globally
- PWA: enabled
- Avatar: GitHub profile picture URL
- Kramdown with Rouge syntax highlighting, line numbers in blocks

## Data Files (`_data/`)

- `authors.yml` — author entries keyed by slug (e.g., `amirulislam`), with `name`, `twitter`, `url`
- `contact.yml` — sidebar contact icons (github, twitter, email, rss)
- `share.yml` — post sharing buttons (Twitter, Facebook, Telegram)

## Deployment

GitHub Actions workflow in `.github/workflows/pages-deploy.yml`:
- Triggers on push to `main`/`master`
- Ruby 3.2, `bundle exec jekyll b`
- Deploys via `actions/deploy-pages@v4`

## Code Style

- Indentation: 2 spaces (see `.editorconfig`)
- Line endings: LF
- YAML quotes: double quotes
- Markdown: no trailing whitespace trimming (per `.editorconfig`)
- Final newline: always

## Key Rules

- Never modify files under `assets/lib/` — these are vendored dependencies
- New authors must be added to `_data/authors.yml` before referencing in posts
- Post filenames must start with a valid date or Jekyll ignores them
- Categories and tags are case-sensitive in Jekyll; follow existing casing
- The Chirpy theme provides layouts, includes, and sass via the gem — don't duplicate them locally
- Keep `_config.yml` changes minimal; most Chirpy defaults are inherited from the gem
