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

## Rules for this folder
- Read the relevant component only before changing code — not the whole repo. Use a subagent for repo-wide reviews.
- Verify changes with `npm run build` / local preview and show evidence before deploying.
- Deploy with `npm run deploy` (`npx netlify-cli deploy --prod --build`).
- Don't touch the disabled launchd plist (`~/Library/LaunchAgents/com.ashmac.newsbrief.plist.disabled`) or re-enable local pipeline scheduling without confirming with Ash — the cloud cron is now the source of truth.
- Never paste `.env.local` contents or API tokens into chat; if a token is ever pasted, flag it for rotation.
