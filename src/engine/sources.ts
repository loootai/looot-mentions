import { canonicalUrl, domainOf, hash, isoDate, list, num, obj, str, type Obj } from "@/lib/util";
import type { Keyword, SourceId } from "./types";

/** A mention before sentiment, intent, the keyword and the time seen are added. */
export interface RawMention {
  title: string;
  url: string | null;
  author: string | null;
  outlet: string | null;
  snippet: string | null;
  publishedAt: string | null;
  engagement?: number;
}

export interface SourceDef {
  id: SourceId;
  label: string;
  /** looot job id, kept as the catalog reference. */
  jobId: string;
  /** The pinned looot endpoint this app runs. */
  endpointId: string;
  /** Who supplies the data behind that endpoint, shown next to its price. */
  provider: string;
  /** Price per call in micro-dollars, read from the public catalog on PRICES_AS_OF. */
  fallbackMicros: number;
  /** false until someone has checked a real response body against the parser. */
  shapeVerified: boolean;
  inputFor(k: Keyword): Record<string, unknown>;
  parse(raw: unknown): RawMention[];
}

export const PRICES_AS_OF = "2026-10-10";
export const ALL_SOURCES: SourceId[] = ["reddit", "x", "hn", "news", "youtube", "tiktok", "instagram", "web"];

const clip = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n - 3)}...` : t);

/** serper-news: { news: [{ title, link, snippet, date, source }] }. */
export function parseNews(raw: unknown): RawMention[] {
  return list(raw, ["news", "results"]).flatMap((r) => {
    const title = str(r.title);
    if (!title) return [];
    return [{ title, url: str(r.link, r.url), author: null, outlet: str(r.source), snippet: str(r.snippet, r.description), publishedAt: isoDate(r.date) }];
  });
}

/** serper-search: { organic: [{ title, link, snippet, date }] }. `only` keeps one domain, `skip` drops domains. */
export function parseSearch(raw: unknown, opts: { only?: string; skip?: string[] } = {}): RawMention[] {
  return list(raw, ["organic", "results"]).flatMap((r) => {
    const title = str(r.title);
    const url = str(r.link, r.url);
    const dom = domainOf(url);
    if (!title || !url || !dom) return [];
    if (opts.only && dom !== opts.only) return [];
    if (opts.skip?.some((s) => dom === s || dom.endsWith(`.${s}`))) return [];
    return [{ title, url, author: null, outlet: dom, snippet: str(r.snippet), publishedAt: isoDate(r.date) }];
  });
}

/** anyapi-run-twitter-search: a list of posts under tweets, results or data. Field names vary, so several are tried. */
export function parseX(raw: unknown): RawMention[] {
  return list(raw, ["tweets", "results", "items", "posts"]).flatMap((r) => {
    const text = str(r.text, r.full_text, r.content);
    if (!text) return [];
    const user = obj(r.author ?? r.user);
    const handle = str(user.userName, user.username, user.screen_name, r.username);
    const id = str(r.id, r.id_str, r.tweet_id);
    const url = str(r.url, r.twitterUrl) ?? (handle && id ? `https://x.com/${handle}/status/${id}` : null);
    const engagement = (num(r.likeCount, r.favorite_count, r.likes) ?? 0) + (num(r.retweetCount, r.retweet_count, r.retweets) ?? 0);
    return [{ title: clip(text), url, author: handle ? `@${handle}` : str(user.name), outlet: "x.com", snippet: text, publishedAt: isoDate(r.createdAt ?? r.created_at), engagement: engagement || undefined }];
  });
}

/** scrapecreators-reddit-search: { posts: [{ title, permalink, selftext, subreddit, author, ups, created_utc }] }. */
export function parseReddit(raw: unknown): RawMention[] {
  return list(raw, ["posts", "results", "children"]).flatMap((entry) => {
    const r = entry.data && typeof entry.data === "object" ? obj(entry.data) : entry;
    const title = str(r.title);
    if (!title) return [];
    const permalink = str(r.permalink);
    const url = permalink ? (permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`) : str(r.url);
    const sub = str(r.subreddit, r.subreddit_name_prefixed);
    return [{ title, url, author: str(r.author) ? `u/${str(r.author)}` : null, outlet: sub ? (sub.startsWith("r/") ? sub : `r/${sub}`) : null, snippet: str(r.selftext, r.body), publishedAt: isoDate(r.created_utc ?? r.created), engagement: num(r.ups, r.score) }];
  });
}

/** Finds the first array of video-like objects (title plus an id) within three levels of the body. */
function videoArray(raw: unknown, depth = 0): Obj[] {
  if (Array.isArray(raw)) {
    const items = raw.map(obj);
    if (items.some((i) => str(i.title) && str(i.video_id, i.videoId, i.id))) return items;
    return [];
  }
  if (depth >= 3) return [];
  for (const v of Object.values(obj(raw))) {
    const found = videoArray(v, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

/** tikhub-api-youtube-web-search-video: videos with title, video_id, channel and a published time. The exact nesting is searched for. */
export function parseYoutube(raw: unknown): RawMention[] {
  return videoArray(raw).flatMap((r) => {
    const title = str(r.title);
    const id = str(r.video_id, r.videoId, r.id);
    if (!title || !id) return [];
    const channel = obj(r.channel ?? r.author);
    return [{ title, url: `https://www.youtube.com/watch?v=${id}`, author: str(r.channel_name, r.channelTitle, channel.name, channel.title, typeof r.channel === "string" ? r.channel : null, r.author_name), outlet: "youtube.com", snippet: str(r.description, r.snippet), publishedAt: isoDate(r.published_time ?? r.publishedAt ?? r.published_at ?? r.publish_date), engagement: num(r.view_count, r.viewCount, r.views) }];
  });
}

/** scrapecreators-tiktok-search-keyword: { search_item_list: [{ aweme_info: { aweme_id, desc, create_time, statistics{play_count,digg_count,comment_count,share_count}, author{unique_id,nickname} } }] }. */
export function parseTikTok(raw: unknown): RawMention[] {
  return list(raw, ["search_item_list", "items", "results"]).flatMap((entry) => {
    const r = entry.aweme_info && typeof entry.aweme_info === "object" ? obj(entry.aweme_info) : entry;
    const text = str(r.desc, r.title, r.description);
    if (!text) return [];
    const id = str(r.aweme_id, r.id, r.video_id);
    const author = obj(r.author);
    const handle = str(author.unique_id, author.uniqueId, author.username);
    const stats = obj(r.statistics ?? r.stats);
    const engagement = (num(stats.digg_count, stats.diggCount, stats.likes) ?? 0) + (num(stats.comment_count, stats.commentCount) ?? 0) + (num(stats.share_count, stats.shareCount) ?? 0);
    const url = str(r.url, r.share_url) ?? (handle && id ? `https://www.tiktok.com/@${handle}/video/${id}` : null);
    return [{ title: clip(text), url, author: handle ? `@${handle}` : str(author.nickname), outlet: "tiktok.com", snippet: text, publishedAt: isoDate(r.create_time ?? r.createTime), engagement: engagement || undefined }];
  });
}

/** anyapi-run-instagram-reels-search: reels with caption, creator, counts. The catalog lists no field names, so several spellings are tried. */
export function parseInstagram(raw: unknown): RawMention[] {
  return list(raw, ["reels", "items", "results", "posts", "media"]).flatMap((r) => {
    const cap = obj(r.caption);
    const text = str(typeof r.caption === "string" ? r.caption : null, cap.text, r.text, r.description, r.title);
    if (!text) return [];
    const owner = obj(r.owner ?? r.user ?? r.creator ?? r.author);
    const handle = str(owner.username, owner.userName, owner.handle, typeof r.creator === "string" ? r.creator : null, r.username);
    const code = str(r.shortcode, r.code);
    const url = str(r.url, r.permalink, r.link) ?? (code ? `https://www.instagram.com/reel/${code}/` : null);
    const engagement = (num(r.likeCount, r.like_count, r.likes) ?? 0) + (num(r.commentCount, r.comment_count, r.comments) ?? 0);
    return [{ title: clip(text), url, author: handle ? `@${handle}` : null, outlet: "instagram.com", snippet: text, publishedAt: isoDate(r.takenAt ?? r.taken_at ?? r.createdAt ?? r.created_at ?? r.timestamp), engagement: engagement || undefined }];
  });
}

const EXCLUDED_FROM_WEB = ["reddit.com", "news.ycombinator.com", "youtube.com", "x.com", "twitter.com", "tiktok.com", "instagram.com"];
const quote = (t: string) => `"${t.replace(/"/g, "")}"`;

/** Every source the app can run. Job ids and prices come from the free looot catalog. */
export const SOURCES: Record<SourceId, SourceDef> = {
  reddit: { id: "reddit", label: "Reddit", jobId: "reddit.post.search", endpointId: "scrapecreators-reddit-search", provider: "Scrape Creators", fallbackMicros: 1880, shapeVerified: false, inputFor: (k) => ({ query: k.term, sort: "new", timeframe: "week" }), parse: parseReddit },
  x: { id: "x", label: "X", jobId: "x.post.search", endpointId: "anyapi-run-twitter-search", provider: "AnyAPI", fallbackMicros: 750, shapeVerified: false, inputFor: (k) => ({ query: k.term, limit: 20, queryType: "Latest" }), parse: parseX },
  hn: { id: "hn", label: "Hacker News", jobId: "google.serp.organic", endpointId: "serper-search", provider: "Serper", fallbackMicros: 1000, shapeVerified: true, inputFor: (k) => ({ q: `site:news.ycombinator.com ${quote(k.term)}`, num: 10, tbs: "qdr:w" }), parse: (r) => parseSearch(r, { only: "news.ycombinator.com" }) },
  news: { id: "news", label: "News", jobId: "news.search", endpointId: "serper-news", provider: "Serper", fallbackMicros: 1000, shapeVerified: false, inputFor: (k) => ({ q: quote(k.term), num: 20, tbs: "qdr:w" }), parse: parseNews },
  youtube: { id: "youtube", label: "YouTube", jobId: "youtube.search.videos", endpointId: "tikhub-api-youtube-web-search-video", provider: "TikHub", fallbackMicros: 1000, shapeVerified: false, inputFor: (k) => ({ search_query: k.term, order_by: "upload_date" }), parse: parseYoutube },
  tiktok: { id: "tiktok", label: "TikTok", jobId: "tiktok.search.videos", endpointId: "scrapecreators-tiktok-search-keyword", provider: "Scrape Creators", fallbackMicros: 1880, shapeVerified: false, inputFor: (k) => ({ query: k.term }), parse: parseTikTok },
  instagram: { id: "instagram", label: "Instagram", jobId: "instagram.reels.search", endpointId: "anyapi-run-instagram-reels-search", provider: "AnyAPI", fallbackMicros: 1500, shapeVerified: false, inputFor: (k) => ({ query: k.term }), parse: parseInstagram },
  web: { id: "web", label: "Web", jobId: "google.serp.organic", endpointId: "serper-search", provider: "Serper", fallbackMicros: 1000, shapeVerified: true, inputFor: (k) => ({ q: `${quote(k.term)} ${EXCLUDED_FROM_WEB.map((d) => `-site:${d}`).join(" ")}`, num: 10, tbs: "qdr:w" }), parse: (r) => parseSearch(r, { skip: EXCLUDED_FROM_WEB }) },
};

/** Fallback price per endpoint id. */
export const FALLBACK_PRICES: Record<string, number> = Object.fromEntries(Object.values(SOURCES).map((s) => [s.endpointId, s.fallbackMicros]));

/** Lower-case alphanumerics only, so "Foo: Bar!" and "foo bar" share one key. */
export const normalizeTitle = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Fingerprint of a mention: its canonical URL, or its text when it has none. */
export const fingerprintOf = (url: string | null, fallback: string): string => hash(url ? canonicalUrl(url) : normalizeTitle(fallback));
