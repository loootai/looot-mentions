/** Money is integer micro-dollars everywhere. 1 dollar is 1,000,000 micros. */
export const MICROS = 1_000_000;

/** Dollars (number or numeric string, as looot returns them) to micros. */
export function toMicros(usd: number | string | null | undefined): number {
  if (usd === null || usd === undefined || usd === "") return 0;
  const n = typeof usd === "number" ? usd : Number(usd);
  return Number.isFinite(n) ? Math.round(n * MICROS) : 0;
}

/** Amounts and quotes: at least four decimals under one dollar ($0.0152), two from one dollar up. */
export function usdPrecise(micros: number): string {
  const v = micros / MICROS;
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(micros % 100 === 0 ? 4 : 5)}`;
}
