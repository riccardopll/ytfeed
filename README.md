# ytfeed

Scrape videos from your YouTube homepage into an LLM-friendly format.

## Install

```bash
brew tap riccardopll/tap
brew install riccardopll/tap/ytfeed
ytfeed login
```

Login state is stored in `~/.ytfeed/youtube-session`.

## Commands

| Command                                            | Description                                             |
| -------------------------------------------------- | ------------------------------------------------------- |
| `ytfeed login`                                     | Open YouTube in a visible browser and save the session. |
| `ytfeed scrape --limit <number> --format <format>` | Export YouTube homepage videos.                         |

Supported export formats: `toon`, `json`.
