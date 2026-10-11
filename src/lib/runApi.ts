import { buildConfig, ConfigError } from "@/engine/config";
import { quoteOf, type Quote } from "@/engine/engine";
import { FALLBACK_PRICES } from "@/engine/sources";
import type { MentionsConfig } from "@/engine/types";
import { fetchPrices } from "@/lib/prices";
import { serverCaps } from "@/lib/serverConfig";
import type { PriceMap } from "@/lib/spender";
import { isDemo } from "@/lib/store";

/**
 * What the caller may send. Keywords and sources are the caller's choice.
 * The caps are not: they come from the server's config file, so a body field cannot raise them.
 */
export interface RunRequest {
  keywords?: string[];
  sources?: string[];
  /** Token from POST /api/quote. The run route reads the confirmed maximum from it. */
  quoteToken?: string;
}

export interface Planned {
  config: MentionsConfig;
  quote: Quote;
  prices: PriceMap;
  unread: string[];
  source: "catalog" | "fallback";
}

const MAX_TERM_LENGTH = 200;

/** Validates a request body and prices it under the server's caps. Free: the public catalog needs no token. Throws ConfigError on bad input. */
export async function planFromRequest(body: RunRequest): Promise<Planned> {
  if (body.keywords !== undefined && (!Array.isArray(body.keywords) || body.keywords.some((k) => typeof k !== "string" || k.length > MAX_TERM_LENGTH))) {
    throw new ConfigError(`Keywords are strings of at most ${MAX_TERM_LENGTH} characters.`);
  }
  const caps = serverCaps();
  const config = buildConfig({ keywords: body.keywords, sources: body.sources, maxSpendPerRunUsd: caps.maxSpendPerRunUsd, monthlyCapUsd: caps.monthlyCapUsd, maxAgeDays: caps.maxAgeDays });
  const priced = isDemo() ? { prices: FALLBACK_PRICES, source: "fallback" as const, unread: [] as string[] } : await fetchPrices(FALLBACK_PRICES);
  return { config, quote: quoteOf(config, priced.prices), prices: priced.prices, unread: priced.unread, source: priced.source };
}

export { ConfigError };
