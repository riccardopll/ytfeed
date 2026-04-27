# ytfeed

Scrape videos from your YouTube homepage into an LLM-friendly format.

## Install

```bash
brew tap riccardopll/tap
brew install riccardopll/tap/ytfeed
```

`ytfeed` requires Chromium through Playwright. If the browser is not already
installed, run:

```bash
bun run install-browser
```

Log in once if you want personalized recommendations:

```bash
ytfeed login
```

## Commands

| Command                       | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `ytfeed`                      | Scrape the YouTube homepage with the default options.   |
| `ytfeed scrape`               | Scrape the YouTube homepage.                            |
| `ytfeed scrape --limit 10`    | Return at most 10 videos.                               |
| `ytfeed scrape --format json` | Emit structured JSON instead of Markdown.               |
| `ytfeed login`                | Open YouTube in a visible browser and save the session. |
