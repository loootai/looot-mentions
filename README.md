<p align="center"><img src="assets/hero.png" alt="looot-mentions" width="100%"></p>

# looot-mentions

[![License](https://img.shields.io/github/license/loootai/looot-mentions)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-mentions)](https://github.com/loootai/looot-mentions/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

Brand and keyword listening in the open. Give it keywords and brand names. It searches Reddit, X, Hacker News, news, YouTube and the web through [looot](https://looot.ai), removes duplicates, tags each mention by source, sentiment and intent, and shows a feed with filters and a daily digest. A headless CLI writes only what is new since the last run to markdown, so it runs from a daily GitHub Actions cron.

An open-source alternative to Brand24 and Mention. On 2026-10-10 Brand24 listed $249 a month for its Individual plan ($199 billed yearly). Mention's pricing page showed no figure. Here one keyword on all six sources costs about $0.0066 per run, so 3 keywords daily is about $0.60 a month.

![Feed](docs/screenshots/feed-light.png)

| Light | Dark |
| --- | --- |
| ![Digest, light](docs/screenshots/digest-light.png) | ![Digest, dark](docs/screenshots/digest-dark.png) |

## What it does

- Searches 6 sources per keyword and keeps a mention only when it contains the keyword and none of your exclusion words.
- Dedupes by canonical URL and by normalised title, so a story syndicated under ten URLs counts once and a link with tracking parameters matches the clean one.
- Tags sentiment (positive, neutral, negative) with word lists and shows the words that produced the label. Tags intent (complaint, question, recommendation request, comparison) with patterns. Both lists live in [config/rules.json](config/rules.json) and you can edit them.
- Feed with filters for keyword, source, sentiment and intent, plus text search.
- Daily digest, grouped as "Needs a reply" (complaints, questions, recommendation requests), comparisons and everything else, with the sources that did not answer listed at the bottom.
- Shows the list-price cost before any paid action, enforces a cap per run and a cap per month.

## Sources

| Source | looot job | Endpoint | List price per call |
| --- | --- | --- | --- |
| Reddit | `reddit.post.search` | `scrapecreators-reddit-search` | $0.00188 |
| X | `x.post.search` | `anyapi-run-twitter-search` | $0.00075 |
| Hacker News | `google.serp.organic` | `serper-search` with `site:news.ycombinator.com` | $0.0010 |
| News | `news.search` | `serper-news` | $0.0010 |
| YouTube | `youtube.search.videos` | `tikhub-api-youtube-web-search-video` | $0.0010 |
| Web | `google.serp.organic` | `serper-search`, excluding the sites above | $0.0010 |

looot has no Hacker News provider, so Hacker News is a Google search limited to that site. It finds stories and discussions that Google indexed, not every comment.

Prices are list prices read from the free public catalog on 2026-10-10. A real run re-reads them first and refuses to call an endpoint whose live price it cannot read.

Cost of a typical run, one keyword on all six sources at list price: $0.00663. Two keywords: $0.0133. A daily run of 3 keywords costs about $0.0199 a day.

Dropped, because looot has no provider for it: Facebook and Instagram posts by keyword, TikTok keyword search (providers exist, not wired here), podcasts, forums outside Reddit and Hacker News, review sites as a source, share of voice, influence scores and alerts on volume spikes.

## Run it

Three ways, one engine.

```bash
npm install
npm run demo          # web UI with sample data on http://localhost:3232, no token, no network
npm run mentions -- --demo
```

Headless CLI:

```bash
cp mentions.example.yaml mentions.yaml           # or pass --keywords "Acme,Acme Pro"
npm run mentions -- --config mentions.yaml --dry-run      # prints the plan and the list-price cost, no call
LOOOT_TOKEN=... npm run mentions -- --config mentions.yaml
```

Options: `--sources reddit,news`, `--out digests`, `--data data/mentions.json`, `--rules config/rules.json`, `--max-spend <usd>`. Each run writes `digests/YYYY-MM-DD.md` with the new mentions and keeps every mention in `data/mentions.json`. The second run on a day appends to that day's digest.

Web UI on live data: `LOOOT_TOKEN=... npm run dev`. It reads `data/mentions.json`. The Run page asks for a quote first (free), then searches for up to the quoted amount. Supabase is not used and no sign-in exists. Put the UI behind your own auth if you host it.

## Daily run on GitHub Actions

[.github/workflows/mentions.yml](.github/workflows/mentions.yml) runs at 06:23 UTC every day, writes the digest, and commits `digests/` and `data/`.

1. Fork or copy this repo and commit your own `mentions.yaml`.
2. Add the repository secret `LOOOT_TOKEN` (Settings, Secrets and variables, Actions).
3. Run it once with "Run workflow" and tick `dry_run` to see the cost.

Until the secret exists the job ends with a notice and spends nothing. The workflow passes `actionlint` 1.7.12. The caps in the config file apply, so a run never passes `maxSpendPerRunUsd` and the job stops before any call when the month's spend would pass `monthlyCapUsd`.

## Money rules

- The quote comes first: `--dry-run` in the CLI, and the Run page shows it before the search button appears.
- The run cap is checked against list prices before each call. A call that would pass it is skipped and never sent.
- The month cap is checked before the run starts, from the spend recorded in `data/mentions.json`.
- Each call carries an idempotency key made from the keyword, the call input, the endpoint and the day. A second run on the same day replays the stored run and charges nothing more.
- A call still going when waiting stops (60 seconds) is "pending", not "failed", and the digest says so. Failed calls are not charged by looot.

## Install for agents

- Read [llms.txt](llms.txt).
- Claude Code skill: copy `skills/mentions` to `~/.claude/skills/mentions`. It prices the run, asks for a yes, runs the CLI and leads with what needs a reply.
- Requires an agent token from https://looot.ai/settings in `LOOOT_TOKEN`.

## What is not tested

No paid looot run was made. The code and fixtures follow the endpoint descriptions in the looot catalog and the parsers of the sibling repo [looot-monitor](https://github.com/loootai/looot-monitor). The Reddit, X, news and Google parsers reuse shapes from that repo. The YouTube parser searches the response for a list of videos because the exact nesting is not documented, and it is built from a hand-written fixture, so expect to adjust field names after your first real run. Sentiment by word list misses sarcasm and reads "recommend a tool" as neutral on purpose. Treat labels as a first pass: the feed shows the matched words so you can check each one. The GitHub Actions workflow was linted but not run, because it needs a repository secret. All demo brands are invented.

## Develop

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run leak-scan
git config core.hooksPath .githooks
```

## Licence

MIT, copyright looot.

## Related

Other open-source projects built on [looot](https://looot.ai):

- [looot-intent](https://github.com/loootai/looot-intent): account intent and buying-stage scoring (6sense)
- [looot-score](https://github.com/loootai/looot-score): lead and ICP fit scoring (MadKudu)
- [looot-reveal](https://github.com/loootai/looot-reveal): which companies visit your site (RB2B, Clearbit Reveal)
- [looot-techstack](https://github.com/loootai/looot-techstack): website technologies from several providers (BuiltWith, Wappalyzer)
- [looot-signals](https://github.com/loootai/looot-signals): hiring, funding and news triggers (TheirStack, Harmonic)
- [looot-lookalike](https://github.com/loootai/looot-lookalike): lookalike company search (Ocean.io)
- [looot-ads](https://github.com/loootai/looot-ads): competitor ad board (Foreplay)
- [looot-reviews](https://github.com/loootai/looot-reviews): review themes and weak spots (ReviewTrackers)
- [looot-battlecards](https://github.com/loootai/looot-battlecards): competitor battlecards (Klue, Crayon)
- [looot-warm-leads](https://github.com/loootai/looot-warm-leads): warm leads from LinkedIn intent signals (Gojiberry)
- [looot-crm](https://github.com/loootai/looot-crm): a small CRM with buying signals built in
- [looot-seo](https://github.com/loootai/looot-seo): self-hosted SEO workspace
- [looot-monitor](https://github.com/loootai/looot-monitor): brand and competitor monitoring with alerts
