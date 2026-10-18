# Capital Q staging — Railway backend, Vercel web

The operational companion to
`docs/adr/0014-railway-replaces-render-for-node-services.md`. That ADR records
_why_; this records _how to run it_.

No secret value appears in this file, and none may be added to it.

## Topology

```
apps/web      Vercel                    public
apps/api      Railway  capital-qapi     public
apps/q-api    Railway  capital-qq-api   public   <- speech provider calls back here
apps/workers  Railway  capital-qworkers PRIVATE  <- never given a public domain
database      hosted Supabase (eu-central-1 session pooler)
```

Railway project `Q`, environment `production`. That environment name is
Railway's default, **not** a Capital Q production claim: the services run with
`CAPITAL_Q_ENV=staging`. Region is `europe-west4` (EU West, Netherlands),
because EU data residency is a requirement, not a preference.

## Configuration is in the repository

`.railway/railway.ts` is the source of truth for service source, build
command, start command, healthcheck, region, replicas and non-secret
variables.

```bash
railway config plan     # read-only preview; safe
railway config apply    # applies, and triggers a deploy per changed service
```

`railway config plan` needs the `railway` npm package installed at the root —
the CLI evaluates the authoring file with it. It is a root devDependency for
exactly that reason.

> **Windows note.** The SDK's CLI-version guard runs
> `execFileSync(process.env._ || "railway")`, which cannot execute the
> `railway.cmd` shim, and Git Bash exports `_` pointing somewhere else
> entirely. Both fail with a misleading "requires Railway CLI 5.42.1 or newer"
> even on a newer CLI. Point `_` at the real binary first:
>
> ```powershell
> $env:_ = 'C:\Users\DELL\AppData\Roaming\npm\node_modules\@railway\cli\bin\railway.exe'
> ```

### Whole-project applies delete what the file omits

`@capital-q/web` is still declared in `.railway/railway.ts`, pinned to `main`
and byte-for-byte as Railway's GitHub import created it, purely so that
applying the file neither redeploys nor deletes it. Delete that block and the
Railway service together, once Vercel serves staging.

## Why the build command is what it is

A leaf deployable cannot be built alone. Every workspace package resolves
through `dist` (`packages/contracts` exports `./dist/index.js`, with no `src`
condition), and `turbo.json` declares `build` with `dependsOn: ["^build"]`, so
Turborepo owns build ordering.

```bash
pnpm deploy:build:api        # turbo run build --filter=@capital-q/api...
pnpm deploy:build:q-api
pnpm deploy:build:workers
```

Railway invokes those root scripts, so the build has one definition and can be
reproduced from a clean clone. A bare `pnpm --filter @capital-q/api build`
builds none of the 30 workspace dependencies and fails with hundreds of
cascading TS2307 errors that are **not** source defects. That is how the first
Railway deployments failed.

Start commands invoke `node apps/<service>/dist/main.js` directly rather than
`pnpm run start`, so the process receiving `SIGTERM` is Node itself.
`apps/workers` registers its own `SIGINT`/`SIGTERM` handlers and a package
manager in between is not guaranteed to forward the signal.

Verify a deployment build locally, from a clean checkout rather than a
development tree full of prebuilt `dist`:

```bash
git worktree add ../q-clean <sha>
cd ../q-clean && pnpm install --frozen-lockfile
pnpm deploy:build:api --force   # --force, or turbo replays a cached build and proves nothing
```

## Environment variables

Names only. Values are set once, per service, and live only in Railway:

```bash
# reads the value from stdin, so it never enters argv or shell history
echo "<value>" | railway variable set NAME --service @capital-q/api --stdin --skip-deploys
```

In `.railway/railway.ts` every secret is declared `preserve()`, which
version-controls the _name_ while leaving the value in Railway.

Each service gets only what its configuration schema reads.
`DATABASE_PRIVILEGED_URL` is deliberately absent everywhere:
`createPrivilegedDatabaseClient` has no caller outside tests.

| Variable                              | api | q-api | workers | secret |
| ------------------------------------- | :-: | :---: | :-----: | :----: |
| `NODE_ENV`                            |  ●  |   ●   |    ●    |        |
| `CAPITAL_Q_ENV` (= `staging`)         |  ●  |   ●   |    ●    |        |
| `REGION`, `LOG_LEVEL`                 |  ●  |   ●   |    ●    |        |
| `PORT`                                |  ●  |   ●   |         |        |
| `DATABASE_URL`                        |  ●  |   ●   |    ●    |   ✱    |
| `DATABASE_CONNECTION_MODE`            |  ●  |   ●   |    ●    |        |
| `SUPABASE_URL`                        |  ●  |   ●   |    ●    |        |
| `SUPABASE_PUBLISHABLE_KEY`            |  ●  |   ●   |         |        |
| `SUPABASE_SECRET_KEY`                 |  ●  |       |    ●    |   ✱    |
| `GEMINI_API_KEY`, `GEMINI_API_KEY2`   |  ●  |   ●   |    ●    |   ✱    |
| `GROQ_API_KEY`, `GROQ_API_KEY_2`      |  ●  |   ●   |    ●    |   ✱    |
| `CQ_API_URL`                          |     |   ●   |         |        |
| `Q_API_PUBLIC_URL`                    |     |   ●   |         |        |
| `TAVILY_API_KEY`                      |     |   ●   |         |   ✱    |
| `BRIGHT_DATA_API_KEY`, `SERP_API_KEY` |     |   ●   |         |   ✱    |
| `DEEPGRAM_API_KEY`                    |     |   ●   |         |   ✱    |
| `ELEVENLABS_API_KEY`                  |     |   ●   |         |   ✱    |
| `ELEVENLABS_SPEECH_ENGINE_ID(_MALE)`  |     |   ●   |         |   ✱    |
| `Q_VOICE_EXPRESSIVE`                  |     |   ●   |         |        |
| `CQ_MALWARE_POLICY`                   |     |       |    ●    |        |

`PORT` is set explicitly (api 3001, q-api 3002) rather than left to Railway's
injected value, so the private address peers use is deterministic. `HOST`
already defaults to `0.0.0.0` in `packages/config/src/common.ts`; no
application change was needed for the platform's port.

### Two variables that must not be set

- **`CQ_SYNTHETIC_DEMO_ROUTING`.** `createSyntheticDemoRoutingAllowance`
  (`packages/model-gateway/src/policy/synthetic-demo.ts`) admits only
  `CAPITAL_Q_ENV` of `local`/`test` **and** a loopback database host, and
  **throws at startup** otherwise. Staging is `staging` against hosted
  Supabase, so setting this both crashes the service and asserts something
  false. Staging Q traffic runs under its ordinary confidentiality ceiling.
- **`Q_EMBEDDING_BASE_URL`.** Left unset. Outside `local` there is no
  loopback default: startup logs it as missing and no request is made. No
  embedding runtime is deployed, so semantic retrieval degrades to lexical,
  which is the designed behaviour. Pointing it at a public host is rejected by
  `isPrivateEmbeddingHost` on purpose: that runtime holds confidential
  document text.

### Never browser-exposed

`SUPABASE_SECRET_KEY`, `DATABASE_URL`, and every Groq / Gemini / Tavily /
Bright Data / SERP / Deepgram / ElevenLabs key are server-side only. The only
browser-safe web variables are `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Networking

`q-api` reaches `api` privately at `http://capital-qapi.railway.internal:3001`.
Worker traffic never leaves the private network. `workers` has no public
domain and must not be given one (doc 21, IDA-033).

`Q_API_PUBLIC_URL` resolves to `https://${{RAILWAY_PUBLIC_DOMAIN}}` — the
q-api service's own Railway domain. This is what replaces the ngrok tunnel the
speech provider used to call back to.

**No CORS layer is required, and none exists.** The browser only ever talks to
the web origin: `apps/web` proxies Q's event stream server-side through
`/api/q-stream/...`, and `CQ_API_URL` / `CQ_Q_API_URL` are server-only
variables. If a future packet makes the browser call `api` or `q-api` directly,
CORS becomes a real requirement — do not add `Access-Control-Allow-Origin: *`
to credentialed endpoints.

## Health

Railway reporting "deployed" is not health. Both HTTP services expose:

```
/health/live     process is up
/health/ready    dependencies are reachable   <- Railway's healthcheck path
```

`workers` has no listener; it is healthy when it is `RUNNING` and its log shows
the outbox and document loops started.

## Known limitations

- No embedding runtime is deployed, so hosted retrieval is lexical only.
  `render.yaml`'s `capital-q-embeddings` service is the shape this would take.
- `apps/api` and `apps/q-api` rely on Fastify `onClose` hooks and register no
  explicit `SIGTERM` handler, so shutdown depends on the platform's drain
  window. Pre-existing; not introduced by this deployment.
- `render.yaml` is superseded (ADR 0014) and must not be applied. It sets
  `CQ_WEB_ORIGIN` on the API service, which is wrong: only `apps/web` reads it.
