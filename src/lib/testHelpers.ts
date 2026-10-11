import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { POST as login } from "@/app/api/auth/login/route";
import { FALLBACK_PRICES } from "@/engine/sources";
import { csrfToken, verifySession } from "@/lib/auth/session";

/** Test helpers: a sandbox environment, a sign-in, and a fake looot server that counts the calls it receives. Not used by the app. */
export const PW = "test-password-123456";
export const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };

export const ENV_KEYS = ["MENTIONS_ADMIN_PASSWORD", "MENTIONS_DATA", "MENTIONS_CONFIG", "NEXT_PUBLIC_DEMO", "LOOOT_TOKEN", "LOOOT_API_URL", "LOOOT_MENTIONS_DATA_DIR", "LOOOT_MENTIONS_DAILY_USD", "LOOOT_MENTIONS_MONTHLY_USD"] as const;

/** Writes the server config file the way an owner would: a cap per run and the old monthly cap. */
export function writeServerConfig(maxSpendPerRunUsd: number, monthlyCapUsd: number): void {
  writeFileSync(process.env.MENTIONS_CONFIG as string, `maxSpendPerRunUsd: ${maxSpendPerRunUsd}\nmonthlyCapUsd: ${monthlyCapUsd}\n`);
}

/** Sets the budget the owner would have: the starting daily and monthly dollars, and the same monthly figure in the config file. */
export function setBudgetUsd(dailyUsd: number, monthlyUsd: number, maxSpendPerRunUsd = 1): void {
  process.env.LOOOT_MENTIONS_DAILY_USD = String(dailyUsd);
  process.env.LOOOT_MENTIONS_MONTHLY_USD = String(monthlyUsd);
  writeServerConfig(maxSpendPerRunUsd, monthlyUsd);
}

/** A fresh data folder, config file, budget folder and admin password for one test. */
export function freshEnv(): void {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "flow-"));
  process.env.MENTIONS_DATA = join(dir, "mentions.json");
  process.env.MENTIONS_CONFIG = join(dir, "mentions.yaml");
  process.env.LOOOT_MENTIONS_DATA_DIR = join(dir, "budget");
  delete process.env.LOOOT_MENTIONS_DAILY_USD;
  delete process.env.LOOOT_MENTIONS_MONTHLY_USD;
  writeServerConfig(1, 5);
  process.env.MENTIONS_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_fake_for_tests";
  delete process.env.NEXT_PUBLIC_DEMO;
}

export const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });

export interface TestSession {
  cookie: string;
  token: string;
  headers: Record<string, string>;
}

/** Signs in with the test password. Each call is a new session, so the per-session run limit does not interfere. */
export async function signIn(): Promise<TestSession> {
  const res = await login(post("/api/auth/login", { password: PW }));
  const cookie = /mentions_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  const token = await csrfToken(process.env, s.sid);
  return { cookie, token, headers: { cookie, "x-mentions-csrf": token } };
}

export type FakeMode = "complete" | "pending" | "http_error";

export interface FakeLooot {
  /** Every POST /v1/runs it received, counting replays of a key. */
  posts: number;
  /** Micros it would bill: one charge per distinct idempotency key, as looot does. */
  chargedMicros: number;
  keys: Set<string>;
  mode: FakeMode;
  delayMs: number;
  /** Ends a pending run so the next GET /v1/runs/{id} reports it completed at this cost. */
  finish(runId: string, costUsd: number): void;
  /** Forgets every run and key, so the next test starts clean. */
  reset(): void;
  stop(): Promise<void>;
}

/** A local stand-in for api.looot.ai: the public catalog answers with the dated list prices, POST /v1/runs bills once per key. */
export async function startFakeLooot(): Promise<FakeLooot> {
  const runs = new Map<string, { status: string; cost: number }>();
  const byKey = new Map<string, string>();
  const fake: FakeLooot = {
    posts: 0,
    chargedMicros: 0,
    keys: new Set(),
    mode: "complete",
    delayMs: 0,
    finish(runId, costUsd) {
      runs.set(runId, { status: "completed", cost: costUsd });
      fake.chargedMicros += Math.round(costUsd * 1e6);
    },
    reset() {
      runs.clear();
      byKey.clear();
      fake.keys.clear();
      fake.posts = 0;
      fake.chargedMicros = 0;
      fake.mode = "complete";
      fake.delayMs = 0;
    },
    stop: () => new Promise((r) => server.close(() => r())),
  };
  const body = { news: [{ title: "Acme raises prices", link: "https://n.example/1", source: "N", date: "2026-10-09T08:00:00Z" }] };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/public-catalog/")) {
        const id = decodeURIComponent(url.split("/").pop() ?? "");
        return void res.end(JSON.stringify({ price: { state: "known", amountMicros: FALLBACK_PRICES[id] ?? 1000, unit: "call" } }));
      }
      if (req.method === "GET" && url.startsWith("/v1/runs/")) {
        const id = decodeURIComponent(url.split("/").pop() ?? "");
        const r = runs.get(id);
        if (!r) return void ((res.statusCode = 404), res.end("{}"));
        return void res.end(JSON.stringify({ runId: id, status: r.status, result: r.status === "completed" ? body : undefined, actualCost: r.status === "completed" ? r.cost : 0 }));
      }
      fake.posts++;
      const key = (JSON.parse(Buffer.concat(chunks).toString() || "{}") as { idempotencyKey?: string }).idempotencyKey ?? `anon${fake.posts}`;
      setTimeout(() => {
        if (fake.mode === "http_error") return void ((res.statusCode = 400), res.end(JSON.stringify({ error: { code: "invalid_input", message: "bad input" } })));
        const known = byKey.get(key);
        const runId = known ?? `run_${byKey.size + 1}`;
        if (!known) {
          byKey.set(key, runId);
          fake.keys.add(key);
          if (fake.mode === "pending") runs.set(runId, { status: "running", cost: 0 });
          else {
            runs.set(runId, { status: "completed", cost: 0.001 });
            fake.chargedMicros += 1000;
          }
        }
        const r = runs.get(runId)!;
        res.end(JSON.stringify({ runId, status: r.status, result: r.status === "completed" ? body : undefined, actualCost: r.status === "completed" ? r.cost : 0 }));
      }, fake.delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
