@AGENTS.md

# NewsBrief — Real Project Home
**Last updated:** 4 July 2026

## What this is
NewsBrief: Ash's personal news briefing app. Next.js, deployed to Netlify (`netlify.toml` in this folder). Git remote: `ashytek/news-brief`.
This is the live project folder — a separate copy at `~/Desktop/Claude/News App/` is legacy notes only and holds no app code; don't confuse the two.

## Architecture (v2, since July 2026)
- **Transcripts**: Apify actor `codepoetry~youtube-transcript-ai-scraper` is primary (~$0.001/video). Language codes must be bare ISO (`en`, `hi`) — the actor rejects `en-GB`/`en-US`. Local fallback chain (yt-dlp → timedtext → capped AssemblyAI) retained for resilience.
- **Scheduling**: GitHub Actions cron, `.github/workflows/news-pipeline.yml`, 4×/day (03:17/09:17/15:17/21:17 UTC). Ash's Mac is retired from pipeline duty (launchd plist disabled, reversible).
- **Sources**: Supabase `sources` table — not a static config file.
- **Trust layer**: reader header shows pipeline health ("Checked Xh ago" / stale / "Pipeline down"). GitHub emails on workflow failure.
- Full history and rationale: `memory/news-app-v2-architecture.md` in the News-App project memory.

## Reliability follow-ups (14 July 2026)
- Docs were stale (root `README.md` was create-next-app boilerplate pointing at Vercel; `pipeline/README.md` described the retired local-Mac workflow and never mentioned Apify) — both rewritten to match v2. `pipeline/.env.example` was also silently gitignored by the blanket `.env*` rule (never committed) — now tracked, with `APIFY_TOKEN` added.
- Deleted `pipeline/cookies.txt` — unused on any active path (production has no cookie file configured) but was a stale, unencrypted dump of Ash's real browser session cookies. Pure cleanup, no functional change.
- Added a same-run transcript source-mix alert (`pipeline/get_transcripts.py` + `run_pipeline.py`): if Apify (primary) produces zero transcripts in a run while the fragile local fallback chain succeeds, pings the healthcheck `/fail` endpoint immediately instead of relying on the 3-run/~18h zero-story-streak check. **Needs `alter table pipeline_runs add column if not exists fetcher_mix jsonb;` run in Supabase** for the historical mix to persist — the alert itself works without it.
- Diagnosed transcript-layer fragility: the April–June reactive-fix churn (PoToken blocks, 429 handling, error misclassification) was structural to DIY YouTube scraping; the July Apify migration is a genuine fix, not another patch. Residual risk is silent primary-path degradation, which the alert above now covers. Remaining known gaps: single dependency on one third-party Apify actor (`codepoetry~youtube-transcript-ai-scraper`, no fallback actor), hardcoded `["en","hi"]` language list in the Apify request (adding a source in another language needs a code change), and healthchecks.io still isn't set up (so the `/fail` pings above currently have nowhere to land).

## Rules for this folder
- Read the relevant component only before changing code — not the whole repo. Use a subagent for repo-wide reviews.
- Verify changes with `npm run build` / local preview and show evidence before deploying.
- Deploy with `npm run deploy` (`npx netlify-cli deploy --prod --build`).
- Don't touch the disabled launchd plist (`~/Library/LaunchAgents/com.ashmac.newsbrief.plist.disabled`) or re-enable local pipeline scheduling without confirming with Ash — the cloud cron is now the source of truth.
- Never paste `.env.local` contents or API tokens into chat; if a token is ever pasted, flag it for rotation.
