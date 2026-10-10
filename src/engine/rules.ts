import defaults from "../../config/rules.json";
import type { Intent, Sentiment } from "./types";

export interface Rules {
  positive: string[];
  negative: string[];
  negators: string[];
  sentimentThreshold: number;
  intents: Record<Intent, string[]>;
}

export const DEFAULT_RULES: Rules = defaults as Rules;

const tokens = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9'’\s-]/g, " ").replace(/’/g, "'").split(/\s+/).filter(Boolean);

/** Rule-based sentiment: positive and negative words from the rules file, flipped by a negator in the 3 words before. */
export function sentimentOf(text: string, rules: Rules = DEFAULT_RULES): Sentiment {
  const pos = new Set(rules.positive.map((w) => w.toLowerCase()));
  const neg = new Set(rules.negative.map((w) => w.toLowerCase()));
  const negators = new Set(rules.negators.map((w) => w.toLowerCase()));
  const words = tokens(text);
  let score = 0;
  const matched: string[] = [];
  words.forEach((w, i) => {
    const sign = pos.has(w) ? 1 : neg.has(w) ? -1 : 0;
    if (sign === 0) return;
    const negator = words.slice(Math.max(0, i - 3), i).find((p) => negators.has(p));
    score += negator ? -sign : sign;
    matched.push(negator ? `${negator} ${w}` : w);
  });
  const t = rules.sentimentThreshold;
  return { label: score >= t ? "positive" : score <= -t ? "negative" : "neutral", score, matched: [...new Set(matched)] };
}

/** Intents whose patterns match the text. A mention can have more than one. Order is fixed. */
export function intentsOf(text: string, rules: Rules = DEFAULT_RULES): Intent[] {
  const order: Intent[] = ["complaint", "recommendation_request", "question", "comparison"];
  const flat = text.replace(/\s+/g, " ").trim();
  return order.filter((intent) => (rules.intents[intent] ?? []).some((p) => new RegExp(p, "i").test(flat)));
}

/** Validates a rules file read from disk. Missing lists fall back to the defaults. */
export function mergeRules(raw: unknown): Rules {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Rules>;
  return {
    positive: Array.isArray(o.positive) ? o.positive : DEFAULT_RULES.positive,
    negative: Array.isArray(o.negative) ? o.negative : DEFAULT_RULES.negative,
    negators: Array.isArray(o.negators) ? o.negators : DEFAULT_RULES.negators,
    sentimentThreshold: typeof o.sentimentThreshold === "number" ? o.sentimentThreshold : DEFAULT_RULES.sentimentThreshold,
    intents: { ...DEFAULT_RULES.intents, ...(o.intents ?? {}) },
  };
}
