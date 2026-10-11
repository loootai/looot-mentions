import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildConfig } from "@/engine/config";
import { EMPTY_STORE, idempotencyKey, payableMicros, planCalls, REFRESH_MS, runMentions } from "@/engine/engine";
import { FALLBACK_PRICES } from "@/engine/sources";
import type { MentionsConfig, Store } from "@/engine/types";
import { Budget, budgetFieldError, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";

const now = new Date("2026-10-10T09:00:00Z");
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number, endpointId: string) => LoootRun | Promise<LoootRun>) {
  const calls: { endpointId: string; key: string }[] = [];
  const looot: LoootRunner = {
    async runAndWait(endpointId, _input, key) {
      calls.push({ endpointId, key });
      return answer(calls.length, endpointId);
    },
  };
  return { looot, calls };
}
const news = { news: [{ title: "Acme raises prices", link: "https://n.example/1", source: "N", date: "2026-10-09T08:00:00Z" }] };
const completed = (cost: number): LoootRun => ({ runId: "run_ok", status: "completed", result: news, actualCost: cost });
// One keyword, one source, one call: serper-news at 1,000 micros.
const cfg = (term = "Acme", capUsd = 5): MentionsConfig => buildConfig({ keywords: [term], sources: ["news"], maxSpendPerRunUsd: capUsd });
const go = (config: MentionsConfig, looot: LoootRunner, ledger: Budget, at: Date = now, store: Store = EMPTY_STORE) => runMentions(config, store, { looot, prices: FALLBACK_PRICES, now: at, ledger });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small reservations at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const s2 = await b.status(new Date("2026-10-11T09:00:00Z"));
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });

  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });

  it("reads a budget file from an older shape or with extra fields without crashing", async () => {
    writeFileSync(file, JSON.stringify({ version: 1, spend: { "2026-10": 4_000_000 }, limits: { dailyMicros: 2_000_000, monthlyMicros: 3_000_000 }, somethingNew: true }));
    const s = await open().status(now);
    expect(s.limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 3_000_000 });
    expect(s.day.usedMicros).toBe(0);
    expect((await open().reserve("x", 1_000, now)).ok).toBe(true);
  });

  it("takes the starting limits from the owner's environment until a budget is saved", async () => {
    const { defaultLimits } = await import("./budget");
    expect(defaultLimits({ LOOOT_MENTIONS_DAILY_USD: "0.5", LOOOT_MENTIONS_MONTHLY_USD: "2" })).toEqual({ dailyMicros: 500_000, monthlyMicros: 2_000_000 });
    expect(defaultLimits({})).toEqual(DEFAULT_LIMITS);
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going, however old", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("idempotency keys", () => {
  const call = planCalls(cfg())[0];

  it("is the same at every moment of one refresh period", () => {
    const start = Math.floor(Date.parse("2026-10-08T05:00:00Z") / REFRESH_MS) * REFRESH_MS;
    expect(idempotencyKey(call, new Date(start))).toBe(idempotencyKey(call, new Date(start + REFRESH_MS - 1)));
  });

  it("changes only when the refresh period turns over: an explicit new request", () => {
    const t = Math.floor(Date.parse("2026-10-08T00:00:00Z") / REFRESH_MS) * REFRESH_MS;
    expect(idempotencyKey(call, new Date(t))).not.toBe(idempotencyKey(call, new Date(t + REFRESH_MS)));
  });

  it("has no date or clock time in the key", () => {
    expect(idempotencyKey(call, now)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(idempotencyKey(call, now)).not.toContain("20261010");
  });

  it("ignores letter case and spaces in the input, and the exclusion list", () => {
    const a = { ...call, keyword: { term: " Acme ", exclude: [] }, input: { q: ' "Acme" ', num: 20 } };
    const b = { ...call, keyword: { term: "acme", exclude: ["acme corp"] }, input: { num: 20, q: '"acme"' } };
    expect(idempotencyKey(a, now)).toBe(idempotencyKey(b, now));
  });

  it("finds no date in the input of any call of any source", () => {
    const all = buildConfig({ keywords: ["Acme", "Beta"], maxSpendPerRunUsd: 5 });
    for (const c of planCalls(all)) expect(JSON.stringify(c.input)).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{10}/);
  });
});

describe("runMentions with the budget", () => {
  it("does not charge a repeated identical request twice", async () => {
    const b = open();
    const first = runner(() => completed(0.001));
    const r1 = await go(cfg(), first.looot, b);
    const second = runner(() => completed(0.001));
    const r2 = await go(cfg(), second.looot, b, new Date(now.getTime() + 3 * 3_600_000));
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    expect(r2.actualMicros).toBe(0);
    expect(r2.reports[0].status).toBe("ok");
    expect(r2.reports[0].found).toBe(r1.reports[0].found);
    expect((await b.status(now)).day.usedMicros).toBe(r1.actualMicros);
  });

  it("sends the same key at two moments of one period", async () => {
    const a = runner(() => completed(0.001));
    const c = runner(() => completed(0.001));
    const t = Math.floor(now.getTime() / REFRESH_MS) * REFRESH_MS;
    await go(cfg(), a.looot, open(), new Date(t + 1000));
    await go(cfg(), c.looot, new Budget(join(dir, "other.json")), new Date(t + REFRESH_MS - 1000));
    expect(c.calls[0].key).toBe(a.calls[0].key);
  });

  it("answers two identical requests started together with one charge", async () => {
    const slow = () => runner(async () => { await new Promise((r) => setTimeout(r, 20)); return completed(0.001); });
    const [a, c] = [slow(), slow()];
    await Promise.all([go(cfg(), a.looot, open()), go(cfg(), c.looot, open())]);
    const s = await open().status(now);
    expect(s.day.usedMicros).toBe(1_000);
    expect(s.day.reservedMicros).toBe(0);
  });

  it("holds total charges inside the budget when runs start at the same time", async () => {
    await open().setLimits({ dailyMicros: 3_000, monthlyMicros: 3_000 });
    const terms = ["a", "b", "c", "d", "e"];
    const sources = terms.map(() => runner(async () => { await new Promise((r) => setTimeout(r, 10)); return completed(0.001); }));
    const results = await Promise.all(terms.map((t, i) => go(cfg(t), sources[i].looot, open())));
    const paid = sources.reduce((n, s) => n + s.calls.length, 0);
    const s = await open().status(now);
    expect(paid).toBe(3);
    expect(s.day.usedMicros).toBe(3_000);
    expect(s.day.usedMicros + s.day.reservedMicros).toBeLessThanOrEqual(3_000);
    expect(results.filter((r) => r.reports[0].status === "skipped_budget")).toHaveLength(2);
  });

  it("stops many small runs one after another at the budget", async () => {
    await open().setLimits({ dailyMicros: 2_500, monthlyMicros: 2_500 });
    const b = open();
    const seen = runner(() => completed(0.001));
    for (let i = 0; i < 8; i++) await go(cfg(`s${i}`), seen.looot, b);
    expect(seen.calls).toHaveLength(2);
    expect((await b.status(now)).day.usedMicros).toBe(2_000);
  });

  it("refuses a call over the budget, says so, and makes no call", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 500, monthlyMicros: 500 });
    const { looot, calls } = runner(() => completed(0.001));
    const r = await go(cfg(), looot, b);
    expect(calls).toHaveLength(0);
    expect(r.reports[0].status).toBe("skipped_budget");
    expect(r.reports[0].error).toMatch(/budget is reached/i);
  });

  it("keeps the reservation of a pending call and never records it as $0", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const r = await go(cfg(), looot, b);
    expect(r.reports[0].status).toBe("pending");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(1_000);
    expect(s.day.usedMicros).toBe(0);
    expect(r.committedMicros).toBe(1_000);
  });

  it("settles a pending call to its real cost when it finishes later, and then answers a repeat from the store", async () => {
    const b = open();
    await go(cfg(), runner(() => ({ runId: "run_slow", status: "running" })).looot, b);
    await b.reconcile({ getRun: async () => ({ runId: "run_slow", status: "completed", result: news, actualCost: 0.0007 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(700);
    const again = runner(() => completed(0.001));
    await go(cfg(), again.looot, b);
    expect(again.calls).toHaveLength(0);
  });

  it("releases the reservation of a call that looot refused with an HTTP answer", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const r = await go(cfg(), looot, b);
    expect(r.reports[0].status).toBe("failed");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await go(cfg(), looot, b);
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await go(cfg(), looot, b);
    expect((await b.status(now)).day.reservedMicros).toBe(1_000);
  });

  it("counts only the calls without a stored answer in the up-front check", async () => {
    const b = open();
    const plan = planCalls(cfg());
    expect(await payableMicros(plan, b, now, FALLBACK_PRICES)).toBe(1_000);
    await go(cfg(), runner(() => completed(0.001)).looot, b);
    expect(await payableMicros(plan, b, now, FALLBACK_PRICES)).toBe(0);
  });

  it("makes no budget file when there is no ledger", async () => {
    const { looot } = runner(() => completed(0.001));
    await runMentions(cfg(), EMPTY_STORE, { looot, prices: FALLBACK_PRICES, now });
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  it("still reads a data file from before the budget, with its old month-by-month spend", async () => {
    const old: Store = { version: 1, lastRunAt: "2026-10-01T00:00:00Z", spend: { "2026-10": 4_990_000 }, mentions: [] };
    const { looot, calls } = runner(() => completed(0.001));
    const r = await go(cfg(), looot, open(), now, old);
    expect(calls).toHaveLength(1);
    expect(r.store.version).toBe(1);
    expect(r.store.spend["2026-10"]).toBe(4_991_000);
  });
});

describe("budget fields in a request", () => {
  it("names a request that tries to carry a budget", () => {
    expect(budgetFieldError({ dailyUsd: 1000 })).toMatch(/cannot set the budget/);
    expect(budgetFieldError({ keywords: ["Acme"] })).toBeNull();
  });
});
