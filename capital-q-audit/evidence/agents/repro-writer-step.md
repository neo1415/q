# Evidence: reproduction - a planned WRITER step blocks a workforce job's reply

- Ran locally on 2026-10-08 against `packages/q-orchestrator/dist/workforce/index.js` (built output; dist contains the same 'No agent can do this step' and DRAFT_ROLES code as src/job-runner.ts:164-168 and src/plan.ts:66,107). No network, no providers.
- Why: JOB_PLAN v1 tells the lead Q 'Every message to the other side is written by WRITER and graded by REVIEWER; plan them as steps' (workforce.v1.ts:353-356), but createWorkforceExecutors (apps/q-api/src/composition/workforce/jobs.ts:333-338) has no WRITER/REVIEWER executor.

## Script (scratchpad, not committed)
```js
import { boundPlan, runJob } from "/home/user/q/packages/q-orchestrator/dist/workforce/index.js";
const permitted = new Set(["list_messages","chat.message.send"]);
const planned = [
  { key: "draft", role: "WRITER", tools: [], goal: "Draft the reply", dependsOn: [] },
  { key: "grade", role: "REVIEWER", tools: [], goal: "Grade it", dependsOn: ["draft"] },
  { key: "reply", role: "CONVERSATION", tools: ["list_messages","chat.message.send"], goal: "Send the reply", dependsOn: ["grade"] },
];
const bound = boundPlan(planned, { permitted, budgetUsd: 0.4 });
let n = 0;
const recorder = { startRun: async () => `run${n++}`, endRun: async () => {}, handoff: async () => {} };
let conversationRan = false;
const out = await runJob({ jobId: "j", goal: "Reply to Zino", steps: bound.steps,
  executors: { CONVERSATION: async () => { conversationRan = true; return { status: "DONE", summary: "Replied" }; } },
  recorder });
console.log(JSON.stringify({ refused: bound.refused, steps: out.steps.map(s => [s.key, s.status, s.summary]), conversationRan }, null, 1));
```

## Output
```json
{
 "refused": [],
 "steps": [
  [
   "draft",
   "HELD",
   "No agent can do this step on its own; it needs you."
  ],
  [
   "grade",
   "SKIPPED",
   "Waited on Writer, which did not finish."
  ],
  [
   "reply",
   "SKIPPED",
   "Waited on Reviewer, which did not finish."
  ]
 ],
 "conversationRan": false
}
```
