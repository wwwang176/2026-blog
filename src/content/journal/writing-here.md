---
title: How this journal works
date: 2026-07-26
description: A placeholder post so the journal has something to render. Replace or delete it once you write your first real entry.
tags: ["meta"]
draft: false
---

This is a placeholder. It exists so the journal listing and detail templates
have something to render — delete it once you publish your first real post.

## Adding a post

Create a `.md` file in `src/content/journal/`. The filename becomes the URL, so
`first-post.md` publishes at `/journal/first-post/`.

Every post needs this frontmatter:

```yaml
---
title: Your title
date: 2026-08-01
description: One or two sentences. This shows in listings, search results and link previews.
tags: ["three.js", "webgl"]
draft: false
---
```

Set `draft: true` and the post is excluded from the build — useful for work in
progress.

## What you get for free

Every post is pre-rendered to static HTML, so search engines see the full
content without running any JavaScript. Posts are added to `sitemap-index.xml`
and the RSS feed at `/rss.xml` automatically.

## Formatting

Standard markdown works: headings, **bold**, *italic*, `inline code`, lists,
blockquotes, tables and fenced code blocks with syntax highlighting.

If you want the richer layout blocks used on the works pages — comparison
columns, stat callouts, numbered steps — rename the file to `.mdx` and they
become available there too.
