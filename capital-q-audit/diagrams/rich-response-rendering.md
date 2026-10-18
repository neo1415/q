# Rich response rendering (how a Q answer becomes visible UI)

Investigator E, HEAD 520bd123. Static reading only; see 06-GENERATIVE-UI.md for evidence.

## 1. From model output to blocks (server, q-api / model-gateway)

```mermaid
flowchart TD
  M[Analyst model structured output<br/>answer text, findings, missingEvidence,<br/>contradictions, clarifyingQuestions,<br/>answerCards v17, comparisonCards v12] --> A[analystResultBlocks<br/>model-gateway/src/q/result-blocks.ts:319]
  T[Run tool outcomes<br/>fit.profile / fit.top_candidates<br/>company reads] --> S[withCardSubjects<br/>card-subjects.ts: COMPANY only]
  T --> F[fitAnswerCardsBlock<br/>fit-cards.ts: code-built cards<br/>when model wrote none]
  P[Run's authorised subjects<br/>request.subjects] --> A
  A -->|ANSWER_CARDS| S
  A --> V{QResultBlocksSchema.safeParse<br/>result-blocks.ts:428}
  V -->|any block invalid| X[ALL blocks dropped<br/>answer is text only]
  V -->|ok| B[blocks on QResponseMessage]
  TL[Typed client-action tools<br/>open_page, show, control_screen,<br/>control_document, set_theme...] --> UI[UI_INTENT blocks]
  UI --> B
  WEB[research_public_web] --> PS[PUBLIC_SOURCE blocks]
  PS --> B
  B --> STREAM[SSE stream to typed asker]
  B --> ROOM[QRoomFeed.publish<br/>q-api/src/room/feed.ts<br/>process-local Map]
```

## 2. From blocks to screen (web)

```mermaid
flowchart TD
  STREAM[typed run stream] --> CONV[useQConversation -> turnsFrom<br/>conversation.ts]
  ROOMR[/api/q-room long poll<br/>only while voice line active<br/>room-feed.ts/] --> ABS[q.absorb + reread<br/>q-session.tsx:289-313]
  ABS --> CONV
  CONV --> SPLIT{block kind}
  SPLIT -->|PUBLIC_SOURCE, FINDING,<br/>UNCERTAINTY| EV[Sources chip<br/>q-evidence.tsx]
  SPLIT -->|COMPANY_REFERENCE /<br/>INVESTOR_REFERENCE| CHIP[Companies / Investors chip<br/>q-answer.tsx]
  SPLIT -->|COMPARISON, COMPARISON_CARDS,<br/>CLARIFICATION, ARTIFACT_REFERENCE,<br/>UI_INTENT| INL[Inline QResultBlocks<br/>q-result-blocks.tsx]
  SPLIT -->|ANSWER_CARDS| STAGE[QPresenceStage -> StageCanvas/AnswerCanvas<br/>centre column over Q presence]
  SPLIT -->|UI_INTENT SHOW_IN_Q_ROOM| RS[roomStage: one card open<br/>room-stage.ts] --> RC[QRoomStage card<br/>loadRoomCardAction reads as the person]
  SPLIT -->|UI_INTENT NAVIGATE / client action| FOLLOW[q-session follow: router.push<br/>or performClientAction]
  SPLIT -->|ACTION_PROPOSAL| AP[display only] -.-> NOW[QNow Approve/Decline<br/>q.state.approval]
  STAGE --> BOARD[Board / Shown recently]
  SAID[cq:q-said events<br/>Q's spoken lines] --> FOCUS[focusForSaid: card named comes into focus]
  FOCUS --> STAGE
```

## 3. Arrival briefing vs. the side columns (the founder's "cards by the sides")

```mermaid
sequenceDiagram
  participant P as /home (HomeScreen, server)
  participant W as ReturningWelcome (welcome)
  participant AB as ArrivalBriefing
  participant AS as arrival-store
  participant SA as arrivalBriefingAction (server)
  participant QC as QConversationPanel
  participant V as Voice line
  P->>QC: welcome = ReturningWelcome (only if no ?c= and RETURNING)
  QC->>QC: lines.length === 0 -> pre-conversation branch: ArrivalRoom(left slot, Q, right slot) + welcome
  W->>AB: render (fallback "Welcome back, X.")
  AB->>AS: useArrival -> decideArrival (sessionStorage gate)
  AS->>SA: getQWorkSince, pendingApprovals, workforce, done, notices
  SA-->>AS: ArrivalData {cards: APPROVAL|HELD only}
  AB->>AB: flank = wide && slots mounted && card active -> portal cards into side slots
  QC->>V: talk(): firstMessage = arrival words
  V-->>QC: onLine("q", greeting) -> spokenOnly line
  QC->>QC: lines.length > 0 -> conversing branch (no ArrivalRoom, no welcome)
  Note over AB: ArrivalBriefing unmounts: side cards vanish,<br/>card decider unregistered, standing note cleared
  Note over QC: ArrivalDock returns null on /home: no card surface remains
```
