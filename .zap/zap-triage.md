# OWASP ZAP dynamic scan (DAST) — setup and triage

The SPPP names OWASP ZAP as the project's DAST tool and requires a scan of staging before a release
is promoted. The SR traceability table names ZAP as the verification method for SR-5 (HTTPS, HSTS,
secure cookies), SR-6 (injection and XSS) and SR-13 (supply chain), so this is graded evidence, not
optional hardening. Ticket: SCRUM-126.

## What runs, and when

`.github/workflows/zap.yml` runs the ZAP **baseline** scan against both staging targets:

| Target | URL                                         |
| ------ | ------------------------------------------- |
| SPA    | <https://safe-drop-five.vercel.app>         |
| API    | <https://safedrop-ony6.onrender.com/health> |

It runs weekly (Monday 07:00 UTC), on any `v*` tag (before a release is promoted), and on demand
from the Actions tab. It does **not** run on pull requests: a scan takes minutes, needs staging
awake, and staging only ever holds `main`, so a PR scan would report on code the PR does not have.

Baseline mode crawls the site and runs passive rules only. It never sends attack payloads, so it is
safe against a live environment.

Each run uploads `zap-spa` and `zap-api` artifacts (HTML, JSON and Markdown reports, kept 30 days)
and writes a summary of alerts by severity to the run's summary page.

### The agreed threshold

**A High-severity alert fails the build. Everything else is reported and triaged here.**

The gate is an explicit check of the JSON report (`riskcode >= 3`) rather than ZAP's own exit codes,
so the rule is visible in one place.

`.zap/rules.tsv` marks the alerts the team has accepted. That keeps them out of ZAP's console output
and out of the run summary, but **not** out of the JSON report, and the High gate counts every alert
in it — marking a rule IGNORE is a way to silence noise, never a way to accept a high-severity
finding. Changing an entry there without updating this file is how a finding gets quietly lost, so
change both in the same PR.

### Running it yourself

```bash
docker run --rm -v "$PWD/reports:/zap/wrk:rw" -v "$PWD/.zap:/zap/conf:ro" \
  ghcr.io/zaproxy/zaproxy:2.17.0 zap-baseline.py \
  -t https://safe-drop-five.vercel.app -c /zap/conf/rules.tsv \
  -r spa.html -J spa.json -w spa.md -m 5 -I
```

Wake the API first (`curl https://safedrop-ony6.onrender.com/health`). Render's free tier stops it
after 15 minutes idle, and a scan started during the cold start reads the timeouts as findings —
the first API scan run for this ticket failed exactly that way.

## Triage — baseline scan of 2026-09-19 (ZAP 2.17.0)

No High-severity findings on either target. The API, behind helmet, passed every header rule: it
already sends CSP, HSTS, COOP, CORP, `Referrer-Policy: no-referrer` and `X-Content-Type-Options`.
Every finding below is on the Vercel-hosted SPA unless stated otherwise.

| Rule                | Alert                                                            | ZAP risk | Decision                                               |
| ------------------- | ---------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| 10038               | Content Security Policy header not set                           | Medium   | **Fixed** — CSP added in `code/frontend/vercel.json`   |
| 10098               | Cross-Domain Misconfiguration (`Access-Control-Allow-Origin: *`) | Medium   | **Fixed** — header pinned to the SPA's own origin      |
| 10063               | Permissions Policy header not set                                | Low      | **Fixed** — `camera=(), microphone=(), geolocation=()` |
| 90004               | Cross-Origin-Opener-Policy missing                               | Low      | **Fixed** — `same-origin`                              |
| 90004               | Cross-Origin-Embedder-Policy missing                             | Low      | **Accepted** — see below                               |
| 10015, 10049, 10050 | Caching alerts (both targets)                                    | Info     | **Fixed on the API**, accepted on the SPA — see below  |
| 10027               | Information disclosure: suspicious comments                      | Info     | **Accepted** — see below                               |
| 10109               | Modern web application                                           | Info     | **Accepted** — informational fingerprint of an SPA     |

### Justifications for what was accepted

**Cross-Origin-Embedder-Policy (90004, Low).** `require-corp` buys cross-origin isolation, which
matters only for `SharedArrayBuffer` and high-resolution timers. SafeDrop uses neither, and the
policy would block any cross-origin asset that does not opt in with CORP — a trap for whoever later
adds a font or an image from a CDN. Revisit if the SPA ever needs cross-origin isolation.

**Caching on the SPA (10015, 10049, 10050, Info).** The files ZAP can reach without a session are
the app shell, the JS and CSS bundles, the favicon, `robots.txt` and `sitemap.xml`. They are public
by definition and are meant to be cached by the CDN. The same alerts on the **API** were a real
finding and were fixed rather than accepted: the API sent no cache headers at all, so a tenant's
JSON was storable and a `/health` verdict could be served stale. It now sends
`Cache-Control: no-store` on every response (`middleware/security.js`, covered by a test in
`tests/integration/app.test.js`).

**Suspicious comments (10027, Info).** The matches are the `AI-USAGE SUMMARY` header the course
requires in every file (it contains the words "from" and "admin") and identifiers in the minified
bundle. Re-check if this rule ever flags a comment that is neither.

## What this scan does not cover

Worth being honest about, because the SR table points at ZAP for three requirements:

- **SR-6 (injection, XSS) is only partly evidenced.** A baseline scan is passive. It reports what
  the responses look like; it does not try payloads. The injection defences are covered by backend
  tests instead (operator-injection attempts in `stubs.test.js` and the audit filter tests, plus
  Mongoose `sanitizeFilter` and `strictQuery: 'throw'`).
- **No authenticated coverage.** ZAP has no session, so it never reaches an `/api/*` route. The API
  has no HTML for the spider to follow either, so even unauthenticated API routes go unvisited.
  Fixing this properly means an OpenAPI description driving `zap-api-scan.py`, plus a throwaway
  database to point an active scan at. That is Iteration 2 work and needs its own ticket.
- **SR-13 (supply chain)** is covered by `npm audit --audit-level=high` in CI, not by ZAP.

## After changing the headers

The CSP and the other header fixes above live in `vercel.json` and only take effect once this is
merged and Vercel redeploys. Confirm afterwards by running the workflow from the Actions tab and
checking that rules 10038, 10098, 10063 and the COOP half of 90004 are gone, then update the table
above with the date of that run.
