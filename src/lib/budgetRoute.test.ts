import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as run } from "@/app/api/run/route";
import { resetLimits } from "@/lib/auth/limits";
import { ENV_KEYS, H, freshEnv, post, setBudgetUsd, signIn, startFakeLooot, type FakeLooot, type TestSession } from "./testHelpers";

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

interface Status {
  limits: { dailyMicros: number; monthlyMicros: number };
  day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number };
  month: { usedMicros: number };
}
const put = (body: unknown, s: TestSession | null) => budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: { ...H, ...(s?.headers ?? {}) }, body: JSON.stringify(body) }));
const read = async (s: TestSession) => (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as Status;
const plan = (term: string) => ({ keywords: [term], sources: ["news"] });
async function runOnce(term: string, s?: TestSession) {
  const me = s ?? (await signIn());
  const q = (await (await quote(post("/api/quote", plan(term), me.headers))).json()) as { quoteToken: string };
  return run(post("/api/run", { ...plan(term), quoteToken: q.quoteToken }, me.headers));
}

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const j = await read(await signIn());
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
  });

  it("starts from the monthlyCapUsd an older config file set, until the owner saves a budget", async () => {
    const s = await signIn();
    expect((await read(s)).limits).toEqual({ dailyMicros: 5_000_000, monthlyMicros: 5_000_000 });
    process.env.LOOOT_MENTIONS_MONTHLY_USD = "20";
    process.env.LOOOT_MENTIONS_DAILY_USD = "3";
    expect((await read(s)).limits).toEqual({ dailyMicros: 3_000_000, monthlyMicros: 20_000_000 });
  });

  it("refuses to read or change the budget without the session", async () => {
    expect((await put({ dailyUsd: 1000, monthlyUsd: 5000 }, null)).status).toBe(401);
    expect((await budgetGet(new Request("http://localhost:3000/api/budget", { headers: H }))).status).toBe(401);
  });

  it("refuses a change without the CSRF token", async () => {
    const s = await signIn();
    expect((await put({ dailyUsd: 1000, monthlyUsd: 5000 }, { ...s, headers: { cookie: s.cookie } })).status).toBe(403);
  });

  it("lets the signed-in owner change the budget, and refuses nonsense", async () => {
    const s = await signIn();
    expect((await put({ dailyUsd: 1, monthlyUsd: 3 }, s)).status).toBe(200);
    expect((await read(s)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
    expect((await put({ dailyUsd: 9, monthlyUsd: 3 }, s)).status).toBe(400);
    expect((await put({ dailyUsd: -1, monthlyUsd: 3 }, s)).status).toBe(400);
  });

  it("shows what a run used, and a pending run as reserved, never as $0 used", async () => {
    const s = await signIn();
    expect((await runOnce("Acme", s)).status).toBe(200);
    expect((await read(s)).day.usedMicros).toBe(1000);
    fake.mode = "pending";
    const res = await runOnce("Pending", s);
    expect(res.status).toBe(200);
    const j = await read(s);
    expect(j.day.reservedMicros).toBe(1000);
    expect(j.day.usedMicros).toBe(1000);
  });

  it("settles a late completion to its real cost on the next run", async () => {
    const s = await signIn();
    fake.mode = "pending";
    await runOnce("Slow", s);
    expect((await read(s)).day.reservedMicros).toBe(1000);
    fake.finish("run_1", 0.0007);
    fake.mode = "complete";
    await runOnce("Other", s);
    const j = await read(s);
    expect(j.day.reservedMicros).toBe(0);
    expect(j.day.usedMicros).toBe(700 + 1000);
  });

  it("releases the reservation when looot answers with an error", async () => {
    const s = await signIn();
    fake.mode = "http_error";
    await runOnce("Bad", s);
    const j = await read(s);
    expect(j.day.reservedMicros).toBe(0);
    expect(j.day.usedMicros).toBe(0);
  });

  it("refuses a run above what is left, before any call", async () => {
    setBudgetUsd(0.0005, 0.0005);
    const res = await runOnce("TooBig");
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(fake.posts).toBe(0);
  });

  it("answers a repeat of a finished run from the stored result even when the budget is used up", async () => {
    const s = await signIn();
    expect((await runOnce("Acme", s)).status).toBe(200);
    await put({ dailyUsd: 0.0011, monthlyUsd: 0.0011 }, s);
    expect((await runOnce("Acme", s)).status).toBe(200);
    expect(fake.posts).toBe(1);
    expect((await runOnce("Different", s)).status).toBe(402);
    expect(fake.posts).toBe(1);
  });

  it("reads a data file written before the budget existed, with its old monthly spend", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(process.env.MENTIONS_DATA as string), { recursive: true });
    writeFileSync(process.env.MENTIONS_DATA as string, JSON.stringify({ version: 1, lastRunAt: "2026-10-01T00:00:00Z", spend: { "2026-10": 4_999_000 }, mentions: [] }));
    expect((await runOnce("Acme")).status).toBe(200);
  });
});
