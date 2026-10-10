import type { PriceMap } from "./spender";

export interface PriceResult {
  prices: PriceMap;
  source: "catalog" | "fallback";
  /** Endpoints whose live price could not be read just now. Their price in `prices` is the dated fallback. */
  unread: string[];
}

interface CatalogItem {
  price?: { state?: string; amountMicros?: number; unit?: string } | null;
}

/** Reads the per-call price in micros from one public catalog item. null when it has no known call price. */
export function priceOfItem(item: CatalogItem | null | undefined): number | null {
  const p = item?.price;
  if (!p || p.state !== "known" || typeof p.amountMicros !== "number" || p.amountMicros < 0) return null;
  if (p.unit && p.unit !== "call") return null;
  return Math.round(p.amountMicros);
}

/**
 * Free, no token needed. Reads current prices for the given endpoints from the public catalog.
 * Any endpoint that cannot be read keeps its fallback price for display and is named in `unread`,
 * so the engine refuses to call it.
 */
export async function fetchPrices(fallback: PriceMap, opts: { baseUrl?: string; fetch?: typeof fetch } = {}): Promise<PriceResult> {
  const base = (opts.baseUrl ?? process.env.LOOOT_API_URL ?? "https://api.looot.ai").replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const prices: PriceMap = { ...fallback };
  const unread: string[] = [];
  await Promise.all(
    Object.keys(fallback).map(async (id) => {
      try {
        const res = await f(`${base}/v1/public-catalog/${encodeURIComponent(id)}`);
        const price = res.ok ? priceOfItem((await res.json()) as CatalogItem) : null;
        if (price === null) unread.push(id);
        else prices[id] = price;
      } catch {
        unread.push(id);
      }
    }),
  );
  return { prices, source: unread.length > 0 ? "fallback" : "catalog", unread };
}
