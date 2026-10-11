export type SourceId = "reddit" | "x" | "hn" | "news" | "youtube" | "tiktok" | "instagram" | "web";
export type SentimentLabel = "positive" | "neutral" | "negative";
export type Intent = "complaint" | "question" | "recommendation_request" | "comparison";

export interface Sentiment {
  label: SentimentLabel;
  /** Positive words minus negative words, after negation. */
  score: number;
  /** The words and phrases that produced the score, so the label can be checked by eye. */
  matched: string[];
}

export interface Mention {
  /** Hash of the canonical URL (or of the text when there is no URL). */
  fingerprint: string;
  /** Hash of the normalised title, so one story syndicated under many URLs counts once. */
  titleKey: string;
  keyword: string;
  source: SourceId;
  title: string;
  url: string | null;
  author: string | null;
  /** Subreddit, news outlet, channel or domain. */
  outlet: string | null;
  snippet: string | null;
  publishedAt: string | null;
  /** ISO time this tool first saw it. */
  firstSeenAt: string;
  engagement?: number;
  sentiment: Sentiment;
  intents: Intent[];
  /** The looot endpoint that supplied it. */
  via: string;
}

export interface Keyword {
  term: string;
  /** A mention that contains one of these words is dropped. */
  exclude: string[];
}

export interface MentionsConfig {
  keywords: Keyword[];
  sources: SourceId[];
  maxSpendPerRunMicros: number;
  monthlyCapMicros: number;
  /** Mentions published longer ago than this are ignored. */
  maxAgeDays: number;
}

/** What the CLI stores between runs. */
export interface Store {
  version: 1;
  lastRunAt: string | null;
  /** Spend by month (YYYY-MM) in micros, as reported by looot. */
  spend: Record<string, number>;
  mentions: Mention[];
}
