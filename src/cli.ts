#!/usr/bin/env bun
import { Command, InvalidArgumentError, Option } from "commander";
import { chromium, type Page } from "playwright";

type CliCommand = "scrape" | "login";
type OutputFormat = "markdown" | "json";

type CliOptions = {
  command: CliCommand;
  limit: number;
  format: OutputFormat;
};

type ScrapeCommandOptions = {
  limit: number;
  format: OutputFormat;
};

type ScrapedVideo = {
  index: number;
  title: string;
  url: string;
  videoId: string | null;
  channel: string | null;
  channelUrl: string | null;
  duration: string | null;
  views: string | null;
  published: string | null;
  metadata: string[];
  thumbnail: string | null;
};

type ScrapedVideoData = Omit<ScrapedVideo, "index">;

type ScrapeResult = {
  scrapedAt: string;
  limit: number;
  count: number;
  videos: ScrapedVideo[];
};

const youtubeHomeUrl = "https://www.youtube.com/";
const sessionProfile = ".youtube-session";
const machineTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const scrapeTimeoutMs = 30_000;
const scrollAttempts = 8;
const defaultLimit = 20;
const defaultFormat: OutputFormat = "markdown";
const defaultCliOptions: CliOptions = {
  command: "scrape",
  limit: defaultLimit,
  format: defaultFormat,
};

const parseArgs = (argv: string[]) => {
  let cliOptions: CliOptions = defaultCliOptions;
  const program = new Command();

  program
    .name("ytfeed")
    .description(
      "Scrape videos from the YouTube homepage into an LLM-friendly format.",
    )
    .showHelpAfterError()
    .addHelpText(
      "after",
      `
Examples:
  ytfeed login
  ytfeed scrape --limit 20
  ytfeed scrape --limit 20 --format json`,
    );

  program
    .command("scrape", { isDefault: true })
    .description("Scrape the YouTube homepage.")
    .option(
      "-l, --limit <number>",
      "Maximum videos to return.",
      parsePositiveInteger,
      defaultLimit,
    )
    .addOption(
      new Option("-f, --format <format>", "Output format.")
        .choices(["markdown", "json"])
        .default(defaultFormat),
    )
    .action((options: ScrapeCommandOptions) => {
      cliOptions = {
        command: "scrape",
        limit: options.limit,
        format: options.format,
      };
    });

  program
    .command("login")
    .description("Open YouTube and persist a browser session.")
    .action(() => {
      cliOptions = {
        command: "login",
        limit: defaultLimit,
        format: defaultFormat,
      };
    });

  program.parse(argv, { from: "user" });

  return cliOptions;
};

const parsePositiveInteger = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("expected a positive integer.");
  }
  return parsed;
};

const mergeScrapedVideo = (
  existing: ScrapedVideoData | undefined,
  next: ScrapedVideoData,
) => {
  if (!existing) {
    return next;
  }

  return {
    title: existing.title || next.title,
    url: existing.url || next.url,
    videoId: existing.videoId ?? next.videoId,
    channel: existing.channel ?? next.channel,
    channelUrl: existing.channelUrl ?? next.channelUrl,
    duration: existing.duration ?? next.duration,
    views: existing.views ?? next.views,
    published: existing.published ?? next.published,
    metadata:
      existing.metadata.length >= next.metadata.length
        ? existing.metadata
        : next.metadata,
    thumbnail: existing.thumbnail ?? next.thumbnail,
  };
};

const launchContext = async (headless: boolean) => {
  const context = await chromium.launchPersistentContext(sessionProfile, {
    headless,
    viewport: { width: 1440, height: 1200 },
    locale: "en-US",
    timezoneId: machineTimezone,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  context.setDefaultTimeout(scrapeTimeoutMs);
  return context;
};

const openLoginSession = async () => {
  const context = await launchContext(false);
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(youtubeHomeUrl, {
    waitUntil: "domcontentloaded",
    timeout: scrapeTimeoutMs,
  });

  prompt(
    "Log in to YouTube in the opened browser, then press Enter here to save the session. ",
  );

  await context.close();
  console.error(`Saved browser session in ${sessionProfile}`);
};

const scrapeHomepage = async (options: CliOptions) => {
  const context = await launchContext(true);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(youtubeHomeUrl, {
      waitUntil: "domcontentloaded",
      timeout: scrapeTimeoutMs,
    });
    await page
      .waitForLoadState("networkidle", { timeout: scrapeTimeoutMs })
      .catch(() => undefined);
    await dismissConsentIfPresent(page);

    let videos: ScrapedVideo[] = [];
    const videoData = new Map<string, ScrapedVideoData>();
    const videoOrder: string[] = [];
    const toIndexedVideos = () => {
      const orderedVideos: ScrapedVideo[] = [];
      for (const key of videoOrder) {
        const video = videoData.get(key);
        if (video) {
          orderedVideos.push({ ...video, index: orderedVideos.length + 1 });
        }
      }
      return orderedVideos.slice(0, options.limit);
    };

    for (let attempt = 0; attempt <= scrollAttempts; attempt += 1) {
      const currentVideos = await page.evaluate(
        ({ limit }) => {
          type BrowserElement = {
            textContent: string | null;
            getAttribute(name: string): string | null;
            querySelector(selector: string): BrowserElement | null;
            querySelectorAll(selector: string): ArrayLike<BrowserElement>;
          };
          type BrowserAnchor = BrowserElement & {
            href: string;
          };
          type BrowserDocument = BrowserElement;

          const browserGlobal = globalThis as typeof globalThis & {
            document: BrowserDocument;
            location: {
              origin: string;
            };
          };
          const browserDocument = browserGlobal.document;

          const normalizeText = (value: string | null | undefined) => {
            return value?.replace(/\s+/g, " ").trim() || "";
          };

          const absoluteUrl = (value: string | null | undefined) => {
            if (!value) {
              return null;
            }

            try {
              return new URL(value, browserGlobal.location.origin).toString();
            } catch {
              return null;
            }
          };

          const videoIdFromUrl = (value: string) => {
            const url = new URL(value);
            if (url.pathname === "/watch") {
              return url.searchParams.get("v");
            }

            return null;
          };

          const isTimecode = (value: string) => {
            return /^(?:\d+:)?\d{1,2}:\d{2}$/.test(value.trim());
          };

          const isViewsMetadata = (value: string) => {
            return /\b(?:views?|watching)\b/i.test(value);
          };

          const isPublishedMetadata = (value: string) => {
            return /\b(ago|streamed|premiered|hour|day|week|month|year)\b/i.test(
              value,
            );
          };

          const isStatsMetadata = (value: string) => {
            return isViewsMetadata(value) || isPublishedMetadata(value);
          };

          const readableDurationFromLabel = (
            value: string | null | undefined,
          ) => {
            const normalized = normalizeText(value);
            const match = normalized.match(
              /\s((?:(?:\d+\s+hours?)(?:,\s*)?)?(?:(?:\d+\s+minutes?)(?:,\s*)?)?(?:\d+\s+seconds?|(?:\d+\s+hours?)|(?:\d+\s+minutes?)))$/i,
            );
            return match?.[1] ?? null;
          };

          const unique = <T>(values: T[]) => {
            return [...new Set(values.filter(Boolean))] as T[];
          };

          const query = <T extends BrowserElement>(
            root: BrowserElement,
            selector: string,
          ) => {
            return root.querySelector(selector) as T | null;
          };

          const queryAll = (root: BrowserElement, selector: string) => {
            return Array.from(root.querySelectorAll(selector));
          };

          const cards = queryAll(
            browserDocument,
            "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer",
          );

          const seen = new Set<string>();
          const result: ScrapedVideoData[] = [];

          for (const card of cards) {
            const anchorCandidates = queryAll(
              card,
              "a[href*='/watch?v=']",
            ) as BrowserAnchor[];
            const visibleTitleAnchor = anchorCandidates.find((anchor) => {
              const text = normalizeText(anchor.textContent);
              return Boolean(text && !isTimecode(text));
            });

            const titleAnchor =
              query<BrowserAnchor>(card, "a#video-title-link") ??
              query<BrowserAnchor>(card, "a#video-title") ??
              query<BrowserAnchor>(
                card,
                "a.ytLockupMetadataViewModelTitle[href*='/watch?v=']",
              ) ??
              query<BrowserAnchor>(card, "h3 a[href*='/watch?v=']") ??
              visibleTitleAnchor ??
              anchorCandidates[0] ??
              null;

            const thumbnailAnchor =
              query<BrowserAnchor>(card, "a#thumbnail[href*='/watch?v=']") ??
              anchorCandidates.find((anchor) =>
                isTimecode(normalizeText(anchor.textContent)),
              ) ??
              null;

            const url = absoluteUrl(titleAnchor?.href ?? thumbnailAnchor?.href);
            if (!url) {
              continue;
            }

            const isShort = new URL(url).pathname.startsWith("/shorts/");
            if (isShort) {
              continue;
            }

            if (!url.includes("/watch?v=")) {
              continue;
            }

            const videoId = videoIdFromUrl(url);
            const key = videoId ?? url;
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);

            const channelAnchor =
              query<BrowserAnchor>(card, "ytd-channel-name a") ??
              query<BrowserAnchor>(card, "#channel-name a") ??
              query<BrowserAnchor>(card, "a[href^='/@']") ??
              query<BrowserAnchor>(card, "a[href^='/channel/']") ??
              query<BrowserAnchor>(card, "a[href^='/user/']") ??
              query<BrowserAnchor>(card, "a[href^='/c/']");

            const metadataRows = queryAll(
              card,
              ".ytContentMetadataViewModelMetadataRow",
            );
            const statsRowIndex = metadataRows.findIndex((row) =>
              isStatsMetadata(normalizeText(row.textContent)),
            );
            const channelRow =
              statsRowIndex > 0 ? metadataRows[statsRowIndex - 1] : undefined;
            const channelRowText = normalizeText(channelRow?.textContent);
            const channel =
              normalizeText(channelAnchor?.textContent) ||
              (channelRowText && !isStatsMetadata(channelRowText)
                ? channelRowText
                : null) ||
              null;

            const legacyMetadataNodes = queryAll(card, "#metadata-line span");
            const lockupStatsRows = metadataRows.filter((row) =>
              isStatsMetadata(normalizeText(row.textContent)),
            );
            const lockupMetadataNodes = lockupStatsRows.flatMap((row) =>
              queryAll(
                row,
                ".ytContentMetadataViewModelMetadataText, span[role='text']",
              ),
            );
            const metadata = unique(
              [...legacyMetadataNodes, ...lockupMetadataNodes]
                .map((node) => normalizeText(node.textContent))
                .filter(
                  (text) =>
                    text && text !== "•" && text !== "·" && text !== channel,
                ),
            );

            const views =
              metadata.find((item) => item.toLowerCase().includes("view")) ??
              null;
            const published = metadata.find(isPublishedMetadata) ?? null;

            const durationNode =
              query(card, "ytd-thumbnail-overlay-time-status-renderer #text") ??
              query(card, "ytd-thumbnail-overlay-time-status-renderer span") ??
              query(card, ".ytd-thumbnail-overlay-time-status-renderer");

            const timecodeDuration = anchorCandidates
              .map((anchor) => normalizeText(anchor.textContent))
              .find(isTimecode);

            const image =
              query<BrowserElement>(card, "img#img[src]") ??
              query<BrowserElement>(card, "img[src]") ??
              query<BrowserElement>(card, "img[data-thumb]");
            const thumbnailUrl = absoluteUrl(
              image?.getAttribute("src") ?? image?.getAttribute("data-thumb"),
            );

            const title = normalizeText(
              titleAnchor?.textContent ??
                titleAnchor?.getAttribute("title") ??
                titleAnchor?.getAttribute("aria-label"),
            );

            if (!title) {
              continue;
            }

            result.push({
              title,
              url,
              videoId,
              channel,
              channelUrl: absoluteUrl(channelAnchor?.getAttribute("href")),
              duration:
                normalizeText(durationNode?.textContent) ||
                timecodeDuration ||
                readableDurationFromLabel(
                  titleAnchor?.getAttribute("aria-label") ??
                    titleAnchor?.getAttribute("title"),
                ) ||
                null,
              views,
              published,
              metadata,
              thumbnail: thumbnailUrl,
            });

            if (result.length >= limit) {
              break;
            }
          }

          return result;
        },
        { limit: options.limit },
      );

      for (const video of currentVideos) {
        const key = video.videoId ?? video.url;
        if (!videoData.has(key)) {
          videoOrder.push(key);
        }

        videoData.set(key, mergeScrapedVideo(videoData.get(key), video));
      }

      videos = toIndexedVideos();

      if (
        videos.length >= options.limit &&
        videos.every((video) => video.thumbnail)
      ) {
        break;
      }

      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(900);
    }

    const thumbnailAttempts = new Set<string>();
    while (true) {
      const video = videos.find(
        (candidate) =>
          !candidate.thumbnail &&
          candidate.videoId &&
          !thumbnailAttempts.has(candidate.videoId),
      );
      if (!video?.videoId) {
        break;
      }
      thumbnailAttempts.add(video.videoId);

      const thumbnail = await page.evaluate(async (videoId) => {
        type BrowserElement = {
          getAttribute(name: string): string | null;
          querySelector(selector: string): BrowserElement | null;
          querySelectorAll(selector: string): ArrayLike<BrowserElement>;
          scrollIntoView(options?: unknown): void;
        };
        type BrowserDocument = {
          querySelectorAll(selector: string): ArrayLike<BrowserElement>;
        };

        const browserGlobal = globalThis as typeof globalThis & {
          document: BrowserDocument;
          location: {
            origin: string;
          };
        };

        const cards = Array.from(
          browserGlobal.document.querySelectorAll(
            "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer",
          ),
        );
        const card = cards.find((item) =>
          item.querySelector(`a[href*='${videoId}']`),
        );
        if (!card) {
          return null;
        }

        card.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 900));

        const image =
          card.querySelector("img#img[src]") ??
          card.querySelector("img[src]") ??
          card.querySelector("img[data-thumb]");
        const value =
          image?.getAttribute("src") ?? image?.getAttribute("data-thumb");
        if (!value) {
          return null;
        }

        try {
          return new URL(value, browserGlobal.location.origin).toString();
        } catch {
          return null;
        }
      }, video.videoId);

      if (thumbnail) {
        const key = video.videoId ?? video.url;
        const existing = videoData.get(key);
        if (existing) {
          videoData.set(key, { ...existing, thumbnail });
          videos = toIndexedVideos();
        }
      }
    }

    return {
      scrapedAt: new Date().toISOString(),
      limit: options.limit,
      count: videos.length,
      videos: videos.slice(0, options.limit),
    } satisfies ScrapeResult;
  } finally {
    await context.close();
  }
};

const dismissConsentIfPresent = async (page: Page) => {
  const consentButtons = [
    page.getByRole("button", { name: /^accept all$/i }),
    page.getByRole("button", { name: /^agree$/i }),
    page.getByRole("button", { name: /^i agree$/i }),
  ];

  for (const button of consentButtons) {
    const count = await button.count().catch(() => 0);
    if (count > 0) {
      await button
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      return;
    }
  }
};

const formatResult = (result: ScrapeResult, format: OutputFormat) => {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  const lines = [
    "# YouTube Homepage Videos",
    "",
    `Scraped at: ${result.scrapedAt}`,
    `Requested limit: ${result.limit}`,
    `Videos found: ${result.count}`,
    "",
  ];

  if (result.videos.length === 0) {
    lines.push("No homepage videos were found.");
    return `${lines.join("\n")}\n`;
  }

  for (const video of result.videos) {
    lines.push(
      `${video.index}. [${escapeMarkdown(video.title)}](${video.url})`,
    );

    if (video.channel) {
      const channel = video.channelUrl
        ? `[${escapeMarkdown(video.channel)}](${video.channelUrl})`
        : escapeMarkdown(video.channel);
      lines.push(`   Channel: ${channel}`);
    }

    if (video.duration) {
      lines.push(`   Duration: ${escapeMarkdown(video.duration)}`);
    }

    if (video.metadata.length > 0) {
      lines.push(
        `   Metadata: ${video.metadata.map(escapeMarkdown).join(" | ")}`,
      );
    }

    if (video.thumbnail) {
      lines.push(`   Thumbnail: ${video.thumbnail}`);
    }

    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
};

const escapeMarkdown = (value: string) => {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
};

const main = async () => {
  const options = parseArgs(Bun.argv.slice(2));

  if (options.command === "login") {
    await openLoginSession();
    return;
  }

  const result = await scrapeHomepage(options);
  const text = formatResult(result, options.format);
  await Bun.write(Bun.stdout, text);

  if (result.count === 0) {
    console.error("Warning: no videos were found.");
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);

  if (/process singleton|user data directory|profile/i.test(message)) {
    console.error(
      "The scraper stores login data in `.youtube-session`. Run `ytfeed login` if the session needs to be refreshed.",
    );
  }

  process.exitCode = 1;
});
