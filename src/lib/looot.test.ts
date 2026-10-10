import { describe, expect, it, vi } from "vitest";
import { LoootClient, LoootError, loootFromEnv } from "./looot";
import { fetchPrices, priceOfItem } from "./prices";
import { Spender } from "./spender";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("LoootClient", () => {
  it("posts the run with the bearer token and the idempotency key", async () => {
    const f = vi.fn(async () => json({ runId: "r1", status: "completed", result: { ok: 1 } }));
    const c = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch });
    const run = await c.runAndWait("serper-news", { q: "x" }, "key-1");
    expect(run.status).toBe("completed");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.looot.ai/v1/runs?wait=30");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(JSON.parse(init.body as string)).toEqual({ endpointId: "serper-news", input: { q: "x" }, idempotencyKey: "key-1" });
  });
  it("polls a running run until it ends", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ runId: "r1", status: "running" })).mockResolvedValueOnce(json({ runId: "r1", status: "completed", result: {} }));
    const c = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: async () => {} });
    expect((await c.runAndWait("e", {}, "k")).status).toBe("completed");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("returns the last state when polling times out", async () => {
    const f = vi.fn(async () => json({ runId: "r1", status: "running" }));
    const c = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch, sleep: async () => {}, pollTimeoutMs: 0 });
    expect((await c.runAndWait("e", {}, "k")).status).toBe("running");
  });
  it("throws a LoootError with looot's message", async () => {
    const c = new LoootClient({ token: "t", fetch: (async () => json({ error: { message: "No balance", code: "insufficient_funds" } }, 402)) as unknown as typeof fetch });
    await expect(c.run("e", {}, "k")).rejects.toMatchObject({ status: 402, code: "insufficient_funds", message: "No balance" });
  });
  it("needs LOOOT_TOKEN", () => {
    expect(() => loootFromEnv({})).toThrow(LoootError);
  });
});

describe("prices", () => {
  it("reads a known call price and rejects others", () => {
    expect(priceOfItem({ price: { state: "known", amountMicros: 1000, unit: "call" } })).toBe(1000);
    expect(priceOfItem({ price: { state: "unknown" } })).toBeNull();
    expect(priceOfItem({ price: { state: "known", amountMicros: 5, unit: "row" } })).toBeNull();
  });
  it("marks an endpoint unread when the catalog fails, and keeps its fallback", async () => {
    const f = vi.fn(async (u: string) => (u.endsWith("/a") ? json({ price: { state: "known", amountMicros: 7, unit: "call" } }) : json({}, 404)));
    const r = await fetchPrices({ a: 1, b: 2 }, { fetch: f as unknown as typeof fetch });
    expect(r).toMatchObject({ prices: { a: 7, b: 2 }, source: "fallback", unread: ["b"] });
  });
});

describe("Spender", () => {
  it("counts a thrown error as failed with no cost", async () => {
    const s = new Spender({ looot: { runAndWait: async () => { throw new Error("boom"); } }, capMicros: 10_000, prices: { e: 100 } });
    expect(await s.call("e", {}, "k")).toMatchObject({ status: "failed", costMicros: 0, error: "boom" });
  });
  it("reads actualCost from a completed run", async () => {
    const s = new Spender({ looot: { runAndWait: async () => ({ runId: "r", status: "completed", result: 1, actualCost: "0.001" }) }, capMicros: 10_000, prices: { e: 1000 } });
    expect((await s.call("e", {}, "k")).costMicros).toBe(1000);
    expect(s.actualMicros).toBe(1000);
  });
});
