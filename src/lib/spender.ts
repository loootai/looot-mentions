import type { LoootRunner } from "./looot";
import { toMicros } from "./money";

export type PriceMap = Record<string, number>;

export type CallStatus = "ok" | "pending" | "failed" | "skipped_cap" | "skipped_price";

export interface CallResult {
  status: CallStatus;
  raw?: unknown;
  /** What looot reported as charged. 0 for a failed or skipped call. */
  costMicros: number;
  runId?: string;
  error?: string;
}

export interface SpenderOptions {
  looot: LoootRunner;
  /** Hard cap for the whole run, in micros, checked against list prices before each call. */
  capMicros: number;
  prices: PriceMap;
  /** Endpoints whose live price could not be read. They are never called. */
  unpriced?: ReadonlySet<string>;
}

/**
 * Wraps every paid call. A call that would push the committed list-price total past the cap is skipped
 * and never sent. A run that is still going when waiting stops comes back as "pending", never as a failure.
 */
export class Spender {
  committedMicros = 0;
  actualMicros = 0;
  readonly calls: { endpointId: string; status: CallStatus }[] = [];

  constructor(private readonly o: SpenderOptions) {}

  /** Runs one endpoint under the cap. The idempotency key must be stable for the same input and endpoint. */
  async call(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<CallResult> {
    const result = await this.#call(endpointId, input, idempotencyKey);
    this.calls.push({ endpointId, status: result.status });
    return result;
  }

  async #call(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<CallResult> {
    if (this.o.unpriced?.has(endpointId)) return { status: "skipped_price", costMicros: 0, error: "The live price could not be read." };
    const price = this.o.prices[endpointId] ?? 0;
    if (this.committedMicros + price > this.o.capMicros) return { status: "skipped_cap", costMicros: 0, error: "The spend cap would be passed." };
    this.committedMicros += price;
    try {
      const run = await this.o.looot.runAndWait(endpointId, input, idempotencyKey);
      const cost = toMicros(run.actualCost);
      this.actualMicros += cost;
      if (run.status === "completed") return { status: "ok", raw: run.result, costMicros: cost, runId: run.runId };
      if (["failed", "blocked", "stopped"].includes(run.status)) return { status: "failed", costMicros: cost, runId: run.runId, error: run.error?.message ?? run.error?.code ?? run.status };
      return { status: "pending", costMicros: cost, runId: run.runId, error: `Still ${run.status} when waiting stopped. Read run ${run.runId} later.` };
    } catch (e) {
      return { status: "failed", costMicros: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
