import { describe, expect, it, vi } from "vitest";
import { DEMO_CONFIG, DEMO_NOW, fixtureRunner } from "@/demo/fixtures";
import type { LoootRunner } from "@/lib/looot";
import { renderDigest } from "./digest";
import { dedupe, EMPTY_STORE, enrich, idempotencyKey, matchesKeyword, overMonthlyCap, planCalls, quoteOf, runMentions } from "./engine";
import { FALLBACK_PRICES, parseReddit, parseSearch, parseX, parseYoutube, parseNews } from "./sources";

const deps = { looot: fixtureRunner, prices: FALLBACK_PRICES, now: DEMO_NOW };
const run = (store = EMPTY_STORE, config = DEMO_CONFIG, d = deps) => runMentions(config, store, d);

describe("plan and quote", () => {
  it("makes one call per keyword and source and adds the list prices", () => {
    expect(planCalls(DEMO_CONFIG)).toHaveLength(12);
    expect(quoteOf(DEMO_CONFIG, FALLBACK_PRICES).totalMicros).toBe(2 * (1880 + 750 + 1000 + 1000 + 1000 + 1000));
  });
  it("keys the idempotency by input and day", () => {
    const [c] = planCalls(DEMO_CONFIG);
    expect(idempotencyKey(c, DEMO_NOW)).toBe(idempotencyKey(c, new Date("2026-10-10T23:00:00Z")));
    expect(idempotencyKey(c, DEMO_NOW)).not.toBe(idempotencyKey(c, new Date("2026-10-11T00:00:00Z")));
    expect(idempotencyKey(c, DEMO_NOW)).not.toBe(idempotencyKey(planCalls(DEMO_CONFIG)[1], DEMO_NOW));
  });
});

describe("runMentions", () => {
  it("returns tagged mentions, drops irrelevant, old and syndicated ones", async () => {
    const r = await run();
    const titles = r.fresh.map((m) => m.title);
    expect(titles).not.toContain("Best invoicing tools for studios"); // no keyword
    expect(titles).not.toContain("Tallyroom review 2025"); // older than 14 days
    expect(titles.filter((t) => t.startsWith("Tallyroom raises"))).toHaveLength(1); // syndicated twice
    expect(titles).not.toContain("Unrelated"); // HN result off the HN domain
    const crash = r.fresh.find((m) => m.title.includes("keeps crashing"));
    expect(crash).toMatchObject({ source: "reddit", keyword: "Ledgerly", intents: ["complaint"], sentiment: { label: "negative" } });
    const cmp = r.fresh.find((m) => m.title.startsWith("Tallyroom vs Ledgerly"));
    expect(cmp?.intents).toContain("comparison");
  });
  it("reports pending and failed sources instead of hiding them", async () => {
    const r = await run();
    expect(r.reports.find((x) => x.keyword === "Ledgerly" && x.source === "x")?.status).toBe("pending");
    expect(r.reports.find((x) => x.keyword === "Ledgerly" && x.source === "youtube")?.status).toBe("failed");
  });
  it("finds only new mentions on the second run", async () => {
    const first = await run();
    const second = await run(first.store, DEMO_CONFIG, { ...deps, now: new Date("2026-10-11T09:00:00Z") });
    expect(second.fresh).toHaveLength(0);
    expect(second.store.mentions).toHaveLength(first.store.mentions.length);
    expect(renderDigest(second.fresh, { date: "2026-10-11", reports: [], chargedMicros: 0 })).toContain("No new mentions");
  });
  it("skips calls past the run cap and never sends them", async () => {
    const spy = vi.fn(fixtureRunner.runAndWait);
    const r = await run(EMPTY_STORE, { ...DEMO_CONFIG, maxSpendPerRunMicros: 2000 }, { ...deps, looot: { runAndWait: spy } as LoootRunner });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(r.committedMicros).toBeLessThanOrEqual(2000);
    expect(r.reports.filter((x) => x.status === "skipped_cap").length).toBeGreaterThan(5);
  });
  it("adds the charged cost to the month's spend", async () => {
    const looot: LoootRunner = { runAndWait: async () => ({ runId: "r", status: "completed", result: {}, actualCost: "0.001" }) };
    const r = await run(EMPTY_STORE, { ...DEMO_CONFIG, sources: ["news"] }, { ...deps, looot });
    expect(r.store.spend["2026-10"]).toBe(2000);
  });
});

describe("monthly cap", () => {
  it("blocks a run that would pass the month's cap", () => {
    const store = { ...EMPTY_STORE, spend: { "2026-10": 4_990_000 } };
    expect(overMonthlyCap(DEMO_CONFIG, store, 20_000, DEMO_NOW)).toBe(true);
    expect(overMonthlyCap(DEMO_CONFIG, store, 5_000, DEMO_NOW)).toBe(false);
    expect(overMonthlyCap(DEMO_CONFIG, store, 20_000, new Date("2026-11-01T00:00:00Z"))).toBe(false);
  });
});

describe("dedupe and keyword match", () => {
  const k = { term: "Acme", exclude: ["acme corp"] };
  it("matches the term and respects exclusions", () => {
    expect(matchesKeyword("I use ACME daily", k)).toBe(true);
    expect(matchesKeyword("Acme Corp earnings", k)).toBe(false);
    expect(matchesKeyword("nothing", k)).toBe(false);
  });
  it("collapses the same URL with tracking params and the same title on another URL", () => {
    const mk = (title: string, url: string) => enrich({ title, url, author: null, outlet: null, snippet: null, publishedAt: "2026-10-09T00:00:00Z" }, { keyword: k, source: "news", via: "x", now: DEMO_NOW });
    const items = [mk("Acme wins", "https://a.example/p?utm_source=x"), mk("Acme wins", "https://b.example/q"), mk("Other", "https://a.example/p/")];
    const out = dedupe(items, { fingerprints: new Set(), titleKeys: new Set() }, { now: DEMO_NOW, maxAgeDays: 14 });
    expect(out.map((m) => m.title)).toEqual(["Acme wins"]);
  });
});

describe("parsers", () => {
  it("reads reddit posts in both nestings", () => {
    const r = parseReddit({ posts: [{ title: "A", permalink: "/r/x/1", subreddit: "x", author: "u", ups: 4, created_utc: 1791590400 }, { data: { title: "B", score: 2 } }, { selftext: "no title" }] });
    expect(r.map((x) => x.title)).toEqual(["A", "B"]);
    expect(r[0]).toMatchObject({ url: "https://www.reddit.com/r/x/1", outlet: "r/x", author: "u/u", engagement: 4 });
  });
  it("reads x posts and builds the URL from handle and id", () => {
    expect(parseX({ tweets: [{ id: "9", text: "hi", user: { screen_name: "bob" }, likeCount: 2, retweetCount: 1 }] })[0]).toMatchObject({ url: "https://x.com/bob/status/9", author: "@bob", engagement: 3 });
  });
  it("finds youtube videos under unknown nesting", () => {
    expect(parseYoutube({ data: { result: { items: [{ video_id: "v1", title: "T", channel_name: "C", view_count: "10" }] } } })[0]).toMatchObject({ url: "https://www.youtube.com/watch?v=v1", author: "C", engagement: 10 });
    expect(parseYoutube({ nothing: 1 })).toEqual([]);
  });
  it("filters search results by domain", () => {
    const raw = { organic: [{ title: "a", link: "https://news.ycombinator.com/item?id=1" }, { title: "b", link: "https://x.example/1" }] };
    expect(parseSearch(raw, { only: "news.ycombinator.com" })).toHaveLength(1);
    expect(parseSearch(raw, { skip: ["news.ycombinator.com"] })[0].title).toBe("b");
  });
  it("reads news with outlet and ISO date", () => {
    expect(parseNews({ news: [{ title: "N", link: "https://n.example", source: "Daily", date: "2026-10-01T00:00:00Z" }] })[0]).toMatchObject({ outlet: "Daily", publishedAt: "2026-10-01T00:00:00.000Z" });
  });
});

describe("digest", () => {
  it("groups by what needs a reply and lists failed sources", async () => {
    const r = await run();
    const md = renderDigest(r.fresh, { date: "2026-10-10", reports: r.reports, chargedMicros: r.actualMicros });
    expect(md).toContain("## Needs a reply");
    expect(md).toContain("## Comparisons");
    expect(md).toContain("Ledgerly on X: still running at looot, not failed");
    expect(md).toContain("Ledgerly on YouTube: failed");
    expect(md.match(/^- \[/gm)?.length).toBe(r.fresh.length);
  });
});
