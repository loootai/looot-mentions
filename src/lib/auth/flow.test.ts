import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRunner } from "@/demo/fixtures";
import * as engine from "@/engine/engine";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as run } from "@/app/api/run/route";
import { proxy } from "@/proxy";
import { resetLimits } from "./limits";
import { csrfToken, verifySession } from "./session";

// No network and no paid call: prices are the list prices in the code, and the "looot" client is the fixture runner.
vi.mock("@/lib/prices", () => ({ fetchPrices: async (fallback: Record<string, number>) => ({ prices: fallback, source: "fallback", unread: [] }) }));
vi.mock("@/lib/looot", async (orig) => ({ ...(await orig<typeof import("@/lib/looot")>()), loootFromEnv: () => fixtureRunner }));
vi.mock("@/engine/engine", async (orig) => {
  const real = await orig<typeof import("@/engine/engine")>();
  return { ...real, runMentions: vi.fn(real.runMentions) };
});

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
const ENV_KEYS = ["MENTIONS_ADMIN_PASSWORD", "MENTIONS_DATA", "MENTIONS_CONFIG", "NEXT_PUBLIC_DEMO", "LOOOT_TOKEN"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const SERVER_CAP_USD = 0.01;

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /mentions_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "flow-"));
  process.env.MENTIONS_DATA = join(dir, "mentions.json");
  process.env.MENTIONS_CONFIG = join(dir, "mentions.yaml");
  writeFileSync(process.env.MENTIONS_CONFIG, `maxSpendPerRunUsd: ${SERVER_CAP_USD}\nmonthlyCapUsd: 5\n`);
  process.env.MENTIONS_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_fake_for_tests";
  delete process.env.NEXT_PUBLIC_DEMO;
  resetLimits();
  vi.mocked(engine.runMentions).mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function session() {
  const res = await login(post("/api/auth/login", { password: PW }));
  const cookie = cookieOf(res);
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
const authed = (s: { cookie: string; token: string }, extra: Record<string, string> = {}) => ({ cookie: s.cookie, "x-mentions-csrf": s.token, ...extra });
const KEYWORDS = { keywords: ["Tallyroom"], sources: ["hn"] };

describe("sign in", () => {
  it("a wrong password gets 401 and no cookie", async () => {
    const res = await login(post("/api/auth/login", { password: "nope-nope-nope-nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("the right password sets a hardened cookie that opens admin routes", async () => {
    const res = await login(post("/api/auth/login", { password: PW }));
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Max-Age=/);
    const page = await proxy(new NextRequest("http://localhost:3000/digest", { headers: { cookie: cookieOf(res) } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
  it("a form post redirects to the page asked for, and never off site", async () => {
    const form = (next: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { host: H.host, origin: H.origin, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": H["x-forwarded-for"] }, body: new URLSearchParams({ password: PW, next }) });
    expect((await login(form("/digest"))).headers.get("location")).toBe("/digest");
    expect((await login(form("//evil.example"))).headers.get("location")).toBe("/");
    expect((await login(form("https://evil.example"))).headers.get("location")).toBe("/");
  });
  it("locks the address after 5 wrong passwords, and the right password does not help until the window ends", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", { password: `wrong-password-${i}-xx` }))).status).toBe(401);
    const locked = await login(post("/api/auth/login", { password: PW }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
  });
  it("refuses a sign-in posted from another site", async () => {
    const res = await login(post("/api/auth/login", { password: PW }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
  it("sign out clears the cookie, and only for a same-site request", async () => {
    const ok = await logout(post("/api/auth/logout", {}));
    expect(ok.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("CSRF on state-changing admin requests", () => {
  it("rejects a cross-site origin even with a valid session", async () => {
    const s = await session();
    expect((await quote(post("/api/quote", KEYWORDS, authed(s, { origin: "https://evil.example" })))).status).toBe(403);
    expect((await run(post("/api/run", KEYWORDS, authed(s, { origin: "https://evil.example" })))).status).toBe(403);
  });
  it("rejects a same-origin request without the token, or with someone else's", async () => {
    const s = await session();
    expect((await run(post("/api/run", KEYWORDS, { cookie: s.cookie }))).status).toBe(403);
    expect((await run(post("/api/run", KEYWORDS, { cookie: s.cookie, "x-mentions-csrf": "AAAA" }))).status).toBe(403);
  });
  it("accepts a same-origin request with the session token", async () => {
    const s = await session();
    expect((await quote(post("/api/quote", KEYWORDS, authed(s)))).status).toBe(200);
  });
  it("a request with no Origin and no fetch metadata is refused", async () => {
    const s = await session();
    const res = await run(new Request("http://localhost:3000/api/run", { method: "POST", headers: { host: H.host, ...authed(s) }, body: JSON.stringify(KEYWORDS) }));
    expect(res.status).toBe(403);
  });
});

describe("money: the cap comes from the server, the maximum from the quote", () => {
  it("a quote ignores a cap sent by the caller", async () => {
    const s = await session();
    const res = await quote(post("/api/quote", { ...KEYWORDS, maxSpendPerRunUsd: 1000, monthlyCapUsd: 1000 }, authed(s)));
    const body = await res.json();
    expect(body.capMicros).toBe(SERVER_CAP_USD * 1_000_000);
    expect(typeof body.quoteToken).toBe("string");
    expect(body.quoteToken.length).toBeGreaterThan(20);
  });
  it("a run with no quote token is refused, whatever maximum the caller writes", async () => {
    const s = await session();
    const res = await run(post("/api/run", { ...KEYWORDS, confirmedMaxUsd: 1000, maxSpendPerRunUsd: 1000 }, authed(s)));
    expect(res.status).toBe(409);
    expect(engine.runMentions).not.toHaveBeenCalled();
  });
  it("a run with a quote runs under the server cap even when the caller asks for more", async () => {
    const s = await session();
    const q = await (await quote(post("/api/quote", KEYWORDS, authed(s)))).json();
    const res = await run(post("/api/run", { ...KEYWORDS, quoteToken: q.quoteToken, confirmedMaxUsd: 1000, maxSpendPerRunUsd: 1000 }, authed(s)));
    expect(res.status).toBe(200);
    const config = vi.mocked(engine.runMentions).mock.calls[0][0];
    // The run's cap is the lower of the server cap and the quoted total. It is never the caller's 1000 dollars.
    expect(config.maxSpendPerRunMicros).toBe(Math.min(SERVER_CAP_USD * 1_000_000, q.totalMicros));
    expect(config.maxSpendPerRunMicros).toBeLessThanOrEqual(SERVER_CAP_USD * 1_000_000);
  });
  it("a quote for other keywords does not unlock a run", async () => {
    const s = await session();
    const q = await (await quote(post("/api/quote", { keywords: ["Tallyroom"], sources: ["hn"] }, authed(s)))).json();
    const res = await run(post("/api/run", { keywords: ["Ledgerly"], sources: ["hn"], quoteToken: q.quoteToken }, authed(s)));
    expect(res.status).toBe(409);
    expect(engine.runMentions).not.toHaveBeenCalled();
  });
  it("a quote from another session does not unlock a run", async () => {
    const a = await session();
    const q = await (await quote(post("/api/quote", KEYWORDS, authed(a)))).json();
    const b = await session();
    const res = await run(post("/api/run", { ...KEYWORDS, quoteToken: q.quoteToken }, authed(b)));
    expect(res.status).toBe(409);
  });
  it("allows 5 runs per session in the window, then 429", async () => {
    const s = await session();
    const q = await (await quote(post("/api/quote", KEYWORDS, authed(s)))).json();
    const go = () => run(post("/api/run", { ...KEYWORDS, quoteToken: q.quoteToken }, authed(s)));
    for (let i = 0; i < 5; i++) expect((await go()).status, `run ${i + 1}`).toBe(200);
    const sixth = await go();
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("limits quotes per session too", async () => {
    const s = await session();
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await quote(post("/api/quote", KEYWORDS, authed(s)))).status;
    expect(last).toBe(429);
  });
  it("a run in demo mode makes no call", async () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    const s = await session();
    const res = await run(post("/api/run", KEYWORDS, authed(s)));
    expect((await res.json()).demo).toBe(true);
    expect(engine.runMentions).not.toHaveBeenCalled();
  });
});
