import { createHash } from "node:crypto";
import type { MentionsConfig } from "@/engine/types";
import type { Env } from "./policy";
import { signMessage, verifyMessage } from "./session";

/** A quote is good for 10 minutes. */
export const QUOTE_TTL_SECONDS = 10 * 60;

/** Fingerprint of what a run would search and what caps it runs under. */
export function planHash(config: MentionsConfig): string {
  return createHash("sha256").update(JSON.stringify([config.keywords, config.sources, config.maxSpendPerRunMicros, config.monthlyCapMicros, config.maxAgeDays])).digest("hex").slice(0, 24);
}

/**
 * Signs a quote for one session and one plan: expiry.totalMicros.planHash.signature.
 * The run route reads the confirmed maximum from this token, never from the request body.
 */
export async function issueQuote(env: Env, sid: string, config: MentionsConfig, totalMicros: number, nowMs: number = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + QUOTE_TTL_SECONDS;
  const hash = planHash(config);
  const sig = await signMessage(env, `q|${sid}|${exp}|${totalMicros}|${hash}`);
  return sig ? `${exp}.${totalMicros}.${hash}.${sig}` : "";
}

/** The quoted total in micro-dollars when the token is signed for this session and this plan and has not expired. Null otherwise. */
export async function verifyQuote(env: Env, sid: string, config: MentionsConfig, token: unknown, nowMs: number = Date.now()): Promise<number | null> {
  if (typeof token !== "string" || token.length > 300) return null;
  const [expRaw, totalRaw, hash, sig, extra] = token.split(".");
  if (!expRaw || !totalRaw || !hash || !sig || extra !== undefined || !/^\d{1,12}$/.test(expRaw) || !/^\d{1,12}$/.test(totalRaw)) return null;
  const exp = Number(expRaw);
  if (exp * 1000 <= nowMs || hash !== planHash(config)) return null;
  return (await verifyMessage(env, `q|${sid}|${exp}|${Number(totalRaw)}|${hash}`, sig)) ? Number(totalRaw) : null;
}
