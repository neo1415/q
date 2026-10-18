# Memory and context retrieval for one answer

Source: `packages/model-gateway/src/q/index.ts:1561-2185, 2469-2555`; `apps/q-api/src/composition/q-intelligence.ts:287-371`; `packages/q-runtime/src/infrastructure/postgres-q-runtime-repositories.ts:621-648`. Nodes marked (not inspected) are wiring only.

```mermaid
flowchart LR
  subgraph Durable
    MSG[(conversation_messages)]
    MARK[(conversation_message_marks)]
    KN[(knowledge statements)]
    CH[(chunks: FTS + pgvector)]
    MEM[(memory store - not inspected)]
    REC[(canonical records: companies, relationships, schedule, approvals, Q work)]
  end
  subgraph InProcess[In-process only]
    CS[conversation core Maps: unclear, lastActed, sequences, focus, notices]
    WARM[warming / prereads Maps]
  end
  MSG -->|newest 64, minus marked, minus superseded utterances| H[history]
  MARK --> H
  H -->|last 6 x 400| TR[Turn reader]
  H -->|all earlier <=63, <=32k each| CONV[conversation variable]
  H -->|12 x 4000| SPEC[Company specialist]
  KN --> EV[createQEvidenceRetrieval]
  CH --> EV
  EV -->|context.assemble| FACTS[authorisedFacts + subjectDescription + institutionalNotes]
  MEM -->|memoryLearner.recall <=4000 chars| MV[MEMORY variable]
  REC -->|prefetch tools under plan| OWN[own facts: onboarding, mandate, standing, day, index, on-screen company/daily/document/page, named companies, relationship, pitch moment]
  OWN --> FACTS
  CS --> TR
  FACTS --> PROMPT[COMPANY_ANALYST v21 USER message<br/>fenced UNTRUSTED]
  CONV --> PROMPT
  MV --> PROMPT
  PROMPT --> LLM[Analyst model]
  LLM -->|userStatements, quote-checked| GATE[knowledge gate]
  LLM -->|profileUpdates/displayName| CARD[approval card]
  LLM -.->|withLearning wrapper| MEM
```
