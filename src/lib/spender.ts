import type { Ledger } from "./budget";
import { LoootError, TERMINAL_STATUSES, type LoootRunner } from "./looot";
import { toMicros } from "./money";

export type PriceMap = Record<string, number>;

export type CallStatus = "ok" | "pending" | "failed" | "skipped_cap" | "skipped_price" | "skipped_budget";

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
  /** Period budget, reservations and stored results. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  /** The clock for the ledger. Defaults to now. */
  now?: Date;
}

/**
 * Wraps every paid call. Check order: a stored answer to the same request, the live price, the per-run cap, an atomic
 * reservation against the period budget, then the call. A call over the cap or the budget is skipped and never sent.
 * The reservation becomes the real cost when the call ends and goes back when looot answers with an HTTP error.
 * A run that is still going when waiting stops comes back as "pending", keeps its reservation, and is never counted as $0.
 */
export class Spender {
  committedMicros = 0;
  actualMicros = 0;
  readonly calls: { endpointId: string; status: CallStatus }[] = [];

  constructor(private readonly o: SpenderOptions) {}

  /** Runs one endpoint under the cap and the budget. The idempotency key must be stable for the same input and endpoint. */
  async call(endpointId: string, input: Record<string, unknown>, idempotencyKey: string, fingerprint = ""): Promise<CallResult> {
    const result = await this.#call(endpointId, input, idempotencyKey, fingerprint);
    this.calls.push({ endpointId, status: result.status });
    return result;
  }

  /** A ledger write that fails (a locked file) must not hide a call that already ran. The reservation then stays until the next reconcile or the hard expiry. */
  async #quiet(fn: () => Promise<void> | undefined): Promise<void> {
    try {
      await fn();
    } catch {
      // The call result is already in hand. The reservation stays held, which errs on the side of spending less.
    }
  }

  async #call(endpointId: string, input: Record<string, unknown>, key: string, fp: string): Promise<CallResult> {
    const ledger = this.o.ledger;
    const at = this.o.now ?? new Date();
    const stored = await ledger?.recall(key, fp, at);
    if (stored) return { status: "ok", raw: stored.result, costMicros: 0, runId: stored.runId };
    if (this.o.unpriced?.has(endpointId)) return { status: "skipped_price", costMicros: 0, error: "The live price could not be read." };
    const price = this.o.prices[endpointId] ?? 0;
    if (this.committedMicros + price > this.o.capMicros) return { status: "skipped_cap", costMicros: 0, error: "The spend cap would be passed." };
    // Commit before the first await, so calls started together all see each other against the per-run cap.
    this.committedMicros += price;
    let reserved = false;
    if (ledger) {
      let held: Awaited<ReturnType<Ledger["reserve"]>>;
      try {
        held = await ledger.reserve(key, price, at, fp);
      } catch (e) {
        this.committedMicros -= price;
        return { status: "failed", costMicros: 0, error: e instanceof Error ? e.message : String(e) };
      }
      if (!held.ok) {
        this.committedMicros -= price;
        return { status: "skipped_budget", costMicros: 0, error: held.message };
      }
      reserved = !held.shared;
    }
    try {
      const run = await this.o.looot.runAndWait(endpointId, input, key);
      const cost = toMicros(run.actualCost);
      this.actualMicros += cost;
      if (!TERMINAL_STATUSES.has(run.status)) {
        // Still running at looot: the reservation stays until the run ends. It is never recorded as failed at zero.
        await this.#quiet(() => ledger?.attach(key, run.runId));
        return { status: "pending", costMicros: cost, runId: run.runId, error: `Still ${run.status} when waiting stopped. Read run ${run.runId} later. Its budget stays reserved until it ends.` };
      }
      await this.#quiet(() => ledger?.settle(key, fp, cost, at, run.status === "completed" ? run : undefined));
      if (run.status === "completed") return { status: "ok", raw: run.result, costMicros: cost, runId: run.runId };
      return { status: "failed", costMicros: cost, runId: run.runId, error: run.error?.message ?? run.error?.code ?? run.status };
    } catch (e) {
      // An HTTP answer from looot means the call did not run, so the reservation goes back. Anything else (a network
      // error) is unknown: the request may have been accepted, so the reservation stays until a replay or the hard expiry.
      if (reserved && e instanceof LoootError) await ledger?.release(key).catch(() => undefined);
      return { status: "failed", costMicros: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
