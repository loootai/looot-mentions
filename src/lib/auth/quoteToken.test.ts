import { describe, expect, it } from "vitest";
import { buildConfig } from "@/engine/config";
import { issueQuote, QUOTE_TTL_SECONDS, verifyQuote } from "./quoteToken";

const env = { MENTIONS_ADMIN_PASSWORD: "correct horse battery" };
const config = buildConfig({ keywords: ["Tallyroom"], sources: ["hn"] });
const t0 = 1_800_000_000_000;

describe("quote token", () => {
  it("round-trips the quoted total for the same session and plan", async () => {
    const t = await issueQuote(env, "sid1", config, 1234, t0);
    expect(await verifyQuote(env, "sid1", config, t, t0 + 1000)).toBe(1234);
  });
  it("is refused for another session, another plan, or after it expires", async () => {
    const t = await issueQuote(env, "sid1", config, 1234, t0);
    expect(await verifyQuote(env, "sid2", config, t, t0)).toBeNull();
    expect(await verifyQuote(env, "sid1", buildConfig({ keywords: ["Other"], sources: ["hn"] }), t, t0)).toBeNull();
    expect(await verifyQuote(env, "sid1", buildConfig({ keywords: ["Tallyroom"], sources: ["hn"], maxSpendPerRunUsd: 9 }), t, t0)).toBeNull();
    expect(await verifyQuote(env, "sid1", config, t, t0 + (QUOTE_TTL_SECONDS + 1) * 1000)).toBeNull();
  });
  it("is refused when the total is edited, or the token is junk", async () => {
    const t = await issueQuote(env, "sid1", config, 1234, t0);
    const [exp, , hash, sig] = t.split(".");
    expect(await verifyQuote(env, "sid1", config, `${exp}.1.${hash}.${sig}`, t0)).toBeNull();
    for (const junk of [undefined, null, 5, "", "a.b.c.d", "x".repeat(400)]) expect(await verifyQuote(env, "sid1", config, junk, t0)).toBeNull();
  });
  it("is empty when no secret is set", async () => {
    expect(await issueQuote({}, "demo", config, 1, t0)).toBe("");
  });
});
