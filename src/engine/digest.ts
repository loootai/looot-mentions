import { usdPrecise } from "@/lib/money";
import type { SourceReport } from "./engine";
import { SOURCES } from "./sources";
import type { Intent, Mention } from "./types";

export const INTENT_LABEL: Record<Intent, string> = { complaint: "Complaint", question: "Question", recommendation_request: "Recommendation request", comparison: "Comparison" };

/** Mentions that call for a person to look: complaints, questions and recommendation requests. */
export const needsReply = (m: Mention): boolean => m.intents.some((i) => i !== "comparison");

const line = (m: Mention): string => {
  const bits = [SOURCES[m.source].label + (m.outlet && m.outlet !== "x.com" && m.outlet !== "youtube.com" ? ` ${m.outlet}` : ""), m.sentiment.label, ...m.intents.map((i) => INTENT_LABEL[i].toLowerCase()), m.publishedAt?.slice(0, 10), m.author].filter(Boolean);
  const title = m.title.replace(/\s+/g, " ").replace(/[[\]]/g, "");
  return `- ${m.url ? `[${title}](${m.url})` : title} (${bits.join(", ")}). Keyword: ${m.keyword}.`;
};

/** The daily digest as markdown: counts, what needs a reply, comparisons, everything else, and which sources failed. */
export function renderDigest(fresh: Mention[], opts: { date: string; reports: SourceReport[]; chargedMicros: number }): string {
  const count = <T extends string>(xs: T[]) => Object.entries(xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(", ");
  const out: string[] = [`# Mentions for ${opts.date}`, ""];
  if (fresh.length === 0) out.push("No new mentions since the last run.", "");
  else {
    out.push(`${fresh.length} new mentions. By source: ${count(fresh.map((m) => m.source))}. By sentiment: ${count(fresh.map((m) => m.sentiment.label))}.`, "");
    const reply = fresh.filter(needsReply);
    const cmp = fresh.filter((m) => !needsReply(m) && m.intents.includes("comparison"));
    const rest = fresh.filter((m) => !needsReply(m) && !m.intents.includes("comparison"));
    if (reply.length) out.push("## Needs a reply", "", ...reply.map(line), "");
    if (cmp.length) out.push("## Comparisons", "", ...cmp.map(line), "");
    if (rest.length) out.push("## Everything else", "", ...rest.map(line), "");
  }
  const bad = opts.reports.filter((r) => r.status !== "ok");
  if (bad.length) out.push("## Sources that did not answer", "", ...bad.map((r) => `- ${r.keyword} on ${SOURCES[r.source].label}: ${r.status === "pending" ? "still running at looot, not failed" : r.status}${r.error ? ` (${r.error})` : ""}`), "");
  out.push(`Charged by looot: ${usdPrecise(opts.chargedMicros)}.`);
  return `${out.join("\n")}\n`;
}
