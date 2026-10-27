import assert from "node:assert/strict";
import test from "node:test";
import { SERIES_BIBLE, TikTokSeriesCapability, episodeNumber, vttToText } from "../dist/src/index.js";

const now = new Date("2026-10-22T10:00:00Z");
const item = (url, views, hoursAgo, extra = {}) => ({ postPage: url, uploadedAtFormatted: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(), views, likes: 10, channel: { username: "a", followers: 1000 }, keyword: "discoteca", ...extra });

test("ranks by view velocity, dedupes, attaches transcript and episode brief", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("run-sync")) return new Response(JSON.stringify([
      item("https://t/1", 1000, 100),
      item("https://t/2", 5000, 10, { song: { title: "Song", artist: "Band" }, subtitleInformation: [{ language_code: "it", url: "https://cdn.tiktok/sub.vtt" }] }),
      item("https://t/2", 5000, 10),
      { postPage: "https://t/bad" },
      item("https://t/3", 10, 100, { keyword: "founder", song: { title: "suono originale - a", artist: "A" } }),
      item("https://t/vi", 99999, 1, { subtitleInformation: [{ language_code: "vi", url: "https://cdn.tiktok/vi.vtt" }] }),
    ]));
    return new Response("WEBVTT\n\n1\n00:00.000 --> 00:01.000\nCiao a tutti\n\n2\n00:01.000 --> 00:02.000\nCiao a tutti\nstasera");
  };
  const action = new TikTokSeriesCapability({ env: { get: () => undefined }, apifyToken: "tok", fetch, now: () => now });
  const result = await action.execute({ queries: null, maxVideos: 5 }, { runId: "r", callId: "c", startedAt: now });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.videos.map((video) => video.url), ["https://t/2", "https://t/3", "https://t/1"]);
  assert.equal(result.data.videos[0].transcript, "Ciao a tutti stasera");
  assert.equal(result.data.videos[0].viewsPerHour, 500);
  assert.deepEqual(result.data.videos[0].sound, { title: "Song", author: "Band", original: false });
  assert.equal(result.data.videos[1].sound.original, true);
  assert.equal(result.data.videos[2].sound, null);
  assert.equal(calls[1].init.headers.authorization, undefined);
  assert.equal(result.data.episode.number, 1);
  assert.match(result.data.episode.beat, /Pilota/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { keywords: SERIES_BIBLE.defaultQueries, maxItems: 36, dateRange: "THIS_WEEK", location: "IT", includeSearchKeywords: true });
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
});

test("reports Apify errors and requires a token", async () => {
  const action = new TikTokSeriesCapability({ env: { get: () => undefined }, apifyToken: "tok", fetch: async () => new Response("nope", { status: 401 }) });
  const result = await action.execute({ queries: ["x"], maxVideos: null }, { runId: "r", callId: "c", startedAt: now });
  assert.equal(result.success, false);
  assert.throws(() => new TikTokSeriesCapability({ env: { get: () => undefined } }));
  const empty = new TikTokSeriesCapability({ env: { get: () => undefined }, apifyToken: "tok", fetch: async () => Response.json([]) });
  const none = await empty.execute({ queries: null, maxVideos: null }, { runId: "r", callId: "c", startedAt: now });
  assert.equal(none.success, false);
  if (!none.success) assert.equal(none.error.code, "NO_VIDEOS");
  assert.deepEqual(["2026-10-21", "2026-10-24", "2026-10-25", "2026-10-29", "2026-11-01", "2026-11-05"].map((d) => episodeNumber("2026-10-21", new Date(`${d}T09:00:00Z`))), [1, 1, 2, 3, 4, 5]);
  assert.equal(episodeNumber("2026-10-21", new Date("2026-10-23T09:00:00Z"), 1), 3);
  assert.equal(vttToText("WEBVTT\n\n00:00.000 --> 00:01.000\n<c>Ok</c>"), "Ok");
});
