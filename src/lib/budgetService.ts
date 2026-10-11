import { Budget, budgetFile, defaultLimits, type BudgetStatus } from "./budget";
import { legacyMonthlyCapUsd } from "./serverConfig";
import { isDemo } from "./store";
import { toMicros } from "./money";

/** The period budget file, in the data folder (LOOOT_MENTIONS_DATA_DIR, default .looot-data). */
export function getBudget(env: Record<string, string | undefined> = process.env): Budget {
  const limits = defaultLimits(env);
  // A monthlyCapUsd that an older config file set on purpose is still the starting monthly budget, unless the environment sets one.
  const legacy = legacyMonthlyCapUsd(env);
  if (legacy !== undefined && !env.LOOOT_MENTIONS_MONTHLY_USD) {
    const monthlyMicros = toMicros(legacy);
    return new Budget(budgetFile(env), { dailyMicros: Math.min(limits.dailyMicros, monthlyMicros), monthlyMicros });
  }
  return new Budget(budgetFile(env), limits);
}

/** Used, reserved and remaining for today and this month. Read only. */
export async function budgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  return getBudget().status(now);
}

/** Owner only (the route checks the session and the CSRF token). Saves the daily and monthly budget in dollars. */
export async function setBudget(input: { dailyUsd: unknown; monthlyUsd: unknown }): Promise<BudgetStatus> {
  if (isDemo()) throw new Error("Demo mode has no budget to change.");
  const b = getBudget();
  await b.setLimits({ dailyMicros: toMicros(Number(input.dailyUsd)), monthlyMicros: toMicros(Number(input.monthlyUsd)) });
  return b.status();
}
