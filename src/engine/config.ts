import { parse } from "yaml";
import { ALL_SOURCES } from "./sources";
import type { Keyword, MentionsConfig, SourceId } from "./types";

export class ConfigError extends Error {}

function keywordOf(v: unknown): Keyword {
  if (typeof v === "string" && v.trim()) return { term: v.trim(), exclude: [] };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.term === "string" && o.term.trim()) {
      return { term: o.term.trim(), exclude: Array.isArray(o.exclude) ? o.exclude.filter((x): x is string => typeof x === "string") : [] };
    }
  }
  throw new ConfigError("A keyword is a string or an object with a term.");
}

/** Validates a parsed config. 1 to 20 keywords, known sources, positive caps. */
export function buildConfig(raw: unknown): MentionsConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(o.keywords) || o.keywords.length < 1) throw new ConfigError("Give at least one keyword or brand name.");
  if (o.keywords.length > 20) throw new ConfigError("At most 20 keywords per run.");
  const keywords = o.keywords.map(keywordOf);
  const sources = (Array.isArray(o.sources) && o.sources.length > 0 ? o.sources : ALL_SOURCES) as string[];
  for (const s of sources) if (!ALL_SOURCES.includes(s as SourceId)) throw new ConfigError(`Unknown source "${s}". Known: ${ALL_SOURCES.join(", ")}.`);
  const usd = (v: unknown, fallback: number, name: string) => {
    const n = v === undefined ? fallback : Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a positive number.`);
    return Math.round(n * 1_000_000);
  };
  const age = o.maxAgeDays === undefined ? 14 : Number(o.maxAgeDays);
  if (!Number.isFinite(age) || age < 1) throw new ConfigError("maxAgeDays must be 1 or more.");
  return { keywords, sources: sources as SourceId[], maxSpendPerRunMicros: usd(o.maxSpendPerRunUsd, 0.25, "maxSpendPerRunUsd"), monthlyCapMicros: usd(o.monthlyCapUsd, 5, "monthlyCapUsd"), maxAgeDays: age };
}

/** Parses the YAML text of a mentions config file. */
export function parseConfig(text: string): MentionsConfig {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new ConfigError(`The config is not valid YAML: ${(e as Error).message}`);
  }
  return buildConfig(raw);
}
