# @agent-os/action-tiktok-series

Daily research for the go2match TikTok series "Come vendere un'app online (in fretta)".

`research_tiktok_series_episode` runs the Apify actor `apidojo/tiktok-scraper-api` on a few search queries (videos of this week, Italian region, native subtitles; `clockworks/tiktok-scraper` stopped returning videos on 2026-10-21), ranks them by views per hour and returns: real links and metrics, transcripts, today's episode number and story beat, the series bible (only real go2match facts) and the instructions the agent follows to write the script.

Config: `APIFY_TOKEN` (required), `TIKTOK_SERIES_QUERIES`, `TIKTOK_SERIES_VIDEOS_PER_QUERY` (default 6), `TIKTOK_SERIES_START_DATE` (episode 1, default 2026-10-21), `TIKTOK_SERIES_EVERY_DAYS` (default 4). Facts and beats live in `src/series.ts`.

Cost: about 0.006 USD per query plus 0.0003 USD per video beyond the free 10-20, ~0.05 USD per daily run with defaults.

Daily run: add a cronjob `0 9 */4 * *` (days 1, 5, 9, ... 29 of the month, matching `everyDays`) with the prompt "Scrivi lo script TikTok di oggi della serie go2match con research_tiktok_series_episode".
