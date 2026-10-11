import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ConfigError, buildConfig, parseConfig } from "@/engine/config";
import { renderDigest } from "@/engine/digest";
import { EMPTY_STORE, payableMicros, quoteOf, runMentions } from "@/engine/engine";
import { mergeRules } from "@/engine/rules";
import { ALL_SOURCES, FALLBACK_PRICES, PRICES_AS_OF } from "@/engine/sources";
import type { MentionsConfig, Store } from "@/engine/types";
import { DEMO_CONFIG, DEMO_NOW, fixtureRunner } from "@/demo/fixtures";
import { getBudget } from "@/lib/budgetService";
import { LoootError, loootFromEnv } from "@/lib/looot";
import { usd, usdPrecise } from "@/lib/money";
import { fetchPrices } from "@/lib/prices";
import { dayKey } from "@/lib/util";

const HELP = `Usage: npm run mentions -- [options]

Input, one of:
  --config <file>        YAML file: keywords, sources, maxSpendPerRunUsd, monthlyCapUsd, maxAgeDays.
  --keywords "a,b"       Inline keywords or brand names.
  --demo                 Sample data. No token, no network, no cost.

Options:
  --sources <list>       Comma list of ${ALL_SOURCES.join(",")}. Default all.
  --out <dir>            Where the daily digest goes, as YYYY-MM-DD.md. Default: digests
  --data <file>          Every mention and the spend so far. Default: data/mentions.json
  --rules <file>         Sentiment and intent rules (JSON). Default: config/rules.json
  --max-spend <usd>      Cap for this run. Default 0.25 (or maxSpendPerRunUsd in the config).
  --partial              Run until the cap or the period budget is reached, even when the quote is above what is left.
  --dry-run              Print the plan and the list-price cost. Make no call, write nothing.
  --help

Needs LOOOT_TOKEN in the environment, except with --demo or --dry-run.
The period budget (daily and monthly) lives in .looot-data/budget.json (LOOOT_MENTIONS_DATA_DIR). LOOOT_MENTIONS_DAILY_USD and
LOOOT_MENTIONS_MONTHLY_USD set the starting amounts (default 10 and 50) until the owner saves new ones in the web UI.`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function parse() {
  return parseArgs({
    options: {
      config: { type: "string" }, keywords: { type: "string" }, demo: { type: "boolean", default: false }, sources: { type: "string" },
      out: { type: "string", default: "digests" }, data: { type: "string", default: "data/mentions.json" }, rules: { type: "string" },
      "max-spend": { type: "string" }, "dry-run": { type: "boolean", default: false }, partial: { type: "boolean", default: false }, help: { type: "boolean", default: false },
    },
  }).values;
}

async function main(): Promise<void> {
  let args;
  try {
    args = parse();
  } catch (e) {
    fail(`${(e as Error).message}\n\n${HELP}`, 2);
  }
  if (args.help) return console.log(HELP);

  let config: MentionsConfig;
  try {
    if (args.demo) config = DEMO_CONFIG;
    else if (args.config) {
      const path = resolve(args.config);
      if (!existsSync(path)) fail(`No config at ${args.config}`, 2);
      config = parseConfig(readFileSync(path, "utf8"));
    } else if (args.keywords) config = buildConfig({ keywords: args.keywords.split(",").map((s) => s.trim()).filter(Boolean) });
    else return fail(`Give --config, --keywords or --demo.\n\n${HELP}`, 2);
    if (args.sources) config = buildConfig({ ...config, keywords: config.keywords, sources: args.sources.split(","), maxSpendPerRunUsd: config.maxSpendPerRunMicros / 1e6, monthlyCapUsd: config.monthlyCapMicros / 1e6 });
    if (args["max-spend"]) {
      const n = Number(args["max-spend"]);
      if (!Number.isFinite(n) || n <= 0) fail("--max-spend must be a positive number of dollars.", 2);
      config = { ...config, maxSpendPerRunMicros: Math.round(n * 1e6) };
    }
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message, 2);
    throw e;
  }

  const live = !args.demo && !args["dry-run"];
  const priced = live ? await fetchPrices(FALLBACK_PRICES) : { prices: FALLBACK_PRICES, source: "fallback" as const, unread: [] as string[] };
  const quote = quoteOf(config, priced.prices);
  console.log(`Plan: ${config.keywords.length} keyword(s) on ${config.sources.length} source(s), ${quote.calls.length} calls, list price ${usdPrecise(quote.totalMicros)} (${priced.source === "catalog" ? "live catalog prices" : `list prices dated ${PRICES_AS_OF}`}). Cap ${usdPrecise(config.maxSpendPerRunMicros)} a run, then the period budget.`);
  for (const l of quote.lines) console.log(`  ${String(l.calls).padStart(3)} x ${l.endpointId} (${l.provider})  ${usdPrecise(l.priceMicros)}`);
  if (quote.totalMicros > config.maxSpendPerRunMicros) console.log("The plan is over the run cap. Calls that do not fit are skipped.");
  if (args["dry-run"]) return console.log("Dry run: no looot call was made and nothing was written.");

  let looot = fixtureRunner;
  if (!args.demo) {
    try {
      looot = loootFromEnv();
    } catch (e) {
      if (e instanceof LoootError) fail("LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --demo or --dry-run.", 2);
      throw e;
    }
  }
  const dataPath = resolve(args.data);
  const store: Store = existsSync(dataPath) ? (JSON.parse(readFileSync(dataPath, "utf8")) as Store) : { ...EMPTY_STORE, spend: {}, mentions: [] };
  const now = args.demo ? DEMO_NOW : new Date();
  // Check order: the quote (above), the cap per run, the period budget, then the calls. Runs that ended since last time settle first.
  let ledger: ReturnType<typeof getBudget> | undefined;
  if (!args.demo) {
    ledger = getBudget();
    if ("getRun" in looot) await ledger.reconcile(looot as unknown as Parameters<typeof ledger.reconcile>[0], now).catch(() => undefined);
    const room = await ledger.status(now);
    console.log(`Budget left: ${usd(room.remainingMicros)} (${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month, ${usd(room.day.reservedMicros)} reserved).`);
    const toCharge = Math.min(await payableMicros(quote.calls, ledger, now, priced.prices), config.maxSpendPerRunMicros);
    if (toCharge > room.remainingMicros && !args.partial) {
      fail("Refused: the quote is above what is left of the period budget. Nothing ran. Wait for the period to roll over, raise the budget on the Costs page of the web UI, or pass --partial to run until it is reached.", 3);
    }
  }
  const rules = args.rules ? mergeRules(JSON.parse(readFileSync(resolve(args.rules), "utf8"))) : undefined;
  const result = await runMentions(config, store, { looot, prices: priced.prices, unpriced: new Set(priced.unread), now, rules, ledger });

  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, `${JSON.stringify(result.store)}\n`);
  const digest = renderDigest(result.fresh, { date: dayKey(now), reports: result.reports, chargedMicros: result.actualMicros });
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const digestPath = join(outDir, `${dayKey(now)}.md`);
  writeFileSync(digestPath, existsSync(digestPath) ? `${readFileSync(digestPath, "utf8").trimEnd()}\n\n---\n\n${digest}` : digest);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, digest);

  console.log(digest);
  const stopped = result.reports.find((r) => r.status === "skipped_budget");
  if (stopped) console.log(`${result.reports.filter((r) => r.status === "skipped_budget").length} calls skipped. ${stopped.error}`);
  console.log(`Digest: ${digestPath}\nData: ${dataPath}`);
  if (result.reports.length > 0 && result.reports.every((r) => r.status === "failed")) fail("Every call failed. See the digest for the errors.");
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
