import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_CONFIG, DEMO_NOW, fixtureRunner } from "@/demo/fixtures";
import { EMPTY_STORE, runMentions } from "@/engine/engine";
import { FALLBACK_PRICES } from "@/engine/sources";
import type { Store } from "@/engine/types";
import { isDemoEnv } from "@/lib/auth/policy";

/** true when the web UI runs on sample data. Reads the live environment, so a built app obeys the variable it starts with. */
export const isDemo = (): boolean => isDemoEnv(process.env);

/** File the CLI and the web UI write to. MENTIONS_DATA overrides it. */
export const dataPath = (): string => resolve(/*turbopackIgnore: true*/ process.env.MENTIONS_DATA ?? "data/mentions.json");

/** Mentions for the UI: the sample data in demo mode, the CLI's data file otherwise. Empty when nothing ran yet. */
export async function loadStore(): Promise<Store> {
  if (isDemo()) return (await runMentions(DEMO_CONFIG, EMPTY_STORE, { looot: fixtureRunner, prices: FALLBACK_PRICES, now: DEMO_NOW })).store;
  const p = dataPath();
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Store) : { ...EMPTY_STORE, spend: {}, mentions: [] };
}
