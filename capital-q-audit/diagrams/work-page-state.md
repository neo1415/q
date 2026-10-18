# Work page state: where each number and row comes from

Source files: `apps/web/app/(app)/work/page.tsx`, `apps/web/src/features/work/work-page.tsx`, `decision-queue.tsx`, `decisions.ts`, `notice-groups.ts`, `workforce-agents.ts`.

```mermaid
flowchart TD
  subgraph Server reads on page load
    AP[GET /v1/q/approvals: approvals PENDING and expires_at > now, postgres-repositories.ts:397-412]
    WK[listWorkAction: delegations, lanes]
    DN[listDoneAction: instruction_steps DONE plus finished delegations]
    SG[listSuggestionsAction]
    WF[loadWorkforceAction: workforce_jobs, runs, drafts, grades, outcomes, approvals]
  end
  subgraph Client polling
    NT[useNotices: communication.notifications, every 60s]
    WL[useWorkforceLive: team re-read]
  end
  AP --> DG[decisionGroups: one APPROVAL item per card]
  WF --> HDS[heldDecisions: latest draft per counterpart with outcome HELD within 7 days, not dismissed in localStorage]
  HDS --> DG
  NT --> NG[groupNotices: unread NEEDS_YOU, folded by kind+title+link]
  WK --> TL[timeLanes: lanes NEEDS_TIMES]
  DG --> CNT["Needs you count = items in groups + timeLanes + notices (lead fix 2026-10-08)"]
  NG --> CNT
  TL --> CNT
  CNT --> UI{count == 0?}
  UI -- yes --> Z["Nothing waits on you..."]
  UI -- no --> L[Queue rows]
  DG --> MSG{view.action.actionType == 'chat.message.send'?}
  MSG -- yes --> MC[Message card: quote + approve / edit / dismiss]
  MSG -- "no, e.g. app.chat.message.send from instructions" --> GP[Generic ApprovalPlan view D-15]
  WF --> TM[Team map: run states; LEAD of INSTRUCTION jobs hidden between firings; DELEGATED_WORK lead stays 'Working' D-11]
```

## Known divergences between the page and the real state

| Real state                                 | What the page shows                                                                          | Defect     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------- |
| One near-miss draft that has become a card | Two rows: an APPROVAL row and a HELD row ("Send as is" is offered while the card is pending) | D-03, D-13 |
| One instruction card                       | Counted twice: the card itself and the "1 thing needs your yes" notice                       | D-13       |
| A card older than 24 h with no decision    | Gone from the queue; the engine keeps holding the conversation                               | D-01       |
| A DELEGATED_WORK job whose work is idle    | LEAD shown as "Working"                                                                      | D-11       |
