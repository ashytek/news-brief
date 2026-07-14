# NewsBrief

Ash's personal news briefing app — tracks a curated set of YouTube sources, extracts and summarizes video transcripts, clusters related stories, and serves them as a reader UI.

For architecture, current status, and working rules, see [`CLAUDE.md`](./CLAUDE.md). For the ingestion pipeline (transcript extraction, summarization, clustering), see [`pipeline/README.md`](./pipeline/README.md).

## Stack

- **App**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Supabase (Postgres + auth)
- **Pipeline**: Python, runs on a GitHub Actions cron (`.github/workflows/news-pipeline.yml`), 4×/day
- **Hosting**: Netlify (`netlify.toml`, `@netlify/plugin-nextjs`)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Requires `.env.local` with Supabase and API keys — see `CLAUDE.md` for which variables are needed.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run deploy` | Build and deploy to Netlify (`netlify-cli deploy --prod --build`) |

## Deployment

Deploys to **Netlify**, not Vercel — run `npm run deploy` from this folder after verifying a local build. See `CLAUDE.md` for the full pre-deploy checklist.
