# Changelog

Built from the GitHub release notes. Each version links to its release page.

## Unreleased

- Fix: the sign-in form could not be used in a browser. Chrome sends `Origin: null` for a same-origin form post under `Referrer-Policy: no-referrer`, and the same-origin check refused it with 403. The check now falls back to `Sec-Fetch-Site` for `null`.

## 0.1.6 (2026-10-11)

Spend limits, version 2. Before this, the only limit across runs was `monthlyCapUsd`, checked before a run and written after it. Two runs started together both passed, a run still going at looot counted as $0, and the idempotency key carried the day, so a repeat on a new day paid again.

What changed
- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, saved in `budget.json` in `LOOOT_MENTIONS_DATA_DIR` (default `.looot-data`). The signed-in owner changes it on the new Costs page (`PUT /api/budget`, session and CSRF token). `LOOOT_MENTIONS_DAILY_USD` and `LOOOT_MENTIONS_MONTHLY_USD` set the starting values. A `monthlyCapUsd` that your config file sets is still the starting monthly budget. A run request cannot raise the budget: one that carries a budget field is refused with 400. The cap per run still comes only from the server config; a cap in a request is ignored.
- Check order: the quote, the cap per run, an atomic reservation against the period budget, then the call.
- Reserve then settle: each paid call reserves its list price under a lock file before it is made, and is skipped if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back when looot answers with an error. A call still running keeps it and is never counted as $0. The next run looks up pending calls with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- Stable keys: the key was a hash of the keyword, input and the day. It is now a hash of the source, endpoint and normalised input, plus a 24-hour refresh window (`floor(time / 24 hours)`). No date or clock time goes in, and no call input carries one: the searches use the relative windows `week` and `qdr:w`, and a test fails if a date appears.
- Stored results: a finished call is stored under its key, so the same request inside the window is answered with no call and no charge. The up-front budget check ignores calls that have a stored answer.
- The sidebar spend panel and the Costs page show used, reserved and remaining for today and this month. The CLI prints what is left before a run and takes `--partial`. The run page answers HTTP 402 with the reason when the budget is reached.
- The call status `skipped_budget` is new: a call skipped because the period budget was reached.
- The daily GitHub Action keeps `budget.json` in `data/` and commits it with the mentions (`git add -f`, because `data/` is gitignored), so the budget carries over between runs.

For upgraders
- No migration. This repo has no database. `budget.json` is a new file. Run one instance on a persistent disk, since the file is not shared between hosts.
- Your data file is read as before. Its month-by-month `spend` figures are kept but no longer limit anything. The new budget starts at zero used, so the month you upgrade in has one fresh allowance.
- `monthlyCapUsd` is no longer checked on its own. It only sets the starting monthly budget.
- Keys changed shape, so the first run after upgrading pays once for calls that ran earlier the same day.
- `/api/budget` and `/costs` are new admin routes. The route map and its tests include them.

[Release page](https://github.com/loootai/looot-mentions/releases/tag/v0.1.6)

## 0.1.5 (2026-10-11)

TikTok and Instagram keyword search are back.

What changed
- TikTok source: `tiktok.search.videos`, endpoint `scrapecreators-tiktok-search-keyword`, $0.00188 a call. The parser follows the response the catalog documents.
- Instagram reels source: `instagram.reels.search`, endpoint `anyapi-run-instagram-reels-search`, $0.0015 a call. The catalog lists no field names, so the parser is tolerant and marked unverified.
- The default source list is now eight. One keyword on all eight costs $0.01001 (was $0.00663 on six). Set `sources:` in the config to keep the old six.
- The quote shows the provider next to each endpoint and its price, in the CLI plan and in the Run page.
- The Web source now also skips tiktok.com and instagram.com, so a post is not counted twice.
- Facebook posts by keyword and Hacker News stay dropped. The catalog has no endpoint for either. Hacker News is still a Google site search.

## 0.1.4 (2026-10-11)

Earlier versions (0.1.3 and older) had no admin authentication. Anyone who could reach a copy of the web UI could read the stored mentions and start paid looot runs on the operator's token. If you run one on a host other people can reach, upgrade to 0.1.4 now.

What changed
- Every page and API route is public on purpose or admin. Admin routes need a session. With no admin password set they refuse to serve and /login shows a setup page.
- Sign-in with MENTIONS_ADMIN_PASSWORD (12+ characters) or MENTIONS_ADMIN_PASSWORD_HASH (npm run hash-password). httpOnly, SameSite=Lax cookie, Secure in production, 8 hour expiry, lockout after 5 wrong passwords, CSRF token and same-origin check on every state-changing request.
- The spend cap for web runs now comes from mentions.yaml on the server. A cap or confirmedMaxUsd in a request body is ignored. POST /api/run needs the signed quote token from POST /api/quote. Each session gets 5 runs and 30 quotes per 10 minutes.
- Security headers on every response. Cache-Control: no-store on admin responses.
- Demo mode stays open with a "Demo, no sign-in" badge and refuses to start next to a LOOOT_TOKEN or a data file.

Upgrading
- Set MENTIONS_ADMIN_PASSWORD before starting the web UI, or every page redirects to the setup page.
- Any script that called /api/quote or /api/run must now sign in first, send the x-mentions-csrf header and pass quoteToken to /api/run.
- The CLI is unchanged and has no sign-in.

See "Securing a deployment" in the README.

[Release page](https://github.com/loootai/looot-mentions/releases/tag/v0.1.4)

## 0.1.3 (2026-10-10)

Sidebar: nested-item support in the shared shell

[Release page](https://github.com/loootai/looot-mentions/releases/tag/v0.1.3)

## 0.1.2 (2026-10-10)

Sidebar layout.

[Release page](https://github.com/loootai/looot-mentions/releases/tag/v0.1.2)

## 0.1.1 (2026-10-10)

Dependency security bump. next and eslint-config-next 16.3.7 to 16.3.8, which fixes six Next.js advisories (GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-cjq9-62q9-8jv4). No code changes. v0.1.0 is unchanged.

[Release page](https://github.com/loootai/looot-mentions/releases/tag/v0.1.1)

## 0.1.0 (2026-10-10)

First release. Six sources, dedupe, rule-based sentiment and intent, feed with filters, daily digest, CLI with --dry-run and spend caps, GitHub Actions cron. No paid looot run was made: parsing is built from catalog docs and fixtures.

[Release page](https://github.com/loootai/looot-mentions/releases/tag/v0.1.0)
