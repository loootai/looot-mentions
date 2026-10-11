---
name: mentions
description: Find and triage new mentions of a brand or keyword across Reddit, X, Hacker News, news, YouTube, TikTok, Instagram and the web with looot-mentions. Use when the user asks for brand monitoring, social listening, who is talking about a product, or a daily mentions digest.
---

# Mentions

Runs the `looot-mentions` CLI from the repository root. It tags each mention by source, sentiment and intent, and writes only what is new since the last run.

## Steps

1. Ask for the keywords and brand names (up to 20). Optional: words to exclude per keyword.
2. Price it first, free, no token needed:
   `npm run mentions -- --keywords "Acme,Acme Pro" --dry-run`
   Show the list-price total and wait for a yes. One keyword on all eight sources costs about $0.0100.
3. Run it with a cap:
   `LOOOT_TOKEN=$LOOOT_TOKEN npm run mentions -- --keywords "Acme,Acme Pro" --max-spend 0.10`
   If LOOOT_TOKEN is missing, tell the user to create an agent token in their looot settings (Agent tokens, scopes runs.execute, catalog.read, runs.read, usage.read) and export it. Never ask for it in chat. Setup details are in the README under "What you need".
4. Read `digests/<today>.md`. Lead with "Needs a reply", then comparisons. Report sources listed as "did not answer" as they are.
5. For a daily run, point the user at `.github/workflows/mentions.yml`: commit a `mentions.yaml` and add the `LOOOT_TOKEN` repository secret.

## Rules

- Quote before every paid run. Respect the cap.
- Sentiment and intent are word-list rules in `config/rules.json`. They are a first pass: say so, and quote the matched words.
- A source that is still running at looot is pending, not failed.
