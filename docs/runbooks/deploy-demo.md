# Deploying the demo (Vercel · Render · Supabase)

The topology is doc 21 with ADR 0001: `apps/web` on Vercel, `apps/api`,
`apps/q-api` and `apps/workers` on Render, the database and auth on a
Supabase cloud project. Nothing here is automated yet; these are the
steps in order, each one a thing you can verify before the next.

## 1. Supabase cloud project

1. Create a project (region close to your users; doc 21 §20-§22).
2. Link and push the migrations from this repository:

```bash
pnpm exec supabase link --project-ref <ref>
```

```bash
pnpm exec supabase db push
```

3. Authentication → Providers → Google: paste the client id and secret.
   In Google Cloud the authorised redirect URI is
   `https://<ref>.supabase.co/auth/v1/callback`.
4. Authentication → URL configuration: site URL `https://<your web domain>`,
   redirect URLs `https://<your web domain>/auth/callback`.
5. Note the project URL, the publishable (anon) key and the service-role
   key. The secret (service-role) key goes only to Render services, never to Vercel
   or the browser.

## 2. Render: api, q-api, workers

Create three Web Services (workers can be a Background Worker) from this
repository, Node 24, root directory the repo root:

| Service | Build command                                                                                    | Start command                            | Port |
| ------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------- | ---- |
| api     | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @capital-q/api... build`     | `pnpm --filter @capital-q/api start`     | 3001 |
| q-api   | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @capital-q/q-api... build`   | `pnpm --filter @capital-q/q-api start`   | 3002 |
| workers | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @capital-q/workers... build` | `pnpm --filter @capital-q/workers start` | n/a  |

Environment for each (same names as `.env.example`): `CAPITAL_Q_ENV=production`,
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`DATABASE_URL` (the pooled connection string), plus for q-api the model
and speech keys (`GROQ_API_KEY`, `GROQ_API_KEY_2`, `GEMINI_API_KEY`,
`DEEPGRAM_API_KEY`, `TAVILY_API_KEY`, `SERP_API_KEY`, `BRIGHT_DATA_API_KEY`)
and `Q_API_PUBLIC_URL=https://<q-api service>.onrender.com` (the Deepgram
agent calls back to this; no ngrok in the cloud). `CQ_API_URL` on q-api is
the api service's URL.

Health: Render pings `/` by default; point it at the service's health
path or leave the default 404-tolerant check.

## 3. Vercel: web

1. Import the repository, root directory `apps/web`, framework Next.js.
   Install command `corepack enable && pnpm install --frozen-lockfile`,
   build command `pnpm --filter @capital-q/web... build` (from the repo
   root; set "Root Directory" to the repo and "Output" to `apps/web/.next`,
   or use the monorepo preset).
2. Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `CQ_API_URL=https://<api>.onrender.com`,
   `CQ_Q_API_URL=https://<q-api>.onrender.com`, `CAPITAL_Q_ENV=production`,
   and `CQ_WEB_ORIGIN=https://<your web domain>` for the auth callbacks.
3. Preview deployments use the same Supabase project only if you accept
   the preview data rule in doc 21 §13; the safer default is a second
   Supabase project for previews.

## 4. First smoke, in order

1. Open the web domain, sign in with Google; you should land on `/welcome`.
2. Tap to begin: Q should greet you by voice. If it does not, the q-api
   log will say which key is missing (`voice channel composed` line).
3. Ask Q to look at a website; the `public research composed` line shows
   which indexes are configured.
4. Finish a founder setup, make the company visible, then as an investor
   ask Q about it.

## 5. What is not production-ready yet

- Voice session bindings and interview state are process-local: one
  q-api instance only until a shared store exists.
- Gemini runs under its reviewed posture again (migration 20260926 restored
  UNREVIEWED / PUBLIC after the 20260919-20260921 demo raise): it leads
  PUBLIC dialogue, synthesis and extraction; confidential customer work
  routes to Groq under zero retention. A reviewed paid tier is the route to
  a higher Gemini ceiling.
- The research memory is process-local and six hours; a restart empties it.
