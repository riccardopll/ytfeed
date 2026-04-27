---
name: ytfeed
description: Use when the user wants to collect, review, summarize, or parse videos from their YouTube homepage recommendations, including video links, channel details, metadata, durations, and thumbnails as Markdown or JSON.
---

# YTFeed

Collects videos from a YouTube homepage and returns an LLM-friendly feed.

## Workflow

1. Use Markdown for quick human review unless the user asks for structured data.
2. Use JSON when the result needs to be parsed, filtered, transformed, or reused
   by another tool.
3. Pass a limit when the user asks for a specific number of videos.
4. Refresh the saved YouTube session only when authentication is needed or the
   feed appears empty because the session has expired.

## Examples

Default Markdown feed:

```bash
ytfeed scrape
```

Markdown feed with a specific limit:

```bash
ytfeed scrape --limit 20
```

Structured JSON:

```bash
ytfeed scrape --limit 20 --format json
```

Refresh the saved session:

```bash
ytfeed login
```

## Output

Markdown output is a compact list of videos with available metadata:

```markdown
1. [Video title](https://www.youtube.com/watch?v=...)
   Channel: [Channel name](https://www.youtube.com/@...)
   Duration: 12:34
   Metadata: 123K views | 2 days ago
   Thumbnail: https://...
```

JSON output includes:

- `scrapedAt`
- `limit`
- `count`
- `videos`

Each video may include `title`, `url`, `videoId`, `channel`, `channelUrl`,
`duration`, `views`, `published`, `metadata`, and `thumbnail`.

## Gotchas

- The default output is Markdown with a limit of `20`.
- `ytfeed login` is interactive; use it only when a session refresh is needed.
- Some fields may be `null` or omitted when YouTube does not expose them in the
  homepage card.
