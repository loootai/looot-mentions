import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EMPTY_STORE, overMonthlyCap, runMentions } from "@/engine/engine";
import { LoootError, loootFromEnv } from "@/lib/looot";
import { ConfigError, planFromRequest, type RunRequest } from "@/lib/runApi";
import { dataPath, isDemo, loadStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Paid. Runs the keywords after the caller confirms a maximum at or above the live quote.
 * A quote that moved above the confirmed maximum answers 409 and runs nothing.
 */
export async function POST(req: Request) {
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const p = await planFromRequest(body);
    const confirmed = Math.round(Number(body.confirmedMaxUsd) * 1_000_000);
    if (!Number.isFinite(confirmed) || confirmed < p.quote.totalMicros) {
      return Response.json({ error: "Confirm a maximum at or above the quote first.", totalMicros: p.quote.totalMicros }, { status: 409 });
    }
    if (isDemo()) return Response.json({ demo: true, message: "Demo mode makes no looot call and writes nothing. Run without NEXT_PUBLIC_DEMO to search for real." });
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
