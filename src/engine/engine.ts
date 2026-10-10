import { dayKey, hash } from "@/lib/util";
import type { LoootRunner } from "@/lib/looot";
import { Spender, type CallStatus, type PriceMap } from "@/lib/spender";
import { DEFAULT_RULES, intentsOf, sentimentOf, type Rules } from "./rules";
import { fingerprintOf, normalizeTitle, SOURCES, type RawMention } from "./sources";
import type { Keyword, Mention, MentionsConfig, SourceId, Store } from "./types";

export interface PlannedCall {
  keyword: Keyword;
  source: SourceId;
  endpointId: string;
  jobId: string;
  input: Record<string, unknown>;
}

/** Builds the list of calls: one per keyword and source. Free: no network. */
export function planCalls(config: MentionsConfig): PlannedCall[] {
  return config.keywords.flatMap((keyword) =>
    config.sources.map((source) => ({ keyword, source, endpointId: SOURCES[source].endpointId, jobId: SOURCES[source].jobId, input: SOURCES[source].inputFor(keyword) })),
  );
}

export interface Quote {
  calls: PlannedCall[];
  lines: { endpointId: string; calls: number; priceMicros: number }[];
  totalMicros: number;
}

/** Prices the plan at the given per-call prices. */
export function quoteOf(config: MentionsConfig, prices: PriceMap): Quote {
  const calls = planCalls(config);
  const by = new Map<string, number>();
  for (const c of calls) by.set(c.endpointId, (by.get(c.endpointId) ?? 0) + 1);
  const lines = [...by.entries()].map(([endpointId, n]) => ({ endpointId, calls: n, priceMicros: prices[endpointId] ?? 0 }));
  return { calls, lines, totalMicros: lines.reduce((n, l) => n + l.calls * l.priceMicros, 0) };
}

/** Stable per (keyword, source, input, day): the same call twice in one day replays the stored run and costs nothing more. */
export function idempotencyKey(call: PlannedCall, now: Date): string {
  return `mn-${hash(`${call.keyword.term}|${call.source}|${call.endpointId}|${JSON.stringify(call.input)}|${dayKey(now)}`)}`;
}

export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);

/** true when the text names the keyword (case-insensitive) and none of its exclusions. */
export function matchesKeyword(text: string, k: Keyword): boolean {
  const t = text.toLowerCase();
  return t.includes(k.term.toLowerCase()) && !k.exclude.some((e) => t.includes(e.toLowerCase()));
}

/** Adds sentiment, intents, keyword and fingerprints to a parsed mention. */
export function enrich(raw: RawMention, ctx: { keyword: Keyword; source: SourceId; via: string; now: Date }, rules: Rules = DEFAULT_RULES): Mention {
  const text = `${raw.title}. ${raw.snippet ?? ""}`;
  return {
    fingerprint: fingerprintOf(raw.url, raw.title),
    titleKey: hash(normalizeTitle(raw.title)),
    keyword: ctx.keyword.term,
    source: ctx.source,
    title: raw.title,
    url: raw.url,
    author: raw.author,
    outlet: raw.outlet,
    snippet: raw.snippet,
    publishedAt: raw.publishedAt,
    firstSeenAt: ctx.now.toISOString(),
    ...(raw.engagement !== undefined ? { engagement: raw.engagement } : {}),
    sentiment: sentimentOf(text, rules),
    intents: intentsOf(text, rules),
    via: ctx.via,
  };
}

/**
 * Keeps mentions not seen before. A mention counts as seen when its URL fingerprint or its title key
 * is already known, so a story syndicated under several URLs shows up once. Mentions older than the age limit are dropped.
 */
export function dedupe(items: Mention[], seen: { fingerprints: ReadonlySet<string>; titleKeys: ReadonlySet<string> }, opts: { now: Date; maxAgeDays: number }): Mention[] {
  const fps = new Set<string>();
  const titles = new Set<string>();
  const out: Mention[] = [];
  const cutoff = opts.now.getTime() - opts.maxAgeDays * 86_400_000;
  for (const m of items) {
    if (m.publishedAt && new Date(m.publishedAt).getTime() < cutoff) continue;
    if (seen.fingerprints.has(m.fingerprint) || seen.titleKeys.has(m.titleKey) || fps.has(m.fingerprint) || titles.has(m.titleKey)) continue;
    fps.add(m.fingerprint);
    titles.add(m.titleKey);
    out.push(m);
  }
  return out;
}

export interface SourceReport {
  keyword: string;
  source: SourceId;
  status: CallStatus;
  found: number;
  fresh: number;
  error?: string;
}

export interface RunResult {
  store: Store;
  fresh: Mention[];
  reports: SourceReport[];
  committedMicros: number;
  actualMicros: number;
}

export const EMPTY_STORE: Store = { version: 1, lastRunAt: null, spend: {}, mentions: [] };
const KEEP = 5000;

/**
 * Runs every keyword on every source, then enriches, filters and dedupes against the store.
 * A call that would pass the per-run cap is skipped. A call still running when waiting stops is "pending", not "failed".
 */
export async function runMentions(config: MentionsConfig, store: Store, deps: { looot: LoootRunner; prices: PriceMap; unpriced?: ReadonlySet<string>; now: Date; rules?: Rules }): Promise<RunResult> {
  const spender = new Spender({ looot: deps.looot, capMicros: config.maxSpendPerRunMicros, prices: deps.prices, unpriced: deps.unpriced });
  const planned = planCalls(config);
  const results = await Promise.all(planned.map((p) => spender.call(p.endpointId, p.input, idempotencyKey(p, deps.now))));
  const seen = { fingerprints: new Set(store.mentions.map((m) => m.fingerprint)), titleKeys: new Set(store.mentions.map((m) => m.titleKey)) };
  const fresh: Mention[] = [];
  const reports: SourceReport[] = [];
  planned.forEach((p, i) => {
    const r = results[i];
    let found = 0;
    let added: Mention[] = [];
    if (r.status === "ok") {
      const parsed = SOURCES[p.source].parse(r.raw).filter((m) => matchesKeyword(`${m.title} ${m.snippet ?? ""}`, p.keyword));
      found = parsed.length;
      const enriched = parsed.map((m) => enrich(m, { keyword: p.keyword, source: p.source, via: p.endpointId, now: deps.now }, deps.rules));
      added = dedupe(enriched, { fingerprints: new Set([...seen.fingerprints, ...fresh.map((m) => m.fingerprint)]), titleKeys: new Set([...seen.titleKeys, ...fresh.map((m) => m.titleKey)]) }, { now: deps.now, maxAgeDays: config.maxAgeDays });
      fresh.push(...added);
    }
    reports.push({ keyword: p.keyword.term, source: p.source, status: r.status, found, fresh: added.length, ...(r.error ? { error: r.error } : {}) });
  });
  const mk = monthKey(deps.now);
  const next: Store = {
    version: 1,
    lastRunAt: deps.now.toISOString(),
    spend: { ...store.spend, [mk]: (store.spend[mk] ?? 0) + spender.actualMicros },
    mentions: [...fresh, ...store.mentions].slice(0, KEEP),
  };
  return { store: next, fresh, reports, committedMicros: spender.committedMicros, actualMicros: spender.actualMicros };
}

/** true when the planned run would take the month's spend past the monthly cap. Checked before any call. */
export function overMonthlyCap(config: MentionsConfig, store: Store, plannedMicros: number, now: Date): boolean {
  return (store.spend[monthKey(now)] ?? 0) + plannedMicros > config.monthlyCapMicros;
}
