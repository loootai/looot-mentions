import type { LoootRun, LoootRunner } from "@/lib/looot";
import { buildConfig } from "@/engine/config";
import type { MentionsConfig } from "@/engine/types";

/** The fixed time every demo run is stamped with. */
export const DEMO_NOW = new Date("2026-10-10T09:00:00.000Z");

export const DEMO_CONFIG: MentionsConfig = buildConfig({
  keywords: ["Tallyroom", "Ledgerly"],
  maxSpendPerRunUsd: 0.25,
  monthlyCapUsd: 5,
});

const T = "Tallyroom";
const L = "Ledgerly";

const REDDIT: Record<string, unknown> = {
  [T]: { posts: [
    { title: "Tallyroom deposit invoices: does the client see the full project total?", permalink: "/r/freelance/comments/1ns2ab/tallyroom_deposit_invoices/", selftext: "Setting up a 40% deposit. Want the client to see the full amount and what is still to pay.", subreddit: "freelance", author: "grid_and_gutter", ups: 12, created_utc: 1791590400 },
    { title: "Tallyroom vs Ledgerly for a 4-person studio?", permalink: "/r/agency/comments/1ns9cd/tallyroom_vs_ledgerly/", selftext: "Which one should we pick? We send about 30 invoices a month.", subreddit: "agency", author: "studio_lead_4", ups: 31, created_utc: 1791597600 },
    { title: "Switched from Ledgerly to Tallyroom, love the flat price", permalink: "/r/smallbusiness/comments/1nsa11/switched/", selftext: "Easy to set up and the deposit invoices are great.", subreddit: "smallbusiness", author: "kiln_and_clay", ups: 58, created_utc: 1791604800 },
    { title: "Best invoicing tools for studios", permalink: "/r/agency/comments/1nsb22/best_invoicing/", selftext: "No names here.", subreddit: "agency", author: "x", ups: 3, created_utc: 1791604800 },
  ] },
  [L]: { posts: [
    { title: "Ledgerly keeps crashing when I export a project report", permalink: "/r/Accounting/comments/1nsc33/ledgerly_crash/", selftext: "Third time this week. Support is slow and I am frustrated.", subreddit: "Accounting", author: "numbers_nora", ups: 9, created_utc: 1791608400 },
    { title: "Can anyone recommend a Ledgerly alternative for multi-currency?", permalink: "/r/freelance/comments/1nsd44/alternative/", selftext: "Looking for something with good multi-currency reports.", subreddit: "freelance", author: "euro_ed", ups: 6, created_utc: 1791612000 },
  ] },
};

const X: Record<string, unknown> = {
  [T]: { tweets: [
    { id: "18480031", text: "First month on Tallyroom done. Sent 22 invoices, 19 paid inside a week. Great tool.", url: "https://x.com/lune_et_ligne/status/18480031", createdAt: "2026-10-09T08:12:00Z", likeCount: 14, retweetCount: 2, author: { userName: "lune_et_ligne", name: "Lune et Ligne" } },
    { id: "18480077", text: "Tallyroom is down again. Third outage this month, this is unacceptable.", createdAt: "2026-10-10T07:31:00Z", likeCount: 3, user: { screen_name: "obi_makes" } },
  ] },
};
const NEWS: Record<string, unknown> = {
  [T]: { news: [
    { title: "Tallyroom raises $4M seed to build invoicing for studios", link: "https://news.example/tallyroom-seed?utm_source=feed", snippet: "The round was led by Northfield.", date: "2026-10-08T08:00:00Z", source: "Studio Weekly" },
    { title: "Tallyroom raises $4M seed to build invoicing for studios", link: "https://syndicate.example/a/tallyroom-seed", snippet: "Syndicated copy.", date: "2026-10-08T10:00:00Z", source: "Wire Mirror" },
  ] },
  [L]: { news: [{ title: "Ledgerly adds bank feeds in six new countries", link: "https://news.example/ledgerly-bank-feeds", date: "2026-10-05T08:00:00Z", source: "FinTech Daily" }] },
};
const HN: Record<string, unknown> = {
  [T]: { organic: [{ title: "Show HN: Tallyroom, invoices that show the client the full project total", link: "https://news.ycombinator.com/item?id=41000001", snippet: "Is there a way to export to Linear?", date: "2026-10-09" }, { title: "Unrelated", link: "https://other.example/x", snippet: "Tallyroom" }] },
};
const WEB: Record<string, unknown> = {
  [T]: { organic: [
    { title: "Tallyroom pricing explained", link: "https://blog.example/tallyroom-pricing", snippet: "A flat price for the whole studio, compared to per-seat tools.", date: "2026-10-07" },
    { title: "Tallyroom review 2025", link: "https://old.example/tallyroom", snippet: "An early look.", date: "2026-08-01" },
  ] },
  [L]: { organic: [{ title: "Ledgerly review: expensive but easy to use", link: "https://reviews.example/ledgerly", snippet: "Ledgerly is overpriced for small teams.", date: "2026-10-06" }] },
};
const YT: Record<string, unknown> = {
  [T]: { data: { items: [{ video_id: "abc123", title: "Tallyroom review: is it worth it?", channel_name: "Studio Finance", published_time: "2026-10-09T12:00:00Z", view_count: 5200 }] } },
};

const done = (result: unknown): LoootRun => ({ runId: "run_demo", status: "completed", result, actualCost: 0 });
const termIn = (text: string): string => (text.includes(T) ? T : text.includes(L) ? L : "");

/** A LoootRunner that answers from the fixtures above. Used by `npm run demo`, `--demo` and the tests. No network. Ledgerly on X is left "running" and Ledgerly on YouTube fails, to show both states. */
export const fixtureRunner: LoootRunner = {
  async runAndWait(endpointId, input) {
    switch (endpointId) {
      case "scrapecreators-reddit-search": return done(REDDIT[String(input.query)] ?? { posts: [] });
      case "anyapi-run-twitter-search":
        return input.query === L ? { runId: "run_demo_pending", status: "running" } : done(X[String(input.query)] ?? { tweets: [] });
      case "serper-news": return done(NEWS[termIn(String(input.q))] ?? { news: [] });
      case "tikhub-api-youtube-web-search-video":
        return input.search_query === L ? { runId: "run_demo_fail", status: "failed", error: { message: "Provider timed out" } } : done(YT[String(input.search_query)] ?? { data: { items: [] } });
      case "serper-search": {
        const q = String(input.q);
        return done((q.startsWith("site:news.ycombinator.com") ? HN : WEB)[termIn(q)] ?? { organic: [] });
      }
      default: return { runId: "run_demo_unknown", status: "failed", error: { message: `No fixture for ${endpointId}` } };
    }
  },
};
