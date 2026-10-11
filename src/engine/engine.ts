import { createHash } from "node:crypto";
import type { Ledger } from "@/lib/budget";
import type { LoootRunner } from "@/lib/looot";
import { Spender, type CallStatus, type PriceMap } from "@/lib/spender";
import { hash } from "@/lib/util";
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
  lines: { endpointId: string; provider: string; calls: number; priceMicros: number }[];
  totalMicros: number;
}

/** Provider name behind a pinned endpoint, or the endpoint id when it is not one of ours. */
const providerOf = (endpointId: string): string => Object.values(SOURCES).find((s) => s.endpointId === endpointId)?.provider ?? endpointId;

/** Prices the plan at the given per-call prices. */
export function quoteOf(config: MentionsConfig, prices: PriceMap): Quote {
  const calls = planCalls(config);
  const by = new Map<string, number>();
  for (const c of calls) by.set(c.endpointId, (by.get(c.endpointId) ?? 0) + 1);
  const lines = [...by.entries()].map(([endpointId, n]) => ({ endpointId, provider: providerOf(endpointId), calls: n, priceMicros: prices[endpointId] ?? 0 }));
  return { calls, lines, totalMicros: lines.reduce((n, l) => n + l.calls * l.priceMicros, 0) };
}

/**
 * How long a result is reused before a run looks again: 24 hours. A repeat inside the window is answered from the stored
 * result with no call and no charge. The window is a whole number, floor(time / 24 hours), never a date.
 */
export const REFRESH_MS = 24 * 3_600_000;

/** Lowercases text, trims it and sorts object keys, so the same request always has the same shape. */
function normalise(v: unknown): unknown {
  if (typeof v === "string") return v.trim().replace(/\s+/g, " ").toLowerCase();
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, normalise(x)]));
  return v;
}

const shapeOf = (call: Pick<PlannedCall, "source" | "endpointId" | "input">) => normalise([call.source, call.endpointId, call.input]);

/**
 * One key per (source, endpoint, normalised input) and refresh window. No date and no clock time goes in, and no call
 * input carries one (the searches use the relative windows `week` and `qdr:w`). Inside a window a repeat gets the same
 * key and the stored result answers it. A new window is an explicit new request with its own key, so a daily run
 * still looks for new mentions. The keyword's exclusion list is left out: it filters after the call and costs nothing.
 */
export function idempotencyKey(call: PlannedCall, now: Date): string {
  return `mn-${hash(JSON.stringify(shapeOf(call)))}-p${Math.floor(now.getTime() / REFRESH_MS)}`;
}

/** Hash of what a paid call asks for: source, endpoint and normalised input. Guards a stored result against a short-key collision. */
export function callFingerprint(call: Pick<PlannedCall, "source" | "endpointId" | "input">): string {
  return createHash("sha256").update(JSON.stringify(shapeOf(call))).digest("hex");
}

/** What a plan can still charge: its list-price total, less the calls a stored result already answers. */
export async function payableMicros(calls: PlannedCall[], ledger: Pick<Ledger, "recall">, now: Date, prices: PriceMap): Promise<number> {
  let n = 0;
  for (const c of calls) if (!(await ledger.recall(idempotencyKey(c, now), callFingerprint(c), now))) n += prices[c.endpointId] ?? 0;
  return n;
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
 * Check order for each call: a stored answer, the per-run cap, an atomic reservation against the period budget, then the call.
 * A call over the cap or the budget is skipped. A call still running when waiting stops is "pending", not "failed", and keeps its reservation.
 */
export async function runMentions(config: MentionsConfig, store: Store, deps: { looot: LoootRunner; prices: PriceMap; unpriced?: ReadonlySet<string>; now: Date; rules?: Rules; ledger?: Ledger }): Promise<RunResult> {
  const spender = new Spender({ looot: deps.looot, capMicros: config.maxSpendPerRunMicros, prices: deps.prices, unpriced: deps.unpriced, ledger: deps.ledger, now: deps.now });
  const planned = planCalls(config);
  const results = await Promise.all(planned.map((p) => spender.call(p.endpointId, p.input, idempotencyKey(p, deps.now), callFingerprint(p))));
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
