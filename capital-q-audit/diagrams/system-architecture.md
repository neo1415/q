# System architecture (investigator A)

Sources: `.railway/railway.ts`, `apps/*/src/main.ts`, `apps/web/app/api/*`, `packages/*/package.json`. Details in `02-SYSTEM-ARCHITECTURE.md`.

## Deployment and runtime

```mermaid
flowchart LR
  subgraph Browser
    UI["Next.js client\n(Q store, voice hooks)"]
  end
  subgraph Railway["Railway project Q (europe-west4, 1 replica each)"]
    WEB["@capital-q/web :3000\nNext 16 server, proxy.ts,\nserver actions, /api/* proxies"]
    API["@capital-q/api :3001\nFastify, 219 routes +\n131 app-action routes"]
    QAPI["@capital-q/q-api :3002\nQ runtime, SSE, voice, room,\n~10 setInterval schedulers"]
    WRK["@capital-q/workers (no HTTP)\noutbox publisher, pgmq consumers,\ntickers, doc pipeline"]
  end
  subgraph Supabase
    AUTH["Supabase Auth"]
    PG[("Postgres via Supavisor\n(app role: postgres, BYPASSRLS)\n21 schemas / 262 tables\npgmq: domain-events, documents,\nrecommendation-refresh")]
    ST[("Storage\n4 buckets")]
  end
  CF["Cloudflare Stream"]
  LLM["OpenAI (primary), Gemini, Groq"]
  RT["OpenAI Realtime (duplex)"]
  DG["Deepgram STT/Agent/TTS"]
  EL["ElevenLabs Speech Engine/TTS"]
  RS["Tavily / Bright Data / SerpAPI\nCompanies House / SEC"]
  RC["Recall.ai meeting bots"]
  GW["Google Gmail/Calendar"]
  ML["SMTP/Brevo, Postmark inbound,\nWeb Push, Stripe(unused)"]
  TEI["TEI embeddings\n(NOT deployed)"]

  UI -- cookie session --> WEB
  UI -- WebRTC (ephemeral) --> RT
  UI -- wss --> DG
  UI -- sdk --> EL
  UI -- HLS signed --> CF
  UI -- auth --> AUTH
  WEB -- "Bearer (from cookie)" --> API
  WEB -- "Bearer; SSE proxy; long-poll /v1/q/room" --> QAPI
  API -- "private CQ_Q_API_URL (interview)" --> QAPI
  QAPI -- "private CQ_API_URL" --> API
  API -- getUser per request --> AUTH
  QAPI -- getUser per request --> AUTH
  API --> PG
  QAPI --> PG
  WRK --> PG
  API --> ST
  WRK --> ST
  API --> CF
  QAPI --> LLM
  QAPI --> RT
  DG -- "think callback /chat/completions" --> QAPI
  EL -- "think callback" --> QAPI
  QAPI --> RS
  WRK --> RS
  QAPI --> RC
  RC -- webhook --> QAPI
  WRK --> GW
  API --> GW
  API --> ML
  WRK --> ML
  WRK --> LLM
  QAPI -. "unreachable; lexical only" .-> TEI
  PG -- "NOTIFY run events / work wake" --> QAPI
```

## Event and background flow

```mermaid
flowchart TB
  DOM["Domain write (api / q-api / workers)\n+ insert events.outbox in same tx"] --> OB[("events.outbox")]
  OB --> PUB["workers OutboxPublisher\nregistry.parse(payload)"]
  PUB -- valid --> Q1[("pgmq domain-events")]
  PUB -- "q.action.* (not in workers registry)" --> STUCK["EVENT_SCHEMA_INVALID x10\n657 rows stuck"]
  Q1 --> H["workers handlers: relationship projection,\nchat/interest/outcome notices, Q work wake,\nnewly-ready company, verification, deck reading"]
  H -- "NOTIFY Q_WORK_WAKE_CHANNEL" --> QW["q-api work runtime / instruction sweep"]
  subgraph q-api timers
    T1["instruction sweep 60s"]
    T2["approved-action sweep 2m"]
    T3["orphaned-run sweep"]
    T4["errands 60s (kill switch)"]
    T5["work tick 60s"]
    T6["meeting assistant"]
    T7["scout 6h"]
  end
```

## Package graph (workspace runtime dependencies)

Layers (L0 = no workspace deps). No cycles; no package imports an app.

```mermaid
flowchart BT
  subgraph L0["L0"]
    contracts; config; observability; email; ui
  end
  subgraph L1_L2["L1-L2"]
    database; q_core; api_client; deck_render; q_embeddings; security; eventing; billing
  end
  subgraph L3_L8["L3-L8 domain contexts"]
    audit; organisations; companies; investors; capital; evidence; media; taxonomy; verification; network; onboarding; gateq; public_identity; readiness; platform_admin; q_artifacts; q_presence; q_research
  end
  subgraph L9_L10["L9-L10 Q core runtime"]
    q_runtime; permissions; communication; integrations; model_gateway; q_actions; q_firewall; q_knowledge; q_orchestrator; discovery
  end
  subgraph L11_L14["L11-L14 Q composition"]
    app_actions; q_tools; q_specialists; q_connectors; q_daily; founder_onboarding; investor_onboarding; gateq_intake; results; q_evals
  end
  WEBAPP["apps/web (9 pkgs)"] --> api_client
  WEBAPP --> q_core
  APIAPP["apps/api (36 pkgs)"] --> app_actions
  QAPIAPP["apps/q-api (48 pkgs)"] --> q_specialists
  QAPIAPP --> q_tools
  WRKAPP["apps/workers (34 pkgs)"] --> eventing
  api_client --> contracts
  security --> database
  database --> config
  model_gateway --> q_runtime
  model_gateway --> evidence
  q_tools --> app_actions
  q_specialists --> q_tools
  q_specialists --> model_gateway
  q_orchestrator --> q_runtime
```

Full adjacency (from package.json `dependencies`, `@capital-q/*` only):

```
apps/api -> [app-actions,audit,billing,capital,communication,companies,config,contracts,database,deck-render,discovery,eventing,evidence,founder-onboarding,gateq,gateq-intake,integrations,investor-onboarding,investors,media,model-gateway,network,observability,onboarding,organisations,permissions,platform-admin,public-identity,q-core,q-knowledge,q-runtime,readiness,results,security,taxonomy,verification]
apps/q-api -> [app-actions,audit,billing,capital,communication,companies,config,contracts,database,deck-render,discovery,email,eventing,evidence,founder-onboarding,gateq,gateq-intake,integrations,investor-onboarding,investors,media,model-gateway,network,observability,onboarding,organisations,permissions,platform-admin,public-identity,q-actions,q-artifacts,q-connectors,q-core,q-daily,q-embeddings,q-firewall,q-knowledge,q-orchestrator,q-presence,q-research,q-runtime,q-specialists,q-tools,readiness,results,security,taxonomy,verification]
apps/web -> [api-client,config,contracts,founder-onboarding,gateq,investor-onboarding,onboarding,q-core,ui]
apps/workers -> [audit,billing,capital,communication,companies,config,contracts,database,discovery,eventing,evidence,founder-onboarding,integrations,investor-onboarding,investors,media,model-gateway,network,observability,onboarding,organisations,permissions,platform-admin,q-artifacts,q-core,q-daily,q-embeddings,q-knowledge,q-presence,q-research,q-specialists,security,taxonomy,verification]
packages/api-client -> [contracts]
packages/app-actions -> [capital,communication,companies,contracts,discovery,evidence,integrations,investors,media,network,onboarding,organisations,permissions,platform-admin,public-identity,q-runtime,readiness,security,verification]
packages/audit -> [contracts,database,security]
packages/billing -> [contracts,database]
packages/capital -> [audit,companies,contracts,database,eventing,security]
packages/communication -> [contracts,database,email,network,security]
packages/companies -> [audit,config,contracts,database,eventing,organisations,security]
packages/config -> []
packages/contracts -> []
packages/database -> [config]
packages/deck-render -> [contracts]
packages/discovery -> [companies,contracts,database,investors,network,observability,permissions,q-embeddings,security,taxonomy]
packages/email -> []
packages/eventing -> [contracts,database]
packages/evidence -> [audit,companies,contracts,database,eventing,observability,security]
packages/founder-onboarding -> [audit,capital,companies,contracts,database,eventing,evidence,observability,onboarding,organisations,q-core,q-knowledge,security,taxonomy]
packages/gateq -> [audit,contracts,database,observability,security]
packages/gateq-intake -> [audit,contracts,database,email,gateq,model-gateway,observability,q-core,security]
packages/integrations -> [contracts,database,email,network,observability,security]
packages/investor-onboarding -> [audit,contracts,database,eventing,investors,observability,onboarding,organisations,q-core,security,taxonomy]
packages/investors -> [audit,contracts,database,eventing,organisations,security,taxonomy]
packages/media -> [audit,companies,contracts,database,eventing,observability,security]
packages/model-gateway -> [contracts,database,evidence,observability,q-core,q-runtime,security]
packages/network -> [audit,companies,contracts,database,eventing,investors,security]
packages/observability -> []
packages/onboarding -> [companies,contracts,database,eventing,investors,observability,security]
packages/organisations -> [audit,contracts,database,email,eventing,security]
packages/permissions -> [audit,capital,companies,contracts,database,eventing,investors,network,security]
packages/platform-admin -> [contracts,database,security]
packages/public-identity -> [audit,contracts,database,security]
packages/q-actions -> [audit,contracts,database,eventing,observability,q-runtime,security]
packages/q-artifacts -> [contracts,database,observability,security]
packages/q-connectors -> [contracts,observability,q-runtime,q-tools,security]
packages/q-core -> [contracts]
packages/q-daily -> [contracts,database,email,model-gateway,observability,q-core,q-research]
packages/q-embeddings -> [config,contracts,observability]
packages/q-evals -> [audit,capital,companies,config,contracts,database,eventing,evidence,gateq,gateq-intake,investors,model-gateway,network,observability,permissions,q-actions,q-core,q-embeddings,q-firewall,q-knowledge,q-orchestrator,q-runtime,q-specialists,q-tools,security]
packages/q-firewall -> [capital,contracts,evidence,investors,observability,permissions,q-runtime,security]
packages/q-knowledge -> [config,contracts,database,evidence,observability,q-core,q-embeddings,q-runtime,security]
packages/q-orchestrator -> [contracts,observability,q-runtime,security]
packages/q-presence -> [contracts,database,observability,security]
packages/q-research -> [contracts,observability,security]
packages/q-runtime -> [audit,capital,companies,contracts,database,evidence,investors,network,observability,organisations,security]
packages/q-specialists -> [contracts,database,deck-render,model-gateway,observability,q-core,q-knowledge,q-runtime,q-tools,security]
packages/q-tools -> [app-actions,capital,companies,contracts,discovery,evidence,investors,observability,permissions,q-research,q-runtime,security]
packages/readiness -> [contracts,database,security]
packages/results -> [contracts,database,deck-render,discovery,security]
packages/security -> [contracts,database]
packages/taxonomy -> [audit,companies,contracts,database,eventing,observability,security]
packages/test-support -> []
packages/ui -> []
packages/verification -> [audit,companies,contracts,database,eventing,security]
```
