---
name: "Configuration & Data"
description: "Rules for _config.yml and _data/ files"
applyTo: "{_config.yml,_data/**}"
---

# Configuration & Data File Instructions

## _config.yml

This is a Chirpy theme config. Most settings are inherited from the gem.

### Safe to Edit
- `title`, `tagline`, `description`, `url`
- `social` block (name, email, links)
- `github.username`, `twitter.username`
- `avatar`, `social_preview_image`
- `comments` section (to enable Disqus/Giscus/Utterances)
- `google_analytics.id`, `goatcounter.id`
- `theme_mode` (light/dark/empty for system)
- `pwa` settings
- `paginate`

### Do Not Touch
- `kramdown` block — Rouge highlighting config is tuned
- `collections`, `defaults` — Chirpy layout/permalink mappings
- `sass`, `compress_html` — theme build settings
- `jekyll-archives` — category/tag permalink structure

## _data/authors.yml

Author entries keyed by slug. Current entries: `amirulislam`.

```yaml
amirulislam:
  name: Amirul Islam
  twitter: _shiningflash
  url: https://www.linkedin.com/in/amirulislamalmamun/
```

When adding an author: add the key here first, then reference it in post front matter.

## _data/contact.yml

Sidebar contact icons. Uses FontAwesome classes. Current: github, twitter, email, rss.

## _data/share.yml

Post sharing buttons. Current: Twitter, Facebook, Telegram.
Uncomment existing entries in the file to enable LinkedIn, Weibo, or Mastodon.
