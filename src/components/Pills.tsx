import { INTENT_LABEL } from "@/engine/digest";
import { SOURCES } from "@/engine/sources";
import type { Intent, Mention, SentimentLabel } from "@/engine/types";

const SENT: Record<SentimentLabel, string> = { positive: "bg-add text-ink", neutral: "bg-low-soft text-low", negative: "bg-high-soft text-high" };

/** One mention as a row: source, title link, snippet, sentiment with the words behind it, and intent tags. */
export function MentionRow({ m }: { m: Mention }) {
  return (
    <li className="border-b border-line p-4 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-12 text-mute">
        <span className="rounded bg-brand-soft px-2 py-0.5 text-ink" title={`${SOURCES[m.source].jobId} via ${SOURCES[m.source].provider}, ${m.via}`}>{SOURCES[m.source].label}</span>
        {m.outlet && <span>{m.outlet}</span>}
        {m.author && <span>{m.author}</span>}
        {m.publishedAt && <span className="num">{m.publishedAt.slice(0, 10)}</span>}
        <span>keyword {m.keyword}</span>
        {m.engagement !== undefined && <span className="num">{m.engagement} engagement</span>}
      </div>
      <h3 className="mt-1 text-14 font-medium">{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="text-link underline">{m.title}</a> : m.title}</h3>
      {m.snippet && <p className="mt-1 text-13 text-mute">{m.snippet.length > 220 ? `${m.snippet.slice(0, 217)}...` : m.snippet}</p>}
      <div className="mt-2 flex flex-wrap gap-2 text-12">
        <span className={`rounded px-2 py-0.5 ${SENT[m.sentiment.label]}`} title={m.sentiment.matched.length ? `Matched: ${m.sentiment.matched.join(", ")}. Score ${m.sentiment.score}.` : "No sentiment words matched."}>
          {m.sentiment.label}{m.sentiment.matched.length > 0 && ` (${m.sentiment.matched.join(", ")})`}
        </span>
        {m.intents.map((i: Intent) => <span key={i} className="rounded bg-medium-soft px-2 py-0.5 text-medium">{INTENT_LABEL[i]}</span>)}
      </div>
    </li>
  );
}
