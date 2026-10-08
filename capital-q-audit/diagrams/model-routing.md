# Model routing and provider paths (investigator F)

Sources: `packages/model-gateway/src/gateway.ts`, `policy/eligibility.ts`, `supabase/migrations/2026100813*`, `20261110000000*`, `20261207163000*`, `realtime/openai.ts`, `images/*`, `q-embeddings/src/infrastructure/openai-provider.ts`, `apps/q-api/src/voice/providers/*`.

```mermaid
flowchart TD
  subgraph Callers
    QA[Q answer / specialists] -->|taskClass, sensitivity=plan.maxSensitivity, dataPosture| GW
    TR[Turn reader FAST_CLASSIFICATION] --> GW
    WK[Workers / extraction / work agent] --> GW
  end
  GW[Model Gateway execute] --> CAT[(ai_ops catalog, 60s TTL)]
  GW --> ELIG{Eligibility per candidate}
  ELIG -->|SYNTHETIC_DEMO + attestation: skip ceilings| ORDER
  ELIG -->|else: sensitivity <= model ceiling AND provider-justified ceiling| ORDER
  ORDER[Policy order] --> P1
  subgraph Policies[Effective routing after 20261008130000, 20261110, 20261207163000]
    P1[dialogue / extraction / taxonomy: luna -> flash-lite -> flash]
    P2[synthesis / comparison / deep: luna -> flash -> flash-lite]
    P3[fast_classification: flash-lite -> luna -> flash, hedge 2000ms]
  end
  P1 & P2 & P3 --> OA[OpenAI adapter gpt-5.6-luna only, Responses API]
  P1 & P2 & P3 --> GG[Gemini adapter, ceiling PUBLIC, key rotation]
  GW --> LEDGER[(ai_ops.model_usage per attempt)]

  subgraph Outside routing policies
    RT[Duplex broker] -->|mint client_secret| ORT[OpenAI realtime gpt-realtime-mini + gpt-4o-transcribe]
    BROWSER[Browser WebRTC] -->|usage reports| RT
    RT --> LEDGER
    IMG[Images] --> GIMG[gemini-3.1-flash-lite-image / gpt-image-1]
    IMG -->|modelId ...022 collides with realtime row| LEDGER
    EMB[q-embeddings] --> OEMB[OpenAI text-embedding-3-small]
    EMB -.no ledger.-> X1[ ]
    VOICE[Standard voice line] --> DG[Deepgram flux STT / aura TTS] & EL[ElevenLabs v3 / turbo]
    DG -->|think| QAPI[q-api think endpoint] --> GW
  end
```
