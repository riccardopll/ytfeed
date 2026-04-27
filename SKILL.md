---
name: ytfeed
description: Use when an agent needs to operate the `ytfeed` YouTube homepage scraper binary. Covers login, scraping in Markdown or JSON, output expectations, and browser/session troubleshooting.
---

# YTFeed

## Binary

Use the `ytfeed` binary:

```bash
ytfeed login
ytfeed scrape --limit 20
ytfeed scrape --limit 20 --format json
```

## Workflow

1. Run `ytfeed scrape --limit <n> --format json` when output needs to be parsed.
2. Run `ytfeed scrape --limit <n>` when Markdown output is enough.
3. Run `ytfeed login` only when YouTube authentication or session refresh is needed; it opens a browser and waits for the user to press Enter.
4. Treat stdout as the scraped result. Treat stderr as warnings, login/session messages, or errors.

## Notes

- The default output is Markdown with limit `20`.
- JSON output should contain `scrapedAt`, `limit`, `count`, and `videos`.
- If `ytfeed` is unavailable, report that it is not installed or not available in `PATH`.
