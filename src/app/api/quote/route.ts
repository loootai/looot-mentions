import { ConfigError, planFromRequest, type RunRequest } from "@/lib/runApi";

export const dynamic = "force-dynamic";

/** Free. Returns what a run would cost at list price, makes no paid call. */
export async function POST(req: Request) {
  try {
    const p = await planFromRequest((await req.json()) as RunRequest);
    return Response.json({ totalMicros: p.quote.totalMicros, capMicros: p.config.maxSpendPerRunMicros, overCap: p.quote.totalMicros > p.config.maxSpendPerRunMicros, calls: p.quote.calls.length, lines: p.quote.lines, priceSource: p.source, unread: p.unread });
  } catch (e) {
    if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: "Could not read the request." }, { status: 400 });
  }
}
