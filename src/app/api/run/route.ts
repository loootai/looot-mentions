import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NextResponse } from "next/server";
import { EMPTY_STORE, overMonthlyCap, runMentions } from "@/engine/engine";
import { requireAdminRoute, sessionIdOf } from "@/lib/auth/guard";
import { allow, retryAfter, RUN_MAX_PER_SESSION, RUN_WINDOW_MS } from "@/lib/auth/limits";
import { verifyQuote } from "@/lib/auth/quoteToken";
import { LoootError, loootFromEnv } from "@/lib/looot";
import { ConfigError, planFromRequest, type RunRequest } from "@/lib/runApi";
import { dataPath, isDemo, loadStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Paid. Admin only. Runs the keywords under the caps in the server's config file.
 * The confirmed maximum is the total in the signed quote token from POST /api/quote, not a number the caller sends.
 * A missing, expired or foreign token, or a live quote above the quoted total, answers 409 and runs nothing.
 * Five runs per session per 10 minutes.
 */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const sid = await sessionIdOf(req.headers);
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const p = await planFromRequest(body);
    if (isDemo()) return Response.json({ demo: true, message: "Demo mode makes no looot call and writes nothing. Run without NEXT_PUBLIC_DEMO to search for real." });
    const confirmed = await verifyQuote(process.env, sid, p.config, body.quoteToken);
    if (confirmed === null || confirmed < p.quote.totalMicros) {
      return Response.json({ error: confirmed === null ? "Get a quote first. The quote is missing, expired or for different keywords." : "The price moved above your quote. Get a new quote.", totalMicros: p.quote.totalMicros }, { status: 409 });
    }
    if (!allow(`run:${sid}`, RUN_MAX_PER_SESSION, RUN_WINDOW_MS)) {
      return NextResponse.json({ error: "Too many runs. Try again later." }, { status: 429, headers: { "Retry-After": String(retryAfter(`run:${sid}`)) } });
    }
    let looot;
    try {
      looot = loootFromEnv();
    } catch (e) {
      if (e instanceof LoootError) return Response.json({ error: "LOOOT_TOKEN is not set on the server." }, { status: 503 });
      throw e;
    }
    const now = new Date();
    const store = await loadStore();
    if (overMonthlyCap(p.config, store, p.quote.totalMicros, now)) return Response.json({ error: "The monthly cap would be passed. Nothing ran." }, { status: 402 });
    const config = { ...p.config, maxSpendPerRunMicros: Math.min(p.config.maxSpendPerRunMicros, confirmed) };
    const result = await runMentions(config, store ?? EMPTY_STORE, { looot, prices: p.prices, unpriced: new Set(p.unread), now });
    mkdirSync(dirname(dataPath()), { recursive: true });
    writeFileSync(dataPath(), `${JSON.stringify(result.store)}\n`);
    return Response.json({ fresh: result.fresh.length, chargedMicros: result.actualMicros, reports: result.reports });
  } catch (e) {
    if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: e instanceof Error ? e.message : "Run failed." }, { status: 500 });
  }
}
