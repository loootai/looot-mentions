import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as quote } from "@/app/api/quote/route";
import { POST as run } from "@/app/api/run/route";
import { resetLimits } from "@/lib/auth/limits";
import { ENV_KEYS, freshEnv, post, setBudgetUsd, signIn, startFakeLooot, type FakeLooot } from "./testHelpers";

// These tests use only the quote and run routes, so they run the same before and after the budget change.
// The fake looot server bills once per idempotency key. A fast poll keeps a pending run from holding a test for 60 seconds.
vi.mock("@/lib/looot", async (orig) => {
  const real = await orig<typeof import("@/lib/looot")>();
  return { ...real, loootFromEnv: () => new real.LoootClient({ token: "lt_test", baseUrl: process.env.LOOOT_API_URL, pollTimeoutMs: 60, pollIntervalMs: 10 }) };
});

const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let fake: FakeLooot;

beforeAll(async () => {
  fake = await startFakeLooot();
});
afterAll(async () => {
  await fake.stop();
});
beforeEach(() => {
  freshEnv();
  fake.reset();
  resetLimits();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (k === "LOOOT_API_URL") continue;
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// One keyword on the news source: one serper-news call at 1,000 micros.
const plan = (term: string) => ({ keywords: [term], sources: ["news"] });
async function runOnce(term: string, extra: object = {}) {
  const s = await signIn();
  const q = (await (await quote(post("/api/quote", plan(term), s.headers))).json()) as { quoteToken: string };
  return run(post("/api/run", { ...plan(term), quoteToken: q.quoteToken, ...extra }, s.headers));
}

describe("a repeated identical request", () => {
  it("is answered from the stored result: no second call to looot", async () => {
    expect((await runOnce("Acme")).status).toBe(200);
    expect(fake.posts).toBe(1);
    expect((await runOnce("Acme")).status).toBe(200);
    expect(fake.posts).toBe(1);
    expect(fake.chargedMicros).toBe(1000);
  });
});

describe("the period budget", () => {
  it("stops many small runs at the budget and says so", async () => {
    setBudgetUsd(0.0025, 0.0025);
    const out: Response[] = [];
    for (let i = 0; i < 6; i++) out.push(await runOnce(`term${i}`));
    expect(out.filter((r) => r.status === 200)).toHaveLength(2);
    const refused = out.filter((r) => r.status !== 200);
    expect(refused.every((r) => r.status === 402)).toBe(true);
    expect(((await refused[0].json()) as { error: string }).error).toMatch(/budget/i);
    expect(fake.posts).toBe(2);
    expect(fake.chargedMicros).toBeLessThanOrEqual(2500);
  });

  it("never lets two runs started together spend more than the budget between them", async () => {
    setBudgetUsd(0.0015, 0.0015);
    fake.delayMs = 60;
    const out = await Promise.all([runOnce("alpha"), runOnce("beta")]);
    expect(fake.chargedMicros).toBeLessThanOrEqual(1500);
    expect(fake.posts).toBe(1);
    expect(out.map((r) => r.status).sort()).toEqual([200, 402]);
  });

  it("holds six runs started together to the budget", async () => {
    setBudgetUsd(0.0035, 0.0035);
    fake.delayMs = 60;
    await Promise.all(["a1", "b1", "c1", "d1", "e1", "f1"].map((t) => runOnce(t)));
    expect(fake.chargedMicros).toBeLessThanOrEqual(3500);
    expect(fake.posts).toBe(3);
  });
});

describe("the cap and the budget come only from the server", () => {
  it("ignores a cap sent by the caller: the server cap holds", async () => {
    setBudgetUsd(10, 50, 0.0015);
    const s = await signIn();
    const body = { keywords: ["one", "two", "three"], sources: ["news"] };
    const q = (await (await quote(post("/api/quote", body, s.headers))).json()) as { quoteToken: string };
    const res = await run(post("/api/run", { ...body, quoteToken: q.quoteToken, maxSpendPerRunUsd: 1000, capUsd: 1000, capMicros: 1e12, monthlyCapUsd: 1000 }, s.headers));
    expect(res.status).toBe(200);
    expect(fake.posts).toBe(1); // three calls at 1,000 each against a cap of 1,500
  });

  it("refuses a run that carries a budget, and calls nothing", async () => {
    const res = await runOnce("budgeted", { dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 }, limits: { dailyMicros: 1e15 } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(fake.posts).toBe(0);
  });
});
