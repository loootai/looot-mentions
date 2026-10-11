import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { ConfigError } from "@/engine/config";

export interface ServerCaps {
  maxSpendPerRunUsd: number;
  monthlyCapUsd: number;
  maxAgeDays: number;
}

export const DEFAULT_CAPS: ServerCaps = { maxSpendPerRunUsd: 0.25, monthlyCapUsd: 5, maxAgeDays: 14 };

/** Path of the config file the server reads its caps from. MENTIONS_CONFIG overrides it. */
export const configPath = (env: Record<string, string | undefined> = process.env): string => resolve(/*turbopackIgnore: true*/ env.MENTIONS_CONFIG || "mentions.yaml");

const num = (v: unknown, fallback: number, name: string, min: number): number => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new ConfigError(`${name} in the config file must be a number of at least ${min}.`);
  return n;
};

/**
 * The spend caps for runs started from the web UI. They come from the server's config file
 * (mentions.yaml, or MENTIONS_CONFIG), never from the request. Defaults: $0.25 a run, $5 a month.
 */
export function serverCaps(env: Record<string, string | undefined> = process.env): ServerCaps {
  const p = configPath(env);
  if (!existsSync(p)) return DEFAULT_CAPS;
  let raw: unknown;
  try {
    raw = parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new ConfigError(`The config file is not valid YAML: ${(e as Error).message}`);
  }
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    maxSpendPerRunUsd: num(o.maxSpendPerRunUsd, DEFAULT_CAPS.maxSpendPerRunUsd, "maxSpendPerRunUsd", 0.000001),
    monthlyCapUsd: num(o.monthlyCapUsd, DEFAULT_CAPS.monthlyCapUsd, "monthlyCapUsd", 0.000001),
    maxAgeDays: num(o.maxAgeDays, DEFAULT_CAPS.maxAgeDays, "maxAgeDays", 1),
  };
}
