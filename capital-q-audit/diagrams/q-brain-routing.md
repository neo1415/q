# Q brain routing (answer.ts decision ladder + separate brains)

Source: `packages/q-specialists/src/answer.ts:1960-3117`; prompt registry (54 ACTIVE). Brains marked (not inspected) were identified by prompt id only.

```mermaid
flowchart TD
  IN[Turn for Q] --> SURF{Surface}
  SURF -->|typed / standard voice line| SEAM[answerTurn]
  SURF -->|duplex call| RTM[Realtime voice model - OpenAI realtime<br/>calls ask_q; improvises on silence<br/>(not inspected)]
  RTM -->|ask_q| SEAM
  SURF -->|onboarding| IA[INTERVIEW_AGENT v16 (not inspected)]
  SURF -->|arrival| WC[WELCOME_CONDUCTOR v2 / web returning.ts (not inspected)]
  SURF -->|rehearsal| TW[INVESTOR_TWIN_TURN v10 (not inspected)]
  SURF -->|standing instruction| WF[Workforce: WORK_*, DRAFT_REVIEW v3, DRAFT_REDRAFT v3 (not inspected)]
  SURF -->|booked call| MH[MEETING_HOST_TURN v3 (not inspected)]

  SEAM --> S1{screenActOf regex?}
  S1 -->|yes| A1[UI_INTENT SCREEN_ACT]
  S1 -->|no| S2{pageAnswer: ordinal card / page by name?}
  S2 -->|yes| A2[UI_INTENT NAVIGATE / OPEN_RECORD_PAGE]
  S2 -->|no| R[TURN_READER v44 + DECISION_READER v2 in parallel]
  R --> H{spoken & heardAs?}
  H -->|yes| HR[insert heard line, re-run answerTurn]
  H -->|no| D{reply to waiting card?}
  D -->|yes| AD[approve/decline by code]
  D -->|no| N{addressedToQ=false / UNCLEAR?}
  N -->|spoken| SIL[SILENT - no answer]
  N -->|typed unclear| PR[one prompt]
  N -->|no| REF{reference open / retryLast?}
  REF -->|yes| OPN[openReferenced / repeatLastAction]
  REF -->|no| HANDS{hand: NAVIGATE / SET_VISIBILITY / PREPARE_DOCUMENT?}
  HANDS -->|yes| ACT[actOnTool]
  HANDS -->|no| APP{app action named / routed / waiting?}
  APP -->|yes| RUN[appActions.run -> card or line]
  APP -->|no| HO{handOver?}
  HO -->|yes| HOV[actOnHandOver / delegation]
  HO -->|no| ONCE[answerOnce]
  ONCE --> SP{company subject & specialist.supports & not ownRecords & not viewing?}
  SP -->|yes| CI[Company Intelligence specialist]
  SP -->|no| GA[Conversational analyst COMPANY_ANALYST v21<br/>NORMAL_DIALOGUE]
  GA --> FS{investor fit sweep hit?}
  FS -->|yes| CARDS[cards + templated summary, no model]
  FS -->|no| LOOP[tool loop + final structured]
```
