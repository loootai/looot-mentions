"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "./adminFetch";

interface QuoteAnswer {
  totalMicros: number;
  capMicros: number;
  overCap: boolean;
  calls: number;
  lines: { endpointId: string; provider: string; calls: number; priceMicros: number }[];
  priceSource: string;
  quoteToken: string;
  error?: string;
}

const usd = (micros: number) => `$${(micros / 1e6).toFixed(micros % 100 === 0 ? 4 : 5)}`;

/** Asks for a quote first (free). The run button appears only after a quote, and sends the signed quote back; the server takes the confirmed maximum from it. */
export function RunForm() {
  const router = useRouter();
  const [keywords, setKeywords] = useState("");
  const [quote, setQuote] = useState<QuoteAnswer | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const payload = () => ({ keywords: keywords.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) });

  async function getQuote() {
    setBusy(true);
    setMessage(null);
    const res = await adminFetch("/api/quote", { method: "POST", body: JSON.stringify(payload()) });
    const json = (await res.json()) as QuoteAnswer;
    setBusy(false);
    if (!res.ok) {
      setQuote(null);
      return setMessage(json.error ?? "Could not get a quote.");
    }
    setQuote(json);
  }

  async function run() {
    if (!quote) return;
    setBusy(true);
    const res = await adminFetch("/api/run", { method: "POST", body: JSON.stringify({ ...payload(), quoteToken: quote.quoteToken }) });
    const json = (await res.json()) as { error?: string; message?: string };
    setBusy(false);
    if (!res.ok) return setMessage(json.error ?? "Run failed.");
    if (json.message) return setMessage(json.message);
    router.push("/");
    router.refresh();
  }

  const field = "mt-1 w-full rounded-control border border-line bg-panel px-3 py-2 text-14";
  return (
    <div className="space-y-4">
      <label className="block text-13">Keywords and brand names (one per line or comma separated)
        <textarea className={field} rows={3} value={keywords} onChange={(e) => { setKeywords(e.target.value); setQuote(null); }} placeholder="Tallyroom, Ledgerly" />
      </label>
      <button onClick={getQuote} disabled={busy} className="rounded-control border border-line bg-panel px-4 py-2 text-14 hover:bg-hover">Get a quote (free)</button>
      {message && <p role="status" className="text-14 text-medium">{message}</p>}
      {quote && (
        <div className="rounded-panel border border-line bg-panel p-4 text-14">
          <p className="font-semibold">This run costs up to <span className="num">{usd(quote.totalMicros)}</span> for {quote.calls} searches.</p>
          <ul className="mt-2 space-y-1 text-13 text-mute">
            {quote.lines.map((l) => <li key={l.endpointId} className="num">{l.calls} x {l.endpointId} ({l.provider}) at {usd(l.priceMicros)} a call</li>)}
          </ul>
          <p className="mt-2 text-12 text-mute">{quote.priceSource === "catalog" ? "Live prices from the looot catalog." : "List prices dated 2026-10-10 (the catalog was not read)."}</p>
          {quote.overCap && <p className="mt-2 text-medium">Over the cap of {usd(quote.capMicros)} a run, set on the server in mentions.yaml. Searches that do not fit will be skipped.</p>}
          <button onClick={run} disabled={busy} className="mt-3 rounded-control bg-brand px-4 py-2 text-14 text-brand-ink">Search for up to {usd(quote.totalMicros)}</button>
        </div>
      )}
    </div>
  );
}
