"use client";

import { useMemo, useState } from "react";
import type { Intent, Mention, SentimentLabel, SourceId } from "@/engine/types";
import { MentionRow } from "./Pills";

const SOURCE_LABEL: Record<SourceId, string> = { reddit: "Reddit", x: "X", hn: "Hacker News", news: "News", youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", web: "Web" };
const INTENT_LABEL: Record<Intent, string> = { complaint: "Complaint", question: "Question", recommendation_request: "Recommendation request", comparison: "Comparison" };
const SENTIMENTS: SentimentLabel[] = ["positive", "neutral", "negative"];

function Chips<T extends string>({ label, options, value, onChange, counts }: { label: string; options: T[]; value: T | null; onChange: (v: T | null) => void; counts: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="w-20 text-12 text-mute">{label}</span>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(value === o ? null : o)} aria-pressed={value === o} className={`rounded-control border px-2.5 py-1 text-12 ${value === o ? "border-brand bg-brand text-brand-ink" : "border-line bg-panel hover:bg-hover"}`}>
          {(SOURCE_LABEL as Record<string, string>)[o] ?? (INTENT_LABEL as Record<string, string>)[o] ?? o} <span className="num opacity-70">{counts[o] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

const tally = (xs: string[][]) => xs.flat().reduce<Record<string, number>>((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {});

/** The mention feed with filters for keyword, source, sentiment and intent, plus text search. Filtering runs in the browser. */
export function Feed({ mentions }: { mentions: Mention[] }) {
  const [keyword, setKeyword] = useState<string | null>(null);
  const [source, setSource] = useState<SourceId | null>(null);
  const [sentiment, setSentiment] = useState<SentimentLabel | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [q, setQ] = useState("");

  const keywords = useMemo(() => [...new Set(mentions.map((m) => m.keyword))], [mentions]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mentions
      .filter((m) => (!keyword || m.keyword === keyword) && (!source || m.source === source) && (!sentiment || m.sentiment.label === sentiment) && (!intent || m.intents.includes(intent)) && (!needle || `${m.title} ${m.snippet ?? ""}`.toLowerCase().includes(needle)))
      .sort((a, b) => (b.publishedAt ?? b.firstSeenAt).localeCompare(a.publishedAt ?? a.firstSeenAt));
  }, [mentions, keyword, source, sentiment, intent, q]);

  const sources = Object.keys(SOURCE_LABEL) as SourceId[];
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-panel border border-line bg-panel p-4">
        <Chips label="Keyword" options={keywords} value={keyword} onChange={setKeyword} counts={tally(mentions.map((m) => [m.keyword]))} />
        <Chips label="Source" options={sources.filter((s) => mentions.some((m) => m.source === s))} value={source} onChange={setSource} counts={tally(mentions.map((m) => [m.source]))} />
        <Chips label="Sentiment" options={SENTIMENTS} value={sentiment} onChange={setSentiment} counts={tally(mentions.map((m) => [m.sentiment.label]))} />
        <Chips label="Intent" options={Object.keys(INTENT_LABEL) as Intent[]} value={intent} onChange={setIntent} counts={tally(mentions.map((m) => m.intents))} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and text" aria-label="Search" className="w-full rounded-control border border-line bg-page px-3 py-2 text-14" />
      </div>
      <p className="text-13 text-mute">{shown.length} of {mentions.length} mentions</p>
      {shown.length > 0 ? <ul className="rounded-panel border border-line bg-panel">{shown.map((m) => <MentionRow key={m.fingerprint} m={m} />)}</ul> : <p className="py-8 text-center text-mute">No mention matches these filters.</p>}
    </div>
  );
}
