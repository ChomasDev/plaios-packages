import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@agent-os/core/domain";
import { SERIES_BIBLE, episodeNumber } from "./series.js";

export { SERIES_BIBLE, episodeNumber };

export interface TikTokSeriesInput {
  queries: string[] | null;
  maxVideos: number | null;
}

export interface TikTokVideo {
  url: string;
  author: string;
  authorFollowers: number;
  postedAt: string;
  durationSec: number;
  caption: string;
  hashtags: string[];
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementRate: number;
  viewsPerFollower: number;
  viewsPerHour: number;
  language: string;
  query: string;
  transcript: string | null;
  sound: { title: string; author: string; original: boolean } | null;
}

export interface TikTokSeriesOutput {
  date: string;
  episode: { number: number; beat: string; seriesTitle: string };
  series: Omit<typeof SERIES_BIBLE, "beats" | "defaultQueries">;
  videos: TikTokVideo[];
  scraped: number;
  instructions: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface TikTokSeriesCapabilityOptions {
  env: Environment;
  apifyToken?: string;
  queries?: string;
  videosPerQuery?: number;
  seriesStartDate?: string;
  everyDays?: number;
  fetch?: FetchLike;
  now?: () => Date;
}

// clockworks/tiktok-scraper returns 0 videos since 2026-10-21 ("Could not get a working device id"); apidojo still works.
const ACTOR_URL = "https://api.apify.com/v2/acts/apidojo~tiktok-scraper-api/run-sync-get-dataset-items";

const INSTRUCTIONS = `Scrivi UN episodio della serie usando episode.beat come storia e i video reali come riferimento di formato.
1. Analizza i 5-8 video piu' forti: hook (primi 3 secondi, parlato + visivo), setup, escalation, payoff, chiusura/loop. Separa il FORMATO dall'argomento.
2. Scegli il formato che si adatta meglio al beat di oggi e dichiara da quali video (link) lo prendi e perche' (cita le metriche reali).
3. Script originale in italiano, 30-60s, voce narrante di Thomas (prima persona, quarta parete rotta), tono serie Netflix ma girabile da solo col telefono:
   - Titolo episodio + 3 varianti di hook (0-3s)
   - Un blocco per scena, cosi':
     [0-3s] SCENA: inquadratura e azione
     VO: voice-over parola per parola
     A SCHERMO: testo sovraimpresso
   - Payoff e chiusura che porta al prossimo episodio (cliffhanger o domanda per i commenti)
   - Musica: proponi 1-2 suoni presi da videos[].sound dei video di riferimento (titolo, autore, link del video), preferendo brani (original=false) a "original sound"; se nessuno si adatta, descrivi il mood senza spacciarlo per trend
   - Caption con 3-5 hashtag
4. Usa solo i numeri di series.facts. Non copiare dialoghi o scene dei video fonte.
5. Formato: testo semplice per Telegram. Niente tabelle, niente Markdown (no |, **, #). Titoli in MAIUSCOLO, elenchi con "-".
6. Distingui: dati verificati (metriche), interpretazioni, ipotesi. Proponi 1 metrica da guardare dopo la pubblicazione.`;

const DOCS = `# research_tiktok_series_episode

Scrapes real TikToks posted this week in Italy (Apify \`apidojo/tiktok-scraper-api\`), ranks them by views per hour and returns them with metrics, links, transcripts and sounds, plus today's episode number and story beat of the go2match series, the series bible (the only facts you may use) and the writing instructions.

## When to use
- Writing the daily (or requested) episode script of the go2match TikTok series "Come vendere un'app online (in fretta)", usually from the cronjob.
- Not for generic TikTok trend questions or other brands: it always returns the go2match brief. Use web search instead.
- Call it once per script: each run costs money (about 0.006 USD per query plus 0.0003 USD per video beyond the free ones, ~0.05 USD with defaults).

## Inputs
- Defaults (configured niche queries, 12 videos): \`{"queries": null, "maxVideos": null}\`
- Custom niche: \`{"queries": ["founder storytelling", "startup italia"], "maxVideos": 8}\`

## After the call
Follow \`instructions\` in the result: write the script in Italian, cite the reference video links and real metrics, use only \`series.facts\` numbers, plain text for Telegram (no Markdown, no tables).

## Limits and failures
- \`maxVideos\` is clamped to 1-30; results are round-robined across queries and filtered to it/en subtitles or videos without subtitles.
- The scrape can take minutes (timeout 300s). \`APIFY_FAILED\` means Apify errored or timed out; 5xx and network errors are retryable, retry once.
- \`NO_VIDEOS\`: the scrape returned nothing usable. Do not write a script with invented sources and do not retry: tell the user the TikTok research failed.
- Transcripts may be null when TikTok has no subtitles.
`;

const manifest: CapabilityManifest = {
  id: "tiktok.series",
  version: "1.0.0",
  name: "research_tiktok_series_episode",
  description:
    "Scrapes real viral TikToks posted in the last week (views, likes, shares, transcripts, links) and returns today's episode brief of the go2match TikTok series 'Come vendere un'app online (in fretta)' with writing instructions. Use it to write the daily TikTok script.",
  inputSchema: {
    type: "object",
    properties: {
      queries: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "TikTok search queries, or null to use the configured niche queries.",
      },
      maxVideos: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 30,
        description: "Number of top videos to return, or null for 12.",
      },
    },
    required: ["queries", "maxVideos"],
    additionalProperties: false,
  },
  permissions: ["network.http", "web.search"],
  tags: ["tiktok", "trend", "viral", "script", "series", "go2match", "video", "hook", "social"],
  execution: { timeoutMs: 300_000, idempotent: true },
  examples: [
    {
      request: "Scrivimi lo script TikTok di oggi per la serie go2match",
      arguments: { queries: null, maxVideos: null },
    },
  ],
};

export class TikTokSeriesCapability implements Capability<TikTokSeriesInput, TikTokSeriesOutput> {
  readonly manifest = manifest;

  private readonly token: string;
  private readonly queries: string[];
  private readonly videosPerQuery: number;
  private readonly startDate: string;
  private readonly everyDays: number;
  private readonly fetch: FetchLike;
  private readonly now: () => Date;

  constructor(options: TikTokSeriesCapabilityOptions) {
    const token = options.apifyToken ?? options.env.get("APIFY_TOKEN");
    if (!token) throw new Error("APIFY_TOKEN is required for TikTokSeriesCapability");
    this.token = token;
    const queries = (options.queries ?? options.env.get("TIKTOK_SERIES_QUERIES"))
      ?.split(",")
      .map((query) => query.trim())
      .filter(Boolean);
    this.queries = queries?.length ? queries : [...SERIES_BIBLE.defaultQueries];
    this.videosPerQuery = clamp(options.videosPerQuery ?? 6, 1, 30);
    this.startDate = options.seriesStartDate ?? "2026-10-21";
    this.everyDays = clamp(options.everyDays ?? 4, 1, 31);
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return DOCS;
  }

  microfrontendData() {
    return { configured: true, provider: "Apify apidojo/tiktok-scraper-api", queries: this.queries, videosPerQuery: this.videosPerQuery, startDate: this.startDate, everyDays: this.everyDays };
  }

  async execute(input: TikTokSeriesInput, context: CapabilityExecutionContext): Promise<CapabilityResult<TikTokSeriesOutput>> {
    const queries = input.queries?.map((query) => query.trim()).filter(Boolean);
    const searchQueries = queries?.length ? queries : this.queries;
    const maxVideos = clamp(input.maxVideos ?? 12, 1, 30);
    const now = this.now();

    let items: ApifyItem[];
    try {
      const response = await this.fetch(`${ACTOR_URL}?timeout=270`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          keywords: searchQueries,
          maxItems: searchQueries.length * this.videosPerQuery,
          dateRange: "THIS_WEEK",
          location: "IT",
          includeSearchKeywords: true,
        }),
        signal: context.signal,
      });
      if (!response.ok) return failure("APIFY_FAILED", `Apify ${response.status}: ${(await response.text()).slice(0, 300)}`, response.status >= 500);
      items = (await response.json()) as ApifyItem[];
    } catch (error) {
      return failure("APIFY_FAILED", error instanceof Error ? error.message : "Apify request failed", true);
    }

    const seen = new Set<string>();
    const ranked = items
      .map((item) => toVideo(item, now))
      .filter((video): video is TikTokVideo & { subtitleUrl?: string } => video !== null && !seen.has(video.url) && Boolean(seen.add(video.url)))
      .sort((a, b) => b.viewsPerHour - a.viewsPerHour);
    // Round-robin across queries so one hot niche does not crowd out the other formats.
    const byQuery = Map.groupBy(ranked, (video) => video.query);
    const top: typeof ranked = [];
    for (let rank = 0; top.length < maxVideos && rank < ranked.length; rank++) {
      for (const group of byQuery.values()) if (group[rank] && top.length < maxVideos) top.push(group[rank]);
    }

    // Without real videos the agent would invent its sources; fail so it tells the user instead.
    if (top.length === 0) {
      return failure(
        "NO_VIDEOS",
        items.length === 0
          ? "Apify returned 0 videos: the scraper could not reach TikTok (check the run log on Apify). Do not write the script without sources; tell the user."
          : `Apify returned ${items.length} videos but none in Italian or English. Try other queries.`,
        false,
      );
    }

    const videos = await Promise.all(
      top.map(async ({ subtitleUrl, ...video }) => ({ ...video, transcript: subtitleUrl ? await this.transcript(subtitleUrl) : null })),
    );

    const number = episodeNumber(this.startDate, now, this.everyDays);
    const { beats, defaultQueries: _defaults, ...series } = SERIES_BIBLE;
    return {
      success: true,
      data: {
        date: now.toISOString().slice(0, 10),
        episode: { number, beat: beats[(number - 1) % beats.length]!, seriesTitle: SERIES_BIBLE.title },
        series,
        videos,
        scraped: items.length,
        instructions: INSTRUCTIONS,
      },
    };
  }

  private async transcript(url: string): Promise<string | null> {
    try {
      const response = await this.fetch(url, { headers: url.includes("apify.com") ? { authorization: `Bearer ${this.token}` } : {} });
      return response.ok ? vttToText(await response.text()).slice(0, 1500) || null : null;
    } catch {
      return null;
    }
  }
}

interface ApifyItem {
  postPage?: string;
  title?: string;
  uploadedAtFormatted?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  bookmarks?: number;
  keyword?: string;
  channel?: { name?: string; username?: string; followers?: number };
  video?: { duration?: number };
  subtitleInformation?: { language_code?: string; url?: string }[] | null;
  hashtags?: string[];
  song?: { title?: string; artist?: string };
}

function toVideo(item: ApifyItem, now: Date): (TikTokVideo & { subtitleUrl?: string }) | null {
  if (!item.postPage || !item.uploadedAtFormatted) return null;
  // Only formats the audience (and the narrator) can read. The spoken language comes from the subtitles; "un" = no subtitles.
  const links = item.subtitleInformation ?? [];
  const subtitle = ["it", "en"].map((code) => links.find((link) => link.language_code?.startsWith(code))).find(Boolean) ?? links[0];
  const language = subtitle?.language_code?.slice(0, 2) ?? "un";
  if (!["it", "en", "un"].includes(language)) return null;
  const views = item.views ?? 0;
  const likes = item.likes ?? 0;
  const comments = item.comments ?? 0;
  const shares = item.shares ?? 0;
  const saves = item.bookmarks ?? 0;
  const followers = item.channel?.followers ?? 0;
  const ageHours = Math.max(1, (now.getTime() - Date.parse(item.uploadedAtFormatted)) / 3_600_000);
  const username = item.channel?.username ?? "";
  return {
    url: item.postPage,
    author: username,
    authorFollowers: followers,
    postedAt: item.uploadedAtFormatted,
    durationSec: Math.round(item.video?.duration ?? 0),
    caption: item.title ?? "",
    hashtags: (item.hashtags ?? []).filter(Boolean),
    views,
    likes,
    comments,
    shares,
    saves,
    engagementRate: round(views ? (likes + comments + shares + saves) / views : 0),
    viewsPerFollower: round(views / Math.max(followers, 100)),
    viewsPerHour: Math.round(views / ageHours),
    language,
    query: item.keyword ?? "",
    transcript: null,
    // TikTok names a creator's own audio "original sound - <username>" in the viewer's language.
    sound: item.song?.title
      ? { title: item.song.title, author: item.song.artist ?? "", original: Boolean(username) && item.song.title.endsWith(`- ${username}`) }
      : null,
    subtitleUrl: subtitle?.url,
  };
}

export function vttToText(vtt: string): string {
  const lines: string[] = [];
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.replace(/<[^>]+>/g, "").trim();
    if (!line || line === "WEBVTT" || line.includes("-->") || /^\d+$/.test(line) || /^(NOTE|Kind:|Language:)/.test(line)) continue;
    if (lines.at(-1) !== line) lines.push(line);
  }
  return lines.join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function failure(code: string, message: string, retryable: boolean): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}
