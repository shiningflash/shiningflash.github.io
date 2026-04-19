---
name: "Tab Pages"
description: "Conventions for navigation tab pages in _tabs/"
applyTo: "_tabs/**"
---

# Tab Page Instructions

## Overview

Tab pages define the sidebar navigation. The Chirpy theme renders them automatically.

## Front Matter

```yaml
---
layout: page          # or: tags, categories, archives
icon: fas fa-...      # FontAwesome 5 icon class
order: N              # sidebar display order (1-based)
---
```

### Current Tabs

| File            | Layout       | Icon                  | Order |
|-----------------|--------------|-----------------------|-------|
| `categories.md` | `categories` | `fas fa-stream`       | 1     |
| `tags.md`       | `tags`       | `fas fa-tags`         | 2     |
| `archives.md`   | `archives`   | `fas fa-archive`      | 3     |
| `about.md`      | `page`       | `fas fa-info-circle`  | 4     |

## Rules

- `categories.md`, `tags.md`, `archives.md` — layout-only, no body content. The theme generates the page.
- `about.md` — the only tab with substantial content.

## About Page Structure

The about page follows a resume-style layout:

1. **Header** — name, badge shields (LinkedIn, GitHub, Medium, Gmail)
2. **Intro paragraph** — one-paragraph professional summary
3. **Sections separated by `---`**:
   - Professional Experience (reverse chronological, with bold metrics)
   - Education
   - Skills (grouped: Languages, Backend, Databases, Cloud & DevOps, etc.)
   - Certifications
   - Honors & Awards
   - Additional Information (top skills, languages, extracurriculars)
   - Publications
4. **Headings**: `##` for sections, `###` for subsections/roles
5. **Bold** company names, metrics, and key technologies
6. Badge shields use `img.shields.io` format with FontAwesome icons
