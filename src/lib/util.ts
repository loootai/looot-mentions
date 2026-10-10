import { createHash } from "node:crypto";

export type Obj = Record<string, unknown>;

/** Narrows to a plain object, or an empty one. */
export const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

/** First non-empty string (numbers become text) among the candidates, or null. */
export function str(...vs: unknown[]): string | null {
  for (const v of vs) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** First finite number among the candidates, or undefined. */
export function num(...vs: unknown[]): number | undefined {
  for (const v of vs) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/** Finds the first array under any of the given keys, looking one level into `data` too. */
export function list(raw: unknown, keys: string[]): Obj[] {
  if (Array.isArray(raw)) return raw.map(obj);
  const o = obj(raw);
  for (const k of keys) if (Array.isArray(o[k])) return (o[k] as unknown[]).map(obj);
  const d = obj(o.data);
  for (const k of keys) if (Array.isArray(d[k])) return (d[k] as unknown[]).map(obj);
  if (Array.isArray(o.data)) return (o.data as unknown[]).map(obj);
  return [];
}

/** Short stable hash used for fingerprints and idempotency keys. */
export function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 20);
}

/** Host of a URL without www, or null. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Turns a date in any common form into ISO text, or null. Relative dates ("3 hours ago") give null. */
export function isoDate(v: unknown): string | null {
  if (typeof v === "number") {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v !== "string" || v.trim() === "" || /ago$/i.test(v.trim())) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** YYYY-MM-DD in UTC. */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Lower-cased URL without tracking params, hash or trailing slash, so one page has one fingerprint. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
