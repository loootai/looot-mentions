# Changelog

Built from the GitHub release notes. Each version links to its release page.

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
