---
name: "Blog Posts"
description: "Conventions for writing and editing blog posts in _posts/"
applyTo: "_posts/**"
---

# Blog Post Instructions

## Filename

`YYYY-MM-DD-slug-with-hyphens.md` — lowercase, no spaces, date must be valid.

## Front Matter Template

```yaml
---
title: "Your Title Here"
date: YYYY-MM-DD HH:MM +TZOFFSET
categories: [English, Programming]
tags: [tag1, tag2]
author: amirulislam
---
```

### Field Rules

- **title**: Descriptive, may include emoji in the body but not in the front matter `title` itself (some posts do include emoji in `title` — follow the author's choice)
- **date**: Include timezone offset (`+0200` or `+0600` depending on location)
- **categories**: First element = language (`English` or `বাংলা`). Then topic areas. Existing topics: `Programming`, `DevOps`, `AI`, `Life-Lesson`, `Experience`, `Motivation`, `Humor`
- **tags**: Lowercase, hyphenated. Check existing tags before creating new ones:
  `programming`, `backend-development`, `tech-talk`, `python`, `fastapi`, `flask`, `django`, `rest-api`, `experience`, `mental-health`, `ai`, `chatgpt`, `optimization`, `docker`, `automation`, `aws`, `azure`, `gcp`, `humor`, `mindset`, `paradigm-shift`, `career-growth`
- **author**: Always `amirulislam` (or `shiningflash` for Bangla-focused posts — both defined in `_data/authors.yml`)

## Writing Voice & Structure

The author writes like he's talking to a friend who's also an engineer. Follow this pattern:

### Opening
- Start with an emoji + bold restatement of the title, OR a personal anecdote
- Example: `**Flask vs. FastAPI: Which Should You Choose?** 🤔`
- Example: `Sometimes, the best opportunities come when you're not even looking for them.`

### Hero Image (optional, near the top)
```html
<img src="/assets/img/filename.ext" alt="descriptive alt text" width="400">
```
- Use `width="400"` for portrait/square, `width="600"` for landscape
- Store images in `assets/img/`

### Body Sections
- Use `###` headings — short, punchy, often with emoji: `### Flask: The Reliable Old Friend 🛠️`
- Separate major sections with `---` or `-----`
- **Bold** key terms, framework names, and metrics on first mention
- Include real numbers from experience: `"improved performance by 30%"`, `"over 1 million users"`
- Code blocks: fenced with language identifier (` ```python `, ` ```yaml `)
- Keep paragraphs short (3–5 sentences max)

### Bilingual Posts
- Some posts mix Bangla and English naturally within paragraphs
- Bangla-only posts use `categories: বাংলা` (no second category needed)
- Don't force consistency — the natural code-switching is intentional

### Closing
- Invite readers to comment/connect
- Optional: include email (`amirulislamalmamun@gmail.com`)
- Tone: warm, encouraging, forward-looking
- Example: `"What's your experience with these frameworks? 🚀"`
- Example: `"feel free to email me at **amirulislamalmamun@gmail.com**. Let's connect and grow together!"`

## Anti-Patterns

- Don't write dry textbook-style explanations — always ground in personal experience
- Don't use Markdown image syntax `![alt](url)` — use HTML `<img>` tags
- Don't create deeply nested heading hierarchies (stick to `##` and `###`)
- Don't duplicate content from `_tabs/about.md` into posts
