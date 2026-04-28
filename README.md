# ytfeed

Scrape videos from your YouTube homepage into an LLM-friendly format.

## Install

```bash
brew tap riccardopll/tap
brew install riccardopll/tap/ytfeed
```

## Commands

| Command                                      | Description                                             |
| -------------------------------------------- | ------------------------------------------------------- |
| `ytfeed login`                               | Open YouTube in a visible browser and save the session. |
| `ytfeed scrape --limit 10 --format <format>` | Export YouTube homepage videos.                         |

Supported export formats: `json`, `toon`. Default: `toon`.
