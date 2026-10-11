import { NextResponse } from "next/server";
import { requireAdminRoute, sessionIdOf } from "@/lib/auth/guard";
import { allow, QUOTE_MAX_PER_SESSION, retryAfter, RUN_WINDOW_MS } from "@/lib/auth/limits";
import { issueQuote } from "@/lib/auth/quoteToken";
import { ConfigError, planFromRequest, type RunRequest } from "@/lib/runApi";

export const dynamic = "force-dynamic";

/** Free. Admin only. Returns what a run would cost at list price, with a signed quote token the run route needs. Makes no paid call. */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const sid = await sessionIdOf(req.headers);
  if (!allow(`quote:${sid}`, QUOTE_MAX_PER_SESSION, RUN_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many quotes. Try again later." }, { status: 429, headers: { "Retry-After": String(retryAfter(`quote:${sid}`)), "Cache-Control": "no-store" } });
  }
  try {
    const p = await planFromRequest((await req.json()) as RunRequest);
    const quoteToken = await issueQuote(process.env, sid, p.config, p.quote.totalMicros);
    return NextResponse.json({ totalMicros: p.quote.totalMicros, capMicros: p.config.maxSpendPerRunMicros, overCap: p.quote.totalMicros > p.config.maxSpendPerRunMicros, calls: p.quote.calls.length, lines: p.quote.lines, priceSource: p.source, unread: p.unread, quoteToken });
  } catch (e) {
    if (e instanceof ConfigError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  }
}
